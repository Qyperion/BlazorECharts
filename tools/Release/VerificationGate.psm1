#Requires -Version 5.1
# The local release gate: stages, test and evidence checks, and the fail-closed verdict of verify-local.ps1.
# Windows PowerShell 5.1 compatible; keep this file ASCII.
Set-StrictMode -Version 3.0
# The caller's preference does not apply: a module function stops at its first error however the script was started.
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'ReleaseTools.psm1')

# Every stage of the gate in run order. The verdict fails when one of them is missing from a report.
$script:StageIds = @(
    'gate-fixtures', 'source-tree', 'release-plan',
    'npm-ci', 'restore', 'build', 'generate-check', 'snapshots-check', 'api-check', 'assets-check', 'typecheck-generator', 'typecheck-runtime',
    'dotnet-test', 'js-test', 'generator-test', 'docs-check',
    'browser-catalog', 'browser-interop', 'browser-lifecycle', 'wordcloud-compatibility', 'browser-matrix', 'browser-resources',
    'packages', 'aot')

# Each Playwright spec under tests/browser runs in exactly one browser stage; paths are relative to tests/browser.
# The generator reads the same file to accept browser evidence only from gated specs.
$script:BrowserStageSpecs = [ordered]@{}
foreach ($stage in (Read-Json (Join-Path $PSScriptRoot 'browser-stages.json')).stages.PSObject.Properties) { $script:BrowserStageSpecs[$stage.Name] = @($stage.Value) }
# The exact number of passing tests of each gated spec over all its projects, as in the last PASS. A
# lost loop case, a deleted or an added test fails the stage until the change updates its count here.
# The matrix counts each required browser project: its seven scenarios (five Interactive Server, two
# WebAssembly) pass or are skipped because the browser cannot start, which the matrix check blocks.
$script:BrowserSpecCounts = @{
    'series-catalog.spec.ts' = 8; 'standard-series.spec.ts' = 36; 'advanced-series.spec.ts' = 18
    'components.spec.ts' = 18; 'coordinates.spec.ts' = 18; 'dates.spec.ts' = 4; 'graphics.spec.ts' = 10; 'demo/demo.spec.ts' = 24; 'demo/app-scenarios.spec.ts' = 16
    'demo/accessibility.spec.ts' = 3; 'demo/components.spec.ts' = 24; 'functions.spec.ts' = 27; 'events.spec.ts' = 34; 'event-conformance.spec.ts' = 1; 'methods.spec.ts' = 20
    'globals.spec.ts' = 14; 'runtime.spec.ts' = 6; 'extensions.spec.ts' = 4; 'updates.spec.ts' = 4; 'interaction-events.spec.ts' = 24; 'lifecycle.spec.ts' = 12; 'recreate.spec.ts' = 8
    'harness/hosting-smoke.spec.ts' = 2; 'demo/hosting.spec.ts' = 27; 'wordcloud.spec.ts' = 74; 'wordcloud-registration.spec.ts' = 15; 'exports.spec.ts' = 24
    'compatibility/wordcloud.spec.ts' = 10; 'resource-lifetime.spec.ts' = 16; 'server-reliability.spec.ts' = 7; 'runtime-versioning.spec.ts' = 4
    'matrix/browser-matrix.spec.ts' = @{ 'matrix-chrome' = 7; 'matrix-msedge' = 7; 'matrix-firefox' = 7 }
}
# The exact number of passing tests of the other test stages, as in the last PASS; dotnet-test counts each test assembly.
$script:StageTestCounts = @{
    'gate-fixtures' = 162; 'js-test' = 191; 'generator-test' = 202; 'packages' = 10; 'aot' = 14
    'dotnet-test' = @{ 'BlazorECharts.Tests' = 626; 'BlazorECharts.ComponentTests' = 51 }
}
# Measurements without thresholds that rewrite a tracked baseline; they are not release evidence.
$script:UngatedBrowserSpecs = @('performance/performance.spec.ts')

# Browsers that must pass the matrix; the Playwright Chromium and WebKit builds are engine checks.
$script:RequiredBrowsers = @('chrome', 'msedge', 'firefox')
$script:GatedRequirements = @(1..13 | Where-Object { $_ -ne 12 } | ForEach-Object { "R$_" })

function Get-GateStageIds { , $script:StageIds }
function Get-BrowserStageSpecs { $script:BrowserStageSpecs }
function Get-BrowserSpecCounts { $script:BrowserSpecCounts }
function Get-StageTestCounts { $script:StageTestCounts }
function Get-RequiredBrowsers { , $script:RequiredBrowsers }

# The Microsoft.Testing.Platform mode of global.json: xUnit writes one trx per test assembly, named after the user, the
# machine and a timestamp that two assemblies started together can share; the per-module layout puts each assembly's
# trx into its own <project>/<framework>_<architecture> folder, so one cannot overwrite the other.
function Get-DotnetTestStage([string]$OutputPath, [string]$Configuration, [string[]]$TestProjects) {
    @{ FilePath = 'dotnet'; DependsOn = @('build'); Artifacts = @('dotnet-test/**/*.trx')
        ArgumentList = @('test', '--solution', 'BlazorECharts.slnx', '-c', $Configuration, '--no-build', '--no-ansi', '--report-xunit-trx',
            '--results-directory', (Join-Path $OutputPath 'dotnet-test'), '--results-directory-layout', 'per-module')
        Tests = @(@{ Kind = 'trx'; Path = 'dotnet-test'; ExpectedFiles = $TestProjects.Count; Modules = $script:StageTestCounts['dotnet-test'] }) }
}

# Arrays are returned unrolled: wrap the call in @() where a list is expected.
function Get-JsonValue($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) { if ($Object.Contains($Name)) { return $Object[$Name] } else { return $null } }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { $null } else { $property.Value }
}

