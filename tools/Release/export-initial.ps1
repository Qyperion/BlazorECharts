#Requires -Version 5.1
<#
.SYNOPSIS
Exports the tracked public tree of the committed HEAD into a new, separate repository with exactly one
commit, Initial, and verifies that repository with verify-local.ps1. The source repository and its
history are not changed.

.DESCRIPTION
-AuthorName and -AuthorEmail are the author and committer of Initial; the global git identity is not used.
Only tracked files that tools/Release/public-tree.json includes are exported, as a checkout would write
them; internal planning, agent configuration and artifacts are never exported. No exported file may be
over 50 MiB, the GitHub warning limit, and no exported text file may name a commit of the private
history, abbreviated or full. The new repository has no
remote. The export manifest (paths, modes, blob ids, SHA-256, both commits) is written outside the
destination, by default to <SourceRoot>/artifacts/export/<destination name>/export-manifest.json.

The pinned upstream archives are copied into the ignored artifacts/ of the destination and unpacked
offline against the tracked locks. Then verify-local.ps1 runs on the destination with -RepositoryUrl and
the Initial commit, and no package may name a commit of the private history.
Exit codes: those of verify-local.ps1 (0 PASS, 1 FAIL, 2 BLOCKED); 1 for any export failure.
#>
param(
    [Parameter(Mandatory)][string]$SourceRoot,
    [Parameter(Mandatory)][string]$DestinationPath,
    [Parameter(Mandatory)][string]$RepositoryUrl,
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][string]$PackageId,
    [Parameter(Mandatory)][string]$WordCloudPackageId,
    [Parameter(Mandatory)][string]$RootNamespace,
    [Parameter(Mandatory)][string]$AuthorName,
    [Parameter(Mandatory)][string]$AuthorEmail,
    [string]$ManifestPath
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'ReleaseTools.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'VerificationGate.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'ExportTools.psm1') -Force

# Path, mode and blob id of every file in HEAD.
function Get-HeadBlobs([string]$Root) {
    $blobs = @{}
    foreach ($line in (Invoke-GitCommand $Root @('-c', 'core.quotepath=off', 'ls-tree', '-r', '--full-tree', 'HEAD'))) {
        if ($line -notmatch '^(\d{6}) blob ([0-9a-f]{40})\t(.+)$') { throw "Unexpected ls-tree line: $line" }
        $blobs[$Matches[3]] = [pscustomobject]@{ mode = $Matches[1]; blob = $Matches[2] }
    }
    $blobs
}

