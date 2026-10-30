#Requires -Version 5.1
<#
.SYNOPSIS
Builds and packs the BlazorECharts and BlazorECharts.WordCloud projects, inspects both packages, records their
hashes, runs the release-tool fixtures and then the clean package consumers.

.DESCRIPTION
Output layout under -OutputPath:
  feed/                    the two .nupkg files (a local NuGet feed) and their .snupkg symbol packages
  packages-manifest.json   package, symbol package and entry hashes
  symbols/                 the PDBs of the symbol packages as read-symbols.cs reads them
  logs/                    build, pack and consumer logs
  build/                   isolated build output (artifacts path)
  fixtures/                release-tool fixtures
  consumers/               consumer sources, publish output, NuGet cache and Playwright results
Exits with a nonzero code on any failure.
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

try {
    $SourceRoot = Resolve-FullPath $SourceRoot
    $OutputPath = Resolve-FullPath $OutputPath
    if (-not (Test-Path -LiteralPath (Join-Path $SourceRoot 'BlazorECharts.slnx'))) { throw "$SourceRoot is not the BlazorECharts source root." }
    if ($OutputPath -eq $SourceRoot -or (Test-PathInside $SourceRoot $OutputPath) -or (Test-PathInside $OutputPath (Join-Path $SourceRoot 'src'))) {
        throw 'OutputPath must not be the source root, one of its parents, or inside src.'
    }
    if ([string]::IsNullOrEmpty($RepositoryUrl) -ne [string]::IsNullOrEmpty($RepositoryCommit)) { throw 'Pass RepositoryUrl and RepositoryCommit together.' }
    if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') { throw "Version '$Version' is not a SemVer 2.0 version." }

    $feed = Join-Path $OutputPath 'feed'
    $logs = Join-Path $OutputPath 'logs'
    $build = Join-Path $OutputPath 'build'
    # Only the directories this script owns are cleaned, and only in its own output directory.
    Reset-OutputEntries -Path $OutputPath -Create @('feed', 'logs', 'build', 'fixtures', 'symbols') | Out-Null

    # Map the build output first: it may lie outside the source root. %2C is an escaped comma between the two mappings.
    $properties = @("-p:Version=$Version", "-p:PathMap=$build\=/_build/%2C$SourceRoot\=/_/", '-p:Deterministic=true', '-p:RestoreLockedMode=true',
        '-p:EnableSourceControlManagerQueries=false')
    if ($RepositoryUrl) {
        # SourceLink without source control queries: they would read the private history of a development clone.
        $sourceLink = Join-Path $build 'sourcelink.json'
        [System.IO.File]::WriteAllText($sourceLink, (Get-SourceLinkJson $RepositoryUrl $RepositoryCommit))
        $properties += @("-p:RepositoryUrl=$RepositoryUrl", "-p:RepositoryCommit=$RepositoryCommit", '-p:RepositoryType=git', '-p:PublishRepositoryUrl=true',
            "-p:SourceLink=$sourceLink")
    }
    foreach ($kind in @('Core', 'WordCloud')) {
        $id = Get-PackageId $kind
        $assembly = Get-AssemblyName $kind
        Write-Host "Packing $id $Version"
        Invoke-Logged -FilePath 'dotnet' -LogPath (Join-Path $logs "pack-$id.log") -WorkingDirectory $SourceRoot -ArgumentList (@(
            'pack', (Join-Path $SourceRoot "src/$assembly/$assembly.csproj"), '-c', $Configuration, '-o', $feed, '--artifacts-path', $build, '-nologo') + $properties)
    }

    $manifest = [ordered]@{ formatVersion = 1; version = $Version; configuration = $Configuration
        repositoryUrl = $RepositoryUrl; repositoryCommit = $RepositoryCommit; packages = @() }
    $failed = $false
    foreach ($kind in @('Core', 'WordCloud')) {
        $id = Get-PackageId $kind
        $package = Join-Path $feed "$id.$Version.nupkg"
        if (-not (Test-Path -LiteralPath $package)) { throw "Pack did not produce $package." }
        $failures = Test-NuGetPackage -Path $package -Kind $kind -SourceRoot $SourceRoot -Version $Version -RepositoryUrl $RepositoryUrl -RepositoryCommit $RepositoryCommit -PrivatePaths @($OutputPath)
        Write-Failures "inspect $id.$Version.nupkg" $failures
        if ($failures.Count -ne 0) { $failed = $true }
        $symbols = Join-Path $feed "$id.$Version.snupkg"
        if (-not (Test-Path -LiteralPath $symbols)) { throw "Pack did not produce $symbols." }
        $failures = Test-SymbolPackage -Path $symbols -Kind $kind -SourceRoot $SourceRoot -Version $Version -WorkPath (Join-Path $OutputPath 'symbols') `
            -RepositoryUrl $RepositoryUrl -RepositoryCommit $RepositoryCommit -PrivatePaths @($OutputPath)
        Write-Failures "inspect $id.$Version.snupkg" $failures
        if ($failures.Count -ne 0) { $failed = $true }
        $zip = [System.IO.Compression.ZipFile]::OpenRead($package)
        try {
            $entries = @($zip.Entries | Sort-Object FullName | ForEach-Object {
                [ordered]@{ path = $_.FullName; bytes = $_.Length; sha256 = Get-BytesSha256 (Read-ZipEntryBytes $_) } })
        }
        finally { $zip.Dispose() }
        $manifest.packages += [ordered]@{ id = $id; file = "feed/$id.$Version.nupkg"; bytes = (Get-Item -LiteralPath $package).Length
            sha256 = Get-FileSha256 $package; entries = $entries
            symbols = [ordered]@{ file = "feed/$id.$Version.snupkg"; bytes = (Get-Item -LiteralPath $symbols).Length; sha256 = Get-FileSha256 $symbols } }
    }
    if ($failed) { throw 'Package inspection failed.' }
    $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $OutputPath 'packages-manifest.json') -Encoding UTF8
    Write-Host "Wrote $(Join-Path $OutputPath 'packages-manifest.json')"

    & (Join-Path $PSScriptRoot 'test-release-tools.ps1') -SourceRoot $SourceRoot -FeedPath $feed -Version $Version -WorkPath (Join-Path $OutputPath 'fixtures')
    if ($LASTEXITCODE -ne 0) { throw 'Release-tool fixtures failed.' }

    & (Join-Path $PSScriptRoot 'test-packages.ps1') -SourceRoot $SourceRoot -FeedPath $feed -Version $Version -WorkPath (Join-Path $OutputPath 'consumers')
    if ($LASTEXITCODE -ne 0) { throw 'Package consumers failed.' }

    Write-Host "PASS package $Version -> $feed"
    exit 0
}
catch {
    Write-Host "FAIL package: $($_.Exception.Message)"
    exit 1
}
