#Requires -Version 5.1
<#
.SYNOPSIS
Checks a library package and its .snupkg symbol package next to it: metadata, layout, documentation,
licenses, asset hashes against sources.lock.json and the tracked manifests, SourceLink, and the absence
of private local paths. -WorkPath receives the symbols as read-symbols.cs reads them. Exits with 1 when
any check fails.
#>
param(
    [Parameter(Mandatory)][string]$Package,
    [Parameter(Mandatory)][ValidateSet('Core', 'WordCloud')][string]$Kind,
    [Parameter(Mandatory)][string]$SourceRoot,
    [Parameter(Mandatory)][string]$Version,
    [string]$RepositoryUrl,
    [string]$RepositoryCommit,
    [string[]]$PrivatePaths = @(),
    [string]$WorkPath = (Join-Path ([System.IO.Path]::GetTempPath()) "blazorecharts-symbols-$([guid]::NewGuid().ToString('N'))")
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'ReleaseTools.psm1') -Force
try {
    $failures = Test-NuGetPackage -Path $Package -Kind $Kind -SourceRoot (Resolve-FullPath $SourceRoot) -Version $Version `
        -RepositoryUrl $RepositoryUrl -RepositoryCommit $RepositoryCommit -PrivatePaths $PrivatePaths
    Write-Failures "inspect $(Split-Path $Package -Leaf)" $failures
    $symbols = [System.IO.Path]::ChangeExtension((Resolve-FullPath $Package), '.snupkg')
    $symbolFailures = if (Test-Path -LiteralPath $symbols) {
        Test-SymbolPackage -Path $symbols -Kind $Kind -SourceRoot (Resolve-FullPath $SourceRoot) -Version $Version -WorkPath $WorkPath `
            -RepositoryUrl $RepositoryUrl -RepositoryCommit $RepositoryCommit -PrivatePaths $PrivatePaths
    }
    else { , @("Missing the symbol package $symbols.") }
    Write-Failures "inspect $(Split-Path $symbols -Leaf)" $symbolFailures
    if ($failures.Count -ne 0 -or $symbolFailures.Count -ne 0) { exit 1 }
}
catch {
    Write-Host "FAIL inspect ${Package}: $($_.Exception.Message)"
    exit 1
}