try {
    foreach ($name in @('SourceRoot', 'DestinationPath', 'ManifestPath')) {
        $value = (Get-Variable -Name $name).Value
        if ($value -and -not [System.IO.Path]::IsPathRooted($value)) { throw "-$name must be an absolute path, got '$value'." }
    }
    $SourceRoot = Resolve-FullPath $SourceRoot
    $DestinationPath = Resolve-FullPath $DestinationPath
    if (-not (Test-Path -LiteralPath (Join-Path $SourceRoot 'BlazorECharts.slnx'))) { throw "$SourceRoot is not the BlazorECharts source root." }
    if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') { throw "Version '$Version' is not a SemVer 2.0 version." }
    $uri = $null
    if (-not [System.Uri]::TryCreate($RepositoryUrl, [System.UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -notin @('https', 'http') -or $uri.UserInfo) {
        throw "RepositoryUrl '$RepositoryUrl' must be an absolute http(s) URL without credentials."
    }
    if ([string]::IsNullOrWhiteSpace($AuthorName) -or $AuthorName -match '[<>\r\n]') { throw "AuthorName '$AuthorName' is not a git author name." }
    if ($AuthorEmail -notmatch '^[^@\s<>]+@[^@\s<>]+$') { throw "AuthorEmail '$AuthorEmail' is not an email address." }
    $failures = @() + (Test-ExportNames -PackageId $PackageId -WordCloudPackageId $WordCloudPackageId -RootNamespace $RootNamespace) +
        (Test-ExportDestination -SourceRoot $SourceRoot -DestinationPath $DestinationPath)
    if (-not $ManifestPath) { $ManifestPath = Join-Path $SourceRoot "artifacts/export/$(Split-Path $DestinationPath -Leaf)/export-manifest.json" }
    $ManifestPath = Resolve-FullPath $ManifestPath
    if ($ManifestPath -eq $DestinationPath -or (Test-PathInside $ManifestPath $DestinationPath)) { $failures += 'ManifestPath must be outside the destination.' }
    if ($failures.Count -ne 0) { throw ($failures -join ' ') }

    # Logs, fixtures and the archive go to an owned directory next to the manifest, never into its folder.
    $work = Reset-OutputEntries -Path "$ManifestPath.work" -Remove @('head.zip') -Create @('logs', 'fixtures')
    $logs = Join-Path $work 'logs'

    & (Join-Path $PSScriptRoot 'test-export-tools.ps1') -SourceRoot $SourceRoot -WorkPath (Join-Path $work 'fixtures')
    if ($LASTEXITCODE -ne 0) { throw 'Export fixtures failed.' }

    # The export is the committed HEAD; uncommitted changes would be silently lost.
    $identity = Get-SourceIdentity -SourceRoot $SourceRoot
    $failures = @() + (Test-SourceIdentity $identity)
    if ($failures.Count -ne 0) { throw ($failures -join ' ') }
    $tree = Read-PublicTree -Path (Join-Path $PSScriptRoot 'public-tree.json')
    $failures = @() + (Test-PublicTree -Tree $tree)
    if ($failures.Count -ne 0) { throw ($failures -join ' ') }
    $selection = Select-PublicFiles -Files (Get-TrackedFiles -SourceRoot $SourceRoot) -Tree $tree
    if (@($selection.failures).Count -ne 0) { throw (@($selection.failures) -join ' ') }
    $selected = @{}
    foreach ($file in $selection.files) { $selected[$file] = $true }
    $sourceBlobs = Get-HeadBlobs $SourceRoot
    $sizes = Get-HeadBlobSizes -SourceRoot $SourceRoot
    $failures = @() + (Test-BlobSizes -Blobs @(@($sizes) | Where-Object { $selected.ContainsKey($_.path) }))
    if ($failures.Count -ne 0) { throw ($failures -join ' ') }
    $private = @(Get-PrivateCommits -SourceRoot $SourceRoot)
    $expected = [int](Invoke-GitCommand $SourceRoot @('rev-list', '--all', '--count'))[0]
    if ($private.Count -lt $expected -or $expected -eq 0) { throw "Read $($private.Count) private commits, fewer than the $expected reachable ones." }
    Write-Host "Exporting $($selected.Count) of $($sourceBlobs.Count) files of commit $($identity.commit) to $DestinationPath"

    $archive = Join-Path $work 'head.zip'
    Save-CommitArchive -SourceRoot $SourceRoot -Commit $identity.commit -Path $archive
    New-Item -ItemType Directory -Force -Path $DestinationPath | Out-Null
    $written = 0
    $converted = New-Object System.Collections.Generic.List[string]
    $zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
    try {
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName.EndsWith('/') -or -not $selected.ContainsKey($entry.FullName)) { continue }
            $target = Join-Path $DestinationPath $entry.FullName
            if (-not (Test-PathInside $target $DestinationPath)) { throw "Archive entry $($entry.FullName) leaves the destination." }
            New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
            $bytes = Read-ZipEntryBytes $entry
            # The written bytes are the committed blob, so the manifest and the gate cover the bytes GitHub serves.
            if ((Get-GitBlobId $bytes) -ne $sourceBlobs[$entry.FullName].blob) { $converted.Add($entry.FullName) }
            [System.IO.File]::WriteAllBytes($target, $bytes)
            $written++
        }
    }
    finally { $zip.Dispose() }
    Remove-Item -LiteralPath $archive -Force
    if ($written -ne $selected.Count) { throw "Wrote $written files, expected $($selected.Count)." }
    if ($converted.Count -ne 0) { throw "Exported bytes differ from the committed blob: $($converted -join ', ')." }
    Write-Host "PASS the $written exported files are byte for byte their committed blobs"
    $found = @() + (Find-PrivateCommitPrefixes -Root $DestinationPath -Files $selection.files -Commits $private)
    if ($found.Count -ne 0) { throw ($found -join ' ') }
    Write-Host "PASS the $written exported files name none of the $($private.Count) private commits"
    $found = @() + (Find-PrivateReferences -Root $DestinationPath -Files $selection.files)
    if ($found.Count -ne 0) { throw ($found -join ' ') }
    Write-Host "PASS the $written exported files name no id of the internal audit or plan"

    Invoke-GitCommand $DestinationPath @('init', '-q', '-b', 'main') | Out-Null
    Invoke-GitCommand $DestinationPath @('-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', 'add', '--all') | Out-Null
    Invoke-GitCommand $DestinationPath @('-c', 'core.autocrlf=false', '-c', "user.name=$AuthorName", '-c', "user.email=$AuthorEmail",
        'commit', '-q', '--no-verify', '-m', 'Initial') | Out-Null

    $checks = New-Object System.Collections.Generic.List[string]
    $count = (Invoke-GitCommand $DestinationPath @('rev-list', '--count', 'HEAD'))[0]
    if ($count -ne '1') { $checks.Add("The destination has $count commits, expected 1.") }
    $message = (Invoke-GitCommand $DestinationPath @('log', '-1', '--format=%B'))[0]
    if ($message -ne 'Initial') { $checks.Add("The commit message is '$message', expected 'Initial'.") }
    $identity = (Invoke-GitCommand $DestinationPath @('log', '-1', '--format=%an <%ae>|%cn <%ce>'))[0]
    if ($identity -cne "$AuthorName <$AuthorEmail>|$AuthorName <$AuthorEmail>") { $checks.Add("Initial has author and committer '$identity', expected $AuthorName <$AuthorEmail>.") }
    $lines = Invoke-GitCommand $DestinationPath @('remote')
    $remotes = @($lines | Where-Object { $_ })
    if ($remotes.Count -ne 0) { $checks.Add("The destination has remotes: $($remotes -join ', ').") }
    $lines = Invoke-GitCommand $DestinationPath @('status', '--porcelain', '--untracked-files=all')
    $status = @($lines | Where-Object { $_ })
    if ($status.Count -ne 0) { $checks.Add("The destination is not clean: $($status -join '; ').") }
    # Every exported file has the mode and blob of the source commit, and nothing else is in the tree.
    $exported = Get-HeadBlobs $DestinationPath
    foreach ($file in $selected.Keys) {
        if (-not $exported.ContainsKey($file)) { $checks.Add("$file is missing from the Initial commit."); continue }
        if ($exported[$file].blob -ne $sourceBlobs[$file].blob -or $exported[$file].mode -ne $sourceBlobs[$file].mode) { $checks.Add("$file differs from the source commit.") }
    }
    foreach ($file in $exported.Keys) { if (-not $selected.ContainsKey($file)) { $checks.Add("$file is in the Initial commit but not in the selection.") } }
    if ($checks.Count -ne 0) { throw ($checks -join ' ') }
    $initial = (Invoke-GitCommand $DestinationPath @('rev-parse', 'HEAD'))[0]
    $initialTree = (Invoke-GitCommand $DestinationPath @('rev-parse', 'HEAD^{tree}'))[0]
    Write-Host "PASS Initial $initial (tree $initialTree): one commit, no remote, $($exported.Count) files equal to the source commit"

    $files = @($selection.files | Sort-Object | ForEach-Object {
        $path = Join-Path $DestinationPath $_
        [ordered]@{ path = $_; mode = $sourceBlobs[$_].mode; blob = $sourceBlobs[$_].blob; bytes = (Get-Item -LiteralPath $path).Length; sha256 = Get-FileSha256 $path }
    })
    $manifest = [ordered]@{ formatVersion = 1; exportedAt = (Get-Date).ToUniversalTime().ToString('o')
        source = [ordered]@{ commit = $identity.commit; tree = $identity.tree; trackedFiles = $sourceBlobs.Count }
        destination = [ordered]@{ path = $DestinationPath; initialCommit = $initial; initialTree = $initialTree }
        names = [ordered]@{ packageId = $PackageId; wordCloudPackageId = $WordCloudPackageId; rootNamespace = $RootNamespace }
        author = "$AuthorName <$AuthorEmail>"
        version = $Version; repositoryUrl = $RepositoryUrl; files = $files; verification = $null }
    $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8

    # Pinned upstream inputs go to the ignored artifacts/ and are unpacked offline against the tracked locks.
    $upstream = Join-Path $DestinationPath 'artifacts/upstream'
    $documentation = Join-Path $DestinationPath 'artifacts/generator/upstream'
    New-Item -ItemType Directory -Force -Path $upstream, $documentation | Out-Null
    $archives = @(Get-ChildItem -LiteralPath (Join-Path $SourceRoot 'artifacts/upstream') -File -Filter *.tgz)
    if ($archives.Count -eq 0) { throw 'artifacts/upstream has no pinned archives; run npm run assets:acquire in the source root.' }
    foreach ($file in $archives) { Copy-Item -LiteralPath $file.FullName -Destination $upstream }
    Copy-Item -LiteralPath (Join-Path $SourceRoot 'artifacts/generator/upstream/echarts-doc.tgz') -Destination $documentation
    $npm = 'npm.cmd'
    $env:Path = "$(Join-Path $env:SystemRoot 'System32');$env:Path"
    foreach ($step in @(@('npm-ci', @('ci', '--no-audit', '--no-fund')), @('assets-acquire', @('run', 'assets:acquire', '--', '--offline')), @('docs-acquire', @('run', 'docs:acquire', '--', '--offline')))) {
        Write-Host "Preparing the export: npm $($step[1] -join ' ')"
        Invoke-Logged -FilePath $npm -ArgumentList $step[1] -LogPath (Join-Path $logs "$($step[0]).log") -WorkingDirectory $DestinationPath
    }
    $lines = Invoke-GitCommand $DestinationPath @('status', '--porcelain', '--untracked-files=all')
    $status = @($lines | Where-Object { $_ })
    if ($status.Count -ne 0) { throw "Preparing the export changed its tree: $($status -join '; ')." }

    Write-Host "Running the release gate on the export with RepositoryCommit $initial"
    $output = Join-Path $DestinationPath 'artifacts/verification'
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $DestinationPath 'tools/Release/verify-local.ps1'), '-SourceRoot', $DestinationPath,
        '-OutputPath', $output, '-Configuration', 'Release', '-Version', $Version, '-RepositoryUrl', $RepositoryUrl, '-RepositoryCommit', $initial)
    & (Get-Process -Id $PID).Path @arguments
    $gate = $LASTEXITCODE

    # Symbol packages too: their PDBs name the commit in SourceLink.
    $packages = @(Get-ChildItem -LiteralPath (Join-Path $output 'packages/feed') -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -in @('.nupkg', '.snupkg') } | Sort-Object Name | ForEach-Object { $_.FullName })
    $found = if ($packages.Count -ne 0) { @() + (Find-PrivateCommits -Packages $packages -Commits $private) } else { @() }
    # Positive control: the same search finds the Initial commit in the repository metadata of every package.
    $initialFound = if ($packages.Count -ne 0) { @() + (Find-PrivateCommits -Packages $packages -Commits @($initial)) } else { @() }
    if ($packages.Count -ne 0 -and $initialFound.Count -lt $packages.Count) { Write-Host "FAIL export: the Initial commit is in $($initialFound.Count) of $($packages.Count) packages."; exit 1 }
    $report = Join-Path $output 'verification-report.json'
    $verdict = if (Test-Path -LiteralPath $report) { (Read-Json $report).verdict.status } else { 'FAIL' }
    $manifest.verification = [ordered]@{ exitCode = $gate; verdict = $verdict; report = $report
        reportSha256 = $(if (Test-Path -LiteralPath $report) { Get-FileSha256 $report } else { $null })
        packages = @($packages | ForEach-Object { [ordered]@{ file = (Split-Path $_ -Leaf); sha256 = Get-FileSha256 $_ } })
        privateCommitsChecked = $private.Count; privateCommitsFound = @($found).Count }
    $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8
    Write-Host "Wrote $ManifestPath"
    if ($packages.Count -eq 0) { Write-Host 'FAIL export: the gate produced no packages to check for private commits.'; exit 1 }
    if ($found.Count -ne 0) { foreach ($item in $found) { Write-Host "FAIL $item" }; exit 1 }
    Write-Host "PASS packages name none of the $($private.Count) private commits"
    Write-Host "$verdict export $Version -> $DestinationPath (Initial $initial)"
    exit $gate
}
catch {
    Write-Host "FAIL export-initial: $($_.Exception.Message)"
    exit 1
}
