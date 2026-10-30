#Requires -Version 5.1
<#
.SYNOPSIS
RED fixtures for the local release gate (verify-local.ps1): each one gives the gate a failed stage,
a missing or changed artifact or a gap in the release plan, and
requires the gate to refuse PASS. One positive control requires a complete report to pass.

.DESCRIPTION
Writes <WorkPath>/fixtures.json with one entry per check. Exits with 1 when a broken input is accepted.
#>
param(
    [Parameter(Mandatory)][string]$SourceRoot,
    [Parameter(Mandatory)][string]$WorkPath
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'ReleaseTools.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'VerificationGate.psm1') -Force

$script:Checks = New-Object System.Collections.Generic.List[object]
function Assert-Gate([string]$Name, [bool]$Condition, [string]$Detail) {
    $script:Checks.Add([ordered]@{ name = $Name; passed = $Condition; detail = $Detail })
    if ($Condition) { Write-Host "PASS $Name" } else { Write-Host "FAIL ${Name}: $Detail" }
}
function Test-Matches([object[]]$Messages, [string]$Pattern) { @($Messages | Where-Object { "$_" -match $Pattern }).Count -gt 0 }
function Format-Messages([object[]]$Messages) { if (@($Messages).Count -eq 0) { '(none)' } else { @($Messages) -join ' | ' } }

$tree = '1111111111111111111111111111111111111111'
$otherTree = '2222222222222222222222222222222222222222'
$commit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

# A report in which every gate stage passed and left one artifact of the verified tree.
function New-PassingReport([string]$Root) {
    if (Test-Path -LiteralPath $Root) { Remove-Item -LiteralPath $Root -Recurse -Force }
    $stages = @(foreach ($id in (Get-GateStageIds)) {
        $path = "stages/$id.txt"
        $file = Join-Path $Root $path
        New-Item -ItemType Directory -Force -Path (Split-Path $file) | Out-Null
        Set-Content -LiteralPath $file -Value "evidence of $id" -Encoding ASCII
        [ordered]@{ id = $id; title = $id; status = 'PASS'; exitCode = 0; failures = @(); blockers = @()
            artifacts = @([ordered]@{ path = $path; bytes = (Get-Item -LiteralPath $file).Length; sha256 = Get-FileSha256 $file; sourceTree = $tree }) }
    })
    $source = [ordered]@{ commit = $commit; tree = $tree; dirty = @(); untracked = @() }
    [ordered]@{ formatVersion = 1; source = $source; sourceAfter = [ordered]@{ commit = $commit; tree = $tree; dirty = @(); untracked = @() }; stages = $stages }
}
# Runs the run script of a workflow step, as GitHub's powershell shell does, with the release tool replaced by a stub that
# has the tool's param block; returns the exit code, the parameters the stub received and the log.
function Invoke-WorkflowStep([string]$Workflow, [string]$Step, [string]$Tool, [hashtable]$Environment) {
    $lines = (Get-Content -LiteralPath $Workflow -Raw) -split '\r?\n'
    $start = -1
    for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match "^\s*-\s+name:\s*$([regex]::Escape($Step))\s*$") { $start = $i; break } }
    if ($start -lt 0) { throw "$Workflow has no step '$Step'." }
    $run = $start + 1
    while ($run -lt $lines.Count -and $lines[$run] -notmatch '^\s+run:\s*\|\s*$') { $run++ }
    $indent = $null
    $body = New-Object System.Collections.Generic.List[string]
    for ($i = $run + 1; $i -lt $lines.Count; $i++) {
        if ($lines[$i].Trim() -eq '') { $body.Add(''); continue }
        $current = $lines[$i].Length - $lines[$i].TrimStart().Length
        if ($null -eq $indent) { $indent = $current }
        if ($current -lt $indent) { break }
        $body.Add($lines[$i].Substring($indent))
    }
    $source = Get-Content -LiteralPath (Join-Path $PSScriptRoot $Tool) -Raw
    if ($source -notmatch '(?ms)^param\(.*?^\)') { throw "$Tool has no param block." }
    $root = Join-Path $WorkPath 'workflow-steps'
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    $stub = Join-Path $root $Tool
    $bound = Join-Path $root "$Tool.json"
    if (Test-Path -LiteralPath $bound) { Remove-Item -LiteralPath $bound -Force }
    Set-Content -LiteralPath $stub -Encoding UTF8 -Value ($Matches[0] + "`n`$PSBoundParameters | ConvertTo-Json | Set-Content -LiteralPath '$bound' -Encoding UTF8`nexit 0")
    $script = Join-Path $root "$Tool.step.ps1"
    Set-Content -LiteralPath $script -Encoding UTF8 -Value ("`$ErrorActionPreference = 'Stop'`n" + ($body -join "`n").Replace("./tools/Release/$Tool", "& '$stub'"))
    $log = Join-Path $root "$Tool.log"
    $code = Invoke-LoggedProcess -FilePath $script:PowerShell -LogPath $log -Environment $Environment -WorkingDirectory $root `
        -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $script)
    [pscustomobject]@{ exitCode = $code; parameters = $(if (Test-Path -LiteralPath $bound) { Read-Json $bound }); log = (Get-Content -LiteralPath $log -Raw) -replace '\s+', ' ' }
}
# The verdict always reads the report as it is persisted.
function Get-Verdict($Report, [string]$Root) {
    $persisted = $Report | ConvertTo-Json -Depth 10 | ConvertFrom-Json
    Get-GateVerdict -Report $persisted -OutputPath $Root -RequiredStages (Get-GateStageIds)
}
function Get-Stage($Report, [string]$Id) { @($Report.stages | Where-Object { $_.id -eq $Id })[0] }
function ConvertTo-RelativeFixturePath([string]$Path, [string]$Root) { $Path.Substring($Root.TrimEnd('\', '/').Length).TrimStart('\', '/').Replace('\', '/') }

function New-StageDefinition([string]$Id, [string]$Command, [hashtable]$Extra = @{}) {
    $definition = @{ Id = $Id; Title = $Id; FilePath = $script:PowerShell; ArgumentList = @('-NoProfile', '-NonInteractive', '-Command', $Command) }
    foreach ($key in $Extra.Keys) { $definition[$key] = $Extra[$key] }
    $definition
}

# A foreign work path is refused before anything is written to it.
try { $WorkPath = Clear-OutputDirectory $WorkPath }
catch { Write-Host "FAIL $($_.Exception.Message)"; exit 1 }

try {
    $SourceRoot = Resolve-FullPath $SourceRoot
    $script:PowerShell = (Get-Process -Id $PID).Path

    # Stage runner.
    $runner = Join-Path $WorkPath 'runner'
    New-Item -ItemType Directory -Force -Path (Join-Path $runner 'out') | Out-Null
    $out = (Join-Path $runner 'out/failing.txt').Replace("'", "''")
    $record = Invoke-GateStage -OutputPath $runner -SourceTree $tree -Definition (New-StageDefinition 'failing' "Set-Content -LiteralPath '$out' -Value x; exit 3" @{ Artifacts = @('out/failing.txt') })
    Assert-Gate 'FailedStageCannotYieldSuccess/exit-code' ($record.status -eq 'FAIL' -and $record.exitCode -eq 3 -and (Test-Matches $record.failures 'exit code 3')) "status $($record.status), exit $($record.exitCode), failures $(Format-Messages $record.failures)"

    $vitest = Join-Path $runner 'out/vitest-failed.json'
    Set-Content -LiteralPath $vitest -Encoding UTF8 -Value '{"numTotalTests":3,"numPassedTests":2,"numFailedTests":1,"numPendingTests":0,"numTodoTests":0,"success":false}'
    $record = Invoke-GateStage -OutputPath $runner -SourceTree $tree -Definition (New-StageDefinition 'failed-tests' 'exit 0' @{ Tests = @(@{ Kind = 'vitest'; Path = 'out/vitest-failed.json' }) })
    Assert-Gate 'FailedStageCannotYieldSuccess/failed-tests' ($record.status -eq 'FAIL' -and (Test-Matches $record.failures '1 test')) "status $($record.status), failures $(Format-Messages $record.failures)"

    $empty = Join-Path $runner 'out/vitest-empty.json'
    Set-Content -LiteralPath $empty -Encoding UTF8 -Value '{"numTotalTests":0,"numPassedTests":0,"numFailedTests":0,"numPendingTests":0,"numTodoTests":0,"success":true}'
    $record = Invoke-GateStage -OutputPath $runner -SourceTree $tree -Definition (New-StageDefinition 'no-tests' 'exit 0' @{ Tests = @(@{ Kind = 'vitest'; Path = 'out/vitest-empty.json' }) })
    Assert-Gate 'FailedStageCannotYieldSuccess/no-tests' ($record.status -eq 'FAIL' -and (Test-Matches $record.failures 'No test passed')) "status $($record.status), failures $(Format-Messages $record.failures)"

    $marker = (Join-Path $runner 'out/dependent-ran.txt').Replace("'", "''")
    $record = Invoke-GateStage -OutputPath $runner -SourceTree $tree -Completed @{ failing = 'FAIL' } `
        -Definition (New-StageDefinition 'dependent' "Set-Content -LiteralPath '$marker' -Value x" @{ DependsOn = @('failing') })
    Assert-Gate 'FailedStageCannotYieldSuccess/dependency' ($record.status -eq 'NOT_RUN' -and -not (Test-Path -LiteralPath $marker)) "status $($record.status), command ran: $(Test-Path -LiteralPath $marker)"

    $reportRoot = Join-Path $WorkPath 'report'
    $report = New-PassingReport $reportRoot
    (Get-Stage $report 'dotnet-test').status = 'FAIL'
    (Get-Stage $report 'dotnet-test').failures = @('Exit code 1.')
    $verdict = Get-Verdict $report $reportRoot
    Assert-Gate 'FailedStageCannotYieldSuccess/verdict' ($verdict.status -eq 'FAIL' -and (Test-Matches $verdict.failures 'dotnet-test')) "verdict $($verdict.status): $(Format-Messages $verdict.failures)"

    $report = New-PassingReport $reportRoot
    (Get-Stage $report 'aot').status = 'NOT_RUN'
    $verdict = Get-Verdict $report $reportRoot
    Assert-Gate 'FailedStageCannotYieldSuccess/not-run' ($verdict.status -eq 'FAIL' -and (Test-Matches $verdict.failures '^aot')) "verdict $($verdict.status): $(Format-Messages $verdict.failures)"

    $report = New-PassingReport $reportRoot
    $report.stages = @($report.stages | Where-Object { $_.id -ne 'browser-matrix' })
    $verdict = Get-Verdict $report $reportRoot
    Assert-Gate 'FailedStageCannotYieldSuccess/missing-stage' ($verdict.status -eq 'FAIL' -and (Test-Matches $verdict.failures 'browser-matrix')) "verdict $($verdict.status): $(Format-Messages $verdict.failures)"

    # Artifacts.
    $record = Invoke-GateStage -OutputPath $runner -SourceTree $tree -Definition (New-StageDefinition 'no-artifact' 'exit 0' @{ Artifacts = @('out/never-written.json') })
    Assert-Gate 'MissingArtifactFailsGate/stage' ($record.status -eq 'FAIL' -and (Test-Matches $record.failures 'never-written\.json')) "status $($record.status), failures $(Format-Messages $record.failures)"

    $report = New-PassingReport $reportRoot
    Remove-Item -LiteralPath (Join-Path $reportRoot 'stages/aot.txt')
    $verdict = Get-Verdict $report $reportRoot
    Assert-Gate 'MissingArtifactFailsGate/deleted' ($verdict.status -eq 'FAIL' -and (Test-Matches $verdict.failures 'stages/aot\.txt.*missing')) "verdict $($verdict.status): $(Format-Messages $verdict.failures)"

    $report = New-PassingReport $reportRoot
    Add-Content -LiteralPath (Join-Path $reportRoot 'stages/packages.txt') -Value 'edited'
    $verdict = Get-Verdict $report $reportRoot
    Assert-Gate 'MissingArtifactFailsGate/changed' ($verdict.status -eq 'FAIL' -and (Test-Matches $verdict.failures 'stages/packages\.txt.*changed')) "verdict $($verdict.status): $(Format-Messages $verdict.failures)"

    $report = New-PassingReport $reportRoot
    (Get-Stage $report 'api-check').artifacts = @()
    $verdict = Get-Verdict $report $reportRoot
    Assert-Gate 'MissingArtifactFailsGate/no-evidence' ($verdict.status -eq 'FAIL' -and (Test-Matches $verdict.failures 'api-check.*no artifact')) "verdict $($verdict.status): $(Format-Messages $verdict.failures)"

    # Every gate stage must be verified: a stage status the gate does not know fails.
    $report = New-PassingReport $reportRoot
    (Get-Stage $report 'browser-matrix').status = 'NOT_VERIFIED'
    $verdict = Get-Verdict $report $reportRoot
    Assert-Gate 'NotVerifiedStageFailsGate' ($verdict.status -eq 'FAIL' -and (Test-Matches $verdict.failures 'browser-matrix has an unknown status')) "verdict $($verdict.status): $(Format-Messages $verdict.failures)"

    # Artifacts of another source tree.
    $report = New-PassingReport $reportRoot
    (Get-Stage $report 'packages').artifacts[0].sourceTree = $otherTree
    $verdict = Get-Verdict $report $reportRoot
    Assert-Gate 'StaleSourceEvidenceRejected/artifact-tree' ($verdict.status -eq 'FAIL' -and (Test-Matches $verdict.failures 'packages.*another source tree')) "verdict $($verdict.status): $(Format-Messages $verdict.failures)"
    $report = New-PassingReport $reportRoot
    $report.sourceAfter.tree = $otherTree
    $verdict = Get-Verdict $report $reportRoot
    Assert-Gate 'StaleSourceEvidenceRejected/tree-changed' ($verdict.status -eq 'FAIL' -and (Test-Matches $verdict.failures 'changed during verification')) "verdict $($verdict.status): $(Format-Messages $verdict.failures)"
    $report = New-PassingReport $reportRoot
    $report.source.dirty = @('src/BlazorECharts/EChart.razor')
    $report.sourceAfter.dirty = @('src/BlazorECharts/EChart.razor')
    $verdict = Get-Verdict $report $reportRoot
    Assert-Gate 'StaleSourceEvidenceRejected/dirty-tree' ($verdict.status -eq 'FAIL' -and (Test-Matches $verdict.failures 'uncommitted')) "verdict $($verdict.status): $(Format-Messages $verdict.failures)"

    # Browser matrix: every required browser passes; any failure fails, a browser that could not run blocks.
    $matrix = Join-Path $WorkPath 'matrix'
    New-Item -ItemType Directory -Force -Path $matrix | Out-Null
    function Write-Matrix([string]$Name, [hashtable]$Statuses) {
        $browsers = @(foreach ($id in @('chrome', 'msedge', 'chromium', 'firefox', 'webkit')) {
            if (-not $Statuses.ContainsKey($id) -or $Statuses[$id] -ne 'ABSENT') {
                $status = if ($Statuses.ContainsKey($id)) { $Statuses[$id] } else { 'PASS' }
                [ordered]@{ id = $id; status = $status; reason = "$id is $status" }
            }
        })
        $path = Join-Path $matrix "$Name.json"
        [ordered]@{ formatVersion = 1; browsers = $browsers } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $path -Encoding UTF8
        $path
    }
    $result = Test-BrowserMatrix -Path (Write-Matrix 'green' @{})
    Assert-Gate 'BrowserMatrixRequiresEveryBrowser/green' (@($result.failures).Count -eq 0 -and @($result.blockers).Count -eq 0) "failures $(Format-Messages $result.failures), blockers $(Format-Messages $result.blockers)"
    $result = Test-BrowserMatrix -Path (Write-Matrix 'firefox-blocked' @{ firefox = 'BLOCKED' })
    Assert-Gate 'BrowserMatrixRequiresEveryBrowser/blocked' (@($result.failures).Count -eq 0 -and (Test-Matches $result.blockers 'firefox')) "failures $(Format-Messages $result.failures), blockers $(Format-Messages $result.blockers)"
    $spawn = Write-Matrix 'firefox-spawn' @{ firefox = 'BLOCKED' }
    $json = Get-Content -LiteralPath $spawn -Raw | ConvertFrom-Json
    @($json.browsers | Where-Object { $_.id -eq 'firefox' })[0].reason = 'browserType.launch: spawn UNKNOWN'
    $json | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $spawn -Encoding UTF8
    $result = Test-BrowserMatrix -Path $spawn
    Assert-Gate 'BrowserMatrixRequiresEveryBrowser/spawn-unknown-hint' (Test-Matches $result.blockers 'PLAYWRIGHT_BROWSERS_PATH') "blockers $(Format-Messages $result.blockers)"
    $result = Test-BrowserMatrix -Path (Write-Matrix 'webkit-failed' @{ webkit = 'FAIL' })
    Assert-Gate 'BrowserMatrixRequiresEveryBrowser/failed' (Test-Matches $result.failures 'webkit') "failures $(Format-Messages $result.failures)"
    $result = Test-BrowserMatrix -Path (Write-Matrix 'edge-absent' @{ msedge = 'ABSENT' })
    Assert-Gate 'BrowserMatrixRequiresEveryBrowser/absent' (Test-Matches $result.failures 'msedge') "failures $(Format-Messages $result.failures)"
    $result = Test-BrowserMatrix -Path (Join-Path $matrix 'missing.json')
    Assert-Gate 'BrowserMatrixRequiresEveryBrowser/no-report' (Test-Matches $result.failures 'missing') "failures $(Format-Messages $result.failures)"
    $script:BlockedMatrix = Write-Matrix 'stage-firefox-blocked' @{ firefox = 'BLOCKED' }

    # Positive control: a complete report of one tree passes.
    $report = New-PassingReport $reportRoot
    $verdict = Get-Verdict $report $reportRoot
    Assert-Gate 'PassingReportYieldsPass/verdict' ($verdict.status -eq 'PASS' -and @($verdict.failures).Count -eq 0 -and @($verdict.blockers).Count -eq 0) "verdict $($verdict.status): failures $(Format-Messages $verdict.failures), blockers $(Format-Messages $verdict.blockers)"
    $record = Invoke-GateStage -OutputPath $runner -SourceTree $tree -Definition (New-StageDefinition 'passing' "Set-Content -LiteralPath '$out' -Value y; exit 0" @{ Artifacts = @('out/failing.txt') })
    Assert-Gate 'PassingReportYieldsPass/stage' ($record.status -eq 'PASS' -and @($record.artifacts).Count -eq 2 -and @($record.artifacts | Where-Object { $_.sourceTree -ne $tree }).Count -eq 0) "status $($record.status), artifacts $(@($record.artifacts).Count), failures $(Format-Messages $record.failures)"

    # A stage check returns exactly one dictionary; stray output must not hide its failures.
    foreach ($case in @(
            @{ Name = 'stray-output'; Check = { 'stray'; @{ failures = @('the real failure') } } },
            @{ Name = 'no-output'; Check = { } },
            @{ Name = 'two-results'; Check = { @{ failures = @() }; @{ failures = @() } } })) {
        $record = Invoke-GateStage -OutputPath $runner -SourceTree $tree -Definition @{ Id = $case.Name; Title = $case.Name; Artifacts = @('out/failing.txt'); Check = $case.Check }
        Assert-Gate "StageCheckReturnsOneResult/$($case.Name)" ($record.status -eq 'FAIL' -and (Test-Matches $record.failures 'exactly one dictionary')) "status $($record.status), failures $(Format-Messages $record.failures)"
    }

    # Every way a test run can fall short of evidence.
    # A status is 'expected', 'skipped', ... or 'expected:failed' for a test whose expectedStatus is failed (test.fail()).
    function Write-PlaywrightResult([string]$Name, [hashtable]$Stats, [object[]]$Specs = @()) {
        $suites = @(foreach ($spec in $Specs) {
            $project = if ($spec.ContainsKey('Project')) { $spec.Project } else { 'chrome' }
            [ordered]@{ file = $spec.File; specs = @([ordered]@{ tests = @(foreach ($status in $spec.Statuses) {
                $parts = "$status".Split(':')
                $expected = if ($parts.Count -gt 1) { $parts[1] } elseif ($parts[0] -eq 'skipped') { 'skipped' } else { 'passed' }
                [ordered]@{ status = $parts[0]; expectedStatus = $expected; projectName = $project } }) }) }
        })
        $path = Join-Path $runner "out/$Name.json"
        [ordered]@{ stats = $Stats; suites = $suites; errors = @() } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $path -Encoding UTF8
        Read-TestCounts -Kind playwright -Path $path
    }
    # -Modules writes one result file per test assembly, as dotnet test does: @{ name = passed }.
    function Write-TrxResult([string]$Name, [string]$Outcome = 'Completed', [hashtable]$Counters = @{}, [switch]$NoCounters, [hashtable]$Modules = @{ 'Fixture.Tests' = 3 }) {
        $directory = Join-Path $runner "out/$Name"
        [System.IO.Directory]::CreateDirectory($directory) | Out-Null
        foreach ($module in $Modules.Keys) {
            $values = @{ total = $Modules[$module]; passed = $Modules[$module]; failed = 0; error = 0; timeout = 0; aborted = 0; notExecuted = 0; inconclusive = 0 }
            foreach ($key in $Counters.Keys) { $values[$key] = $Counters[$key] }
            $attributes = @($values.Keys | Sort-Object | ForEach-Object { "$_=`"$($values[$_])`"" }) -join ' '
            $element = if ($NoCounters) { '' } else { "<Counters $attributes />" }
            $definitions = if ($values.total -gt 0) { "<TestDefinitions><UnitTest name=`"Test`"><TestMethod codeBase=`"C:/tests/bin/$module.dll`" className=`"Test`" name=`"Test`" /></UnitTest></TestDefinitions>" } else { '' }
            Set-Content -LiteralPath (Join-Path $directory "$module.trx") -Encoding UTF8 -Value "<?xml version=`"1.0`" encoding=`"utf-8`"?><TestRun xmlns=`"http://microsoft.com/schemas/VisualStudio/TeamTest/2010`">$definitions<ResultSummary outcome=`"$Outcome`">$element</ResultSummary></TestRun>"
        }
        Read-TestCounts -Kind trx -Path $directory
    }
    $counts = Write-PlaywrightResult 'skipped' @{ expected = 3; unexpected = 0; skipped = 1; flaky = 0 }
    $failures = Test-TestCounts $counts @{}
    Assert-Gate 'TestEvidenceRejectsGaps/skipped' (Test-Matches $failures '1 test\(s\) were skipped') (Format-Messages $failures)
    $failures = Test-TestCounts $counts @{ AllowSkipped = $true }
    Assert-Gate 'TestEvidenceRejectsGaps/skipped-allowed' (@($failures).Count -eq 0) (Format-Messages $failures)
    $failures = Test-TestCounts (Write-PlaywrightResult 'flaky' @{ expected = 3; unexpected = 0; skipped = 0; flaky = 1 }) @{}
    Assert-Gate 'TestEvidenceRejectsGaps/flaky' (Test-Matches $failures 'flaky') (Format-Messages $failures)
    $counts = Write-PlaywrightResult 'specs' @{ expected = 3; unexpected = 0; skipped = 0; flaky = 0 } @(
        @{ File = 'a.spec.ts'; Statuses = @('expected', 'expected') }, @{ File = 'c.spec.ts'; Statuses = @('expected') })
    $failures = Test-TestCounts $counts @{ Specs = @('a.spec.ts', 'b.spec.ts') }
    Assert-Gate 'TestEvidenceRejectsGaps/spec-without-pass' (Test-Matches $failures 'Spec b\.spec\.ts has no passing test') (Format-Messages $failures)
    Assert-Gate 'TestEvidenceRejectsGaps/spec-of-another-stage' (Test-Matches $failures 'Spec c\.spec\.ts ran in a stage') (Format-Messages $failures)
    $failures = Test-TestCounts $counts @{ Specs = @('a.spec.ts', 'c.spec.ts'); Counts = @{ 'a.spec.ts' = 3; 'c.spec.ts' = 1 } }
    Assert-Gate 'TestEvidenceRejectsGaps/spec-below-count' (@($failures).Count -eq 1 -and (Test-Matches $failures 'a\.spec\.ts has 2 passing test\(s\), expected 3')) (Format-Messages $failures)
    $failures = Test-TestCounts $counts @{ Specs = @('a.spec.ts', 'c.spec.ts'); Counts = @{ 'a.spec.ts' = 1; 'c.spec.ts' = 1 } }
    Assert-Gate 'TestEvidenceRejectsGaps/spec-above-count' (@($failures).Count -eq 1 -and (Test-Matches $failures 'a\.spec\.ts has 2 passing test\(s\), expected 1.*update the count')) (Format-Messages $failures)
    $failures = Test-TestCounts $counts @{ Specs = @('a.spec.ts', 'c.spec.ts'); Counts = @{ 'a.spec.ts' = 2; 'c.spec.ts' = 1 } }
    Assert-Gate 'TestEvidenceRejectsGaps/spec-count' (@($failures).Count -eq 0) (Format-Messages $failures)
    $failures = Test-TestCounts $counts @{ Expected = 4 }
    Assert-Gate 'TestEvidenceRejectsGaps/run-below-count' (Test-Matches $failures '3 test\(s\) passed, expected 4') (Format-Messages $failures)
    $failures = Test-TestCounts $counts @{ Expected = 2 }
    Assert-Gate 'TestEvidenceRejectsGaps/run-above-count' (Test-Matches $failures '3 test\(s\) passed, expected 2') (Format-Messages $failures)
    foreach ($kind in @('vitest', 'fixtures')) {
        $path = Join-Path $runner "out/$kind-count.json"
        $json = if ($kind -eq 'vitest') { '{"numTotalTests":3,"numPassedTests":3,"numFailedTests":0,"numPendingTests":0,"numTodoTests":0,"success":true}' } else { '{"passed":3,"failed":0}' }
        Set-Content -LiteralPath $path -Encoding UTF8 -Value $json
        $failures = Test-TestCounts (Read-TestCounts -Kind $kind -Path $path) @{ Expected = 4 }
        Assert-Gate "TestEvidenceRejectsGaps/$kind-count" (Test-Matches $failures '3 test\(s\) passed, expected 4') (Format-Messages $failures)
    }

    # test.fail() reports a failing test as expected; it is not a pass.
    $counts = Write-PlaywrightResult 'expected-failure' @{ expected = 3; unexpected = 0; skipped = 0; flaky = 0 } @(@{ File = 'a.spec.ts'; Statuses = @('expected', 'expected', 'expected:failed') })
    $failures = Test-TestCounts $counts @{ Specs = @('a.spec.ts'); Counts = @{ 'a.spec.ts' = 3 } }
    Assert-Gate 'TestEvidenceRejectsGaps/expected-failure' ((Test-Matches $failures '1 test\(s\) are expected to fail') -and (Test-Matches $failures 'a\.spec\.ts has 2 passing')) (Format-Messages $failures)
    # A configuration without named projects (the package consumers) reports an empty project name; the persisted report must still read back.
    $counts = Write-PlaywrightResult 'unnamed-project' @{ expected = 1; unexpected = 0; skipped = 0; flaky = 0 } @(@{ File = 'a.spec.ts'; Project = ''; Statuses = @('expected') })
    $thrown = $null
    try { $counts | ConvertTo-Json -Depth 8 | ConvertFrom-Json | Out-Null } catch { $thrown = $_.Exception.Message }
    Assert-Gate 'TestEvidenceRejectsGaps/unnamed-project' ($null -eq $thrown -and $counts.passed -eq 1) "$thrown"
    $sources = Join-Path $runner 'sources'
    [System.IO.Directory]::CreateDirectory($sources) | Out-Null
    $marked = @{ 'playwright.spec.ts' = "test('a', async () => {`n  test.fail();`n});"; 'vitest.test.ts' = "it.fails('b', () => {});"; 'each.test.ts' = "test.fails.each([1])('c', () => {});" }
    foreach ($name in $marked.Keys) { Set-Content -LiteralPath (Join-Path $sources $name) -Encoding UTF8 -Value $marked[$name] }
    Set-Content -LiteralPath (Join-Path $sources 'clean.spec.ts') -Encoding UTF8 -Value "test('d', async () => { const result = { fail: () => 0 }; result.fail(); });"
    $failures = Test-ForbidExpectedFailures -SourceRoot $SourceRoot -Files @(Get-ChildItem -LiteralPath $sources -File | ForEach-Object { $_.FullName })
    Assert-Gate 'ReleasePlanRejectsGaps/expected-failure-source' (@($failures).Count -eq 3 -and (Test-Matches $failures 'playwright\.spec\.ts:2') -and (Test-Matches $failures 'vitest\.test\.ts:1') -and (Test-Matches $failures 'each\.test\.ts:1')) (Format-Messages $failures)
    $failures = Test-ForbidExpectedFailures -SourceRoot $SourceRoot
    Assert-Gate 'ReleasePlanRejectsGaps/expected-failure-tree' (@($failures).Count -eq 0) (Format-Messages $failures)
    $failures = Test-TestCounts (Write-TrxResult 'trx-clean') @{ ExpectedFiles = 1 }
    Assert-Gate 'TestEvidenceRejectsGaps/trx-clean' (@($failures).Count -eq 0) (Format-Messages $failures)
    $failures = Test-TestCounts (Write-TrxResult 'trx-files') @{ ExpectedFiles = 2 }
    Assert-Gate 'TestEvidenceRejectsGaps/trx-expected-files' (Test-Matches $failures 'Expected 2 result files') (Format-Messages $failures)
    $failures = Test-TestCounts (Write-TrxResult 'trx-aborted-test' -Counters @{ passed = 2; aborted = 1 }) @{}
    Assert-Gate 'TestEvidenceRejectsGaps/trx-aborted-test' (Test-Matches $failures '1 test\(s\) failed') (Format-Messages $failures)
    $failures = Test-TestCounts (Write-TrxResult 'trx-aborted-run' 'Aborted') @{}
    Assert-Gate 'TestEvidenceRejectsGaps/trx-aborted-run' (Test-Matches $failures 'error\(s\) outside tests') (Format-Messages $failures)
    $failures = Test-TestCounts (Write-TrxResult 'trx-other-outcome' -Counters @{ total = 4; disconnected = 1 }) @{}
    Assert-Gate 'TestEvidenceRejectsGaps/trx-other-outcome' (Test-Matches $failures 'error\(s\) outside tests') (Format-Messages $failures)
    $failures = Test-TestCounts (Write-TrxResult 'trx-no-counters' -NoCounters) @{}
    Assert-Gate 'TestEvidenceRejectsGaps/trx-no-counters' (Test-Matches $failures 'error\(s\) outside tests') (Format-Messages $failures)
    $modules = @{ 'Fixture.Tests' = 3; 'Fixture.ComponentTests' = 2 }
    $failures = Test-TestCounts (Write-TrxResult 'trx-modules' -Modules $modules) @{ ExpectedFiles = 2; Modules = $modules }
    Assert-Gate 'TestEvidenceRejectsGaps/trx-modules' (@($failures).Count -eq 0) (Format-Messages $failures)
    $failures = Test-TestCounts (Write-TrxResult 'trx-module-count' -Modules @{ 'Fixture.Tests' = 3; 'Fixture.ComponentTests' = 1 }) @{ ExpectedFiles = 2; Modules = $modules }
    Assert-Gate 'TestEvidenceRejectsGaps/trx-module-count' (@($failures).Count -eq 1 -and (Test-Matches $failures 'Fixture\.ComponentTests has 1 passing test\(s\), expected 2')) (Format-Messages $failures)
    # A test project whose discovery broke: its result file exists and passes nothing.
    $failures = Test-TestCounts (Write-TrxResult 'trx-zero-passed' -Modules @{ 'Fixture.Tests' = 3; 'Fixture.ComponentTests' = 0 }) @{ ExpectedFiles = 2; Modules = $modules }
    Assert-Gate 'TestEvidenceRejectsGaps/trx-zero-passed' ((Test-Matches $failures 'Fixture\.ComponentTests has 0 passing test\(s\), expected 2') -and (Test-Matches $failures 'ComponentTests\.trx has no expected count')) (Format-Messages $failures)

    # The dotnet-test stage as the gate defines it, run by a dotnet that names the trx of both test assemblies with one
    # timestamp, as the SDK did once; its per-module layout gives each assembly a <project>/<framework>_<architecture> folder.
    $source = (Join-Path $runner 'out/trx-modules').Replace("'", "''")
    $emulator = Join-Path $runner 'dotnet-test.ps1'
    Set-Content -LiteralPath $emulator -Encoding UTF8 -Value @'
$results = $args[[array]::IndexOf($args, '--results-directory') + 1]
$layout = [array]::IndexOf($args, '--results-directory-layout')
foreach ($file in Get-ChildItem -LiteralPath '{source}' -Filter *.trx) {
    $directory = if ($layout -ge 0 -and $args[$layout + 1] -eq 'per-module') { Join-Path $results "$($file.BaseName)/net10.0_x64" } else { $results }
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $directory 'User_HOST_2026-10-27_15_02_55.995278.trx')
}
'@.Replace('{source}', $source)
    $definition = Get-DotnetTestStage -OutputPath $runner -Configuration Release -TestProjects @($modules.Keys)
    $definition.Id = 'dotnet-test'; $definition.Title = 'dotnet test'
    $definition.ArgumentList = @('-NoProfile', '-NonInteractive', '-File', $emulator) + $definition.ArgumentList
    $definition.FilePath = $script:PowerShell
    $definition.Tests[0].Modules = $modules
    $record = Invoke-GateStage -OutputPath $runner -SourceTree $tree -Definition $definition -Completed @{ build = 'PASS' }
    $trx = @($record.artifacts | Where-Object { $_.path -like '*.trx' } | ForEach-Object { $_.path })
    Assert-Gate 'DotnetTestKeepsEachAssembly/same-file-name' ($record.status -eq 'PASS' -and $trx.Count -eq 2) "status $($record.status), trx $(Format-Messages $trx), failures $(Format-Messages $record.failures)"

    # The matrix counts each required browser: a browser that cannot start skips its scenarios and blocks, a lost scenario fails.
    $matrixSpec = 'matrix/browser-matrix.spec.ts'
    $matrixCounts = @{ $matrixSpec = @{ 'matrix-chrome' = 7; 'matrix-msedge' = 7; 'matrix-firefox' = 7 } }
    $passing = @(1..7 | ForEach-Object { 'expected' })
    $skipped = @(1..7 | ForEach-Object { 'skipped' })
    $counts = Write-PlaywrightResult 'matrix-blocked' @{ expected = 21; unexpected = 0; skipped = 7; flaky = 0 } @(
        @{ File = $matrixSpec; Project = 'matrix-chrome'; Statuses = $passing }, @{ File = $matrixSpec; Project = 'matrix-msedge'; Statuses = $passing },
        @{ File = $matrixSpec; Project = 'matrix-firefox'; Statuses = $skipped }, @{ File = $matrixSpec; Project = 'matrix-webkit'; Statuses = $passing })
    $failures = Test-TestCounts $counts @{ Specs = @($matrixSpec); Counts = $matrixCounts; AllowSkipped = $true }
    Assert-Gate 'BrowserMatrixCountsEachBrowser/blocked-is-no-shortage' (@($failures).Count -eq 0) (Format-Messages $failures)
    $counts = Write-PlaywrightResult 'matrix-lost' @{ expected = 19; unexpected = 0; skipped = 0; flaky = 0 } @(
        @{ File = $matrixSpec; Project = 'matrix-chrome'; Statuses = $passing }, @{ File = $matrixSpec; Project = 'matrix-msedge'; Statuses = $passing },
        @{ File = $matrixSpec; Project = 'matrix-firefox'; Statuses = @($passing | Select-Object -First 5) })
    $failures = Test-TestCounts $counts @{ Specs = @($matrixSpec); Counts = $matrixCounts; AllowSkipped = $true }
    Assert-Gate 'BrowserMatrixCountsEachBrowser/lost-scenario' (@($failures).Count -eq 1 -and (Test-Matches $failures '5 passing and 0 skipped test\(s\) in matrix-firefox, expected 7')) (Format-Messages $failures)
    $record = Invoke-GateStage -OutputPath $runner -SourceTree $tree -Definition @{ Id = 'browser-matrix'; Title = 'matrix'; Artifacts = @('out/matrix-blocked.json')
        Tests = @(@{ Kind = 'playwright'; Path = 'out/matrix-blocked.json'; Specs = @($matrixSpec); Counts = $matrixCounts; AllowSkipped = $true })
        Check = { $matrix = Test-BrowserMatrix -Path $script:BlockedMatrix; @{ failures = $matrix.failures; blockers = $matrix.blockers } } }
    Assert-Gate 'BrowserMatrixCountsEachBrowser/browser-does-not-start' ($record.status -eq 'BLOCKED' -and @($record.failures).Count -eq 0 -and (Test-Matches $record.blockers 'firefox')) "status $($record.status), failures $(Format-Messages $record.failures), blockers $(Format-Messages $record.blockers)"

    $buildLog = Join-Path $runner 'out/build.log'
    Set-Content -LiteralPath $buildLog -Encoding UTF8 -Value @('Build succeeded.', '    1 Warning(s)', '    0 Error(s)')
    $failures = Test-BuildLog -Path $buildLog
    Assert-Gate 'TestEvidenceRejectsGaps/build-warning' (@($failures).Count -eq 1 -and (Test-Matches $failures 'warnings')) (Format-Messages $failures)
    Set-Content -LiteralPath $buildLog -Encoding UTF8 -Value @('Build succeeded.')
    $failures = Test-BuildLog -Path $buildLog
    Assert-Gate 'TestEvidenceRejectsGaps/build-no-summary' (@($failures).Count -eq 2) (Format-Messages $failures)
    Set-Content -LiteralPath $buildLog -Encoding UTF8 -Value @('Build succeeded.', '    0 Warning(s)', '    0 Error(s)')
    $failures = Test-BuildLog -Path $buildLog
    Assert-Gate 'TestEvidenceRejectsGaps/build-clean' (@($failures).Count -eq 0) (Format-Messages $failures)

    # Report verdict branches.
    $report = New-PassingReport $reportRoot
    $report.stages = @($report.stages) + @(Get-Stage $report 'build')
    $verdict = Get-Verdict $report $reportRoot
    Assert-Gate 'VerdictRejectsBrokenReports/duplicate-stage' ($verdict.status -eq 'FAIL' -and (Test-Matches $verdict.failures 'build is in the report twice')) "verdict $($verdict.status): $(Format-Messages $verdict.failures)"
    $report = New-PassingReport $reportRoot
    (Get-Stage $report 'docs-check').status = 'SKIPPED'
    $verdict = Get-Verdict $report $reportRoot
    Assert-Gate 'VerdictRejectsBrokenReports/unknown-status' ($verdict.status -eq 'FAIL' -and (Test-Matches $verdict.failures "docs-check has an unknown status 'SKIPPED'")) "verdict $($verdict.status): $(Format-Messages $verdict.failures)"
    $report = New-PassingReport $reportRoot
    (Get-Stage $report 'packages').artifacts[0].path = '../outside.txt'
    $verdict = Get-Verdict $report $reportRoot
    Assert-Gate 'VerdictRejectsBrokenReports/artifact-outside' ($verdict.status -eq 'FAIL' -and (Test-Matches $verdict.failures 'not inside the output')) "verdict $($verdict.status): $(Format-Messages $verdict.failures)"
    $report = New-PassingReport $reportRoot
    $report.sourceAfter.untracked = @('src/BlazorECharts/Leftover.cs')
    $verdict = Get-Verdict $report $reportRoot
    Assert-Gate 'VerdictRejectsBrokenReports/untracked-input-at-end' ($verdict.status -eq 'FAIL' -and (Test-Matches $verdict.failures 'end of the run: src/BlazorECharts/Leftover\.cs')) "verdict $($verdict.status): $(Format-Messages $verdict.failures)"

    # The source identity of a real repository: paths with spaces, a staged rename and untracked build inputs.
    $repo = Join-Path $WorkPath 'identity repo'
    [System.IO.Directory]::CreateDirectory((Join-Path $repo 'docs')) | Out-Null
    [System.IO.Directory]::CreateDirectory((Join-Path $repo 'src')) | Out-Null
    [System.IO.Directory]::CreateDirectory((Join-Path $repo 'tests')) | Out-Null
    $author = @('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false')
    Invoke-GitCommand $repo @('init', '-q', '-b', 'main') | Out-Null
    Set-Content -LiteralPath (Join-Path $repo 'docs/read me.md') -Value 'one' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $repo 'src/old.cs') -Value 'class Old {}' -Encoding ASCII
    Invoke-GitCommand $repo @('add', '--all') | Out-Null
    Invoke-GitCommand $repo ($author + @('commit', '-q', '-m', 'one')) | Out-Null
    Invoke-GitCommand $repo ($author + @('commit', '-q', '--allow-empty', '-m', 'two')) | Out-Null
    $lines = Invoke-GitCommand $repo @('rev-parse', 'HEAD')
    Assert-Gate 'GitOutputIsAlwaysAnArray/one-line' (@($lines).Count -eq 1 -and "$($lines[0])" -match '^[0-9a-f]{40}$') "$(@($lines).Count) item(s): $(Format-Messages $lines)"
    $lines = Invoke-GitCommand $repo @('log', '--format=%H')
    Assert-Gate 'GitOutputIsAlwaysAnArray/lines' (@($lines).Count -eq 2 -and @($lines | Where-Object { $_ -match '^[0-9a-f]{40}$' }).Count -eq 2) "$(@($lines).Count) item(s): $(Format-Messages $lines)"
    $lines = Invoke-GitCommand $repo @('ls-files', '--', 'no-such-file')
    Assert-Gate 'GitOutputIsAlwaysAnArray/none' ($null -ne $lines -and @($lines).Count -eq 0) "$(@($lines).Count) item(s)"
    $thrown = $null
    try { Invoke-GitCommand $repo @('rev-parse', '--verify', 'no-such-ref') | Out-Null } catch { $thrown = $_.Exception.Message }
    Assert-Gate 'GitOutputIsAlwaysAnArray/failure' ("$thrown" -match 'exit code 128') "$thrown"
    Set-Content -LiteralPath (Join-Path $repo 'docs/read me.md') -Value 'two' -Encoding ASCII
    Invoke-GitCommand $repo @('mv', 'src/old.cs', 'src/new name.cs') | Out-Null
    foreach ($name in @('src/a b.cs', 'Directory.Build.rsp', 'tests/notes.txt')) { Set-Content -LiteralPath (Join-Path $repo $name) -Value x -Encoding ASCII }
    $identity = Get-SourceIdentity -SourceRoot $repo
    Assert-Gate 'SourceIdentityKeepsPaths/dirty' (((@($identity.dirty) | Sort-Object) -join '|') -eq 'docs/read me.md|src/new name.cs') "dirty $(Format-Messages $identity.dirty)"
    Assert-Gate 'SourceIdentityKeepsPaths/untracked' (((@($identity.untracked) | Sort-Object) -join '|') -eq 'Directory.Build.rsp|src/a b.cs|tests/notes.txt') "untracked $(Format-Messages $identity.untracked)"
    $failures = Test-SourceIdentity $identity
    Assert-Gate 'SourceIdentityKeepsPaths/rejected' ((Test-Matches $failures 'uncommitted changes.*docs/read me\.md') -and (Test-Matches $failures 'change the build or the packages: Directory\.Build\.rsp, src/a b\.cs\.$')) (Format-Messages $failures)

    # Ignored files the SDK reads are build inputs; build output and tool caches are not.
    Set-Content -LiteralPath (Join-Path $repo '.gitignore') -Encoding ASCII -Value @('*.user', '**/bin/', '/artifacts/')
    foreach ($name in @('tests/App/App.csproj.user', 'src/Lib/bin/Lib.dll', 'artifacts/log.txt', 'src/Lib/artifacts/Gen.cs')) {
        $file = Join-Path $repo $name
        [System.IO.Directory]::CreateDirectory((Split-Path $file)) | Out-Null
        Set-Content -LiteralPath $file -Value x -Encoding ASCII
    }
    $identity = Get-SourceIdentity -SourceRoot $repo
    Assert-Gate 'SourceIdentityKeepsPaths/ignored-inputs' (((@($identity.ignored) | Sort-Object) -join '|') -eq 'tests/App/App.csproj.user') "ignored $(Format-Messages $identity.ignored)"
    $failures = Test-SourceIdentity $identity
    Assert-Gate 'SourceIdentityKeepsPaths/ignored-rejected' ((Test-Matches $failures 'tests/App/App\.csproj\.user') -and (Test-Matches $failures 'src/Lib/artifacts/Gen\.cs')) (Format-Messages $failures)
    $report = New-PassingReport $reportRoot
    $report.sourceAfter.ignored = @('tests/App/App.csproj.user')
    $verdict = Get-Verdict $report $reportRoot
    Assert-Gate 'VerdictRejectsBrokenReports/ignored-input-at-end' ($verdict.status -eq 'FAIL' -and (Test-Matches $verdict.failures 'end of the run: tests/App/App\.csproj\.user')) "verdict $($verdict.status): $(Format-Messages $verdict.failures)"

    # A checkout that converted a committed LF file to CRLF is not the verified tree; committed CRLF bytes are.
    $eolRepo = Join-Path $WorkPath 'eol repo'
    [System.IO.Directory]::CreateDirectory($eolRepo) | Out-Null
    Invoke-GitCommand $eolRepo @('init', '-q', '-b', 'main') | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $eolRepo '.gitattributes'), "* text=auto`nnotice.txt -text`n")
    [System.IO.File]::WriteAllText((Join-Path $eolRepo 'read me.md'), "one`ntwo`n")
    [System.IO.File]::WriteAllText((Join-Path $eolRepo 'notice.txt'), "one`r`ntwo`r`n")
    Invoke-GitCommand $eolRepo @('add', '--all') | Out-Null
    Invoke-GitCommand $eolRepo ($author + @('commit', '-q', '-m', 'one')) | Out-Null
    Remove-Item -LiteralPath (Join-Path $eolRepo 'read me.md')
    Invoke-GitCommand $eolRepo @('-c', 'core.autocrlf=true', 'checkout', '--', 'read me.md') | Out-Null
    $identity = Get-SourceIdentity -SourceRoot $eolRepo
    Assert-Gate 'SourceIdentityKeepsPaths/converted-eol' (@($identity.dirty).Count -eq 0 -and ((@($identity.converted)) -join '|') -eq 'read me.md') "dirty $(Format-Messages $identity.dirty); converted $(Format-Messages $identity.converted)"
    $failures = Test-SourceIdentity $identity
    Assert-Gate 'SourceIdentityKeepsPaths/converted-eol-rejected' ((Test-Matches $failures 'line endings.*read me\.md') -and -not (Test-Matches $failures 'notice\.txt')) (Format-Messages $failures)

    # A case-insensitive file system does not record a rename that changes only the case: the commit keeps the old name.
    $caseRepo = Join-Path $WorkPath 'case repo'
    [System.IO.Directory]::CreateDirectory((Join-Path $caseRepo 'src')) | Out-Null
    Invoke-GitCommand $caseRepo @('init', '-q', '-b', 'main') | Out-Null
    Invoke-GitCommand $caseRepo @('config', 'core.ignorecase', 'true') | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $caseRepo 'src/Datazoom.cs'), "class A {}`n")
    [System.IO.File]::WriteAllText((Join-Path $caseRepo 'src/Kept.cs'), "class B {}`n")
    Invoke-GitCommand $caseRepo @('add', '--all') | Out-Null
    Invoke-GitCommand $caseRepo ($author + @('commit', '-q', '-m', 'one')) | Out-Null
    [System.IO.File]::Move((Join-Path $caseRepo 'src/Datazoom.cs'), (Join-Path $caseRepo 'src/DataZoom.cs'))
    $identity = Get-SourceIdentity -SourceRoot $caseRepo
    Assert-Gate 'SourceIdentityKeepsPaths/case-renamed' (@($identity.dirty).Count -eq 0 -and ((@($identity.misnamed)) -join '|') -eq 'src/Datazoom.cs -> src/DataZoom.cs') "dirty $(Format-Messages $identity.dirty); misnamed $(Format-Messages $identity.misnamed)"
    $failures = Test-SourceIdentity $identity
    Assert-Gate 'SourceIdentityKeepsPaths/case-renamed-rejected' ((Test-Matches $failures 'case.*src/Datazoom\.cs -> src/DataZoom\.cs') -and -not (Test-Matches $failures 'Kept\.cs')) (Format-Messages $failures)

    # Consumers are copied from the tracked files only.
    $template = Join-Path $repo 'consumer'
    [System.IO.Directory]::CreateDirectory((Join-Path $template 'App')) | Out-Null
    Set-Content -LiteralPath (Join-Path $template 'App/App.csproj') -Value 'tracked' -Encoding ASCII
    Invoke-GitCommand $repo @('add', '--', 'consumer/App/App.csproj') | Out-Null
    Set-Content -LiteralPath (Join-Path $template 'App/Leftover.cs') -Value 'untracked' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $template 'App/App.csproj.user') -Value 'ignored' -Encoding ASCII
    $copy = Join-Path $WorkPath 'consumer copy'
    Copy-ConsumerTemplate -Template $template -Destination $copy
    $copied = @(Get-ChildItem -LiteralPath $copy -Recurse -File | ForEach-Object { ConvertTo-RelativeFixturePath $_.FullName $copy }) -join '|'
    Assert-Gate 'ConsumersAreCopiedFromTrackedFiles' ($copied -eq 'App/App.csproj') "copied [$copied]"

    # Module functions stop at their first error even when the caller's session continues on errors.
    $locked = Join-Path (Initialize-OutputDirectory (Join-Path $WorkPath 'eap')) 'stale/locked.txt'
    [System.IO.Directory]::CreateDirectory((Split-Path $locked)) | Out-Null
    Set-Content -LiteralPath $locked -Value x -Encoding ASCII
    $quote = { param($text) "'" + $text.Replace("'", "''") + "'" }
    foreach ($module in @('ReleaseTools.psm1', 'VerificationGate.psm1', 'ExportTools.psm1')) {
        $command = "`$ErrorActionPreference = 'Continue'; Import-Module $(& $quote (Join-Path $PSScriptRoot $module)); " +
            "`$stream = [System.IO.File]::Open($(& $quote $locked), 'Open', 'Read', 'None'); " +
            "try { & (Get-Module $(& $quote ([System.IO.Path]::GetFileNameWithoutExtension($module)))) { Remove-Item -LiteralPath $(& $quote (Split-Path $locked)) -Recurse -Force }; 'RESULT continued' } " +
            "catch { 'RESULT stopped' } finally { `$stream.Dispose() }"
        $log = Join-Path $WorkPath "eap-$module.log"
        Invoke-LoggedProcess -FilePath $script:PowerShell -LogPath $log -ArgumentList @('-NoProfile', '-NonInteractive', '-Command', "& { $command }") | Out-Null
        $text = Get-Content -LiteralPath $log -Raw
        Assert-Gate "ModulesStopOnErrors/$module" ($text -match 'RESULT stopped') "log $log"
    }

    # Output paths with wildcard characters: logs and artifacts are literal.
    $bracket = Join-Path $WorkPath 'out [1]'
    [System.IO.Directory]::CreateDirectory($bracket) | Out-Null
    $artifact = (Join-Path $bracket 'result.txt').Replace("'", "''")
    $record = Invoke-GateStage -OutputPath $bracket -SourceTree $tree -Definition (New-StageDefinition 'bracket' "Set-Content -LiteralPath '$artifact' -Value x" @{ Artifacts = @('result.txt') })
    Assert-Gate 'LiteralOutputPaths/stage' ($record.status -eq 'PASS' -and @($record.artifacts).Count -eq 2) "status $($record.status), artifacts $(@($record.artifacts).Count), failures $(Format-Messages $record.failures)"

    # Output directories: the tools refuse a foreign directory and leave it untouched.
    $foreign = Join-Path $WorkPath 'foreign'
    [System.IO.Directory]::CreateDirectory($foreign) | Out-Null
    Set-Content -LiteralPath (Join-Path $foreign 'keep.txt') -Value 'not tool output' -Encoding ASCII
    $thrown = $null
    try { Clear-OutputDirectory $foreign | Out-Null } catch { $thrown = $_.Exception.Message }
    Assert-Gate 'OutputDirectoryIsOwned/foreign' ("$thrown" -match 'has no \.blazorecharts-output' -and @(Get-ChildItem -LiteralPath $foreign -Force).Count -eq 1) "$thrown"
    $owned = Initialize-OutputDirectory (Join-Path $WorkPath 'owned')
    Set-Content -LiteralPath (Join-Path $owned 'old.txt') -Value x -Encoding ASCII
    $owned = Clear-OutputDirectory $owned
    Assert-Gate 'OutputDirectoryIsOwned/reused' ((@(Get-ChildItem -LiteralPath $owned -Force | ForEach-Object { $_.Name }) -join '|') -eq '.blazorecharts-output') (@(Get-ChildItem -LiteralPath $owned -Force | ForEach-Object { $_.Name }) -join ', ')
    if (-not $env:BLAZOR_ECHARTS_OUTPUT_GUARD_FIXTURE) {
        # Child runs skip this block, so a regressed guard cannot recurse.
        $env:BLAZOR_ECHARTS_OUTPUT_GUARD_FIXTURE = '1'
        try {
            $feed = Join-Path $WorkPath 'guard-feed'
            [System.IO.Directory]::CreateDirectory((Join-Path $feed 'feed')) | Out-Null
            Set-Content -LiteralPath (Join-Path $feed 'packages-manifest.json') -Value '{}' -Encoding ASCII
            foreach ($id in (Get-PackageIds)) { Set-Content -LiteralPath (Join-Path $feed "feed/$id.0.0.0-guard.nupkg") -Value x -Encoding ASCII }
            $manifest = Join-Path $WorkPath 'guard-export/export-manifest.json'
            $exportWork = "$manifest.work"
            $destination = Join-Path ([System.IO.Path]::GetTempPath()) "blazorecharts-guard-$([guid]::NewGuid().ToString('N'))"
            $scripts = [ordered]@{
                'verify-local.ps1' = @{ Output = $foreign; Arguments = @('-SourceRoot', $SourceRoot, '-OutputPath', $foreign) }
                'package.ps1' = @{ Output = $foreign; Arguments = @('-SourceRoot', $SourceRoot, '-OutputPath', $foreign) }
                'test-aot.ps1' = @{ Output = $foreign; Arguments = @('-SourceRoot', $SourceRoot, '-PackageDirectory', $feed, '-ResultsDirectory', $foreign) }
                'test-packages.ps1' = @{ Output = $foreign; Arguments = @('-SourceRoot', $SourceRoot, '-FeedPath', (Join-Path $feed 'feed'), '-Version', '0.0.0-guard', '-WorkPath', $foreign) }
                'test-verification-gate.ps1' = @{ Output = $foreign; Arguments = @('-SourceRoot', $SourceRoot, '-WorkPath', $foreign) }
                'test-export-tools.ps1' = @{ Output = $foreign; Arguments = @('-SourceRoot', $SourceRoot, '-WorkPath', $foreign) }
                'test-release-tools.ps1' = @{ Output = $foreign; Arguments = @('-SourceRoot', $SourceRoot, '-FeedPath', (Join-Path $feed 'feed'), '-Version', '0.0.0-guard', '-WorkPath', $foreign) }
                'export-initial.ps1' = @{ Output = $exportWork; Arguments = @('-SourceRoot', $SourceRoot, '-DestinationPath', $destination, '-RepositoryUrl', 'https://example.invalid/repository',
                    '-Version', '0.0.0-guard', '-PackageId', (Get-PackageId Core), '-WordCloudPackageId', (Get-PackageId WordCloud), '-RootNamespace', 'BlazorECharts',
                    '-AuthorName', 'Release Guard', '-AuthorEmail', 'guard@example.invalid', '-ManifestPath', $manifest) }
            }
            [System.IO.Directory]::CreateDirectory($exportWork) | Out-Null
            Set-Content -LiteralPath (Join-Path $exportWork 'keep.txt') -Value 'not tool output' -Encoding ASCII
            foreach ($name in $scripts.Keys) {
                $case = $scripts[$name]
                $log = Join-Path $WorkPath "guard-$name.log"
                $code = Invoke-LoggedProcess -FilePath $script:PowerShell -LogPath $log -ArgumentList (@('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot $name)) + $case.Arguments)
                $left = @(Get-ChildItem -LiteralPath $case.Output -Force | ForEach-Object { $_.Name }) -join '|'
                $refused = (Get-Content -LiteralPath $log -Raw) -match 'has no \.blazorecharts-output'
                Assert-Gate "OutputDirectoryIsOwned/$name" ($code -ne 0 -and $refused -and $left -eq 'keep.txt' -and -not (Test-Path -LiteralPath $destination)) "exit $code, refused $refused, left [$left], log $log"
            }
        }
        finally { Remove-Item Env:\BLAZOR_ECHARTS_OUTPUT_GUARD_FIXTURE -ErrorAction SilentlyContinue }
    }

    # Release plan: the real files pass, broken copies are rejected.
    $plan = Join-Path $WorkPath 'plan'
    New-Item -ItemType Directory -Force -Path $plan | Out-Null
    $checklistPath = Join-Path $SourceRoot 'docs/compatibility/release-checklist.md'
    $requirements = if (Test-Path -LiteralPath $checklistPath) { Read-ReleaseChecklist -Path $checklistPath } else { @() }
    $failures = if (Test-Path -LiteralPath $checklistPath) { Test-ReleaseChecklist -Requirements $requirements -StageIds (Get-GateStageIds) } else { @("$checklistPath is missing.") }
    Assert-Gate 'ReleasePlanRejectsGaps/checklist' (@($failures).Count -eq 0) (Format-Messages $failures)
    $broken = @($requirements | Where-Object { $_.id -ne 'R7' }) + @([ordered]@{ id = 'R7'; title = 'Updates'; stages = @('unknown-stage') })
    $failures = Test-ReleaseChecklist -Requirements @($requirements | Where-Object { $_.id -ne 'R7' }) -StageIds (Get-GateStageIds)
    Assert-Gate 'ReleasePlanRejectsGaps/checklist-missing-requirement' (Test-Matches $failures 'R7') (Format-Messages $failures)
    $failures = Test-ReleaseChecklist -Requirements $broken -StageIds (Get-GateStageIds)
    Assert-Gate 'ReleasePlanRejectsGaps/checklist-unknown-stage' (Test-Matches $failures 'unknown-stage') (Format-Messages $failures)

    $workflowPath = Join-Path $SourceRoot '.github/workflows/verify.yml'
    $failures = Test-VerifyWorkflow -Path $workflowPath
    Assert-Gate 'ReleasePlanRejectsGaps/workflow' (@($failures).Count -eq 0) (Format-Messages $failures)
    if (Test-Path -LiteralPath $workflowPath) {
        $text = Get-Content -LiteralPath $workflowPath -Raw
        $copy = Join-Path $plan 'push.yml'
        Set-Content -LiteralPath $copy -Encoding UTF8 -Value ($text + "`n      - run: git push origin HEAD`n")
        $failures = Test-VerifyWorkflow -Path $copy
        Assert-Gate 'ReleasePlanRejectsGaps/workflow-push' (Test-Matches $failures 'push') (Format-Messages $failures)
        $copy = Join-Path $plan 'secret.yml'
        Set-Content -LiteralPath $copy -Encoding UTF8 -Value ($text + "`n        env:`n          TOKEN: `${{ secrets.NUGET_API_KEY }}`n")
        $failures = Test-VerifyWorkflow -Path $copy
        Assert-Gate 'ReleasePlanRejectsGaps/workflow-secret' (Test-Matches $failures 'secret') (Format-Messages $failures)
        $copy = Join-Path $plan 'credentials.yml'
        Set-Content -LiteralPath $copy -Encoding UTF8 -Value ($text -replace 'persist-credentials: false', 'persist-credentials: true')
        $failures = Test-VerifyWorkflow -Path $copy
        Assert-Gate 'ReleasePlanRejectsGaps/workflow-credentials' (Test-Matches $failures 'persist-credentials') (Format-Messages $failures)
        $copy = Join-Path $plan 'other-tool.yml'
        Set-Content -LiteralPath $copy -Encoding UTF8 -Value ($text -replace 'tools/Release/verify-local\.ps1', 'tools/other-gate.ps1')
        $failures = Test-VerifyWorkflow -Path $copy
        Assert-Gate 'ReleasePlanRejectsGaps/workflow-tools' (Test-Matches $failures 'does not run tools/Release/verify-local\.ps1') (Format-Messages $failures)
        $cases = [ordered]@{
            'workflow-pull-request-target' = @{ Text = ($text -replace '(?m)^  pull_request:', '  pull_request_target:'); Pattern = 'pull_request_target' }
            'workflow-run-trigger' = @{ Text = ($text -replace '(?m)^  workflow_dispatch:', "  workflow_run:`n    workflows: [build]"); Pattern = 'workflow_run' }
            'workflow-tag-pin' = @{ Text = ($text -replace 'actions/checkout@[0-9a-f]{40}', 'actions/checkout@v5'); Pattern = 'actions/checkout@v5 is not pinned' }
            'workflow-floating-workload' = @{ Text = ($text -replace 'dotnet workload install wasm-tools[^\r\n]*', 'dotnet workload install wasm-tools --skip-manifest-update'); Pattern = 'pinned workload set' }
            'workflow-always' = @{ Text = ($text -replace '!cancelled\(\)', 'always()'); Pattern = 'always\(\)' }
            'workflow-event-in-run' = @{ Text = ($text + "`n      - name: Title`n        run: |`n          echo `"`${{ github.event.pull_request.title }}`"`n"); Pattern = 'event data' }
            'workflow-input-in-run' = @{ Text = ($text + "`n      - run: echo `${{ inputs.version }}`n"); Pattern = 'run script expands \$\{\{ inputs\.version \}\}' }
            'workflow-write-all' = @{ Text = ($text + "`n    permissions: write-all`n"); Pattern = 'write permission' }
            'workflow-write-flow' = @{ Text = ($text + "`n    permissions: { contents: read, pull-requests: write }`n"); Pattern = 'write permission' }
            'workflow-write-comment' = @{ Text = ($text + "`n    permissions:`n      contents: write # release notes`n"); Pattern = 'write permission' }
            'workflow-trigger-list' = @{ Text = ($text -replace '(?m)^on:\s*$', "on: [workflow_dispatch, pull_request_target]`nold:"); Pattern = 'pull_request_target' }
            'workflow-trigger-flow' = @{ Text = ($text -replace '(?m)^on:', "on: { workflow_run: { workflows: [build] } }`nold:"); Pattern = 'workflow_run' }
            'workflow-node-literal' = @{ Text = ($text -replace 'node-version-file: \.node-version', 'node-version: 24.18.0'); Pattern = 'node-version-file' }
            'workflow-unlocked-restore' = @{ Text = ($text + "`n      - run: dotnet build samples/BlazorECharts.Demo/BlazorECharts.Demo.csproj -c Release`n"); Pattern = 'RestoreLockedMode' }
            'workflow-results-not-uploaded' = @{ Text = ($text -replace '(?m)^\s+artifacts/verification/dotnet-test/\*\*/\*\.trx\s*\r?\n', ''); Pattern = '\*\.trx.*Get-GateVerdict' }
            'workflow-results-flat' = @{ Text = ($text -replace 'dotnet-test/\*\*/\*\.trx', 'dotnet-test/*.trx'); Pattern = 'dotnet-test/\*\*/\*\.trx.*Get-GateVerdict' }
        }
        foreach ($name in $cases.Keys) {
            $copy = Join-Path $plan "$name.yml"
            Set-Content -LiteralPath $copy -Encoding UTF8 -Value $cases[$name].Text
            $failures = Test-VerifyWorkflow -Path $copy
            Assert-Gate "ReleasePlanRejectsGaps/$name" (Test-Matches $failures $cases[$name].Pattern) (Format-Messages $failures)
        }
        # Event data passed through env, as the failure message recommends, is accepted: env: ends the run script.
        $copy = Join-Path $plan 'event-through-env.yml'
        Set-Content -LiteralPath $copy -Encoding UTF8 -Value ($text + "`n      - name: Title`n        run: echo `"`$TITLE`"`n        env:`n          TITLE: `${{ github.event.pull_request.title }}`n")
        $failures = Test-VerifyWorkflow -Path $copy
        Assert-Gate 'ReleasePlanRejectsGaps/workflow-event-through-env' (@($failures).Count -eq 0) (Format-Messages $failures)
    }

    # The run scripts that call the release tools never run locally: execute them against a stub with the tool's own
    # parameters and check what it received.
    $repositoryUrl = 'https://github.com/Qyperion/BlazorECharts'
    $release = @{ RELEASE_VERSION = '1.0.0'; RELEASE_REPOSITORY = $repositoryUrl; RELEASE_COMMIT = $commit }
    $bound = Invoke-WorkflowStep -Workflow $workflowPath -Step 'Run the release gate' -Tool 'verify-local.ps1' -Environment $release
    Assert-Gate 'WorkflowStepsBindTheirParameters/verify-release' ($bound.exitCode -eq 0 -and $bound.parameters.Version -eq '1.0.0' -and
        $bound.parameters.RepositoryUrl -eq $repositoryUrl -and $bound.parameters.RepositoryCommit -eq $commit -and "$($bound.parameters.OutputPath)" -match 'artifacts[\\/]verification$') `
        "exit $($bound.exitCode): $($bound.parameters | ConvertTo-Json -Compress) $($bound.log)"
    $bound = Invoke-WorkflowStep -Workflow $workflowPath -Step 'Run the release gate' -Tool 'verify-local.ps1' -Environment @{ RELEASE_VERSION = ''; RELEASE_REPOSITORY = $repositoryUrl; RELEASE_COMMIT = $commit }
    Assert-Gate 'WorkflowStepsBindTheirParameters/verify-pull-request' ($bound.exitCode -eq 0 -and $null -ne $bound.parameters -and
        -not ($bound.parameters.PSObject.Properties.Name -match '^(Version|RepositoryUrl|RepositoryCommit)$')) "exit $($bound.exitCode): $($bound.parameters | ConvertTo-Json -Compress) $($bound.log)"

    $releasePath = Join-Path $SourceRoot '.github/workflows/release.yml'
    $bound = Invoke-WorkflowStep -Workflow $releasePath -Step 'Confirm the verified packages' -Tool 'confirm-release.ps1' -Environment $release
    Assert-Gate 'WorkflowStepsBindTheirParameters/release-confirm' ($bound.exitCode -eq 0 -and $bound.parameters.Version -eq '1.0.0' -and
        $bound.parameters.RepositoryUrl -eq $repositoryUrl -and $bound.parameters.RepositoryCommit -eq $commit -and "$($bound.parameters.VerificationPath)" -match 'artifacts[\\/]verification$') `
        "exit $($bound.exitCode): $($bound.parameters | ConvertTo-Json -Compress) $($bound.log)"

    $failures = Test-ReleaseWorkflow -Path $releasePath
    Assert-Gate 'ReleasePlanRejectsGaps/release-workflow' (@($failures).Count -eq 0) (Format-Messages $failures)
    if (Test-Path -LiteralPath $releasePath) {
        $text = Get-Content -LiteralPath $releasePath -Raw
        $cases = [ordered]@{
            'release-token-for-workflow' = @{ Text = ($text -replace '(?m)^permissions:\s*\r?\n  contents: read', "permissions:`n  contents: read`n  id-token: write"); Pattern = 'whole workflow' }
            'release-token-for-gate' = @{ Text = ($text -replace '(?m)^    name: Release version\s*$', "    name: Release version`n    permissions:`n      id-token: write"); Pattern = 'Job version requests id-token' }
            'release-contents-write' = @{ Text = ($text -replace '(?m)^      id-token: write', "      id-token: write`n      contents: write"); Pattern = 'requests contents: write' }
            'release-write-all' = @{ Text = ($text -replace '(?m)^permissions:\s*\r?\n  contents: read', 'permissions: write-all'); Pattern = 'write-all' }
            'release-no-environment' = @{ Text = ($text -replace '(?m)^    environment: nuget\s*\r?\n', ''); Pattern = 'protected environment' }
            'release-no-confirmation' = @{ Text = ($text -replace 'tools/Release/confirm-release\.ps1', 'tools/Release/other.ps1'); Pattern = 'confirm-release\.ps1 before the login' }
            'release-duplicate-push' = @{ Text = ($text -replace ' --skip-duplicate', ''); Pattern = 'skip-duplicate' }
            'release-stored-key' = @{ Text = ($text -replace 'steps\.login\.outputs\.NUGET_API_KEY', 'secrets.NUGET_API_KEY'); Pattern = 'stored secret' }
            'release-login-tag' = @{ Text = ($text -replace 'NuGet/login@[0-9a-f]{40}', 'NuGet/login@v1'); Pattern = 'NuGet/login@v1 is not pinned' }
            'release-pull-request' = @{ Text = ($text -replace '(?m)^on:\s*$', "on:`n  pull_request:"); Pattern = 'runs for pull_request' }
            'release-branch-push' = @{ Text = ($text -replace "(?m)^    tags:\s*\r?\n      - 'v\*'", '    branches: [main]'); Pattern = 'pushed branches' }
            'release-input-in-run' = @{ Text = ($text + "      - run: echo `${{ inputs.version }}`n"); Pattern = 'run script expands \$\{\{ inputs\.version \}\}' }
            'release-packs' = @{ Text = ($text + "      - run: dotnet pack src/BlazorECharts/BlazorECharts.csproj -p:RestoreLockedMode=true`n"); Pattern = 'only verify\.yml packs' }
            'release-without-gate' = @{ Text = ($text -replace '\./\.github/workflows/verify\.yml', './.github/workflows/build.yml'); Pattern = 'release gate of \./\.github/workflows/verify\.yml' }
        }
        foreach ($name in $cases.Keys) {
            $copy = Join-Path $plan "$name.yml"
            Set-Content -LiteralPath $copy -Encoding UTF8 -Value $cases[$name].Text
            $failures = Test-ReleaseWorkflow -Path $copy
            Assert-Gate "ReleasePlanRejectsGaps/$name" (Test-Matches $failures $cases[$name].Pattern) (Format-Messages $failures)
        }
    }

    $pagesPath = Join-Path $SourceRoot '.github/workflows/pages.yml'
    $bound = Invoke-WorkflowStep -Workflow $pagesPath -Step 'Publish the demo' -Tool 'publish-demo.ps1' -Environment @{ PAGES_BASE_PATH = '/BlazorECharts' }
    Assert-Gate 'WorkflowStepsBindTheirParameters/pages-publish' ($bound.exitCode -eq 0 -and $bound.parameters.BasePath -eq '/BlazorECharts' -and
        "$($bound.parameters.OutputPath)" -match 'artifacts[\\/]pages$' -and $null -ne $bound.parameters.SourceRoot) "exit $($bound.exitCode): $($bound.parameters | ConvertTo-Json -Compress) $($bound.log)"
    $failures = Test-PagesWorkflow -Path $pagesPath
    Assert-Gate 'ReleasePlanRejectsGaps/pages-workflow' (@($failures).Count -eq 0) (Format-Messages $failures)
    if (Test-Path -LiteralPath $pagesPath) {
        $text = Get-Content -LiteralPath $pagesPath -Raw
        $cases = [ordered]@{
            'pages-pull-request' = @{ Text = ($text -replace '(?m)^on:\s*$', "on:`n  pull_request:"); Pattern = 'deploys for pull_request' }
            'pages-branch-push' = @{ Text = ($text -replace "(?m)^    tags:\s*\r?\n      - 'v\*'", '    branches: [main]'); Pattern = 'pushed branches' }
            'pages-write-for-workflow' = @{ Text = ($text -replace '(?m)^permissions:\s*\r?\n  contents: read', "permissions:`n  contents: read`n  pages: write"); Pattern = 'for every job' }
            'pages-write-for-build' = @{ Text = ($text -replace '(?m)^      pages: read', '      pages: write'); Pattern = 'Job build requests pages: write' }
            'pages-contents-write' = @{ Text = ($text -replace '(?m)^      pages: write', "      pages: write`n      contents: write"); Pattern = 'deploy job requests contents: write' }
            'pages-no-environment' = @{ Text = ($text -replace '(?m)^      name: github-pages', '      name: preview'); Pattern = 'github-pages environment' }
            'pages-code-in-deploy' = @{ Text = ($text + "      - run: ./tools/deploy.ps1`n"); Pattern = 'deploy job runs repository code' }
            'pages-tag-pin' = @{ Text = ($text -replace 'actions/deploy-pages@[0-9a-f]{40}', 'actions/deploy-pages@v5'); Pattern = 'actions/deploy-pages@v5 is not pinned' }
            'pages-floating-workload' = @{ Text = ($text -replace 'dotnet workload install wasm-tools[^\r\n]*', 'dotnet workload install wasm-tools'); Pattern = 'pinned workload set' }
            'pages-secret' = @{ Text = ($text -replace 'PAGES_BASE_PATH: \$\{\{ steps\.pages\.outputs\.base_path \}\}', 'PAGES_BASE_PATH: ${{ secrets.PAGES_PATH }}'); Pattern = 'stored secret' }
            'pages-other-tool' = @{ Text = ($text -replace 'tools/Release/publish-demo\.ps1', 'tools/build-site.ps1'); Pattern = 'publish-demo\.ps1' }
        }
        foreach ($name in $cases.Keys) {
            $copy = Join-Path $plan "$name.yml"
            Set-Content -LiteralPath $copy -Encoding UTF8 -Value $cases[$name].Text
            $failures = Test-PagesWorkflow -Path $copy
            Assert-Gate "ReleasePlanRejectsGaps/$name" (Test-Matches $failures $cases[$name].Pattern) (Format-Messages $failures)
        }
    }

    # Before a push: only the files of a passing report for this release, byte for byte.
    $releaseUrl = 'https://github.com/Qyperion/BlazorECharts'
    $releaseRoot = Join-Path $WorkPath 'release'
    $newRelease = {
        $report = New-PassingReport $releaseRoot
        $feed = Join-Path $releaseRoot 'packages/feed'
        New-Item -ItemType Directory -Force -Path $feed | Out-Null
        $packages = @(foreach ($id in (Get-PackageIds)) {
            foreach ($extension in @('nupkg', 'snupkg')) { Set-Content -LiteralPath (Join-Path $feed "$id.1.0.0.$extension") -Value "$extension of $id" -Encoding ASCII }
            [ordered]@{ id = $id; file = "feed/$id.1.0.0.nupkg"; sha256 = Get-FileSha256 (Join-Path $feed "$id.1.0.0.nupkg")
                symbols = [ordered]@{ file = "feed/$id.1.0.0.snupkg"; sha256 = Get-FileSha256 (Join-Path $feed "$id.1.0.0.snupkg") } }
        })
        [ordered]@{ formatVersion = 1; version = '1.0.0'; packages = $packages } | ConvertTo-Json -Depth 5 |
            Set-Content -LiteralPath (Join-Path $releaseRoot 'packages/packages-manifest.json') -Encoding UTF8
        $report['parameters'] = [ordered]@{ version = '1.0.0'; repositoryUrl = $releaseUrl; repositoryCommit = $commit }
        $report['verdict'] = [ordered]@{ status = 'PASS' }
        $report
    }
    $writeRelease = { param($Report) $Report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $releaseRoot 'verification-report.json') -Encoding UTF8 }
    $confirm = { param([string]$Version = '1.0.0', [string]$Commit = $commit) Test-ReleaseVerification -Path $releaseRoot -Version $Version -RepositoryUrl $releaseUrl -RepositoryCommit $Commit }
    & $writeRelease (& $newRelease)
    $failures = & $confirm
    Assert-Gate 'ReleaseVerification/pass' (@($failures).Count -eq 0) (Format-Messages $failures)
    Add-Content -LiteralPath (Join-Path $releaseRoot "packages/feed/$(Get-PackageId Core).1.0.0.nupkg") -Value 'tampered' -Encoding ASCII
    $failures = & $confirm
    Assert-Gate 'ReleaseVerification/changed-package' (Test-Matches $failures "^feed/$([regex]::Escape((Get-PackageId Core)))\.1\.0\.0\.nupkg differs from the SHA-256") (Format-Messages $failures)
    & $writeRelease (& $newRelease)
    Set-Content -LiteralPath (Join-Path $releaseRoot 'packages/feed/Other.1.0.0.nupkg') -Value 'other' -Encoding ASCII
    $failures = & $confirm
    Assert-Gate 'ReleaseVerification/unrecorded-package' (Test-Matches $failures 'Other\.1\.0\.0\.nupkg, which the gate did not record') (Format-Messages $failures)
    & $writeRelease (& $newRelease)
    $failures = & $confirm -Commit 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    Assert-Gate 'ReleaseVerification/other-commit' ((Test-Matches $failures 'verified repositoryCommit') -and (Test-Matches $failures "verified commit $commit")) (Format-Messages $failures)
    $failures = & $confirm -Version '1.0.1'
    Assert-Gate 'ReleaseVerification/other-version' ((Test-Matches $failures "verified version '1\.0\.0', not '1\.0\.1'") -and (Test-Matches $failures 'feed/.*1\.0\.1\.nupkg')) (Format-Messages $failures)
    $report = & $newRelease
    $report['verdict'] = [ordered]@{ status = 'FAIL' }
    & $writeRelease $report
    $failures = & $confirm
    Assert-Gate 'ReleaseVerification/failed-gate' (Test-Matches $failures "verdict 'FAIL', not PASS") (Format-Messages $failures)
    & $writeRelease (& $newRelease)
    Add-Content -LiteralPath (Join-Path $releaseRoot 'stages/build.txt') -Value 'changed' -Encoding ASCII
    $failures = & $confirm
    Assert-Gate 'ReleaseVerification/changed-evidence' (Test-Matches $failures '^Rechecked from the recorded files, the verdict is FAIL: .*build: artifact stages/build\.txt changed') (Format-Messages $failures)

    $failures = Test-RestoreSources -PropsPath (Join-Path $SourceRoot 'Directory.Build.props')
    Assert-Gate 'ReleasePlanRejectsGaps/restore-sources' (@($failures).Count -eq 0) (Format-Messages $failures)
    $props = Join-Path $plan 'Directory.Build.props'
    Set-Content -LiteralPath $props -Encoding UTF8 -Value '<Project><PropertyGroup><RestorePackagesWithLockFile>true</RestorePackagesWithLockFile></PropertyGroup></Project>'
    $failures = Test-RestoreSources -PropsPath $props
    Assert-Gate 'ReleasePlanRejectsGaps/library-packs-source' (Test-Matches $failures 'DisableImplicitLibraryPacksFolder') (Format-Messages $failures)

    $failures = Test-ForbidOnly -SourceRoot $SourceRoot
    Assert-Gate 'ReleasePlanRejectsGaps/forbid-only' (@($failures).Count -eq 0) (Format-Messages $failures)
    $config = Join-Path $plan 'playwright.config.ts'
    Set-Content -LiteralPath $config -Encoding UTF8 -Value 'export default defineConfig({ workers: 1 });'
    $failures = Test-ForbidOnly -SourceRoot $SourceRoot -Configs @($config)
    Assert-Gate 'ReleasePlanRejectsGaps/forbid-only-missing' (Test-Matches $failures 'forbidOnly') (Format-Messages $failures)

    $specs = Get-BrowserSpecFiles -SourceRoot $SourceRoot
    $failures = Test-BrowserSpecAssignment -SpecFiles $specs -Assignments (Get-BrowserStageSpecs)
    Assert-Gate 'ReleasePlanRejectsGaps/browser-specs' (@($failures).Count -eq 0 -and @($specs).Count -gt 0) "$(@($specs).Count) specs: $(Format-Messages $failures)"
    $failures = Test-BrowserSpecAssignment -SpecFiles (@($specs) + 'new-feature.spec.ts') -Assignments (Get-BrowserStageSpecs)
    Assert-Gate 'ReleasePlanRejectsGaps/unassigned-spec' (Test-Matches $failures 'new-feature\.spec\.ts') (Format-Messages $failures)
    $twice = [ordered]@{}
    foreach ($key in (Get-BrowserStageSpecs).Keys) { $twice[$key] = @((Get-BrowserStageSpecs)[$key]) }
    $twice['browser-resources'] = @($twice['browser-resources']) + 'events.spec.ts'
    $failures = Test-BrowserSpecAssignment -SpecFiles $specs -Assignments $twice
    Assert-Gate 'ReleasePlanRejectsGaps/spec-twice' (Test-Matches $failures 'events\.spec\.ts') (Format-Messages $failures)
    $counts = @{}
    foreach ($key in (Get-BrowserSpecCounts).Keys) { if ($key -ne 'events.spec.ts') { $counts[$key] = (Get-BrowserSpecCounts)[$key] } }
    $counts['retired.spec.ts'] = 3
    $counts['matrix/browser-matrix.spec.ts'] = @{ 'matrix-chrome' = 7; 'matrix-firefox' = 0 }
    $failures = Test-BrowserSpecAssignment -SpecFiles $specs -Assignments (Get-BrowserStageSpecs) -Counts $counts
    Assert-Gate 'ReleasePlanRejectsGaps/spec-counts' ((Test-Matches $failures 'events\.spec\.ts has no expected number') -and (Test-Matches $failures 'browser-matrix\.spec\.ts has no expected number') -and
        (Test-Matches $failures 'retired\.spec\.ts, which no stage runs')) (Format-Messages $failures)
}
catch {
    Assert-Gate 'FixtureError' $false "$($_.Exception.Message) at $($_.InvocationInfo.PositionMessage)"
}

$failed = @($script:Checks | Where-Object { -not $_.passed }).Count
[ordered]@{ formatVersion = 1; passed = $script:Checks.Count - $failed; failed = $failed; fixtures = $script:Checks.ToArray() } |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $WorkPath 'fixtures.json') -Encoding UTF8
Write-Host "$($script:Checks.Count - $failed) passed, $failed failed"
if ($failed -ne 0) { exit 1 }
exit 0