function ConvertTo-RelativePath([string]$Path, [string]$Root) {
    $Path.Substring($Root.TrimEnd('\', '/').Length).TrimStart('\', '/').Replace('\', '/')
}

# The verified tree is the tree of HEAD; tracked changes make the identity unusable and are listed.
# NUL-separated status keeps paths with spaces or quotes verbatim; a rename or copy adds its source path.
# Ignored files are listed only when they are build inputs: bin, obj and tool caches are outputs.
function Get-SourceIdentity([Parameter(Mandatory)][string]$SourceRoot) {
    $dirty = New-Object System.Collections.Generic.List[string]
    $untracked = New-Object System.Collections.Generic.List[string]
    $ignored = New-Object System.Collections.Generic.List[string]
    $entries = @((Invoke-GitCommand $SourceRoot @('status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching')) -join "`n" -split "`0" | Where-Object { $_ -ne '' })
    for ($i = 0; $i -lt $entries.Count; $i++) {
        $entry = $entries[$i]
        if ($entry.Length -lt 4) { throw "Unexpected git status entry '$entry'." }
        $status = $entry.Substring(0, 2)
        $path = $entry.Substring(3)
        if ($status -eq '??') { $untracked.Add($path) }
        elseif ($status -eq '!!') { if (Test-IgnoredBuildInputPath $path) { $ignored.Add($path) } }
        else { $dirty.Add($path) }
        if ($status -match '[RC]') { $i++ }
    }
    [ordered]@{
        commit = (Invoke-GitCommand $SourceRoot @('rev-parse', 'HEAD'))[0]
        tree = (Invoke-GitCommand $SourceRoot @('rev-parse', 'HEAD^{tree}'))[0]
        dirty = $dirty.ToArray()
        untracked = $untracked.ToArray()
        ignored = $ignored.ToArray()
        converted = @(Get-ConvertedFiles $SourceRoot)
        misnamed = @(Get-MisnamedFiles $SourceRoot)
    }
}

# Tracked paths that the checkout spells in another case, as 'tracked -> on disk': a case-insensitive file
# system does not record a rename that changes only the case, so the commit keeps the old name.
# Unrolled: wrap the call in @().
function Get-MisnamedFiles([Parameter(Mandatory)][string]$SourceRoot) {
    $listings = @{}
    $paths = @((Invoke-GitCommand $SourceRoot @('-c', 'core.quotepath=off', 'ls-files', '-z')) -join "`n" -split "`0" | Where-Object { $_ -ne '' })
    foreach ($path in $paths) {
        $directory = $SourceRoot
        $actual = New-Object System.Collections.Generic.List[string]
        foreach ($segment in $path.Split('/')) {
            if (-not $listings.ContainsKey($directory)) {
                # Exact names first; a PowerShell hashtable ignores case and finds the spelling on disk.
                $exact = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
                $folded = @{}
                if ([System.IO.Directory]::Exists($directory)) {
                    foreach ($entry in [System.IO.Directory]::GetFileSystemEntries($directory)) { $name = [System.IO.Path]::GetFileName($entry); [void]$exact.Add($name); $folded[$name] = $name }
                }
                $listings[$directory] = @{ exact = $exact; folded = $folded }
            }
            $name = if ($listings[$directory].exact.Contains($segment)) { $segment } else { $listings[$directory].folded[$segment] }
            if ($null -eq $name) { $actual = $null; break }
            $actual.Add($name)
            $directory = [System.IO.Path]::Combine($directory, $name)
        }
        if ($null -ne $actual -and ($actual -join '/') -cne $path) { "$path -> $($actual -join '/')" }
    }
}

# Tracked files checked out with other line endings than their blob, such as CRLF from core.autocrlf: the
# verified bytes would not be the committed ones. A blob with CRLF (a -text notice) is checked out as it is.
# Unrolled: wrap the call in @().
function Get-ConvertedFiles([Parameter(Mandatory)][string]$SourceRoot) {
    $entries = @((Invoke-GitCommand $SourceRoot @('-c', 'core.quotepath=off', 'ls-files', '--eol', '-z')) -join "`n" -split "`0" | Where-Object { $_ -ne '' })
    foreach ($entry in $entries) {
        if ($entry -notmatch '^i/(\S*)\s+w/(\S*)\s+attr/[^\t]*\t(.+)$') { throw "Unexpected git ls-files --eol entry '$entry'." }
        if ($Matches[2] -in @('crlf', 'mixed') -and $Matches[1] -ne $Matches[2]) { $Matches[3] }
    }
}

# Untracked files that change what restore, build or pack produce: anything under src, MSBuild
# directory files and response files at any depth, and the root NuGet and SDK settings.
function Test-BuildInputPath([string]$Path) {
    $name = ($Path -split '/')[-1]
    $Path -like 'src/*' -or $name -match '^(Directory\.Build\.(props|targets|rsp)|Directory\.Packages\.props)$' -or $name -like '*.rsp' -or
        $Path -match '^(?i)(nuget\.config|global\.json)$'
}

# Ignored files that the SDK still reads: <project>.user files at any depth and the build inputs above,
# except the output folders bin and obj and installed node_modules.
function Test-IgnoredBuildInputPath([string]$Path) {
    if ($Path -match '(^|/)(bin|obj|node_modules)/') { return $false }
    $Path.TrimEnd('/') -like '*.user' -or (Test-BuildInputPath $Path)
}

# Unrolled: wrap the call in @().
function Get-BuildInputs($Identity) {
    @(Get-JsonValue $Identity 'untracked') | Where-Object { $_ -and (Test-BuildInputPath $_) }
    @(Get-JsonValue $Identity 'ignored') | Where-Object { $_ -and (Test-IgnoredBuildInputPath $_) }
}

function Test-SourceIdentity($Identity) {
    $failures = New-Object System.Collections.Generic.List[string]
    $dirty = @(Get-JsonValue $Identity 'dirty')
    if ($dirty.Count -ne 0) {
        $failures.Add("Tracked files have uncommitted changes against $(Get-JsonValue $Identity 'commit'): $($dirty -join ', '). Commit them so that every result names one source tree.")
    }
    $built = @(Get-BuildInputs $Identity)
    if ($built.Count -ne 0) { $failures.Add("Untracked or ignored files would change the build or the packages: $($built -join ', ').") }
    $converted = @(@(Get-JsonValue $Identity 'converted') | Where-Object { $_ })
    if ($converted.Count -ne 0) {
        $failures.Add("Tracked files are checked out with other line endings than committed: $($converted -join ', '). Check them out again; .gitattributes keeps text files LF.")
    }
    $misnamed = @(@(Get-JsonValue $Identity 'misnamed') | Where-Object { $_ })
    if ($misnamed.Count -ne 0) {
        $failures.Add("Tracked paths differ in case from the checkout: $($misnamed -join ', '). Record the rename: git rm --cached the old path and git add the new one.")
    }
    , $failures.ToArray()
}

# The summary of a dotnet build log must report no warning and no error.
function Test-BuildLog([Parameter(Mandatory)][string]$Path) {
    $failures = New-Object System.Collections.Generic.List[string]
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { $failures.Add("The build log $Path is missing."); return , $failures.ToArray() }
    $log = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if ($log -notmatch '(?m)^\s*0 Warning\(s\)\s*$') { $failures.Add('The build reported warnings or no summary.') }
    if ($log -notmatch '(?m)^\s*0 Error\(s\)\s*$') { $failures.Add('The build reported errors or no summary.') }
    , $failures.ToArray()
}

function New-TestCounts([string]$Kind, [string]$Path) {
    [ordered]@{ kind = $Kind; path = $Path; files = 0; passed = 0; failed = 0; skipped = 0; flaky = 0; errors = 0; expectedFailures = 0
        modules = [ordered]@{}; specs = [ordered]@{}; projects = [ordered]@{} }
}

# Reads trx (a directory), vitest, playwright or gate fixture results (a JSON file).
function Read-TestCounts([Parameter(Mandatory)][string]$Kind, [Parameter(Mandatory)][string]$Path, [string]$DisplayPath = $Path) {
    $counts = New-TestCounts $Kind $DisplayPath
    switch ($Kind) {
        'trx' {
            $files = @(if (Test-Path -LiteralPath $Path -PathType Container) { Get-ChildItem -LiteralPath $Path -Recurse -File -Filter *.trx })
            $counts.files = $files.Count
            foreach ($file in $files) {
                [xml]$trx = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
                $summary = $trx.SelectSingleNode("//*[local-name()='ResultSummary']")
                $counters = $trx.SelectSingleNode("//*[local-name()='ResultSummary']/*[local-name()='Counters']")
                if ($null -eq $counters) { $counts.errors++; continue }
                # An aborted or failed run is an error even when its counters look clean.
                if ($summary.GetAttribute('outcome') -cne 'Completed') { $counts.errors++ }
                $value = { param($name) $text = $counters.GetAttribute($name); if ($text) { [int]$text } else { 0 } }
                $passed = & $value 'passed'
                $failed = (& $value 'failed') + (& $value 'error') + (& $value 'timeout') + (& $value 'aborted')
                $skipped = (& $value 'notExecuted') + (& $value 'inconclusive')
                $counts.passed += $passed
                $counts.failed += $failed
                $counts.skipped += $skipped
                # Every other outcome (disconnected, notRunnable, passedButRunAborted, pending, ...) is not a pass either.
                if ((& $value 'total') -ne $passed + $failed + $skipped) { $counts.errors++ }
                # The test assembly names the result file; a file without tests keeps its own name.
                $method = $trx.SelectSingleNode("//*[local-name()='TestMethod']")
                $module = if ($null -ne $method -and $method.GetAttribute('codeBase')) { [System.IO.Path]::GetFileNameWithoutExtension($method.GetAttribute('codeBase')) } else { $file.Name }
                if ($counts.modules.Contains($module)) { $counts.errors++ } else { $counts.modules[$module] = $passed }
            }
        }
        'vitest' {
            if (Test-Path -LiteralPath $Path -PathType Leaf) {
                $json = Read-Json $Path
                $counts.files = 1
                $counts.passed = [int](Get-JsonValue $json 'numPassedTests')
                $counts.failed = [int](Get-JsonValue $json 'numFailedTests')
                $counts.skipped = [int](Get-JsonValue $json 'numPendingTests') + [int](Get-JsonValue $json 'numTodoTests')
                if ((Get-JsonValue $json 'success') -ne $true) { $counts.errors++ }
            }
        }
        'playwright' {
            if (Test-Path -LiteralPath $Path -PathType Leaf) {
                $json = Read-Json $Path
                $counts.files = 1
                $stats = Get-JsonValue $json 'stats'
                $counts.passed = [int](Get-JsonValue $stats 'expected')
                $counts.failed = [int](Get-JsonValue $stats 'unexpected')
                $counts.skipped = [int](Get-JsonValue $stats 'skipped')
                $counts.flaky = [int](Get-JsonValue $stats 'flaky')
                $counts.errors = @(Get-JsonValue $json 'errors').Where({ $null -ne $_ }).Count
                # A pass is a test expected to pass that did; test.fail() makes a failing test "expected", which is no evidence.
                # Passed and skipped tests per spec file (relative to the config root) and per spec and project.
                $stack = New-Object System.Collections.Stack
                foreach ($suite in @(Get-JsonValue $json 'suites')) { if ($suite) { $stack.Push(@($suite, (Get-JsonValue $suite 'file'))) } }
                while ($stack.Count -ne 0) {
                    $item = $stack.Pop()
                    $suite = $item[0]; $file = $item[1]
                    foreach ($child in @(Get-JsonValue $suite 'suites')) { if ($child) { $stack.Push(@($child, $file)) } }
                    foreach ($spec in @(Get-JsonValue $suite 'specs')) {
                        if (-not $spec) { continue }
                        $name = "$file".Replace('\', '/')
                        if (-not $counts.specs.Contains($name)) { $counts.specs[$name] = 0; $counts.projects[$name] = [ordered]@{} }
                        foreach ($test in @(Get-JsonValue $spec 'tests')) {
                            if (-not $test) { continue }
                            $status = Get-JsonValue $test 'status'
                            $expected = Get-JsonValue $test 'expectedStatus'
                            # A configuration without named projects reports an empty name, which is no JSON property name.
                            $project = "$(Get-JsonValue $test 'projectName')"
                            if ($project -eq '') { $project = '(default)' }
                            if (-not $counts.projects[$name].Contains($project)) { $counts.projects[$name][$project] = [ordered]@{ passed = 0; skipped = 0 } }
                            if ($expected -ne 'passed' -and $expected -ne 'skipped') { $counts.expectedFailures++; if ($status -eq 'expected') { $counts.passed-- } }
                            elseif ($status -eq 'expected' -and $expected -eq 'passed') { $counts.specs[$name]++; $counts.projects[$name][$project].passed++ }
                            elseif ($status -eq 'skipped') { $counts.projects[$name][$project].skipped++ }
                        }
                    }
                }
            }
        }
        'fixtures' {
            if (Test-Path -LiteralPath $Path -PathType Leaf) {
                $json = Read-Json $Path
                $counts.files = 1
                $counts.passed = [int](Get-JsonValue $json 'passed')
                $counts.failed = [int](Get-JsonValue $json 'failed')
            }
        }
        default { throw "Unknown test result kind '$Kind'." }
    }
    $counts
}

$script:CountHint = 'update the count in tools/Release/VerificationGate.psm1 in the change that adds or removes tests'

# A test stage is evidence only when results exist, something passed, and nothing failed, flaked or was skipped.
# Expected (a run), Modules (trx per test assembly) and Counts (per spec, or per spec and project) are exact
# numbers of passing tests: a missing test fails the stage, and so does a new one until its count is updated.
# A project of a per-project count may skip a test (a browser that cannot start), which the stage check judges.
function Test-TestCounts($Counts, [hashtable]$Definition) {
    $failures = New-Object System.Collections.Generic.List[string]
    $where = $Counts.path
    if ($Counts.files -eq 0) { $failures.Add("No test results at $where."); return , $failures.ToArray() }
    if ($Definition.ContainsKey('ExpectedFiles') -and $Counts.files -ne $Definition.ExpectedFiles) { $failures.Add("Expected $($Definition.ExpectedFiles) result files at $where, found $($Counts.files).") }
    if ($Counts.failed -gt 0) { $failures.Add("$($Counts.failed) test(s) failed ($where).") }
    if ($Counts.flaky -gt 0) { $failures.Add("$($Counts.flaky) test(s) were flaky ($where); a retry is not evidence.") }
    if ($Counts.expectedFailures -gt 0) { $failures.Add("$($Counts.expectedFailures) test(s) are expected to fail ($where); a test marked test.fail() is not evidence.") }
    if ($Counts.errors -gt 0) { $failures.Add("The test run reported $($Counts.errors) error(s) outside tests ($where).") }
    if ($Counts.passed -eq 0) { $failures.Add("No test passed ($where).") }
    if ($Counts.skipped -gt 0 -and -not ($Definition.ContainsKey('AllowSkipped') -and $Definition.AllowSkipped)) { $failures.Add("$($Counts.skipped) test(s) were skipped ($where).") }
    if ($Definition.ContainsKey('Expected') -and $Counts.passed -ne $Definition.Expected) {
        $failures.Add("$($Counts.passed) test(s) passed, expected $($Definition.Expected) ($where); $script:CountHint.")
    }
    if ($Definition.ContainsKey('Modules')) {
        foreach ($module in $Definition.Modules.Keys) {
            $passed = if ($Counts.modules.Contains($module)) { $Counts.modules[$module] } else { 0 }
            if ($passed -ne $Definition.Modules[$module]) { $failures.Add("Test assembly $module has $passed passing test(s), expected $($Definition.Modules[$module]) ($where); $script:CountHint.") }
        }
        foreach ($module in $Counts.modules.Keys) { if (-not $Definition.Modules.ContainsKey($module)) { $failures.Add("Result file of $module has no expected count ($where).") } }
    }
    if ($Definition.ContainsKey('Specs')) {
        $expected = if ($Definition.ContainsKey('Counts')) { $Definition.Counts } else { @{} }
        foreach ($spec in @($Definition.Specs)) {
            $passed = if ($Counts.specs.Contains($spec)) { $Counts.specs[$spec] } else { 0 }
            $count = if ($expected.ContainsKey($spec)) { $expected[$spec] } else { $null }
            if ($count -is [System.Collections.IDictionary]) {
                $projects = if ($Counts.projects.Contains($spec)) { $Counts.projects[$spec] } else { @{} }
                foreach ($project in $count.Keys) {
                    # A project missing from the run (a browser that is not installed) is judged by the stage check.
                    if (-not $projects.Contains($project)) { continue }
                    $ran = $projects[$project]
                    if ($ran.passed + $ran.skipped -ne $count[$project]) { $failures.Add("Spec $spec has $($ran.passed) passing and $($ran.skipped) skipped test(s) in $project, expected $($count[$project]) ($where); $script:CountHint.") }
                }
            }
            elseif ($passed -eq 0) { $failures.Add("Spec $spec has no passing test ($where).") }
            elseif ($null -ne $count -and $passed -ne $count) { $failures.Add("Spec $spec has $passed passing test(s), expected $count ($where); $script:CountHint.") }
        }
        foreach ($spec in $Counts.specs.Keys) { if (@($Definition.Specs) -notcontains $spec) { $failures.Add("Spec $spec ran in a stage it is not assigned to ($where).") } }
    }
    , $failures.ToArray()
}

<#
Runs one gate stage and returns its record. A definition has:
  Id, Title                 stage id and description
  FilePath, ArgumentList    native command (optional); WorkingDirectory, Environment
  DependsOn                 stage ids that must have passed; otherwise the stage is NOT_RUN
  Artifacts                 paths or wildcards under -OutputPath that the stage must leave
  Tests                     @(@{ Kind; Path; ExpectedFiles; AllowSkipped; Specs }), Path under -OutputPath
  Check                     scriptblock: param($record) -> @{ failures; blockers; notes; details }
Every artifact, including the stage log, is recorded with its SHA-256 and the verified source tree.
#>
function Invoke-GateStage {
    param(
        [Parameter(Mandatory)][hashtable]$Definition,
        [Parameter(Mandatory)][string]$OutputPath,
        [Parameter(Mandatory)][string]$SourceTree,
        [hashtable]$Completed = @{}
    )
    $id = $Definition.Id
    $failures = New-Object System.Collections.Generic.List[string]
    $blockers = New-Object System.Collections.Generic.List[string]
    $notes = New-Object System.Collections.Generic.List[string]
    $record = [ordered]@{ id = $id; title = $Definition.Title; status = 'NOT_RUN'; exitCode = $null; seconds = 0; command = $null; log = $null
        tests = @(); artifacts = @(); failures = @(); blockers = @(); notes = @(); details = [ordered]@{} }
    $dependencies = @(if ($Definition.ContainsKey('DependsOn')) { $Definition.DependsOn })
    $missing = @($dependencies | Where-Object { -not $Completed.ContainsKey($_) -or $Completed[$_] -ne 'PASS' })
    if ($missing.Count -ne 0) {
        $record.failures = @("Not run: $(@($missing | ForEach-Object { "$_ is $(if ($Completed.ContainsKey($_)) { $Completed[$_] } else { 'missing' })" }) -join ', ').")
        return $record
    }

    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        if ($Definition.ContainsKey('FilePath')) {
            $arguments = @(if ($Definition.ContainsKey('ArgumentList')) { $Definition.ArgumentList })
            $environment = if ($Definition.ContainsKey('Environment')) { $Definition.Environment } else { @{} }
            $directory = if ($Definition.ContainsKey('WorkingDirectory')) { $Definition.WorkingDirectory } else { (Get-Location).Path }
            $record.command = (@($Definition.FilePath) + $arguments) -join ' '
            $record.log = "logs/$id.log"
            $code = Invoke-LoggedProcess -FilePath $Definition.FilePath -ArgumentList $arguments -LogPath (Join-Path $OutputPath $record.log) `
                -Environment $environment -WorkingDirectory $directory
            $record.exitCode = $code
            if ($code -ne 0) { $failures.Add("Exit code $code.") }
        }
        foreach ($test in @(if ($Definition.ContainsKey('Tests')) { $Definition.Tests })) {
            $counts = Read-TestCounts -Kind $test.Kind -Path (Join-Path $OutputPath $test.Path) -DisplayPath $test.Path
            $record.tests += , $counts
            foreach ($failure in (Test-TestCounts $counts $test)) { $failures.Add($failure) }
        }
        if ($Definition.ContainsKey('Check')) {
            # Stray output of a check would turn its result into an array and lose the failures.
            $results = @(& $Definition.Check $record)
            if ($results.Count -ne 1 -or $results[0] -isnot [System.Collections.IDictionary]) {
                $failures.Add("The stage check must return exactly one dictionary; it returned $($results.Count) object(s): $(@($results | ForEach-Object { if ($null -eq $_) { 'null' } else { $_.GetType().Name } }) -join ', ').")
            }
            else {
                $result = $results[0]
                foreach ($failure in @(Get-JsonValue $result 'failures')) { if ($failure) { $failures.Add($failure) } }
                foreach ($blocker in @(Get-JsonValue $result 'blockers')) { if ($blocker) { $blockers.Add($blocker) } }
                foreach ($note in @(Get-JsonValue $result 'notes')) { if ($note) { $notes.Add($note) } }
                $details = Get-JsonValue $result 'details'
                if ($null -ne $details) { $record.details = $details }
            }
        }
    }
    catch { $failures.Add("Stage error: $($_.Exception.Message)") }
    $watch.Stop()
    $record.seconds = [math]::Round($watch.Elapsed.TotalSeconds, 1)

    $patterns = @(if ($Definition.ContainsKey('Artifacts')) { $Definition.Artifacts }) + @(if ($record.log) { $record.log })
    $recorded = @{}
    foreach ($pattern in $patterns) {
        # Only the file name of a pattern may hold * or ?, and a last directory ** matches any depth below the one before it;
        # every other directory, including the output path, is literal.
        $full = Join-Path $OutputPath $pattern
        $leaf = [System.IO.Path]::GetFileName($full)
        $directory = [System.IO.Path]::GetDirectoryName($full)
        $recurse = [System.IO.Path]::GetFileName($directory) -eq '**'
        if ($recurse) { $directory = [System.IO.Path]::GetDirectoryName($directory) }
        $found = @(if ($leaf -match '[*?]') { Get-ChildItem -LiteralPath $directory -File -Filter $leaf -Recurse:$recurse -ErrorAction SilentlyContinue }
            elseif (Test-Path -LiteralPath $full -PathType Leaf) { Get-Item -LiteralPath $full })
        if ($found.Count -eq 0) { $failures.Add("Missing artifact $pattern."); continue }
        foreach ($file in $found) {
            if ($recorded.ContainsKey($file.FullName)) { continue }
            $recorded[$file.FullName] = $true
            $record.artifacts += , [ordered]@{ path = ConvertTo-RelativePath $file.FullName $OutputPath; bytes = $file.Length
                sha256 = Get-FileSha256 $file.FullName; sourceTree = $SourceTree }
        }
    }
    $record.failures = $failures.ToArray()
    $record.blockers = $blockers.ToArray()
    $record.notes = $notes.ToArray()
    $record.status = if ($failures.Count -ne 0) { 'FAIL' } elseif ($blockers.Count -ne 0) { 'BLOCKED' } else { 'PASS' }
    $record
}

# Any FAIL fails; a required browser that is BLOCKED or NOT_VERIFIED blocks.
function Test-BrowserMatrix([Parameter(Mandatory)][string]$Path, [string[]]$Required = $script:RequiredBrowsers) {
    $failures = New-Object System.Collections.Generic.List[string]
    $blockers = New-Object System.Collections.Generic.List[string]
    $browsers = [ordered]@{}
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { $failures.Add("The browser matrix report $Path is missing.") }
    else {
        foreach ($browser in @(Get-JsonValue (Read-Json $Path) 'browsers')) {
            if (-not $browser) { continue }
            $id = Get-JsonValue $browser 'id'
            $status = Get-JsonValue $browser 'status'
            $reason = Get-JsonValue $browser 'reason'
            $browsers[$id] = [ordered]@{ status = $status; version = (Get-JsonValue $browser 'version'); reason = $reason }
            if ($status -eq 'FAIL') {
                $failed = @()
                $scenarios = Get-JsonValue $browser 'scenarios'
                if ($scenarios) { $failed = @($scenarios.PSObject.Properties | Where-Object { (Get-JsonValue $_.Value 'status') -eq 'FAIL' } | ForEach-Object { $_.Name }) }
                $failures.Add("$id FAIL in the browser matrix: $($failed -join ', ').")
            }
            elseif (@('PASS', 'BLOCKED', 'NOT_VERIFIED') -notcontains $status) { $failures.Add("$id has an unknown matrix status '$status'.") }
            elseif ($status -ne 'PASS' -and $Required -contains $id) {
                $hint = if ("$reason" -match 'spawn UNKNOWN') { ' Windows could not start the browser; Playwright browsers under a virtualized %LOCALAPPDATA% (a terminal of a packaged desktop app) fail side-by-side activation. Set PLAYWRIGHT_BROWSERS_PATH to a folder outside %LOCALAPPDATA% for the install and the gate; see docs/compatibility/hosting.md#browser-matrix.' } else { '' }
                $blockers.Add("$id is $status in the browser matrix: $reason$hint")
            }
        }
        foreach ($id in $Required) { if (-not $browsers.Contains($id)) { $failures.Add("Required browser $id is not in the browser matrix report.") } }
    }
    [ordered]@{ failures = $failures.ToArray(); blockers = $blockers.ToArray(); browsers = $browsers }
}

# Rows "| R<n> | requirement | evidence | `stage-id`, ... |" of docs/compatibility/release-checklist.md.
function Read-ReleaseChecklist([Parameter(Mandatory)][string]$Path) {
    $requirements = New-Object System.Collections.Generic.List[object]
    foreach ($line in (Get-Content -LiteralPath $Path -Encoding UTF8)) {
        if ($line -notmatch '^\|\s*(R\d+)\s*\|') { continue }
        $cells = @($line.Trim().Trim('|').Split('|') | ForEach-Object { $_.Trim() })
        $stages = @([regex]::Matches($cells[$cells.Count - 1], '`([a-z0-9-]+)`') | ForEach-Object { $_.Groups[1].Value })
        $requirements.Add([ordered]@{ id = $Matches[1]; title = $cells[1]; stages = $stages })
    }
    , $requirements.ToArray()
}

function Test-ReleaseChecklist([object[]]$Requirements = @(), [Parameter(Mandatory)][string[]]$StageIds) {
    $failures = New-Object System.Collections.Generic.List[string]
    $byId = @{}
    foreach ($requirement in $Requirements) {
        $id = Get-JsonValue $requirement 'id'
        if ($byId.ContainsKey($id)) { $failures.Add("$id is listed twice in the release checklist."); continue }
        $byId[$id] = $requirement
        $stages = @(Get-JsonValue $requirement 'stages')
        if ($id -eq 'R12') { if ($stages.Count -ne 0) { $failures.Add('R12 is verified by the release export, not by gate stages.') }; continue }
        if ($script:GatedRequirements -notcontains $id) { $failures.Add("$id is not a release requirement."); continue }
        if ($stages.Count -eq 0) { $failures.Add("$id names no gate stage.") }
        foreach ($stage in $stages) { if ($StageIds -notcontains $stage) { $failures.Add("$id names the unknown gate stage '$stage'.") } }
    }
    foreach ($id in @($script:GatedRequirements + 'R12')) { if (-not $byId.ContainsKey($id)) { $failures.Add("The release checklist has no row for $id.") } }
    , $failures.ToArray()
}

# The worst status of the stages a requirement names; R12 is outside the gate.
function Get-RequirementStatus([object[]]$Requirements, [object[]]$Stages) {
    $rank = @{ PASS = 0; BLOCKED = 1; FAIL = 2; NOT_RUN = 2 }
    $statuses = @{}
    foreach ($stage in $Stages) { $statuses[(Get-JsonValue $stage 'id')] = Get-JsonValue $stage 'status' }
    , @(foreach ($requirement in $Requirements) {
        $stages = @(Get-JsonValue $requirement 'stages')
        $status = if ($stages.Count -eq 0) { 'NOT_GATED' } else {
            $worst = 'PASS'
            foreach ($stage in $stages) {
                $value = if ($statuses.ContainsKey($stage)) { $statuses[$stage] } else { 'FAIL' }
                if (-not $rank.ContainsKey($value)) { $value = 'FAIL' }
                if ($rank[$value] -gt $rank[$worst]) { $worst = $(if ($value -eq 'NOT_RUN') { 'FAIL' } else { $value }) }
            }
            $worst
        }
        [ordered]@{ id = (Get-JsonValue $requirement 'id'); title = (Get-JsonValue $requirement 'title'); stages = $stages; status = $status }
    })
}

function Get-BrowserSpecFiles([Parameter(Mandatory)][string]$SourceRoot) {
    $root = Join-Path $SourceRoot 'tests/browser'
    , @(Get-ChildItem -LiteralPath $root -Recurse -File -Filter *.spec.ts | Where-Object { $_.FullName -notmatch '\\node_modules\\' } |
        ForEach-Object { ConvertTo-RelativePath $_.FullName $root } | Sort-Object)
}

function Test-BrowserSpecAssignment([string[]]$SpecFiles, [Parameter(Mandatory)][System.Collections.IDictionary]$Assignments, [hashtable]$Counts = $script:BrowserSpecCounts) {
    $failures = New-Object System.Collections.Generic.List[string]
    $owner = @{}
    foreach ($stage in $Assignments.Keys) {
        foreach ($spec in @($Assignments[$stage])) {
            if ($owner.ContainsKey($spec)) { $failures.Add("Spec $spec is assigned to both $($owner[$spec]) and $stage.") }
            else { $owner[$spec] = $stage }
            if ($SpecFiles -notcontains $spec) { $failures.Add("Stage $stage names the missing spec $spec.") }
            $count = if ($Counts.ContainsKey($spec)) { $Counts[$spec] } else { 0 }
            $values = @(if ($count -is [System.Collections.IDictionary]) { $count.Values } else { $count })
            if ($values.Count -eq 0 -or @($values | Where-Object { $_ -lt 1 }).Count -ne 0) { $failures.Add("Spec $spec has no expected number of passing tests.") }
        }
    }
    foreach ($spec in $Counts.Keys) { if (-not $owner.ContainsKey($spec)) { $failures.Add("A count is set for $spec, which no stage runs.") } }
    foreach ($spec in $SpecFiles) {
        if (-not $owner.ContainsKey($spec) -and $script:UngatedBrowserSpecs -notcontains $spec) { $failures.Add("Spec $spec is not assigned to a gate stage.") }
    }
    , $failures.ToArray()
}

# Every Playwright configuration of the gate fails a run with a committed test.only.
$script:PlaywrightConfigs = @('tests/browser/playwright.config.ts', 'tests/PackageConsumer/playwright.config.ts', 'tests/PackageConsumer/aot.playwright.config.ts')
function Test-ForbidOnly([Parameter(Mandatory)][string]$SourceRoot, [string[]]$Configs = @()) {
    $failures = New-Object System.Collections.Generic.List[string]
    if ($Configs.Count -eq 0) { $Configs = @($script:PlaywrightConfigs | ForEach-Object { Join-Path $SourceRoot $_ }) }
    foreach ($config in $Configs) {
        if (-not (Test-Path -LiteralPath $config -PathType Leaf)) { $failures.Add("The Playwright configuration $config is missing."); continue }
        if ((Get-Content -LiteralPath $config -Raw -Encoding UTF8) -notmatch '(?m)^\s*forbidOnly:\s*true\s*,') { $failures.Add("$config does not set forbidOnly: true.") }
    }
    , $failures.ToArray()
}

# Playwright test.fail() and Vitest it.fails/test.fails turn a failing test into a reported pass.
function Test-ForbidExpectedFailures([Parameter(Mandatory)][string]$SourceRoot, [string[]]$Files = @()) {
    $failures = New-Object System.Collections.Generic.List[string]
    if ($Files.Count -eq 0) {
        $Files = @((Invoke-GitCommand $SourceRoot @('ls-files', '-z', '--', 'tests', 'tools')) -join "`n" -split "`0" |
            Where-Object { $_ -match '\.(ts|mts|js|mjs|cjs)$' -and $_ -notmatch '(^|/)wwwroot/' } | ForEach-Object { Join-Path $SourceRoot $_ })
    }
    foreach ($file in $Files) {
        $name = if ($file.StartsWith($SourceRoot, [System.StringComparison]::OrdinalIgnoreCase)) { ConvertTo-RelativePath $file $SourceRoot } else { $file }
        $lines = @(Get-Content -LiteralPath $file -Encoding UTF8)
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match '\b(?:test|it)(?:\.[A-Za-z]+)*\.fails?\s*[(.]') { $failures.Add("${name}:$($i + 1) marks a test as expected to fail; fix or remove the test instead.") }
        }
    }
    , $failures.ToArray()
}

# Workflow text without comments; a comment ends at a # after whitespace, and the workflows quote no #.
function Get-WorkflowCode([string]$Text) { ($Text -split '\r?\n' | ForEach-Object { $_ -replace '(^|\s)#.*$', '' }) -join "`n" }

# Rules for every workflow of the repository: pinned actions, no stored checkout credentials, no run with the
# repository's rights on fork code, no always(), no expression in a run script, locked restores and the one
# pinned Node.js version.
function Test-WorkflowSafety([Parameter(Mandatory)][string]$Text) {
    $failures = New-Object System.Collections.Generic.List[string]
    $code = Get-WorkflowCode $Text
    $checkouts = [regex]::Matches($text, 'uses:\s*actions/checkout@').Count
    $kept = [regex]::Matches($text, 'persist-credentials:\s*false').Count
    if ($checkouts -eq 0 -or $kept -ne $checkouts) { $failures.Add("Every checkout must set persist-credentials: false ($kept of $checkouts).") }
    # Triggers that run with the base repository's rights on code from a fork, in any form of on: (block,
    # list, flow or scalar); the names mean nothing else in a workflow.
    foreach ($trigger in @([regex]::Matches($code, '\b(pull_request_target|workflow_run)\b') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)) {
        $failures.Add("The workflow is triggered by $trigger, which runs fork code with the repository's rights.")
    }
    # A tag can be moved to other code; only a full commit SHA pins an action. A workflow of this repository is pinned by the commit itself.
    foreach ($action in @([regex]::Matches($text, '(?m)^\s*(?:-\s+)?uses:\s*([^\s#]+)') | ForEach-Object { $_.Groups[1].Value })) {
        if ($action -notmatch '^[\w.-]+/[\w./-]+@[0-9a-f]{40}$' -and $action -notmatch '^\./\.github/workflows/[\w.-]+\.ya?ml$') { $failures.Add("Action $action is not pinned to a full commit SHA.") }
    }
    if ($text -match '(?m)^\s*(?:-\s+)?if:.*\balways\(\)') { $failures.Add('The workflow uses always(), which also runs on cancellation; use !cancelled().') }
    # Node.js comes from the one pinned version in .node-version, not from a second literal.
    $setups = [regex]::Matches($code, 'uses:\s*actions/setup-node@').Count
    $pinned = [regex]::Matches($code, '(?m)^\s+node-version-file:\s*\.node-version\s*$').Count
    if ($code -match '(?m)^\s+node-version:' -or $pinned -ne $setups) { $failures.Add("Every setup-node must read node-version-file: .node-version ($pinned of $setups).") }
    # A restore of the workflow uses the lock files, as the gate does.
    foreach ($command in @([regex]::Matches($code, '\bdotnet\s+(?:build|restore|publish|pack|test)\b[^\r\n]*') | ForEach-Object { $_.Value.Trim() })) {
        if ($command -notmatch '--no-restore\b|--locked-mode\b|-p:RestoreLockedMode=true\b') { $failures.Add("'$command' restores without the lock files; add -p:RestoreLockedMode=true.") }
    }
    # An expression in a run script is shell injection for event data and inputs; pass every value through env instead.
    $lines = $text -split '\r?\n'
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -notmatch '^(\s*(?:-\s+)?)run:\s*(.*)$') { continue }
        # The script ends at the next line indented at most to the run key itself, such as env: of the same step.
        $indent = $Matches[1].Length
        $body = New-Object System.Collections.Generic.List[string]
        $body.Add($Matches[2])
        while ($i + 1 -lt $lines.Count -and ($lines[$i + 1].Trim() -eq '' -or ($lines[$i + 1] -match '^(\s*)' -and $Matches[1].Length -gt $indent))) { $i++; $body.Add($lines[$i]) }
        if (($body -join "`n") -match '\$\{\{([^}]*)\}\}') { $failures.Add("A run script expands `${{$($Matches[1])}}; pass event data and other values through env instead.") }
    }
    , $failures.ToArray()
}

# The jobs of a workflow by name, each with the text of its block.
function Get-WorkflowJobs([string]$Code) {
    $jobs = [ordered]@{}
    $name = $null
    $inJobs = $false
    foreach ($line in ($Code -split '\r?\n')) {
        if ($line -match '^jobs:\s*$') { $inJobs = $true; continue }
        if (-not $inJobs) { continue }
        if ($line -match '^\S') { break }
        if ($line -match '^  ([A-Za-z0-9_-]+):\s*$') { $name = $Matches[1]; $jobs[$name] = ''; continue }
        if ($name) { $jobs[$name] += "$line`n" }
    }
    $jobs
}

# The release workflow publishes only what the gate verified: the reusable verify.yml packs, a protected publish
# job confirms the gate report and the package hashes and is the only job that may request an OIDC token.
function Test-ReleaseWorkflow([Parameter(Mandatory)][string]$Path) {
    $failures = New-Object System.Collections.Generic.List[string]
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { $failures.Add("$Path is missing."); return , $failures.ToArray() }
    $text = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    foreach ($failure in (Test-WorkflowSafety $text)) { $failures.Add($failure) }
    $code = Get-WorkflowCode $text
    if ($code -notmatch '(?m)^  push:\s*\n    tags:') { $failures.Add('The release workflow must run on pushed tags.') }
    if ($code -match '(?m)^\s+(pull_request|branches):') { $failures.Add("The release workflow runs for $($Matches[1] -replace 'branches', 'pushed branches'); only tags and manual runs release.") }
    if ($code -notmatch '(?m)^permissions:\s*\n\s+contents:\s*read\s*$') { $failures.Add('The workflow must set top-level permissions to contents: read.') }
    if ($code -match "(?m)^\s*permissions:\s*['`"]?write-all\b") { $failures.Add('The release workflow requests write-all.') }
    foreach ($match in [regex]::Matches($code, "(?m)^\s*(?:-\s+)?([a-z-]+):\s*['`"]?write['`"]?\s*$|\{[^}]*\b([a-z-]+):\s*['`"]?write\b")) {
        $permission = if ($match.Groups[1].Success) { $match.Groups[1].Value } else { $match.Groups[2].Value }
        if ($permission -ne 'id-token') { $failures.Add("The release workflow requests $permission`: write.") }
    }
    if ($code -match '(?i)\bsecrets\.|github\.token|GITHUB_TOKEN') { $failures.Add('The release workflow uses a stored secret or token; Trusted Publishing needs none.') }
    if ($code -match '(?i)\bgit\s+push\b|\bnpm\s+publish\b|\bgh\s+release\b|\bdotnet\s+pack\b') { $failures.Add('The release workflow packs, pushes to git or publishes elsewhere; only verify.yml packs.') }

    $jobs = Get-WorkflowJobs $code
    $publishers = @($jobs.Keys | Where-Object { $jobs[$_] -match 'NuGet/login@' })
    $tokens = @($jobs.Keys | Where-Object { $jobs[$_] -match 'id-token:\s*write' })
    if ($code -match '(?m)^permissions:[ \t]*\n([ \t]+.*\n)*?[ \t]+id-token:') { $failures.Add('id-token is requested for the whole workflow; only the publish job may request it.') }
    if ($publishers.Count -ne 1) { $failures.Add("Exactly one job must log in to nuget.org, found $($publishers.Count).") }
    foreach ($job in $tokens) { if ($publishers -notcontains $job) { $failures.Add("Job $job requests id-token: write but does not publish.") } }
    $gates = @($jobs.Keys | Where-Object { $jobs[$_] -match '(?m)^    uses:\s*\./\.github/workflows/verify\.yml\s*$' -and $jobs[$_] -match '(?m)^      version:\s*\S' })
    if ($gates.Count -ne 1) { $failures.Add('One job must run the release gate of ./.github/workflows/verify.yml with the version.') }
    foreach ($job in @($jobs.Keys | Where-Object { $jobs[$_] -match '\bnuget\s+push\b' -and $publishers -notcontains $_ })) { $failures.Add("Job $job pushes packages without the publish job's checks.") }
    if ($publishers.Count -eq 1) {
        $publish = $jobs[$publishers[0]]
        if ($tokens -notcontains $publishers[0]) { $failures.Add('The publish job does not request id-token: write for Trusted Publishing.') }
        if ($publish -notmatch '(?m)^    environment:\s*\S') { $failures.Add('The publish job must run in a protected environment.') }
        if ($gates.Count -eq 1 -and $publish -notmatch "(?m)^    needs:.*\b$([regex]::Escape($gates[0]))\b") { $failures.Add("The publish job must need the gate job $($gates[0]).") }
        if ($publish -notmatch '(?m)^\s+name:\s*verification\s*$') { $failures.Add('The publish job must download the verification artifact of the gate.') }
        $confirm = $publish.IndexOf('tools/Release/confirm-release.ps1')
        $login = $publish.IndexOf('NuGet/login@')
        $push = [regex]::Match($publish, '\bdotnet\s+nuget\s+push\b[^\n]*')
        if ($confirm -lt 0 -or $confirm -gt $login) { $failures.Add('The publish job must run tools/Release/confirm-release.ps1 before the login.') }
        if (-not $push.Success -or $push.Index -lt $login) { $failures.Add('The publish job must push with dotnet nuget push after the login.') }
        elseif ($push.Value -notmatch '--skip-duplicate' -or $push.Value -notmatch '--source https://api\.nuget\.org/v3/index\.json' -or $push.Value -notmatch '--api-key \$env:NUGET_API_KEY') {
            $failures.Add('dotnet nuget push must use --api-key $env:NUGET_API_KEY, --source https://api.nuget.org/v3/index.json and --skip-duplicate.')
        }
        if ($publish -notmatch '(?m)^\s+NUGET_API_KEY:\s*\$\{\{\s*steps\.login\.outputs\.NUGET_API_KEY\s*\}\}\s*$') { $failures.Add('The API key must come from the login step.') }
    }
    , $failures.ToArray()
}

# Lock files pin content hashes. Once a workload is installed, the SDK adds its library-packs folder as a restore source,
# and its copies differ from the packages on nuget.org: a lock file written on such a machine fails elsewhere with NU1403.
function Test-RestoreSources([Parameter(Mandatory)][string]$PropsPath) {
    $failures = New-Object System.Collections.Generic.List[string]
    [xml]$props = Get-Content -LiteralPath $PropsPath -Raw
    $values = @($props.SelectNodes("//*[local-name()='DisableImplicitLibraryPacksFolder']") | ForEach-Object { $_.InnerText.Trim() })
    if ($values -notcontains 'true') {
        $failures.Add("$PropsPath must set DisableImplicitLibraryPacksFolder to true, so that every machine restores the locked packages from nuget.org.")
    }
    , $failures.ToArray()
}

# The demo site workflow builds with read permissions only. One deploy job in the github-pages environment, which
# runs no repository code, may write to Pages and request the OIDC token; only tags and manual runs deploy.
function Test-PagesWorkflow([Parameter(Mandatory)][string]$Path) {
    $failures = New-Object System.Collections.Generic.List[string]
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { $failures.Add("$Path is missing."); return , $failures.ToArray() }
    $text = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    foreach ($failure in (Test-WorkflowSafety $text)) { $failures.Add($failure) }
    $code = Get-WorkflowCode $text
    if ($code -notmatch 'tools/Release/publish-demo\.ps1') { $failures.Add('The workflow does not build the site with tools/Release/publish-demo.ps1.') }
    if ($code -notmatch '(?m)^  push:\s*\n    tags:') { $failures.Add('The demo site must deploy on pushed tags.') }
    if ($code -match '(?m)^\s+(pull_request|branches):') { $failures.Add("The demo site deploys for $($Matches[1] -replace 'branches', 'pushed branches'); only tags and manual runs deploy.") }
    if ($code -notmatch '(?m)^permissions:\s*\n\s+contents:\s*read\s*$') { $failures.Add('The workflow must set top-level permissions to contents: read.') }
    if ($code -match "(?m)^\s*permissions:\s*['`"]?write-all\b") { $failures.Add('The workflow requests write-all.') }
    if ($code -match '(?i)\bsecrets\.|github\.token|GITHUB_TOKEN') { $failures.Add('The workflow uses a stored secret or token; the deployment needs none.') }
    if ($code -match '(?i)\bgit\s+push\b|\bnuget\s+push\b|\bnpm\s+publish\b|\bgh\s+release\b|\bdotnet\s+pack\b') { $failures.Add('The workflow packs, pushes or publishes; it only deploys the demo site.') }
    foreach ($failure in (Test-WorkloadInstalls $code)) { $failures.Add($failure) }

    $writes = "(?m)^\s*(?:-\s+)?([a-z-]+):\s*['`"]?write['`"]?\s*$|\{[^}]*\b([a-z-]+):\s*['`"]?write\b"
    $header = ($code -split '(?m)^jobs:', 2)[0]
    foreach ($match in [regex]::Matches($header, $writes)) { $failures.Add("The workflow requests $(@($match.Groups[1], $match.Groups[2] | Where-Object Success)[0].Value): write for every job; only the deploy job may write.") }
    $jobs = Get-WorkflowJobs $code
    $deployers = @($jobs.Keys | Where-Object { $jobs[$_] -match 'actions/deploy-pages@' })
    if ($deployers.Count -ne 1) { $failures.Add("Exactly one job must deploy with actions/deploy-pages, found $($deployers.Count).") }
    foreach ($job in $jobs.Keys) {
        foreach ($match in [regex]::Matches($jobs[$job], $writes)) {
            $permission = @($match.Groups[1], $match.Groups[2] | Where-Object Success)[0].Value
            if ($deployers -notcontains $job) { $failures.Add("Job $job requests $permission`: write but does not deploy the site.") }
            elseif ($permission -notin 'pages', 'id-token') { $failures.Add("The deploy job requests $permission`: write.") }
        }
    }
    if ($deployers.Count -eq 1) {
        $deploy = $jobs[$deployers[0]]
        if ($deploy -notmatch '(?m)^    environment:\s*\n\s+name:\s*github-pages\s*$') { $failures.Add('The deploy job must run in the github-pages environment.') }
        if ($deploy -match 'actions/checkout@|(?m)^\s*(?:-\s+)?run:') { $failures.Add('The deploy job runs repository code; it may only deploy the uploaded site.') }
    }
    , $failures.ToArray()
}

# The workload manifests decide the version of the implicit WebAssembly pack in the lock files; a workload set pins them.
function Test-WorkloadInstalls([string]$Code) {
    , @(foreach ($command in @([regex]::Matches($Code, '\bdotnet\s+workload\s+install\b[^\r\n]*') | ForEach-Object { $_.Value.Trim() })) {
        if ($command -notmatch '\s--version\s+\d+\.\d+\.\d+(\.\d+)?\b' -or $command -match '--skip-manifest-update') {
            "'$command' must install a pinned workload set (--version), or the WebAssembly pack differs from the lock files."
        }
    })
}

# The CI workflow runs the same tools as a local release and holds no credentials.
function Test-VerifyWorkflow([Parameter(Mandatory)][string]$Path) {
    $failures = New-Object System.Collections.Generic.List[string]
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { $failures.Add("$Path is missing."); return , $failures.ToArray() }
    $text = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if ($text -notmatch 'tools/Release/verify-local\.ps1') { $failures.Add('The workflow does not run tools/Release/verify-local.ps1.') }
    if ($text -notmatch '(?m)^permissions:\s*\r?\n\s+contents:\s*read\s*$') { $failures.Add('The workflow must set top-level permissions to contents: read.') }
    $code = Get-WorkflowCode $text
    # Block, flow and scalar forms: contents: write, { contents: write }, write-all.
    if ($code -match "(?m)^\s*(?:-\s+)?[a-z-]+:\s*['`"]?write['`"]?\s*$" -or $code -match "(?m)^\s*permissions:\s*['`"]?write-all\b" -or
        $code -match "(?m)^\s*permissions:\s*\{[^}]*:\s*['`"]?write\b") { $failures.Add('The workflow requests a write permission.') }
    if ($text -match '(?i)\bsecrets\.|github\.token|GITHUB_TOKEN') { $failures.Add('The workflow uses a secret or token.') }
    if ($text -match '(?i)\bgit\s+push\b|\bnuget\s+push\b|\bnpm\s+publish\b|\bgh\s+release\b') { $failures.Add('The workflow pushes or publishes.') }
    foreach ($failure in (Test-WorkloadInstalls $code)) { $failures.Add($failure) }
    foreach ($failure in (Test-WorkflowSafety $text)) { $failures.Add($failure) }
    # The uploaded verification lets Get-GateVerdict recheck the verdict: reports, test results and packages.
    foreach ($pattern in @('dotnet-test/**/*.trx', 'results.json', 'fixtures.json', '*.nupkg', '*.snupkg')) {
        if ($code -notmatch "(?m)^\s+artifacts/verification/\S*$([regex]::Escape($pattern))\s*$") {
            $failures.Add("The workflow does not upload the $pattern files of artifacts/verification, so Get-GateVerdict cannot recheck the verdict.")
        }
    }
    , $failures.ToArray()
}

<#
The fail-closed verdict over a persisted report. PASS needs every gate stage PASS with recorded artifacts
that still exist unchanged and belong to the verified tree, and a source tree without uncommitted changes
that did not change during the run. FAIL wins over BLOCKED.
#>
function Get-GateVerdict {
    param([Parameter(Mandatory)]$Report, [Parameter(Mandatory)][string]$OutputPath, [Parameter(Mandatory)][string[]]$RequiredStages)
    $failures = New-Object System.Collections.Generic.List[string]
    $blockers = New-Object System.Collections.Generic.List[string]
    $source = Get-JsonValue $Report 'source'
    $after = Get-JsonValue $Report 'sourceAfter'
    $tree = Get-JsonValue $source 'tree'
    if ([string]::IsNullOrEmpty($tree)) { $failures.Add('The report names no source tree.') }
    else {
        $dirty = @(Get-JsonValue $source 'dirty')
        if ($dirty.Count -ne 0) { $failures.Add("The source tree had uncommitted changes: $($dirty -join ', ').") }
        if ($null -eq $after) { $failures.Add('The report has no source identity from the end of the run.') }
        elseif ((Get-JsonValue $after 'tree') -ne $tree -or (Get-JsonValue $after 'commit') -ne (Get-JsonValue $source 'commit') -or
            (@(Get-JsonValue $after 'dirty') -join "`n") -ne ($dirty -join "`n")) {
            $failures.Add("The source tree changed during verification: $tree at the start, $(Get-JsonValue $after 'tree') with changes [$(@(Get-JsonValue $after 'dirty') -join ', ')] at the end.")
        }
        if ($null -ne $after) {
            $inputs = @(Get-BuildInputs $after)
            if ($inputs.Count -ne 0) { $failures.Add("Untracked or ignored files that change the build or the packages exist at the end of the run: $($inputs -join ', ').") }
        }
    }
    $seen = @{}
    foreach ($stage in @(Get-JsonValue $Report 'stages')) {
        if (-not $stage) { continue }
        $id = Get-JsonValue $stage 'id'
        if ($seen.ContainsKey($id)) { $failures.Add("Stage $id is in the report twice.") }
        $seen[$id] = $true
        $status = Get-JsonValue $stage 'status'
        $stageFailures = @(@(Get-JsonValue $stage 'failures') | Where-Object { $_ })
        $stageBlockers = @(@(Get-JsonValue $stage 'blockers') | Where-Object { $_ })
        switch ("$status") {
            'PASS' { }
            'BLOCKED' { if ($stageBlockers.Count -eq 0) { $blockers.Add("${id}: blocked.") } else { foreach ($blocker in $stageBlockers) { $blockers.Add("${id}: $blocker") } } }
            { $_ -in @('FAIL', 'NOT_RUN') } { $failures.Add("${id} is ${status}: $(if ($stageFailures.Count -eq 0) { 'no reason recorded' } else { $stageFailures -join ' ' })") }
            default { $failures.Add("${id} has an unknown status '$status'.") }
        }
        $artifacts = @(@(Get-JsonValue $stage 'artifacts') | Where-Object { $_ })
        if ($artifacts.Count -eq 0) { $failures.Add("${id} recorded no artifact, so nothing proves its result.") }
        foreach ($artifact in $artifacts) {
            $path = "$(Get-JsonValue $artifact 'path')"
            if ([string]::IsNullOrEmpty($path) -or [System.IO.Path]::IsPathRooted($path) -or $path -match '(^|[\\/])\.\.([\\/]|$)') { $failures.Add("${id}: artifact path '$path' is not inside the output."); continue }
            $file = Join-Path $OutputPath $path
            if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { $failures.Add("${id}: artifact $path is missing.") }
            elseif ((Get-FileSha256 $file) -ne (Get-JsonValue $artifact 'sha256')) { $failures.Add("${id}: artifact $path changed after the stage recorded it.") }
            $artifactTree = Get-JsonValue $artifact 'sourceTree'
            if ($artifactTree -ne $tree) { $failures.Add("${id}: artifact $path belongs to another source tree ($artifactTree).") }
        }
    }
    foreach ($id in $RequiredStages) { if (-not $seen.ContainsKey($id)) { $failures.Add("Required stage $id is missing from the report.") } }
    [ordered]@{ status = $(if ($failures.Count -ne 0) { 'FAIL' } elseif ($blockers.Count -ne 0) { 'BLOCKED' } else { 'PASS' })
        failures = $failures.ToArray(); blockers = $blockers.ToArray() }
}

<#
Before a push: the persisted gate report of -Path passed, still passes when Get-GateVerdict rechecks it from the
recorded files, and verified this version, repository and commit; the feed holds exactly the packages and symbol
packages of packages-manifest.json, byte for byte. Pack is not reproducible, so only these files may be published.
#>
function Test-ReleaseVerification {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][string]$RepositoryUrl,
        [Parameter(Mandatory)][string]$RepositoryCommit
    )
    $failures = New-Object System.Collections.Generic.List[string]
    $reportPath = Join-Path $Path 'verification-report.json'
    if (-not (Test-Path -LiteralPath $reportPath -PathType Leaf)) { $failures.Add("$reportPath is missing."); return , $failures.ToArray() }
    $report = Read-Json $reportPath
    $recorded = Get-JsonValue (Get-JsonValue $report 'verdict') 'status'
    if ($recorded -ne 'PASS') { $failures.Add("The gate report has the verdict '$recorded', not PASS.") }
    $verdict = Get-GateVerdict -Report $report -OutputPath $Path -RequiredStages (Get-GateStageIds)
    if ($verdict.status -ne 'PASS') { $failures.Add("Rechecked from the recorded files, the verdict is $($verdict.status): $(@($verdict.failures) + @($verdict.blockers) -join ' ')") }
    $parameters = Get-JsonValue $report 'parameters'
    $expected = [ordered]@{ version = $Version; repositoryUrl = $RepositoryUrl; repositoryCommit = $RepositoryCommit }
    foreach ($name in $expected.Keys) {
        $value = Get-JsonValue $parameters $name
        if ("$value" -cne $expected[$name]) { $failures.Add("The gate verified $name '$value', not '$($expected[$name])'.") }
    }
    $commit = Get-JsonValue (Get-JsonValue $report 'source') 'commit'
    if ($commit -cne $RepositoryCommit) { $failures.Add("The gate verified commit $commit, not $RepositoryCommit.") }

    $manifestPath = Join-Path $Path 'packages/packages-manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { $failures.Add("$manifestPath is missing."); return , $failures.ToArray() }
    $manifest = Read-Json $manifestPath
    if ($manifest.version -cne $Version) { $failures.Add("packages-manifest.json records version $($manifest.version), not $Version.") }
    $recordedFiles = @{}
    foreach ($id in (Get-PackageIds)) {
        $entry = @($manifest.packages | Where-Object { $_.id -ceq $id })
        if ($entry.Count -ne 1) { $failures.Add("packages-manifest.json has no single entry for $id."); continue }
        $symbols = Get-JsonValue $entry[0] 'symbols'
        foreach ($file in @(@{ Path = $entry[0].file; Sha256 = $entry[0].sha256; Expected = "feed/$id.$Version.nupkg" },
            @{ Path = (Get-JsonValue $symbols 'file'); Sha256 = (Get-JsonValue $symbols 'sha256'); Expected = "feed/$id.$Version.snupkg" })) {
            if ($file.Path -cne $file.Expected) { $failures.Add("packages-manifest.json records '$($file.Path)', expected $($file.Expected)."); continue }
            $recordedFiles[$file.Path] = $true
            $full = Join-Path $Path "packages/$($file.Path)"
            if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { $failures.Add("$($file.Path) is missing.") }
            elseif ((Get-FileSha256 $full) -ne $file.Sha256) { $failures.Add("$($file.Path) differs from the SHA-256 that the gate recorded.") }
        }
    }
    foreach ($file in @(Get-ChildItem -LiteralPath (Join-Path $Path 'packages/feed') -File -ErrorAction SilentlyContinue)) {
        if (-not $recordedFiles.ContainsKey("feed/$($file.Name)")) { $failures.Add("The feed holds $($file.Name), which the gate did not record.") }
    }
    , $failures.ToArray()
}

