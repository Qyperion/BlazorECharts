#Requires -Version 5.1
# Checks of export-initial.ps1: destination, allowlist of the public tree, names and private commits.
# Windows PowerShell 5.1 compatible; keep this file ASCII.
Set-StrictMode -Version 3.0
# The caller's preference does not apply: a module function stops at its first error however the script was started.
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'ReleaseTools.psm1')

# Internal files that no allowlist may export; an entry ending with / is a directory.
$script:Internal = @('.git/', 'artifacts/', '.plans/', 'CLAUDE.md', '.claude/', '.mcp.json', '.codegraph/')
$script:WorkingNames = [ordered]@{ PackageId = (Get-PackageId Core); WordCloudPackageId = (Get-PackageId WordCloud); RootNamespace = 'BlazorECharts' }

function Get-WorkingNames { $script:WorkingNames }

function Test-EntryMatches([string]$Entry, [string]$Path) {
    if ($Entry.EndsWith('/')) { $Path.StartsWith($Entry, [System.StringComparison]::Ordinal) } else { $Path -ceq $Entry }
}

function Test-InternalPath([string]$Path) { @($script:Internal | Where-Object { Test-EntryMatches $_ $Path }).Count -gt 0 }

function Read-PublicTree([Parameter(Mandatory)][string]$Path) { Read-Json $Path }

