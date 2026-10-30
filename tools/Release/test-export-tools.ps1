#Requires -Version 5.1
<#
.SYNOPSIS
RED fixtures for export-initial.ps1: each one gives the export an unsafe destination, a broken
allowlist, an internal file or a package that names a private commit, and requires a rejection.
The real allowlist must classify every tracked file. Exits with 1 when a broken input is accepted.
#>
param(
    [Parameter(Mandatory)][string]$SourceRoot,
    [Parameter(Mandatory)][string]$WorkPath
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'ReleaseTools.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'ExportTools.psm1') -Force

$script:Checks = New-Object System.Collections.Generic.List[object]
function Assert-Export([string]$Name, [bool]$Condition, [string]$Detail) {
    $script:Checks.Add([ordered]@{ name = $Name; passed = $Condition; detail = $Detail })
    if ($Condition) { Write-Host "PASS $Name" } else { Write-Host "FAIL ${Name}: $Detail" }
}
function Test-Matches([object[]]$Messages, [string]$Pattern) { @($Messages | Where-Object { "$_" -match $Pattern }).Count -gt 0 }
function Format-Messages([object[]]$Messages) { if (@($Messages).Count -eq 0) { '(none)' } else { @($Messages) -join ' | ' } }
function New-Tree([string[]]$Include, [string[]]$Exclude = @()) { [pscustomobject]@{ formatVersion = 1; include = $Include; exclude = $Exclude } }

# A foreign work path is refused before anything is written to it.
try { $WorkPath = Clear-OutputDirectory $WorkPath }
catch { Write-Host "FAIL $($_.Exception.Message)"; exit 1 }

try {
    $SourceRoot = Resolve-FullPath $SourceRoot

    # Destination.
    $failures = Test-ExportDestination -SourceRoot $SourceRoot -DestinationPath $SourceRoot
    Assert-Export 'RejectsSourceOrParentDestination/source' (Test-Matches $failures 'source root') (Format-Messages $failures)
    $failures = Test-ExportDestination -SourceRoot $SourceRoot -DestinationPath (Split-Path $SourceRoot)
    Assert-Export 'RejectsSourceOrParentDestination/parent' (Test-Matches $failures 'contains the source root') (Format-Messages $failures)
    $failures = Test-ExportDestination -SourceRoot $SourceRoot -DestinationPath (Join-Path $SourceRoot 'artifacts/export')
    Assert-Export 'RejectsSourceOrParentDestination/inside' (Test-Matches $failures 'inside the source root') (Format-Messages $failures)
    $failures = Test-ExportDestination -SourceRoot $SourceRoot -DestinationPath 'relative/export'
    Assert-Export 'RejectsSourceOrParentDestination/relative' (Test-Matches $failures 'absolute') (Format-Messages $failures)

    # The work path may lie inside the source root, so the emptiness checks use a stand-in source.
    $standIn = Join-Path $WorkPath 'source'
    $occupied = Join-Path $WorkPath 'occupied'
    New-Item -ItemType Directory -Force -Path $occupied | Out-Null
    Set-Content -LiteralPath (Join-Path $occupied 'file.txt') -Value x
    $failures = Test-ExportDestination -SourceRoot $standIn -DestinationPath $occupied
    Assert-Export 'RejectsNonEmptyDestination/file' (Test-Matches $failures 'not empty') (Format-Messages $failures)
    $hidden = Join-Path $WorkPath 'hidden'
    $git = New-Item -ItemType Directory -Force -Path (Join-Path $hidden '.git')
    $git.Attributes = $git.Attributes -bor [System.IO.FileAttributes]::Hidden
    $failures = Test-ExportDestination -SourceRoot $standIn -DestinationPath $hidden
    Assert-Export 'RejectsNonEmptyDestination/hidden-git' (Test-Matches $failures 'not empty') (Format-Messages $failures)
    $empty = Join-Path $WorkPath 'empty'
    New-Item -ItemType Directory -Force -Path $empty | Out-Null
    $failures = @() + (Test-ExportDestination -SourceRoot $standIn -DestinationPath $empty) + (Test-ExportDestination -SourceRoot $standIn -DestinationPath (Join-Path $WorkPath 'absent'))
    Assert-Export 'RejectsNonEmptyDestination/empty-or-absent-accepted' (@($failures | Where-Object { $_ }).Count -eq 0) (Format-Messages $failures)

    # Allowlist entries.
    foreach ($entry in @('C:\Windows\', 'W:/Projects/x.md', '/etc/passwd', '\\server\share\', '../outside/', 'src/../CLAUDE.md', 'src\BlazorECharts\', 'src/*.cs', '')) {
        $failures = Test-PublicTree -Tree (New-Tree @('src/', $entry))
        Assert-Export "RejectsAbsoluteAllowlistEntry/'$entry'" (@($failures).Count -gt 0) (Format-Messages $failures)
    }
    $failures = Test-PublicTree -Tree (New-Tree @('src/') @('C:\secret\'))
    Assert-Export 'RejectsAbsoluteAllowlistEntry/exclude' (@($failures).Count -gt 0) (Format-Messages $failures)

    # Internal files never reach the export.
    foreach ($entry in @('.git/', '.git/config', '.plans/', '.plans/README.md', '.plans/research/', 'CLAUDE.md', '.claude/', '.claude/settings.json', '.mcp.json', 'artifacts/')) {
        $failures = Test-PublicTree -Tree (New-Tree @('src/', $entry))
        Assert-Export "RejectsGitAndInternalPlanningFiles/include '$entry'" (Test-Matches $failures 'internal') (Format-Messages $failures)
    }
    $selection = Select-PublicFiles -Files @('docs/getting-started.md', '.plans/README.md', 'src/A.cs') -Tree (New-Tree @('docs/', '.plans/', 'src/'))
    Assert-Export 'RejectsGitAndInternalPlanningFiles/broad-include' ((Test-Matches $selection.failures '\.plans/README\.md') -and @($selection.files) -notcontains '.plans/README.md') (Format-Messages $selection.failures)
    $selection = Select-PublicFiles -Files @('src/A.cs', 'NEW-FILE.md') -Tree (New-Tree @('src/'))
    Assert-Export 'UnclassifiedTrackedFileFails' (Test-Matches $selection.failures 'NEW-FILE\.md') (Format-Messages $selection.failures)
    $selection = Select-PublicFiles -Files @('src/A.cs', 'CLAUDE.md') -Tree (New-Tree @('src/') @('CLAUDE.md'))
    Assert-Export 'ExcludedFileStaysOut' (@($selection.failures).Count -eq 0 -and @($selection.files).Count -eq 1 -and @($selection.files)[0] -eq 'src/A.cs') "files $(@($selection.files) -join ', '); failures $(Format-Messages $selection.failures)"

    # The real allowlist classifies every tracked file and keeps the internal ones out.
    $tree = Read-PublicTree -Path (Join-Path $PSScriptRoot 'public-tree.json')
    $failures = Test-PublicTree -Tree $tree
    $tracked = Get-TrackedFiles -SourceRoot $SourceRoot
    $selection = Select-PublicFiles -Files $tracked -Tree $tree
    $files = @($selection.files)
    $present = @('BlazorECharts.slnx', 'src/BlazorECharts/BlazorECharts.csproj', 'tools/Release/verify-local.ps1', 'docs/compatibility/release-checklist.md', '.github/workflows/verify.yml', 'LICENSE')
    $absent = @($files | Where-Object { $_ -like '.plans/*' -or $_ -like '.claude/*' -or $_ -in @('CLAUDE.md', '.mcp.json') })
    $missing = @($present | Where-Object { $files -notcontains $_ })
    Assert-Export 'RealPublicTreeIsComplete' (@($failures).Count -eq 0 -and @($selection.failures).Count -eq 0 -and $absent.Count -eq 0 -and $missing.Count -eq 0 -and $files.Count -gt 0) `
        "$($files.Count) of $(@($tracked).Count) files; tree $(Format-Messages $failures); selection $(Format-Messages $selection.failures); internal $(Format-Messages $absent); missing $(Format-Messages $missing)"

    # Names.
    $names = Get-WorkingNames
    $failures = Test-ExportNames -PackageId $names.PackageId -WordCloudPackageId $names.WordCloudPackageId -RootNamespace $names.RootNamespace
    Assert-Export 'WorkingNamesAreAccepted' (@($failures).Count -eq 0 -and $names.PackageId -ceq 'Qyperion.BlazorECharts' -and $names.WordCloudPackageId -ceq 'Qyperion.BlazorECharts.WordCloud') `
        "$($names.PackageId), $($names.WordCloudPackageId): $(Format-Messages $failures)"
    # The unprefixed core id BlazorEcharts belongs to another owner on nuget.org.
    $failures = Test-ExportNames -PackageId 'BlazorECharts' -WordCloudPackageId 'BlazorECharts.WordCloud' -RootNamespace 'BlazorECharts'
    Assert-Export 'UnprefixedPackageIdsAreRejected' ((Test-Matches $failures "PackageId 'BlazorECharts'") -and (Test-Matches $failures "WordCloudPackageId 'BlazorECharts\.WordCloud'")) (Format-Messages $failures)
    $failures = Test-ExportNames -PackageId 'Contoso.Charts' -WordCloudPackageId 'Contoso.Charts.WordCloud' -RootNamespace 'Contoso.Charts'
    Assert-Export 'RenameIsRejectedUntilSupported' (Test-Matches $failures 'not supported') (Format-Messages $failures)
    $failures = Test-ExportNames -PackageId 'Blazor ECharts' -WordCloudPackageId 'BlazorECharts.WordCloud' -RootNamespace '1BlazorECharts'
    Assert-Export 'InvalidNamesAreRejected' ((Test-Matches $failures 'PackageId') -and (Test-Matches $failures 'RootNamespace')) (Format-Messages $failures)

    # Packages must not name a commit of the private history.
    $package = Join-Path $WorkPath 'private.nupkg'
    $zip = [System.IO.Compression.ZipFile]::Open($package, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $writer = New-Object System.IO.StreamWriter($zip.CreateEntry('BlazorECharts.nuspec').Open())
        try { $writer.Write('<repository type="git" commit="0123456789abcdef0123456789abcdef01234567" />') } finally { $writer.Dispose() }
    }
    finally { $zip.Dispose() }
    $found = Find-PrivateCommits -Packages @($package) -Commits @('0123456789abcdef0123456789abcdef01234567', 'fedcba9876543210fedcba9876543210fedcba98')
    Assert-Export 'PackagesDoNotNamePrivateCommits/found' (Test-Matches $found '0123456789abcdef') (Format-Messages $found)
    $found = Find-PrivateCommits -Packages @($package) -Commits @('fedcba9876543210fedcba9876543210fedcba98')
    Assert-Export 'PackagesDoNotNamePrivateCommits/clean' (@($found).Count -eq 0) (Format-Messages $found)

    # Text files of the export must not name a commit of the private history, abbreviated or full.
    $commit = '0123456789abcdef0123456789abcdef01234567'
    $text = Join-Path $WorkPath 'text'
    New-Item -ItemType Directory -Force -Path $text | Out-Null
    Set-Content -LiteralPath (Join-Path $text 'baseline.md') -Value '| Commit | `0123456` |' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $text 'full.txt') -Value "commit $($commit.ToUpperInvariant())" -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $text 'other.json') -Value ('{"short":"012345","sha256":"' + $commit + 'abcdef0123456789abcdef01","id":"type:0123456789abcdef01234567x9"}') -Encoding UTF8
    [System.IO.File]::WriteAllBytes((Join-Path $text 'image.bin'), [byte[]](@(0x89, 0x50, 0x4E, 0x47, 0x00, 0x20) + [System.Text.Encoding]::ASCII.GetBytes($commit)))
    $files = @('baseline.md', 'full.txt', 'other.json', 'image.bin')
    $found = Find-PrivateCommitPrefixes -Root $text -Files $files -Commits @($commit, 'fedcba9876543210fedcba9876543210fedcba98')
    Assert-Export 'TextFilesDoNotNamePrivateCommits/found' ((Test-Matches $found 'baseline\.md.*0123456') -and (Test-Matches $found "full\.txt.*$commit") -and @($found).Count -eq 2) (Format-Messages $found)
    $found = Find-PrivateCommitPrefixes -Root $text -Files $files -Commits @('fedcba9876543210fedcba9876543210fedcba98')
    Assert-Export 'TextFilesDoNotNamePrivateCommits/clean' (@($found).Count -eq 0) (Format-Messages $found)

    # GitHub rejects blobs over 100 MiB and warns over 50 MiB: no tracked file may pass 52428800 bytes.
    $failures = Test-BlobSizes -Blobs @([pscustomobject]@{ path = 'schemas/big.json'; bytes = [long]52428801 }, [pscustomobject]@{ path = 'schemas/limit.json'; bytes = [long]52428800 })
    Assert-Export 'OversizedBlobFailsExport/synthetic' ((Test-Matches $failures 'schemas/big\.json') -and -not (Test-Matches $failures 'limit\.json')) (Format-Messages $failures)
    $blobs = Get-HeadBlobSizes -SourceRoot $SourceRoot
    $license = @(@($blobs) | Where-Object { $_.path -ceq 'LICENSE' })
    $failures = Test-BlobSizes -Blobs $blobs
    Assert-Export 'OversizedBlobFailsExport/real-head' ($license.Count -eq 1 -and $license[0].bytes -eq (Get-Item -LiteralPath (Join-Path $SourceRoot 'LICENSE')).Length -and @($failures).Count -eq 0) `
        "$($blobs.Count) blobs; $(Format-Messages $failures)"

    # A repository with the checkout settings of Git for Windows, where text=auto files get CRLF.
    $author = @('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false')
    $repository = Join-Path $WorkPath 'eol'
    New-Item -ItemType Directory -Force -Path $repository | Out-Null
    Invoke-GitCommand $repository @('init', '-q', '-b', 'main') | Out-Null
    Invoke-GitCommand $repository @('config', 'core.autocrlf', 'true') | Out-Null
    Invoke-GitCommand $repository @('config', 'core.eol', 'crlf') | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $repository '.gitattributes'), "* text=auto`n")
    [System.IO.File]::WriteAllText((Join-Path $repository 'notes.md'), "one`ntwo`n")
    Invoke-GitCommand $repository @('add', '--all') | Out-Null
    Invoke-GitCommand $repository ($author + @('commit', '-q', '-m', 'one')) | Out-Null
    $blob = (Invoke-GitCommand $repository @('rev-parse', 'HEAD:notes.md'))[0]
    $archive = Join-Path $WorkPath 'eol.zip'
    Save-CommitArchive -SourceRoot $repository -Commit 'HEAD' -Path $archive
    $zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
    try { $bytes = Read-ZipEntryBytes $zip.GetEntry('notes.md') } finally { $zip.Dispose() }
    Assert-Export 'ExportedTextFileIsTheBlob/text-auto' ((Get-GitBlobId $bytes) -eq $blob -and [Array]::IndexOf($bytes, [byte]13) -lt 0) "blob $blob, exported $(Get-GitBlobId $bytes), $($bytes.Length) bytes"
    # Control: the conversion of an archive without core.eol=lf changes the blob id.
    $converted = Join-Path $WorkPath 'eol-converted.zip'
    Invoke-GitCommand $repository @('-c', 'core.autocrlf=false', 'archive', '--format=zip', '-o', $converted, 'HEAD') | Out-Null
    $zip = [System.IO.Compression.ZipFile]::OpenRead($converted)
    try { $bytes = Read-ZipEntryBytes $zip.GetEntry('notes.md') } finally { $zip.Dispose() }
    Assert-Export 'ExportedTextFileIsTheBlob/conversion-detected' ((Get-GitBlobId $bytes) -ne $blob -and [Array]::IndexOf($bytes, [byte]13) -ge 0) "blob $blob, converted $(Get-GitBlobId $bytes)"

    # Commits only in a reflog (an amended one) and unreachable commits are private history too.
    $first = (Invoke-GitCommand $repository @('rev-parse', 'HEAD'))[0]
    Invoke-GitCommand $repository ($author + @('commit', '-q', '--allow-empty', '-m', 'two')) | Out-Null
    $amended = (Invoke-GitCommand $repository @('rev-parse', 'HEAD'))[0]
    Invoke-GitCommand $repository ($author + @('commit', '-q', '--amend', '--allow-empty', '-m', 'two again')) | Out-Null
    $head = (Invoke-GitCommand $repository @('rev-parse', 'HEAD'))[0]
    $dangling = (Invoke-GitCommand $repository ($author + @('commit-tree', "$first^{tree}", '-m', 'dangling')))[0]
    $commits = @(Get-PrivateCommits -SourceRoot $repository)
    $missing = @(@($first, $amended, $head, $dangling) | Where-Object { $commits -notcontains $_ })
    Assert-Export 'PrivateCommitsIncludeReflogAndUnreachable' ($missing.Count -eq 0 -and $commits.Count -eq 4) "found $(Format-Messages $commits); missing $(Format-Messages $missing)"

    # Ids of the private audit and plan never reach the export; SVG paths, minified code and standard names are not ids.
    # The ids are joined at run time, so that this file names none itself.
    $ids = @{ old = (@('M', '33') -join '-'); finding = (@('GEN', '03') -join '-'); reason = (@('API', '10') -join '-'); letter = (@('H', '3') -join '-')
        hypothesis = (@("$([char]0x0413)2", '25') -join '-') }
    $references = Join-Path $WorkPath 'references'
    New-Item -ItemType Directory -Force -Path $references | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $references 'comment.ts'), "// a slower machine fails for no reason ($($ids.old)).`n// $($ids.finding): the ICU locale`n", [System.Text.Encoding]::UTF8)
    [System.IO.File]::WriteAllText((Join-Path $references 'reason.json'), "{ `"reason`": `"named by what it is ($($ids.reason), as $($ids.letter) for events)`" }`n", [System.Text.Encoding]::UTF8)
    [System.IO.File]::WriteAllText((Join-Path $references 'hypothesis.ts'), "// $($ids.hypothesis): an absent id must fail`n", [System.Text.Encoding]::UTF8)
    [System.IO.File]::WriteAllText((Join-Path $references 'clean.js'), "`"d`":`"M-11.5 0L-3.2 4`" UTF-8, ISO-8601, SHA-256, ES2022, L-shaped; I=(r-W)/(H-1),w=Math.max(M-1,1)`n", [System.Text.Encoding]::UTF8)
    $files = @('comment.ts', 'reason.json', 'hypothesis.ts', 'clean.js')
    $found = Find-PrivateReferences -Root $references -Files $files
    $expected = @("comment.ts names the private id $($ids.old).", "comment.ts names the private id $($ids.finding).", "reason.json names the private id $($ids.reason).", "hypothesis.ts names the private id $($ids.hypothesis).")
    Assert-Export 'TextFilesDoNotNamePrivateIds/found' ((@($found) -join '|') -eq ($expected -join '|')) (Format-Messages $found)
    $public = @((Select-PublicFiles -Files (Get-TrackedFiles -SourceRoot $SourceRoot) -Tree (Read-PublicTree -Path (Join-Path $PSScriptRoot 'public-tree.json'))).files)
    $found = Find-PrivateReferences -Root $SourceRoot -Files $public
    Assert-Export 'TextFilesDoNotNamePrivateIds/real-public-tree' ($public.Count -gt 0 -and @($found).Count -eq 0) "$($public.Count) files; $(Format-Messages $found)"
}
catch {
    Assert-Export 'FixtureError' $false "$($_.Exception.Message) at $($_.InvocationInfo.PositionMessage)"
}

$failed = @($script:Checks | Where-Object { -not $_.passed }).Count
[ordered]@{ formatVersion = 1; passed = $script:Checks.Count - $failed; failed = $failed; fixtures = $script:Checks.ToArray() } |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $WorkPath 'fixtures.json') -Encoding UTF8
Write-Host "$($script:Checks.Count - $failed) passed, $failed failed"
if ($failed -ne 0) { exit 1 }
exit 0
