#Requires -Version 5.1
<#
.SYNOPSIS
Publishes the standalone WebAssembly consumer from the local package feed twice, trimmed and AOT,
checks both outputs and their linker warnings, and runs the browser scenario on a static host.

.DESCRIPTION
-PackageDirectory is the output of package.ps1: feed/ with the two packages and packages-manifest.json.
Every package must match its recorded SHA-256. Output layout under -ResultsDirectory:
  trimmed/, aot/           consumer sources (src) and publish output (publish) per variant
  nuget-packages/          private NuGet cache; the library entries are removed before every run
  logs/                    restore, publish and Playwright logs
  fixtures/                release-tool fixtures, including the warning gate
  playwright/              Playwright results
  aot-manifest.json        package hashes, output sizes, warnings and browser results
Needs the wasm-tools workload (it is never installed here), npm dev dependencies (Playwright) and
Google Chrome. Exits with a nonzero code on any failure.
#>
param(
    [Parameter(Mandatory)][string]$SourceRoot,
    [Parameter(Mandatory)][string]$PackageDirectory,
    [Parameter(Mandatory)][string]$ResultsDirectory
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'ReleaseTools.psm1') -Force

function Get-FrameworkFile([string]$Framework, [string]$Name) {
    # Fingerprinted names: <Name>.<hash>.<ext>; compressed copies are skipped.
    $pattern = '^' + [regex]::Escape([System.IO.Path]::GetFileNameWithoutExtension($Name)) + '\.[0-9a-z]+' + [regex]::Escape([System.IO.Path]::GetExtension($Name)) + '$'
    @(Get-ChildItem -LiteralPath $Framework -File | Where-Object { $_.Name -match $pattern })
}

