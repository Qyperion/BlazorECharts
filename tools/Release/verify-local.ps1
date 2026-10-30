#Requires -Version 5.1
<#
.SYNOPSIS
The local release gate: runs every source, browser and package check of one committed source tree in
order and writes a fail-closed report.

.DESCRIPTION
Stages, requirements and verdicts are described in docs/compatibility/release-checklist.md.
-OutputPath must be new, empty or an earlier output of the release tools (it holds a .blazorecharts-output
file); only these entries are replaced:
  verification-report.json, verification-report.md   the report with its verdict
  source.json, release-plan.json                      source identity and the release plan check
  logs/                                               one log per command stage
  gate-fixtures/, dotnet-test/, js-test/, generator-test/, playwright/<stage>/   test results
  browser-matrix.json                                 the browser matrix of this run
  packages/, aot/                                     output of package.ps1 and test-aot.ps1
Exit codes: 0 PASS, 1 FAIL, 2 BLOCKED.
Needs git, the pinned .NET SDK, Node.js and npm, the wasm-tools workload, artifacts/upstream and
artifacts/generator (npm run assets:acquire, npm run docs:acquire), Google Chrome, Microsoft Edge and the
Playwright Firefox build. Apart from npm ci it installs nothing.
#>
param(
    [Parameter(Mandatory)][string]$SourceRoot,
    [Parameter(Mandatory)][string]$OutputPath,
    [string]$Configuration = 'Release',
    [string]$Version = '0.1.0-local',
    [string]$RepositoryUrl,
    [string]$RepositoryCommit
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'ReleaseTools.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'VerificationGate.psm1') -Force

function Get-ToolVersion([string]$FilePath, [string[]]$Arguments) {
    $saved = $ErrorActionPreference
    try { $ErrorActionPreference = 'Continue'; "$(& $FilePath @Arguments 2>$null | Select-Object -First 1)".Trim() }
    catch { $null }
    finally { $ErrorActionPreference = $saved }
}

try {
    foreach ($name in @('SourceRoot', 'OutputPath')) {
        $value = (Get-Variable -Name $name).Value
        if ($value -and -not [System.IO.Path]::IsPathRooted($value)) { throw "-$name must be an absolute path, got '$value'." }
    }
    $SourceRoot = Resolve-FullPath $SourceRoot
    $OutputPath = Resolve-FullPath $OutputPath
    if (-not (Test-Path -LiteralPath (Join-Path $SourceRoot 'BlazorECharts.slnx'))) { throw "$SourceRoot is not the BlazorECharts source root." }
    if ($OutputPath -eq $SourceRoot -or (Test-PathInside $SourceRoot $OutputPath) -or (Test-PathInside $OutputPath (Join-Path $SourceRoot 'src'))) {
        throw 'OutputPath must not be the source root, one of its parents, or inside src.'
    }
    if ($Configuration -notmatch '^[A-Za-z][A-Za-z0-9_-]*$') { throw "Configuration '$Configuration' is not a build configuration name." }
    if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') { throw "Version '$Version' is not a SemVer 2.0 version." }
    if ([string]::IsNullOrEmpty($RepositoryUrl) -ne [string]::IsNullOrEmpty($RepositoryCommit)) { throw 'Pass RepositoryUrl and RepositoryCommit together.' }

    $owned = @('logs', 'gate-fixtures', 'dotnet-test', 'js-test', 'generator-test', 'playwright', 'packages', 'aot',
        'source.json', 'release-plan.json', 'browser-matrix.json', 'verification-report.json', 'verification-report.md')
    Reset-OutputEntries -Path $OutputPath -Remove $owned | Out-Null

    $startedAt = (Get-Date).ToUniversalTime().ToString('o')
    $identity = Get-SourceIdentity -SourceRoot $SourceRoot
    $tree = $identity.tree
    Write-Host "Verifying commit $($identity.commit), tree $tree"
    $script:Requirements = @()

    $windows = [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
    $npm = if ($windows) { 'npm.cmd' } else { 'npm' }
    if ($windows) {
        # The generator extracts archives to W:\... paths; a GNU tar from Git Bash earlier in PATH reads them as remote hosts.
        $env:Path = "$(Join-Path $env:SystemRoot 'System32');$env:Path"
    }
    $powershell = (Get-Process -Id $PID).Path
    $playwright = 'node_modules/@playwright/test/cli.js'
    $vitest = 'node_modules/vitest/vitest.mjs'
    [xml]$solution = Get-Content -LiteralPath (Join-Path $SourceRoot 'BlazorECharts.slnx') -Raw
    $testProjects = @($solution.SelectNodes('//Project') | Where-Object {
        (Get-Content -LiteralPath (Join-Path $SourceRoot $_.GetAttribute('Path')) -Raw) -match '<IsTestProject>true</IsTestProject>' } |
        ForEach-Object { [System.IO.Path]::GetFileNameWithoutExtension($_.GetAttribute('Path')) })
    $testCounts = Get-StageTestCounts

    function New-Stage([string]$Id, [string]$Title, [hashtable]$Settings = @{}) {
        $definition = @{ Id = $Id; Title = $Title; WorkingDirectory = $SourceRoot }
        foreach ($key in $Settings.Keys) { $definition[$key] = $Settings[$key] }
        $definition
    }
    function New-NpmStage([string]$Id, [string]$Script) { New-Stage $Id "npm run $Script" @{ FilePath = $npm; ArgumentList = @('run', $Script); DependsOn = @('npm-ci') } }
    function Get-BrowserEnvironment([string]$Output) {
        # An empty value removes the variable that would add the performance project.
        @{ BLAZOR_ECHARTS_PLAYWRIGHT_OUTPUT = (Join-Path $OutputPath $Output); BLAZOR_ECHARTS_MATRIX_REPORT = (Join-Path $OutputPath 'browser-matrix.json')
            BLAZOR_ECHARTS_TEST_CONFIGURATION = $Configuration; BLAZOR_ECHARTS_PERFORMANCE = '' }
    }
    function New-BrowserStage([string]$Id, [string]$Title, [hashtable]$Settings = @{}) {
        $specs = @((Get-BrowserStageSpecs)[$Id])
        $output = "playwright/$Id"
        $test = @{ Kind = 'playwright'; Path = "$output/results.json"; Specs = $specs; Counts = (Get-BrowserSpecCounts) }
        if ($Settings.ContainsKey('AllowSkipped')) { $test.AllowSkipped = $Settings.AllowSkipped; $Settings.Remove('AllowSkipped') }
        $workers = @()
        if ($Settings.ContainsKey('Workers')) { $workers = @("--workers=$($Settings.Workers)"); $Settings.Remove('Workers') }
        # Filters are regular expressions over the spec path, anchored so that wordcloud.spec.ts does not select compatibility/wordcloud.spec.ts.
        $stage = New-Stage $Id $Title @{
            FilePath = 'node'; ArgumentList = @($playwright, 'test', '--config', 'tests/browser/playwright.config.ts') + $workers + @($specs | ForEach-Object { "tests/browser/$_`$" })
            Environment = (Get-BrowserEnvironment $output); DependsOn = @('npm-ci', 'build'); Artifacts = @("$output/results.json"); Tests = @($test)
        }
        foreach ($key in $Settings.Keys) { $stage[$key] = $Settings[$key] }
        $stage
    }
    function New-VitestStage([string]$Id, [string[]]$Projects) {
        $results = "$Id/results.json"
        New-Stage $Id "Vitest $($Projects -join ', ')" @{ FilePath = 'node'; DependsOn = @('npm-ci'); Artifacts = @($results)
            ArgumentList = @($vitest, 'run', '--config', 'vitest.config.ts') + @($Projects | ForEach-Object { '--project', $_ }) + @("--outputFile=$(Join-Path $OutputPath $results)")
            Tests = @(@{ Kind = 'vitest'; Path = $results; Expected = $testCounts[$Id] }) }
    }

    $repositoryArguments = if ($RepositoryUrl) { @('-RepositoryUrl', $RepositoryUrl, '-RepositoryCommit', $RepositoryCommit) } else { @() }
    $definitions = @(
        (New-Stage 'gate-fixtures' 'Release gate fixtures' @{ FilePath = $powershell
            ArgumentList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'test-verification-gate.ps1'), '-SourceRoot', $SourceRoot, '-WorkPath', (Join-Path $OutputPath 'gate-fixtures'))
            Artifacts = @('gate-fixtures/fixtures.json'); Tests = @(@{ Kind = 'fixtures'; Path = 'gate-fixtures/fixtures.json'; Expected = $testCounts['gate-fixtures'] }) }),
        (New-Stage 'source-tree' 'One committed source tree' @{ Artifacts = @('source.json'); Check = {
            $identity | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $OutputPath 'source.json') -Encoding UTF8
            # The Test-* functions return one array; @() + appends its items instead of nesting it.
            $failures = @() + (Test-SourceIdentity $identity)
            if ($RepositoryCommit -and $RepositoryCommit -ne $identity.commit) { $failures += "RepositoryCommit $RepositoryCommit is not the verified commit $($identity.commit)." }
            @{ failures = $failures; details = [ordered]@{ commit = $identity.commit; tree = $identity.tree; untracked = $identity.untracked } }
        } }),
        (New-Stage 'release-plan' 'Release checklist, browser stages, CI, release and demo site workflows and blob sizes' @{ Artifacts = @('release-plan.json'); Check = {
            $script:Requirements = Read-ReleaseChecklist -Path (Join-Path $SourceRoot 'docs/compatibility/release-checklist.md')
            $specs = Get-BrowserSpecFiles -SourceRoot $SourceRoot
            $blobs = Get-HeadBlobSizes -SourceRoot $SourceRoot
            $failures = @() + (Test-ReleaseChecklist -Requirements $script:Requirements -StageIds (Get-GateStageIds)) +
                (Test-BrowserSpecAssignment -SpecFiles $specs -Assignments (Get-BrowserStageSpecs)) + (Test-ForbidOnly -SourceRoot $SourceRoot) +
                (Test-ForbidExpectedFailures -SourceRoot $SourceRoot) + (Test-VerifyWorkflow -Path (Join-Path $SourceRoot '.github/workflows/verify.yml')) +
                (Test-ReleaseWorkflow -Path (Join-Path $SourceRoot '.github/workflows/release.yml')) + (Test-PagesWorkflow -Path (Join-Path $SourceRoot '.github/workflows/pages.yml')) +
                (Test-RestoreSources -PropsPath (Join-Path $SourceRoot 'Directory.Build.props')) + (Test-BlobSizes -Blobs $blobs)
            $modules = @($testCounts['dotnet-test'].Keys)
            foreach ($project in $testProjects) { if ($modules -notcontains $project) { $failures += "Test project $project has no expected number of passing tests." } }
            foreach ($module in $modules) { if ($testProjects -notcontains $module) { $failures += "An expected test count is set for $module, which is not a test project of the solution." } }
            [ordered]@{ requirements = $script:Requirements; browserStages = (Get-BrowserStageSpecs); specCounts = (Get-BrowserSpecCounts); testCounts = $testCounts; specs = $specs; failures = $failures } |
                ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $OutputPath 'release-plan.json') -Encoding UTF8
            @{ failures = $failures }
        } }),
        (New-Stage 'npm-ci' 'npm ci' @{ FilePath = $npm; ArgumentList = @('ci', '--no-audit', '--no-fund') }),
        (New-Stage 'restore' 'dotnet restore --locked-mode' @{ FilePath = 'dotnet'; ArgumentList = @('restore', 'BlazorECharts.slnx', '--locked-mode', '-nologo') }),
        (New-Stage 'build' "dotnet build -c $Configuration" @{ FilePath = 'dotnet'; DependsOn = @('restore')
            ArgumentList = @('build', 'BlazorECharts.slnx', '-c', $Configuration, '--no-restore', '-nologo', '-tl:off')
            Check = { @{ failures = @() + (Test-BuildLog -Path (Join-Path $OutputPath 'logs/build.log')) } } }),
        (New-NpmStage 'generate-check' 'generate:check'),
        (New-NpmStage 'snapshots-check' 'snapshots:check'),
        (New-NpmStage 'api-check' 'api:check'),
        (New-NpmStage 'assets-check' 'assets:check'),
        (New-NpmStage 'typecheck-generator' 'typecheck:generator'),
        (New-NpmStage 'typecheck-runtime' 'typecheck:runtime'),
        (New-Stage 'dotnet-test' 'dotnet test' (Get-DotnetTestStage -OutputPath $OutputPath -Configuration $Configuration -TestProjects $testProjects)),
        (New-VitestStage 'js-test' 'javascript'),
        (New-VitestStage 'generator-test' @('generator', 'generator-parallel')),
        (New-NpmStage 'docs-check' 'docs:check'),
        (New-BrowserStage 'browser-catalog' 'Series, components and demo catalog'),
        (New-BrowserStage 'browser-interop' 'Functions, events, methods and runtime'),
        (New-BrowserStage 'browser-lifecycle' 'Lifecycle, hosting, WordCloud and export'),
        (New-BrowserStage 'wordcloud-compatibility' 'WordCloud exact pair' @{ FilePath = $npm; ArgumentList = @('run', 'test:compatibility') }),
        (New-BrowserStage 'browser-matrix' 'Browser matrix' @{ AllowSkipped = $true; Artifacts = @('playwright/browser-matrix/results.json', 'browser-matrix.json'); Check = {
            $matrix = Test-BrowserMatrix -Path (Join-Path $OutputPath 'browser-matrix.json') -Required (Get-RequiredBrowsers)
            @{ failures = $matrix.failures; blockers = $matrix.blockers; details = [ordered]@{ browsers = $matrix.browsers } }
        } }),
        # Resource lifetime measures the page heap and owned resources: one worker, no neighbouring test.
        (New-BrowserStage 'browser-resources' 'Resource lifetime' @{ Workers = 1 }),
        (New-Stage 'packages' 'package.ps1' @{ FilePath = $powershell; DependsOn = @('npm-ci', 'restore')
            ArgumentList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'package.ps1'), '-SourceRoot', $SourceRoot,
                '-OutputPath', (Join-Path $OutputPath 'packages'), '-Configuration', $Configuration, '-Version', $Version) + $repositoryArguments
            Artifacts = @('packages/packages-manifest.json', 'packages/feed/*.nupkg', 'packages/feed/*.snupkg')
            Tests = @(@{ Kind = 'playwright'; Path = 'packages/consumers/playwright/results.json'; Expected = $testCounts['packages'] }) }),
        (New-Stage 'aot' 'test-aot.ps1' @{ FilePath = $powershell; DependsOn = @('packages')
            ArgumentList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'test-aot.ps1'), '-SourceRoot', $SourceRoot,
                '-PackageDirectory', (Join-Path $OutputPath 'packages'), '-ResultsDirectory', (Join-Path $OutputPath 'aot'))
            Artifacts = @('aot/aot-manifest.json'); Tests = @(@{ Kind = 'playwright'; Path = 'aot/playwright/results.json'; Expected = $testCounts['aot'] }) })
    )
    $ids = @($definitions | ForEach-Object { $_.Id }) -join ','
    if ($ids -ne ((Get-GateStageIds) -join ',')) { throw "The stage definitions ($ids) differ from the gate stages." }

    $completed = @{}
    $records = New-Object System.Collections.Generic.List[object]
    $index = 0
    foreach ($definition in $definitions) {
        $index++
        Write-Host ('[{0,2}/{1}] {2}: {3}' -f $index, $definitions.Count, $definition.Id, $definition.Title)
        $record = Invoke-GateStage -Definition $definition -OutputPath $OutputPath -SourceTree $tree -Completed $completed
        $completed[$definition.Id] = $record.status
        $records.Add($record)
        $tests = @($record.tests | ForEach-Object { "$($_.kind) $($_.passed) passed, $($_.failed) failed, $($_.skipped) skipped" }) -join '; '
        Write-Host "        $($record.status) in $($record.seconds) s$(if ($record.exitCode -ne $null) { ", exit $($record.exitCode)" })$(if ($tests) { "; $tests" })"
        foreach ($message in @($record.failures) + @($record.blockers) + @($record.notes)) { if ($message) { Write-Host "        - $message" } }
        if ($record.status -eq 'FAIL' -and $record.log -and (Test-Path -LiteralPath (Join-Path $OutputPath $record.log))) {
            Get-Content -LiteralPath (Join-Path $OutputPath $record.log) -Tail 15 | ForEach-Object { Write-Host "        | $_" }
        }
    }

    $report = [ordered]@{
        formatVersion = 1; tool = 'tools/Release/verify-local.ps1'; startedAt = $startedAt; finishedAt = (Get-Date).ToUniversalTime().ToString('o')
        parameters = [ordered]@{ configuration = $Configuration; version = $Version; repositoryUrl = $RepositoryUrl; repositoryCommit = $RepositoryCommit }
        environment = [ordered]@{ os = [System.Environment]::OSVersion.VersionString; powershell = $PSVersionTable.PSVersion.ToString()
            dotnet = (Get-ToolVersion 'dotnet' @('--version')); node = (Get-ToolVersion 'node' @('--version')); npm = (Get-ToolVersion $npm @('--version')); git = (Get-ToolVersion 'git' @('--version'))
            playwrightBrowsersPath = $env:PLAYWRIGHT_BROWSERS_PATH }
        source = $identity; sourceAfter = (Get-SourceIdentity -SourceRoot $SourceRoot)
        stages = $records.ToArray()
        requirements = (Get-RequirementStatus -Requirements $script:Requirements -Stages $records.ToArray())
        verdict = $null
    }
    # The verdict reads the report as it is persisted and rehashes every recorded file.
    $persisted = $report | ConvertTo-Json -Depth 12 | ConvertFrom-Json
    $report.verdict = Get-GateVerdict -Report $persisted -OutputPath $OutputPath -RequiredStages (Get-GateStageIds)
    $json = Write-GateReport -Report $report -OutputPath $OutputPath
    $status = $report.verdict.status
    Write-Host ''
    foreach ($failure in @($report.verdict.failures)) { if ($failure) { Write-Host "FAIL: $failure" } }
    foreach ($blocker in @($report.verdict.blockers)) { if ($blocker) { Write-Host "BLOCKED: $blocker" } }
    Write-Host "$status release gate for tree $tree. Report: $json (SHA-256 $(Get-FileSha256 $json))"
    switch ($status) { 'PASS' { exit 0 } 'BLOCKED' { exit 2 } default { exit 1 } }
}
catch {
    Write-Host "FAIL verify-local: $($_.Exception.Message)"
    exit 1
}
