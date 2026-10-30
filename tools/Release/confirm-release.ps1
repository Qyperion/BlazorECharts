#Requires -Version 5.1
<#
.SYNOPSIS
Confirms a release before publishing: the gate report in -VerificationPath has the verdict PASS, still
passes when rechecked from the recorded files, and verified this version, repository and commit; the
feed holds exactly the packages and symbol packages that the gate recorded, byte for byte.

.DESCRIPTION
release.yml runs it on the downloaded verification artifact before it requests a nuget.org API key.
Exits with 1 when anything differs.
#>
param(
    [Parameter(Mandatory)][string]$VerificationPath,
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][string]$RepositoryUrl,
    [Parameter(Mandatory)][string]$RepositoryCommit
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'ReleaseTools.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'VerificationGate.psm1') -Force

try {
    $failures = Test-ReleaseVerification -Path (Resolve-FullPath $VerificationPath) -Version $Version -RepositoryUrl $RepositoryUrl -RepositoryCommit $RepositoryCommit
    Write-Failures "release $Version of $RepositoryCommit" $failures
    if ($failures.Count -ne 0) { exit 1 }
    foreach ($id in (Get-PackageIds)) { Write-Host "  $id.$Version.nupkg and .snupkg" }
    exit 0
}
catch {
    Write-Host "FAIL confirm-release: $($_.Exception.Message)"
    exit 1
}