function Format-TestCounts($Tests) {
    @(@($Tests) | Where-Object { $_ } | ForEach-Object {
        $text = "$($_.kind) $($_.passed) passed"
        if ($_.failed) { $text += ", $($_.failed) failed" }
        if ($_.skipped) { $text += ", $($_.skipped) skipped" }
        if ($_.flaky) { $text += ", $($_.flaky) flaky" }
        $text
    }) -join '; '
}

function Format-MarkdownCell([string]$Text) { ($Text -replace '\r?\n', ' ' -replace '\|', '\|').Trim() }

function Write-GateReport([Parameter(Mandatory)]$Report, [Parameter(Mandatory)][string]$OutputPath) {
    $json = Join-Path $OutputPath 'verification-report.json'
    $Report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $json -Encoding UTF8
    $verdict = Get-JsonValue $Report 'verdict'
    $source = Get-JsonValue $Report 'source'
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add('# Local release verification')
    $lines.Add('')
    $lines.Add("Verdict: **$(Get-JsonValue $verdict 'status')**")
    $lines.Add('')
    $lines.Add("Source: commit ``$(Get-JsonValue $source 'commit')``, tree ``$(Get-JsonValue $source 'tree')``. Started $(Get-JsonValue $Report 'startedAt'), finished $(Get-JsonValue $Report 'finishedAt').")
    foreach ($section in @(@('Failures', 'failures'), @('Blockers', 'blockers'))) {
        $items = @(@(Get-JsonValue $verdict $section[1]) | Where-Object { $_ })
        if ($items.Count -eq 0) { continue }
        $lines.Add('')
        $lines.Add("## $($section[0])")
        $lines.Add('')
        foreach ($item in $items) { $lines.Add("- $(Format-MarkdownCell $item)") }
    }
    $lines.Add('')
    $lines.Add('## Stages')
    $lines.Add('')
    $lines.Add('| Stage | Status | Exit | Seconds | Tests | Notes |')
    $lines.Add('|---|---|---|---|---|---|')
    foreach ($stage in @(Get-JsonValue $Report 'stages')) {
        $notes = @(@(Get-JsonValue $stage 'failures') + @(Get-JsonValue $stage 'blockers') + @(Get-JsonValue $stage 'notes') | Where-Object { $_ }) -join ' '
        if ($notes.Length -gt 300) { $notes = $notes.Substring(0, 300) + '...' }
        $lines.Add("| ``$($stage.id)`` | $($stage.status) | $($stage.exitCode) | $($stage.seconds) | $(Format-TestCounts (Get-JsonValue $stage 'tests')) | $(Format-MarkdownCell $notes) |")
    }
    $requirements = @(Get-JsonValue $Report 'requirements')
    if ($requirements.Count -ne 0) {
        $lines.Add('')
        $lines.Add('## Requirements')
        $lines.Add('')
        $lines.Add('| ID | Requirement | Status | Stages |')
        $lines.Add('|---|---|---|---|')
        foreach ($requirement in $requirements) {
            if (-not $requirement) { continue }
            $stages = @($requirement.stages | ForEach-Object { '`' + $_ + '`' }) -join ', '
            $lines.Add("| $($requirement.id) | $(Format-MarkdownCell $requirement.title) | $($requirement.status) | $stages |")
        }
    }
    Set-Content -LiteralPath (Join-Path $OutputPath 'verification-report.md') -Encoding UTF8 -Value $lines.ToArray()
    $json
}

Export-ModuleMember -Function Get-GateStageIds, Get-BrowserStageSpecs, Get-BrowserSpecCounts, Get-StageTestCounts, Get-RequiredBrowsers, Get-DotnetTestStage, Get-JsonValue, Get-SourceIdentity, Test-SourceIdentity, Test-BuildLog,
    Read-TestCounts, Test-TestCounts, Invoke-GateStage, Test-BrowserMatrix, Read-ReleaseChecklist,
    Test-ReleaseChecklist, Get-RequirementStatus, Get-BrowserSpecFiles, Test-BrowserSpecAssignment, Test-ForbidOnly, Test-ForbidExpectedFailures, Test-RestoreSources, Test-WorkflowSafety, Test-VerifyWorkflow, Test-ReleaseWorkflow, Test-PagesWorkflow, Get-GateVerdict, Test-ReleaseVerification, Write-GateReport
