#Requires -Version 5.1
<#
.SYNOPSIS
Publishes the standalone WebAssembly demo (samples/BlazorECharts.Standalone) as a static site under
-BasePath, such as /BlazorECharts for https://<owner>.github.io/BlazorECharts/.

.DESCRIPTION
pages.yml runs it and deploys <OutputPath>/wwwroot to GitHub Pages; locally it builds the same site. The
site is a trimmed Release publish, restored from the lock files, with <base href> set to -BasePath. A copy
of index.html as 404.html starts the app on a deep link such as /BlazorECharts/examples/sankey, because a
static host without rewrites answers it with its 404 page. Needs the wasm-tools workload of the gate
(it is never installed here). Exits with 1 on any failure.
#>
param(
    [Parameter(Mandatory)][string]$SourceRoot,
    [Parameter(Mandatory)][string]$OutputPath,
    [string]$BasePath = ''
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'ReleaseTools.psm1') -Force

try {
    $SourceRoot = Resolve-FullPath $SourceRoot
    $OutputPath = Resolve-FullPath $OutputPath
    if (-not (Test-Path -LiteralPath (Join-Path $SourceRoot 'BlazorECharts.slnx'))) { throw "$SourceRoot is not the BlazorECharts source root." }
    if ($OutputPath -eq $SourceRoot -or (Test-PathInside $SourceRoot $OutputPath) -or (Test-PathInside $OutputPath (Join-Path $SourceRoot 'src')) -or
        (Test-PathInside $OutputPath (Join-Path $SourceRoot 'samples'))) {
        throw 'OutputPath must not be the source root, one of its parents, or inside src or samples.'
    }
    # configure-pages gives /BlazorECharts for a project site and an empty path for a custom domain.
    if ($BasePath -notmatch '^(/[A-Za-z0-9._~-]+)*/?$') { throw "BasePath '$BasePath' is not an absolute URL path such as /BlazorECharts." }
    $base = $BasePath.TrimEnd('/') + '/'

    if (Test-Path -LiteralPath $OutputPath) { Remove-Item -LiteralPath $OutputPath -Recurse -Force }
    $project = Join-Path $SourceRoot 'samples/BlazorECharts.Standalone/BlazorECharts.Standalone.csproj'
    & dotnet publish $project -c Release -o $OutputPath -p:RestoreLockedMode=true -nologo
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE." }

    $site = Join-Path $OutputPath 'wwwroot'
    $index = Join-Path $site 'index.html'
    $html = [System.IO.File]::ReadAllText($index)
    $placeholder = '<base href="/" />'
    if (([regex]::Matches($html, [regex]::Escape($placeholder))).Count -ne 1) { throw "$index must contain $placeholder exactly once." }
    $html = $html.Replace($placeholder, "<base href=`"$base`" />")
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($index, $html, $utf8)
    [System.IO.File]::WriteAllText((Join-Path $site '404.html'), $html, $utf8)
    # GitHub Pages compresses on its own and never serves the precompressed copies; those of index.html would keep the old base.
    Get-ChildItem -LiteralPath $site -Recurse -File | Where-Object { $_.Extension -in '.br', '.gz' } | Remove-Item -Force

    $files = @(Get-ChildItem -LiteralPath $site -Recurse -File)
    if (-not (Test-Path -LiteralPath $index) -or @($files | Where-Object { $_.Extension -eq '.wasm' }).Count -eq 0) { throw "$site has no index.html or no WebAssembly files." }
    $megabytes = [math]::Round(($files | Measure-Object -Property Length -Sum).Sum / 1MB, 1)
    Write-Host "PASS demo site: $site, base $base, $($files.Count) files, $megabytes MB"
    exit 0
}
catch {
    Write-Host "FAIL publish-demo: $($_.Exception.Message)"
    exit 1
}