try {
    $SourceRoot = Resolve-FullPath $SourceRoot
    $PackageDirectory = Resolve-FullPath $PackageDirectory
    $ResultsDirectory = Resolve-FullPath $ResultsDirectory
    if (-not (Test-Path -LiteralPath (Join-Path $SourceRoot 'BlazorECharts.slnx'))) { throw "$SourceRoot is not the BlazorECharts source root." }
    if ($ResultsDirectory -eq $SourceRoot -or (Test-PathInside $SourceRoot $ResultsDirectory) -or (Test-PathInside $ResultsDirectory (Join-Path $SourceRoot 'src'))) {
        throw 'ResultsDirectory must not be the source root, one of its parents, or inside src.'
    }
    $feed = Join-Path $PackageDirectory 'feed'
    $packagesManifest = Join-Path $PackageDirectory 'packages-manifest.json'
    if (-not (Test-Path -LiteralPath $packagesManifest)) { throw "$packagesManifest is missing; run package.ps1 first." }

    Reset-OutputEntries -Path $ResultsDirectory -Create @('logs', 'trimmed', 'aot', 'fixtures', 'playwright') | Out-Null
    $logs = Join-Path $ResultsDirectory 'logs'
    $cache = Join-Path $ResultsDirectory 'nuget-packages'

    # The workload set and the WebAssembly packs that build the outputs are part of the evidence.
    $code = Invoke-LoggedProcess -FilePath 'dotnet' -ArgumentList @('workload', 'list') -LogPath (Join-Path $logs 'workload-list.log')
    $workloads = Get-Content -LiteralPath (Join-Path $logs 'workload-list.log') -Raw
    $wasmTools = @($workloads -split '\r?\n' | Where-Object { $_ -match '^\s*wasm-tools\s' })
    if ($code -ne 0 -or $wasmTools.Count -eq 0) { throw "The wasm-tools workload is required for AOT (dotnet workload install wasm-tools). 'dotnet workload list':`n$workloads" }
    $code = Invoke-LoggedProcess -FilePath 'dotnet' -ArgumentList @('workload', '--version') -LogPath (Join-Path $logs 'workload-version.log')
    # The log starts with the command line; the version is its last non-empty line.
    $workloadVersion = @(Get-Content -LiteralPath (Join-Path $logs 'workload-version.log') | Select-Object -Skip 1 | Where-Object { $_.Trim() }) | Select-Object -Last 1
    if ($code -ne 0 -or -not $workloadVersion) { throw "dotnet workload --version reported no workload version (exit code $code)." }
    $workloadVersion = $workloadVersion.Trim()
    $dotnetRoot = Split-Path (Get-Command dotnet).Source
    $packs = @(Get-ChildItem -LiteralPath (Join-Path $dotnetRoot 'packs') -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '(?i)WebAssembly|browser-wasm|MonoAOTCompiler|Emscripten' } | Sort-Object Name | ForEach-Object {
            [ordered]@{ id = $_.Name; versions = @(Get-ChildItem -LiteralPath $_.FullName -Directory | ForEach-Object { $_.Name } | Sort-Object) } })

    # The packages under test are exactly the recorded ones.
    $recorded = Read-Json $packagesManifest
    $version = $recorded.version
    $packages = @()
    $failed = $false
    foreach ($id in @((Get-PackageId Core), (Get-PackageId WordCloud))) {
        $entry = @($recorded.packages | Where-Object { $_.id -eq $id })
        $path = Join-Path $feed "$id.$version.nupkg"
        $checks = @()
        if ($entry.Count -ne 1) { $checks += "packages-manifest.json has no single entry for $id." }
        elseif (-not (Test-Path -LiteralPath $path)) { $checks += "The feed has no $id.$version.nupkg." }
        else {
            $sha256 = Get-FileSha256 $path
            if ($sha256 -ne $entry[0].sha256) { $checks += "$id.$version.nupkg differs from packages-manifest.json ($sha256, recorded $($entry[0].sha256))." }
            $packages += [ordered]@{ id = $id; version = $version; bytes = (Get-Item -LiteralPath $path).Length; sha256 = $sha256 }
        }
        Write-Failures "$id.$version.nupkg matches packages-manifest.json" $checks
        if ($checks.Count -ne 0) { $failed = $true }
    }
    if ($failed) { throw 'The package feed does not match its manifest.' }

    & (Join-Path $PSScriptRoot 'test-release-tools.ps1') -SourceRoot $SourceRoot -FeedPath $feed -Version $version -WorkPath (Join-Path $ResultsDirectory 'fixtures')
    if ($LASTEXITCODE -ne 0) { throw 'Release-tool fixtures failed.' }

    $known = @((Read-Json (Join-Path $PSScriptRoot 'aot-known-warnings.json')).warnings)
    $engine = Get-LockPackage $SourceRoot 'echarts'
    $coreZip = [System.IO.Compression.ZipFile]::OpenRead((Join-Path $feed "$(Get-PackageId Core).$version.nupkg"))
    try { $coreDllBytes = $coreZip.GetEntry("lib/net10.0/$(Get-AssemblyName Core).dll").Length } finally { $coreZip.Dispose() }

    Reset-PackageCache $cache
    $config = Join-Path $ResultsDirectory 'nuget.config'
    Write-ConsumerNuGetConfig -Path $config -FeedPath $feed -CachePath $cache
    $environment = @{ NUGET_PACKAGES = $cache; DOTNET_CLI_TELEMETRY_OPTOUT = '1'; DOTNET_NOLOGO = '1' }
    $template = Join-Path $SourceRoot 'tests/PackageConsumer'
    $variants = @(
        @{ Name = 'trimmed'; Properties = @('-p:PublishTrimmed=true') },
        @{ Name = 'aot'; Properties = @('-p:PublishTrimmed=true', '-p:RunAOTCompilation=true') }
    )
    $results = @()
    foreach ($variant in $variants) {
        $name = $variant.Name
        $sources = Join-Path $ResultsDirectory "$name/src"
        $output = Join-Path $ResultsDirectory "$name/publish"
        Copy-ConsumerTemplate -Template $template -Destination $sources -Include @('Directory.Build.props', 'Directory.Build.targets', 'Directory.Packages.props', 'Standalone')
        $failures = Test-PackageOnlyConsumer -ConsumerRoot $sources
        Write-Failures "$name consumer uses PackageReference only" $failures
        if ($failures.Count -ne 0) { throw 'The consumer references the library sources.' }

        $project = Join-Path $sources 'Standalone/Standalone.csproj'
        $properties = @("-p:BlazorEChartsVersion=$version") + $variant.Properties
        Write-Host "Restoring and publishing the $name consumer"
        Invoke-Logged -FilePath 'dotnet' -LogPath (Join-Path $logs "restore-$name.log") -Environment $environment -WorkingDirectory $sources `
            -ArgumentList (@('restore', $project, '--configfile', $config, '--force') + $properties)
        $watch = [System.Diagnostics.Stopwatch]::StartNew()
        $publishLog = Join-Path $logs "publish-$name.log"
        Invoke-Logged -FilePath 'dotnet' -LogPath $publishLog -Environment $environment -WorkingDirectory $sources `
            -ArgumentList (@('publish', $project, '-c', 'Release', '-o', $output, '--no-restore', '-nologo', '-v', 'n') + $properties)
        $watch.Stop()

        $checks = New-Object System.Collections.Generic.List[string]
        $expected = @((Get-PackageId Core), (Get-PackageId WordCloud))
        foreach ($failure in (Test-ConsumerRestore -AssetsFile (Join-Path $sources 'Standalone/obj/project.assets.json') -Version $version -Packages $expected)) { $checks.Add($failure) }
        foreach ($failure in (Test-CachedPackage -CachePath $cache -FeedPath $feed -Version $version -Packages $expected)) { $checks.Add($failure) }

        $root = Join-Path $output 'wwwroot'
        $framework = Join-Path $root '_framework'
        $runtime = Join-Path $root "_content/BlazorECharts/js/echarts-$($engine.version).js"
        if (-not (Test-Path -LiteralPath $runtime)) { $checks.Add("Published output lacks _content/BlazorECharts/js/echarts-$($engine.version).js.") }
        elseif ((Get-FileSha256 $runtime) -ne $engine.files.'dist/echarts.esm.min.mjs') { $checks.Add('Published ECharts engine differs from sources.lock.json.') }
        if (-not (Test-Path -LiteralPath (Join-Path $root '_content/BlazorECharts.WordCloud/js/wordcloud-extension.js'))) { $checks.Add('Published output lacks the WordCloud assets.') }
        $sizes = [ordered]@{}
        foreach ($file in @('BlazorECharts.wasm', 'BlazorECharts.WordCloud.wasm', 'PackageConsumer.Standalone.wasm', 'dotnet.native.wasm', 'System.Private.CoreLib.wasm')) {
            $found = Get-FrameworkFile $framework $file
            if ($found.Count -ne 1) { $checks.Add("Expected one _framework/$file, found $($found.Count)."); continue }
            $sizes[$file] = $found[0].Length
        }
        $uncompressed = @(Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.Extension -notin @('.br', '.gz') })
        $brotli = @(Get-ChildItem -LiteralPath $framework -File -Filter *.br)
        $log = Get-Content -LiteralPath $publishLog -Raw -Encoding UTF8
        # PublishTrimmed must reach the library: with the default partial mode only IsTrimmable assemblies shrink.
        if ($log -notmatch '(?m)^\s*Optimizing assemblies for size') { $checks.Add('The publish log has no ILLink run.') }
        if ($sizes.Contains('BlazorECharts.wasm') -and $sizes['BlazorECharts.wasm'] -ge 0.9 * $coreDllBytes) {
            $checks.Add("BlazorECharts.wasm is $($sizes['BlazorECharts.wasm']) bytes against $coreDllBytes in the package: the library was not trimmed.")
        }
        $aotCompiled = $log -match '(?m)^\s*AOT''ing \d+ assemblies'
        if ($name -eq 'aot') {
            if (-not $aotCompiled) { $checks.Add('The AOT publish log shows no AOT compilation.') }
            foreach ($assembly in @((Get-AssemblyName Core), (Get-AssemblyName WordCloud))) {
                if ($log -notmatch "(?m)\] $([regex]::Escape($assembly))\.dll -> $([regex]::Escape($assembly))\.dll\.bc") { $checks.Add("$assembly.dll was not AOT compiled.") }
            }
        }
        elseif ($aotCompiled) { $checks.Add('The trimmed publish unexpectedly ran AOT compilation.') }

        $warnings = Get-TrimWarnings $publishLog
        $warningFailures = Test-TrimWarnings -Warnings $warnings -Known $known
        foreach ($failure in $warningFailures) { $checks.Add($failure) }
        Write-Failures "$name output: restore from the local feed, assets, trimming$(if ($name -eq 'aot') { ', AOT' }) and linker warnings" $checks.ToArray()
        if ($checks.Count -ne 0) { $failed = $true }
        $results += [ordered]@{
            name = $name; properties = $variant.Properties; publishSeconds = [math]::Round($watch.Elapsed.TotalSeconds, 1)
            files = $uncompressed.Count; bytes = ($uncompressed | Measure-Object Length -Sum).Sum; frameworkBrotliBytes = ($brotli | Measure-Object Length -Sum).Sum
            packagedCoreDllBytes = $coreDllBytes; sizes = $sizes
            warnings = @($warnings | ForEach-Object { [ordered]@{ code = $_.Code; text = $_.Text; location = $_.Location } })
        }
    }
    if ($failed) { throw 'Published output checks failed.' }
    $nativeTrimmed = $results[0].sizes['dotnet.native.wasm']
    $nativeAot = $results[1].sizes['dotnet.native.wasm']
    if ($nativeAot -lt 2 * $nativeTrimmed) { throw "AOT dotnet.native.wasm ($nativeAot bytes) is not larger than the interpreted one ($nativeTrimmed bytes): no compiled code." }

    $cli = Join-Path $SourceRoot 'node_modules/@playwright/test/cli.js'
    if (-not (Test-Path -LiteralPath $cli)) { throw 'Playwright is not installed; run npm ci in the source root.' }
    Write-Host 'Running the browser scenario on a static host for both outputs'
    $playwright = Join-Path $ResultsDirectory 'playwright'
    $browserFailure = $null
    try {
        Invoke-Logged -FilePath 'node' -LogPath (Join-Path $logs 'playwright.log') -WorkingDirectory $SourceRoot -Environment @{
            BLAZOR_ECHARTS_AOT_RESULTS = $ResultsDirectory; BLAZOR_ECHARTS_AOT_OUTPUT = $playwright } `
            -ArgumentList @($cli, 'test', '--config', (Join-Path $SourceRoot 'tests/PackageConsumer/aot.playwright.config.ts'))
    }
    catch { $browserFailure = $_.Exception.Message }
    Get-Content -LiteralPath (Join-Path $logs 'playwright.log') | Where-Object { $_ -match '^\s+\d+ (passed|failed|skipped|flaky)' } | ForEach-Object { Write-Host $_.Trim() }

    $browser = [ordered]@{ passed = 0; failed = 0; skipped = 0; serialization = [ordered]@{} }
    $report = Join-Path $playwright 'results.json'
    if (Test-Path -LiteralPath $report) {
        $json = Read-Json $report
        $browser.passed = [int]$json.stats.expected; $browser.failed = [int]$json.stats.unexpected; $browser.skipped = [int]$json.stats.skipped
        $stack = New-Object System.Collections.Stack
        foreach ($suite in @($json.suites)) { $stack.Push($suite) }
        while ($stack.Count -ne 0) {
            $suite = $stack.Pop()
            foreach ($child in @($suite.suites | Where-Object { $_ })) { $stack.Push($child) }
            foreach ($spec in @($suite.specs | Where-Object { $_ })) {
                foreach ($test in @($spec.tests)) {
                    foreach ($annotation in @($test.annotations | Where-Object { $_.type -eq 'serialization' })) { $browser.serialization[$test.projectName] = $annotation.description }
                }
            }
        }
    }
    $manifest = [ordered]@{ formatVersion = 1; version = $version; sdk = ((& dotnet --version) | Out-String).Trim()
        workloads = [ordered]@{ version = $workloadVersion; wasmTools = ($wasmTools[0] -replace '\s+', ' ').Trim(); packs = $packs }
        packages = $packages; variants = $results; browser = $browser }
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $ResultsDirectory 'aot-manifest.json') -Encoding UTF8
    Write-Host "Wrote $(Join-Path $ResultsDirectory 'aot-manifest.json')"
    if ($browserFailure) { throw "Browser scenario failed: $browserFailure" }

    Write-Host "PASS trimmed and AOT WebAssembly $version"
    exit 0
}
catch {
    Write-Host "FAIL test-aot: $($_.Exception.Message)"
    exit 1
}
