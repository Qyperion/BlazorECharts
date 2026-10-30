#Requires -Version 5.1
<#
.SYNOPSIS
Builds the package consumers from an isolated local feed and NuGet cache, verifies that both
library packages come from that feed, and runs the offline browser checks.

.DESCRIPTION
The consumers in tests/PackageConsumer are copied without bin/obj to -WorkPath/src. Their
NuGet.Config maps the two library packages to the local feed only. The cache at -WorkPath/nuget-packages is
private to these consumers; their entries are removed before every run. Browser checks need
the repository's npm dev dependencies (Playwright) and an installed Google Chrome; the consumer
applications themselves use no npm. -SdkVersion pins the SDK that restores and publishes the
consumers, for example the oldest installed feature band. Exits with a nonzero code on any failure.
#>
param(
    [Parameter(Mandatory)][string]$SourceRoot,
    [Parameter(Mandatory)][string]$FeedPath,
    [Parameter(Mandatory)][string]$Version,
    [string]$WorkPath,
    [string]$SdkVersion
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'ReleaseTools.psm1') -Force

try {
    $SourceRoot = Resolve-FullPath $SourceRoot
    $FeedPath = Resolve-FullPath $FeedPath
    if (-not $WorkPath) { $WorkPath = Join-Path $SourceRoot 'artifacts/package-consumers' }
    $WorkPath = Resolve-FullPath $WorkPath
    foreach ($id in (Get-PackageIds)) {
        if (-not (Test-Path -LiteralPath (Join-Path $FeedPath "$id.$Version.nupkg"))) { throw "The feed has no $id.$Version.nupkg." }
    }

    $sources = Join-Path $WorkPath 'src'
    $publish = Join-Path $WorkPath 'publish'
    $logs = Join-Path $WorkPath 'logs'
    $cache = Join-Path $WorkPath 'nuget-packages'
    Reset-OutputEntries -Path $WorkPath -Create @('src', 'publish', 'logs', 'playwright') | Out-Null
    Reset-PackageCache $cache

    Copy-ConsumerTemplate -Template (Join-Path $SourceRoot 'tests/PackageConsumer') -Destination $sources
    if ($SdkVersion) {
        # The closest global.json wins over the repository's, so only the consumers use this SDK.
        Set-Content -LiteralPath (Join-Path $sources 'global.json') -Encoding ASCII -Value "{ `"sdk`": { `"version`": `"$SdkVersion`", `"rollForward`": `"disable`" } }"
    }
    Invoke-Logged -FilePath 'dotnet' -LogPath (Join-Path $logs 'sdk.log') -WorkingDirectory $sources -ArgumentList @('--version')
    Write-Host "Consumers use SDK $((Get-Content -LiteralPath (Join-Path $logs 'sdk.log') -Tail 1).Trim())"
    $failures = Test-PackageOnlyConsumer -ConsumerRoot $sources
    Write-Failures 'consumers use PackageReference only' $failures
    if ($failures.Count -ne 0) { throw 'A consumer references the library sources.' }

    $config = Join-Path $WorkPath 'nuget.config'
    Write-ConsumerNuGetConfig -Path $config -FeedPath $FeedPath -CachePath $cache
    $environment = @{ NUGET_PACKAGES = $cache; DOTNET_CLI_TELEMETRY_OPTOUT = '1'; DOTNET_NOLOGO = '1' }
    $consumers = @(
        @{ Name = 'server'; Project = 'Server/Server.csproj'; Assets = 'Server/obj/project.assets.json'; WordCloud = $true; Assembly = 'PackageConsumer.Server' },
        @{ Name = 'wasm'; Project = 'Wasm/Host/Host.csproj'; Assets = 'Wasm/Client/obj/project.assets.json'; WordCloud = $true; Assembly = 'PackageConsumer.Wasm' },
        @{ Name = 'core-only'; Project = 'CoreOnly/CoreOnly.csproj'; Assets = 'CoreOnly/obj/project.assets.json'; WordCloud = $false; Assembly = 'PackageConsumer.CoreOnly' },
        # The application references its own component library, which references only WordCloud on the lowest Components.Web patch.
        @{ Name = 'library'; Project = 'Library/App/App.csproj'; Assets = 'Library/Charts/obj/project.assets.json'; WordCloud = $true; Assembly = 'PackageConsumer.Library'; ComponentsWeb = '10.0.0' }
    )
    $engine = Get-LockPackage $SourceRoot 'echarts'
    $failed = $false
    foreach ($consumer in $consumers) {
        $project = Join-Path $sources $consumer.Project
        $output = Join-Path $publish $consumer.Name
        Write-Host "Restoring and publishing the $($consumer.Name) consumer"
        Invoke-Logged -FilePath 'dotnet' -LogPath (Join-Path $logs "restore-$($consumer.Name).log") -Environment $environment -WorkingDirectory $sources `
            -ArgumentList @('restore', $project, '--configfile', $config, '--force', "-p:BlazorEChartsVersion=$Version")
        Invoke-Logged -FilePath 'dotnet' -LogPath (Join-Path $logs "publish-$($consumer.Name).log") -Environment $environment -WorkingDirectory $sources `
            -ArgumentList @('publish', $project, '-c', 'Release', '-o', $output, '--no-restore', '-nologo', "-p:BlazorEChartsVersion=$Version")

        $expected = @((Get-PackageId Core)) + @(if ($consumer.WordCloud) { Get-PackageId WordCloud })
        $checks = New-Object System.Collections.Generic.List[string]
        foreach ($failure in (Test-ConsumerRestore -AssetsFile (Join-Path $sources $consumer.Assets) -Version $Version -Packages $expected)) { $checks.Add($failure) }
        foreach ($failure in (Test-CachedPackage -CachePath $cache -FeedPath $FeedPath -Version $Version -Packages $expected)) { $checks.Add($failure) }
        if ($consumer.ContainsKey('ComponentsWeb') -and -not ((Read-Json (Join-Path $sources $consumer.Assets)).libraries.PSObject.Properties.Name -contains "Microsoft.AspNetCore.Components.Web/$($consumer.ComponentsWeb)")) {
            $checks.Add("The $($consumer.Name) consumer did not restore Microsoft.AspNetCore.Components.Web $($consumer.ComponentsWeb).")
        }
        $content = Join-Path $output 'wwwroot/_content'
        $runtime = Join-Path $content "BlazorECharts/js/echarts-$($engine.version).js"
        if (-not (Test-Path -LiteralPath $runtime)) { $checks.Add("Published output lacks _content/BlazorECharts/js/echarts-$($engine.version).js.") }
        elseif ((Get-FileSha256 $runtime) -ne $engine.files.'dist/echarts.esm.min.mjs') { $checks.Add('Published ECharts engine differs from sources.lock.json.') }
        $wordcloud = Test-Path -LiteralPath (Join-Path $content 'BlazorECharts.WordCloud')
        if ($consumer.WordCloud -and -not $wordcloud) { $checks.Add('Published output lacks the WordCloud assets.') }
        if (-not $consumer.WordCloud -and $wordcloud) { $checks.Add('The core-only consumer publishes WordCloud assets.') }
        if (-not (Test-Path -LiteralPath (Join-Path $output "$($consumer.Assembly).dll"))) { $checks.Add("Published output lacks $($consumer.Assembly).dll.") }
        Write-Failures "$($consumer.Name) consumer restored from the local feed" $checks.ToArray()
        if ($checks.Count -ne 0) { $failed = $true }
    }
    if ($failed) { throw 'Consumer restore or publish checks failed.' }

    $cli = Join-Path $SourceRoot 'node_modules/@playwright/test/cli.js'
    if (-not (Test-Path -LiteralPath $cli)) { throw 'Playwright is not installed; run npm ci in the source root.' }
    Write-Host 'Running the offline consumer browser checks'
    Invoke-Logged -FilePath 'node' -LogPath (Join-Path $logs 'playwright.log') -WorkingDirectory $SourceRoot -Environment @{
        BLAZOR_ECHARTS_CONSUMERS_PUBLISH = $publish; BLAZOR_ECHARTS_CONSUMERS_OUTPUT = (Join-Path $WorkPath 'playwright') } `
        -ArgumentList @($cli, 'test', '--config', (Join-Path $SourceRoot 'tests/PackageConsumer/playwright.config.ts'))
    Get-Content -LiteralPath (Join-Path $logs 'playwright.log') | Where-Object { $_ -match '^\s+\d+ (passed|failed|skipped|flaky)' } | ForEach-Object { Write-Host $_.Trim() }
    Write-Host 'PASS package consumers'
    exit 0
}
catch {
    Write-Host "FAIL package consumers: $($_.Exception.Message)"
    exit 1
}