# Entries are repository paths with /: no absolute path, drive, UNC, backslash, . or .. segment or wildcard.
function Test-PublicTree([Parameter(Mandatory)]$Tree) {
    $failures = New-Object System.Collections.Generic.List[string]
    if ($Tree.formatVersion -ne 1) { $failures.Add('public-tree.json must have formatVersion 1.') }
    foreach ($list in @('include', 'exclude')) {
        $seen = @{}
        foreach ($entry in @($Tree.$list)) {
            $text = "$entry"
            if ([string]::IsNullOrWhiteSpace($text)) { $failures.Add("An empty $list entry is not allowed."); continue }
            if ([System.IO.Path]::IsPathRooted($text) -or $text -match '^[A-Za-z]:' -or $text.StartsWith('/')) { $failures.Add("The $list entry '$text' is an absolute path."); continue }
            if ($text.Contains('\')) { $failures.Add("The $list entry '$text' uses a backslash; entries are repository paths with /."); continue }
            if (@($text.TrimEnd('/').Split('/') | Where-Object { $_ -in @('', '.', '..') }).Count -ne 0) { $failures.Add("The $list entry '$text' has an empty, . or .. segment."); continue }
            if ($text -match '[*?\[\]]') { $failures.Add("The $list entry '$text' has a wildcard; list paths or directories."); continue }
            if ($seen.ContainsKey($text)) { $failures.Add("The $list entry '$text' is listed twice.") }
            $seen[$text] = $true
            if ($list -eq 'include' -and (@($script:Internal | Where-Object { (Test-EntryMatches $_ $text) -or $_ -ceq $text }).Count -ne 0)) {
                $failures.Add("The include entry '$text' names an internal path; internal files never reach the public tree.")
            }
        }
    }
    , $failures.ToArray()
}

# Every tracked file is either included or excluded; an included internal file fails, it is never exported.
function Select-PublicFiles([string[]]$Files, [Parameter(Mandatory)]$Tree) {
    $failures = New-Object System.Collections.Generic.List[string]
    $selected = New-Object System.Collections.Generic.List[string]
    $include = @($Tree.include | ForEach-Object { "$_" })
    $exclude = @($Tree.exclude | ForEach-Object { "$_" })
    foreach ($file in $Files) {
        if (@($exclude | Where-Object { Test-EntryMatches $_ $file }).Count -ne 0) { continue }
        if (@($include | Where-Object { Test-EntryMatches $_ $file }).Count -eq 0) { $failures.Add("Tracked file $file is neither included nor excluded by public-tree.json."); continue }
        if (Test-InternalPath $file) { $failures.Add("The allowlist would export the internal file $file; exclude it."); continue }
        $selected.Add($file)
    }
    [pscustomobject]@{ files = $selected.ToArray(); failures = $failures.ToArray() }
}

function Get-TrackedFiles([Parameter(Mandatory)][string]$SourceRoot) {
    Invoke-GitCommand $SourceRoot @('-c', 'core.quotepath=off', 'ls-files')
}

function Test-ExportDestination([Parameter(Mandatory)][string]$SourceRoot, [Parameter(Mandatory)][string]$DestinationPath) {
    $failures = New-Object System.Collections.Generic.List[string]
    if (-not [System.IO.Path]::IsPathRooted($DestinationPath)) { $failures.Add("DestinationPath must be an absolute path, got '$DestinationPath'."); return , $failures.ToArray() }
    $source = Resolve-FullPath $SourceRoot
    $destination = Resolve-FullPath $DestinationPath
    if ($destination -eq $source) { $failures.Add('DestinationPath is the source root.') }
    elseif (Test-PathInside $source $destination) { $failures.Add('DestinationPath contains the source root.') }
    elseif (Test-PathInside $destination $source) { $failures.Add('DestinationPath is inside the source root.') }
    if (Test-Path -LiteralPath $destination -PathType Leaf) { $failures.Add("DestinationPath $destination is a file.") }
    elseif ((Test-Path -LiteralPath $destination) -and @(Get-ChildItem -LiteralPath $destination -Force).Count -ne 0) { $failures.Add("DestinationPath $destination is not empty.") }
    , $failures.ToArray()
}

# The export publishes the names of the tree. Renaming the root namespace touches sources, generated code,
# hashed assets and the public API baseline; until that is implemented the export only confirms the names.
function Test-ExportNames([string]$PackageId, [string]$WordCloudPackageId, [string]$RootNamespace) {
    $failures = New-Object System.Collections.Generic.List[string]
    $identifier = '^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$'
    $values = [ordered]@{ PackageId = $PackageId; WordCloudPackageId = $WordCloudPackageId; RootNamespace = $RootNamespace }
    foreach ($name in $values.Keys) { if ("$($values[$name])" -notmatch $identifier) { $failures.Add("$name '$($values[$name])' is not a dotted identifier.") } }
    if ($failures.Count -eq 0) {
        $changed = @($values.Keys | Where-Object { $values[$_] -cne $script:WorkingNames[$_] })
        if ($changed.Count -ne 0) {
            $failures.Add("Renaming ($(@($changed | ForEach-Object { "$_ '$($values[$_])'" }) -join ', ')) is not supported yet; the export keeps $(@($script:WorkingNames.Keys | ForEach-Object { "$_ '$($script:WorkingNames[$_])'" }) -join ', ').")
        }
    }
    , $failures.ToArray()
}

# Full commit ids of the private history inside any package entry.
function Find-PrivateCommits([string[]]$Packages, [string[]]$Commits) {
    $found = New-Object System.Collections.Generic.List[string]
    $latin1 = [System.Text.Encoding]::GetEncoding(28591)
    foreach ($package in $Packages) {
        $zip = [System.IO.Compression.ZipFile]::OpenRead($package)
        try {
            foreach ($entry in $zip.Entries) {
                $text = $latin1.GetString((Read-ZipEntryBytes $entry))
                foreach ($commit in $Commits) {
                    if ($commit -and $text.IndexOf($commit, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { $found.Add("$(Split-Path $package -Leaf)!$($entry.FullName) names the private commit $commit.") }
                }
            }
        }
        finally { $zip.Dispose() }
    }
    , $found.ToArray()
}

# Abbreviated (7 to 40 hex digits) or full ids of private commits in the text files under Root. As in git,
# a file with a NUL byte in its first 8000 bytes is binary; a hex run longer than 40 digits is not an id.
function Find-PrivateCommitPrefixes([Parameter(Mandatory)][string]$Root, [string[]]$Files, [string[]]$Commits) {
    $found = New-Object System.Collections.Generic.List[string]
    $prefixes = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($commit in @($Commits | Where-Object { $_ -match '^[0-9a-fA-F]{40}$' })) { for ($n = 7; $n -le 40; $n++) { [void]$prefixes.Add($commit.Substring(0, $n)) } }
    $starts = @($prefixes | Where-Object { $_.Length -eq 7 } | ForEach-Object { $_.ToLowerInvariant() } | Sort-Object -Unique)
    if ($starts.Count -eq 0) { return , $found.ToArray() }
    $options = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor [System.Text.RegularExpressions.RegexOptions]::Compiled
    $token = New-Object System.Text.RegularExpressions.Regex("(?<![0-9A-Za-z])(?:$($starts -join '|'))[0-9A-Fa-f]{0,33}(?![0-9A-Za-z])", $options)
    $latin1 = [System.Text.Encoding]::GetEncoding(28591)
    foreach ($file in $Files) {
        $bytes = [System.IO.File]::ReadAllBytes((Join-Path $Root $file))
        if ([Array]::IndexOf($bytes, [byte]0, 0, [Math]::Min(8000, $bytes.Length)) -ge 0) { continue }
        foreach ($match in $token.Matches($latin1.GetString($bytes))) {
            if ($prefixes.Contains($match.Value)) { $found.Add("$file names the private commit $($match.Value).") }
        }
    }
    , $found.ToArray()
}

# Ids of the internal audit and plan in the text files under Root: a finding prefix such as GEN or API with a
# number, an older one-letter id in parentheses after a space or before a colon, and a hypothesis (Cyrillic Ge).
# SVG path data such as M-11.5 and minified arithmetic such as max(M-1,1) are not ids.
function Find-PrivateReferences([Parameter(Mandatory)][string]$Root, [string[]]$Files) {
    $found = New-Object System.Collections.Generic.List[string]
    $pattern = '(?<![^\s])\((?<id>(?:CR|H|M|L)-\d+)[,)]|(?<![A-Za-z0-9])(?<id>(?:CR|H|M|L)-\d+):|(?<![A-Za-z0-9])(?<id>(?:RT|JS|API|GEN|EV|WC|REL|DOC|HYG)-\d+)(?![0-9])|(?<![\p{L}\p{N}])(?<id>\u04132?-\d+)(?![0-9])'
    $token = New-Object System.Text.RegularExpressions.Regex($pattern, [System.Text.RegularExpressions.RegexOptions]::Compiled)
    foreach ($file in $Files) {
        $bytes = [System.IO.File]::ReadAllBytes((Join-Path $Root $file))
        if ([Array]::IndexOf($bytes, [byte]0, 0, [Math]::Min(8000, $bytes.Length)) -ge 0) { continue }
        foreach ($match in $token.Matches([System.Text.Encoding]::UTF8.GetString($bytes))) { $found.Add("$file names the private id $($match.Groups['id'].Value).") }
    }
    , $found.ToArray()
}

# Every commit of the private history: reachable from a ref, only in a reflog (amended or rebased) or
# unreachable and not yet pruned. Unrolled: wrap the call in @().
function Get-PrivateCommits([Parameter(Mandatory)][string]$SourceRoot) {
    $commits = New-Object 'System.Collections.Generic.SortedSet[string]' ([System.StringComparer]::Ordinal)
    foreach ($line in (Invoke-GitCommand $SourceRoot @('rev-list', '--all', '--reflog'))) {
        if ($line -notmatch '^[0-9a-f]{40}$') { throw "Unexpected rev-list line: $line" }
        [void]$commits.Add($line)
    }
    foreach ($line in (Invoke-GitCommand $SourceRoot @('fsck', '--unreachable', '--no-reflogs', '--no-progress', '--connectivity-only'))) {
        if ($line -match '^(?:unreachable|dangling) commit ([0-9a-f]{40})$') { [void]$commits.Add($Matches[1]) }
    }
    @($commits)
}

# git archive writes the files as a checkout would. The native core.eol of Git for Windows is CRLF, which a
# checkout gives text files without an eol attribute; core.eol=lf and autocrlf off keep the committed bytes.
function Save-CommitArchive([Parameter(Mandatory)][string]$SourceRoot, [Parameter(Mandatory)][string]$Commit, [Parameter(Mandatory)][string]$Path) {
    Invoke-GitCommand $SourceRoot @('-c', 'core.eol=lf', '-c', 'core.autocrlf=false', 'archive', '--format=zip', '-o', $Path, $Commit) | Out-Null
}

# The blob id of raw bytes, as git hash-object --no-filters computes it in a SHA-1 repository.
function Get-GitBlobId([byte[]]$Bytes) {
    $header = [System.Text.Encoding]::ASCII.GetBytes("blob $($Bytes.Length)`0")
    $sha = [System.Security.Cryptography.SHA1]::Create()
    try {
        [void]$sha.TransformBlock($header, 0, $header.Length, $null, 0)
        [void]$sha.TransformFinalBlock($Bytes, 0, $Bytes.Length)
        ([BitConverter]::ToString($sha.Hash) -replace '-', '').ToLowerInvariant()
    }
    finally { $sha.Dispose() }
}

Export-ModuleMember -Function Get-WorkingNames, Read-PublicTree, Test-PublicTree, Select-PublicFiles, Get-TrackedFiles, Test-ExportDestination, Test-ExportNames, Find-PrivateCommits,
    Find-PrivateCommitPrefixes, Find-PrivateReferences, Get-PrivateCommits, Save-CommitArchive, Get-GitBlobId
