#Requires -Version 5.1
# Shared helpers for tools/Release. Windows PowerShell 5.1 compatible; keep this file ASCII.
Set-StrictMode -Version 3.0
# The caller's preference does not apply: a module function stops at its first error however the script was started.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# The one table of package ids. The nuget.org ids carry the owner prefix; the assemblies, projects, namespaces and
# _content paths keep the library name.
$script:PackageIds = @{ Core = 'Qyperion.BlazorECharts'; WordCloud = 'Qyperion.BlazorECharts.WordCloud' }
$script:AssemblyNames = @{ Core = 'BlazorECharts'; WordCloud = 'BlazorECharts.WordCloud' }
# Package ids without the prefix are never ours: BlazorEcharts belongs to another owner (ids ignore case), and
# anyone may take BlazorECharts.WordCloud.
$script:UnprefixedPackageIds = @('BlazorECharts', 'BlazorECharts.WordCloud')
$script:ProjectUrl = 'https://github.com/Qyperion/BlazorECharts'
# SPDX expression of everything a package distributes: the MIT library and the bundled third-party JavaScript.
$script:PackageLicenses = @{ Core = 'MIT AND Apache-2.0 AND BSD-3-Clause AND 0BSD'; WordCloud = 'MIT AND ISC' }
# The lowest patch of the target framework: a higher bound forces NU1605/NU1109 on applications pinned to an older patch.
$script:ComponentsWebMinimum = '10.0.0'

function Get-PackageId([ValidateSet('Core', 'WordCloud')][string]$Kind) { $script:PackageIds[$Kind] }

function Get-PackageIds { @($script:PackageIds['Core'], $script:PackageIds['WordCloud']) }

# The assembly and project name; the project is src/<name>/<name>.csproj.
function Get-AssemblyName([ValidateSet('Core', 'WordCloud')][string]$Kind) { $script:AssemblyNames[$Kind] }

function Get-UnprefixedPackageIds { $script:UnprefixedPackageIds }

function Resolve-FullPath([Parameter(Mandatory)][string]$Path) {
    [System.IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)).TrimEnd('\', '/')
}

function Test-PathInside([string]$Path, [string]$Root) {
    $full = (Resolve-FullPath $Path) + '\'
    $base = (Resolve-FullPath $Root) + '\'
    $full.StartsWith($base, [System.StringComparison]::OrdinalIgnoreCase)
}

# Runs a native command with its output in a log file. Throws on a nonzero exit code.
function Invoke-Logged {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [Parameter(Mandatory)][string]$LogPath,
        [hashtable]$Environment = @{},
        [string]$WorkingDirectory = (Get-Location).Path
    )
    $code = Invoke-LoggedProcess @PSBoundParameters
    if ($code -ne 0) {
        Get-Content -LiteralPath $LogPath -Tail 40 | ForEach-Object { Write-Host "  | $_" }
        throw "'$FilePath $($ArgumentList -join ' ')' failed with exit code $code. Log: $LogPath"
    }
}

# Runs a native command with its output in a log file and returns its exit code.
function Invoke-LoggedProcess {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [Parameter(Mandatory)][string]$LogPath,
        [hashtable]$Environment = @{},
        [string]$WorkingDirectory = (Get-Location).Path
    )
    $previous = @{}
    foreach ($name in $Environment.Keys) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name)
        [Environment]::SetEnvironmentVariable($name, $Environment[$name])
    }
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName((Resolve-FullPath $LogPath))) | Out-Null
    "> $FilePath $($ArgumentList -join ' ')" | Set-Content -LiteralPath $LogPath -Encoding UTF8
    Push-Location -LiteralPath $WorkingDirectory
    $savedPreference = $ErrorActionPreference
    try {
        # Native stderr must not become a terminating error in Windows PowerShell.
        $ErrorActionPreference = 'Continue'
        & $FilePath @ArgumentList 2>&1 | ForEach-Object { "$_" } | Add-Content -LiteralPath $LogPath -Encoding UTF8
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $savedPreference
        Pop-Location
        foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name]) }
    }
    $code
}

function Get-BytesSha256([byte[]]$Bytes) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { ([BitConverter]::ToString($sha.ComputeHash($Bytes)) -replace '-', '').ToLowerInvariant() } finally { $sha.Dispose() }
}

function Get-FileSha256([string]$Path) { (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant() }

function Read-ZipEntryBytes([System.IO.Compression.ZipArchiveEntry]$Entry) {
    $stream = $Entry.Open()
    try {
        $memory = New-Object System.IO.MemoryStream
        $stream.CopyTo($memory)
        , $memory.ToArray()
    }
    finally { $stream.Dispose() }
}

function Get-XmlChild([System.Xml.XmlNode]$Node, [string]$Name) {
    $child = $Node.SelectSingleNode("*[local-name()='$Name']")
    if ($null -eq $child) { '' } else { $child.InnerText }
}

function Read-Json([string]$Path) { Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }

function Get-LockPackage([string]$SourceRoot, [string]$Name) {
    $lock = Read-Json (Join-Path $SourceRoot 'schemas/upstream/sources.lock.json')
    $package = @($lock.packages | Where-Object { $_.name -eq $Name })
    if ($package.Count -ne 1) { throw "sources.lock.json has no single entry for $Name." }
    $package[0]
}

# Absolute local paths that must not appear in a distributed file.
function Get-PrivatePathNeedles([string]$SourceRoot, [string[]]$Extra = @()) {
    $root = Resolve-FullPath $SourceRoot
    $needles = New-Object System.Collections.Generic.List[string]
    foreach ($path in @(@($root, $env:USERPROFILE) + @($Extra | ForEach-Object { Resolve-FullPath $_ }))) {
        if ([string]::IsNullOrWhiteSpace($path) -or $path.Length -lt 4) { continue }
        $needles.Add($path)
        $needles.Add($path.Replace('\', '/'))
    }
    , $needles.ToArray()
}

function Find-PrivatePath([byte[]]$Bytes, [string[]]$Needles) {
    # Latin-1 maps bytes one to one, so a string search covers UTF-8/ASCII and, with a UTF-16 needle, UTF-16LE.
    $latin1 = [System.Text.Encoding]::GetEncoding(28591)
    $text = $latin1.GetString($Bytes)
    foreach ($needle in $Needles) {
        if ($text.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return $needle }
        $wide = $latin1.GetString([System.Text.Encoding]::Unicode.GetBytes($needle))
        if ($text.IndexOf($wide, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return "$needle (UTF-16)" }
    }
    $null
}

# Returns the list of failures; an empty list means the package passed.
function Test-NuGetPackage {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][ValidateSet('Core', 'WordCloud')][string]$Kind,
        [Parameter(Mandatory)][string]$SourceRoot,
        [Parameter(Mandatory)][string]$Version,
        [string]$RepositoryUrl,
        [string]$RepositoryCommit,
        # Further absolute paths that must not appear, such as the build output directory.
        [string[]]$PrivatePaths = @()
    )
    $failures = New-Object System.Collections.Generic.List[string]
    $id = Get-PackageId $Kind
    $assembly = Get-AssemblyName $Kind
    $coreId = Get-PackageId Core
    $project = Join-Path $SourceRoot "src/$assembly"
    $zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-FullPath $Path))
    try {
        $entries = @{}
        foreach ($entry in $zip.Entries) { $entries[$entry.FullName] = $entry }

        # Metadata.
        $nuspecEntry = $entries["$id.nuspec"]
        if ($null -eq $nuspecEntry) { $failures.Add("Missing $id.nuspec.") }
        else {
            $nuspecText = [System.Text.Encoding]::UTF8.GetString((Read-ZipEntryBytes $nuspecEntry)).TrimStart([char]0xFEFF)
            [xml]$nuspec = $nuspecText
            $metadata = $nuspec.package.metadata
            $metadataId = Get-XmlChild $metadata 'id'
            $metadataVersion = Get-XmlChild $metadata 'version'
            if ($metadataId -ne $id) { $failures.Add("nuspec id is '$metadataId', expected '$id'.") }
            if ($metadataVersion -ne $Version) { $failures.Add("nuspec version is '$metadataVersion', expected '$Version'.") }
            $license = $metadata.SelectSingleNode("*[local-name()='license']")
            $expectedLicense = $script:PackageLicenses[$Kind]
            if ($null -eq $license -or $license.GetAttribute('type') -cne 'expression' -or $license.InnerText -cne $expectedLicense) {
                $failures.Add("License expression must be '$expectedLicense', found '$(if ($license) { $license.InnerText })'.")
            }
            if ((Get-XmlChild $metadata 'readme') -ne 'README.md') { $failures.Add('Package readme must be README.md.') }
            if ((Get-XmlChild $metadata 'icon') -ne 'icon.png') { $failures.Add('Package icon must be icon.png.') }
            if ((Get-XmlChild $metadata 'projectUrl') -cne $script:ProjectUrl) { $failures.Add("Project URL must be $($script:ProjectUrl).") }
            $tags = @((Get-XmlChild $metadata 'tags') -split '\s+')
            if ($Kind -eq 'WordCloud' -and $tags -cnotcontains 'wordcloud') { $failures.Add("WordCloud tags must include wordcloud, found '$($tags -join ' ')'.") }
            foreach ($name in @('authors', 'description', 'copyright')) {
                if ([string]::IsNullOrWhiteSpace((Get-XmlChild $metadata $name))) { $failures.Add("nuspec $name is empty.") }
            }
            $groups = @($metadata.SelectNodes("*[local-name()='dependencies']/*[local-name()='group']"))
            if ($groups.Count -ne 1 -or $groups[0].GetAttribute('targetFramework') -ne 'net10.0') { $failures.Add('Dependencies must have exactly one net10.0 group.') }
            $dependencies = @{}
            foreach ($dependency in @($metadata.SelectNodes("*[local-name()='dependencies']//*[local-name()='dependency']"))) { $dependencies[$dependency.GetAttribute('id')] = $dependency.GetAttribute('version') }
            if ($Kind -eq 'Core') {
                if ($dependencies['Microsoft.AspNetCore.Components.Web'] -cne $script:ComponentsWebMinimum) {
                    $failures.Add("Core must depend on Microsoft.AspNetCore.Components.Web $($script:ComponentsWebMinimum), found '$($dependencies['Microsoft.AspNetCore.Components.Web'])'.")
                }
                if ($dependencies.ContainsKey((Get-PackageId WordCloud))) { $failures.Add('Core must not depend on WordCloud.') }
            }
            elseif ($dependencies[$coreId] -cne "[$Version]") {
                # The installer needs the ECharts runtime of the same core release.
                $failures.Add("WordCloud must depend on exactly $coreId [$Version], found '$($dependencies[$coreId])'.")
            }
            # The nuspec of a release is immutable: exactly these dependencies and metadata elements, nothing unreviewed.
            $expected = @(if ($Kind -eq 'Core') { "exclude=Build,Analyzers;id=Microsoft.AspNetCore.Components.Web;version=$($script:ComponentsWebMinimum)" }
                else { "exclude=Build,Analyzers;id=$coreId;version=[$Version]" })
            $actual = @($metadata.SelectNodes("*[local-name()='dependencies']//*[local-name()='dependency']") | ForEach-Object {
                @($_.Attributes | ForEach-Object { "$($_.Name)=$($_.Value)" } | Sort-Object) -join ';' })
            foreach ($item in $actual) { if ($expected -cnotcontains $item) { $failures.Add("Unexpected dependency $item; expected exactly $($expected -join ', ').") } }
            foreach ($item in $expected) { if ($actual -cnotcontains $item) { $failures.Add("Missing dependency $item.") } }
            $required = @('id', 'version', 'authors', 'license', 'licenseUrl', 'icon', 'readme', 'projectUrl', 'description', 'copyright', 'tags', 'dependencies') +
                @(if ($RepositoryUrl) { 'releaseNotes', 'repository' })
            $allowed = $required
            $elements = @($metadata.ChildNodes | Where-Object { $_.NodeType -eq [System.Xml.XmlNodeType]::Element } | ForEach-Object { $_.LocalName })
            foreach ($name in $elements) { if ($allowed -cnotcontains $name) { $failures.Add("Unexpected nuspec metadata element $name.") } }
            foreach ($name in $required) { if ($elements -cnotcontains $name) { $failures.Add("Missing nuspec metadata element $name.") } }
            if ($metadata.Attributes.Count -ne 0) { $failures.Add("Unexpected nuspec metadata attributes: $(@($metadata.Attributes | ForEach-Object { $_.Name }) -join ', ').") }
            $repository = $metadata.SelectSingleNode("*[local-name()='repository']")
            if ([string]::IsNullOrEmpty($RepositoryUrl)) {
                if ($null -ne $repository) { $failures.Add('Repository metadata is present, but none was requested; local history must stay private.') }
            }
            elseif ($null -eq $repository -or $repository.GetAttribute('url') -ne $RepositoryUrl -or $repository.GetAttribute('commit') -ne $RepositoryCommit) {
                $failures.Add("Repository metadata must be url '$RepositoryUrl' and commit '$RepositoryCommit'.")
            }
            $releaseNotes = Get-XmlChild $metadata 'releaseNotes'
            if ($RepositoryUrl -and $releaseNotes -cne "See $RepositoryUrl/blob/v$Version/CHANGELOG.md") {
                $failures.Add("Release notes must be 'See $RepositoryUrl/blob/v$Version/CHANGELOG.md', found '$releaseNotes'.")
            }
        }

        # Allowed layout: package plumbing, root documents, net10.0 lib, build props and static web assets.
        $allowed = @('^_rels/\.rels$', '^\[Content_Types\]\.xml$', '^package/services/metadata/core-properties/[0-9a-z]+\.psmdcp$',
            "^$([regex]::Escape($id))\.nuspec$", '^README\.md$', '^LICENSE$', '^THIRD-PARTY-NOTICES\.md$', '^icon\.png$',
            "^lib/net10\.0/$([regex]::Escape($assembly))\.(dll|xml)$",
            "^(build|buildTransitive|buildMultiTargeting)/($([regex]::Escape($id))|Microsoft\.AspNetCore\.StaticWebAsset(s|Endpoints))\.props$",
            '^staticwebassets/')
        foreach ($name in $entries.Keys) {
            if (-not ($allowed | Where-Object { $name -match $_ })) { $failures.Add("Unexpected package entry: $name") }
            if ($name -match '(?i)node_modules|(^|/)docs/|(^|/)plan/|research|\.ts$|tsconfig|\.pdb$') { $failures.Add("Forbidden package entry: $name") }
        }
        foreach ($name in @("lib/net10.0/$assembly.dll", "lib/net10.0/$assembly.xml", 'README.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md', 'icon.png')) {
            if (-not $entries.ContainsKey($name)) { $failures.Add("Missing $name.") }
        }
        if ($entries.ContainsKey("lib/net10.0/$assembly.xml")) {
            $docs = [System.Text.Encoding]::UTF8.GetString((Read-ZipEntryBytes $entries["lib/net10.0/$assembly.xml"]))
            if ($docs -notmatch "<name>$([regex]::Escape($assembly))</name>" -or $docs -notmatch '<member name=') { $failures.Add('XML documentation is empty or belongs to another assembly.') }
        }
        $sources = @{ 'LICENSE' = Join-Path $SourceRoot 'LICENSE'; 'THIRD-PARTY-NOTICES.md' = Join-Path $SourceRoot 'THIRD-PARTY-NOTICES.md'; 'README.md' = Join-Path $project 'README.md'
            'icon.png' = Join-Path $SourceRoot 'src/icon.png' }
        foreach ($name in $sources.Keys) {
            if ($entries.ContainsKey($name) -and (Get-BytesSha256 (Read-ZipEntryBytes $entries[$name])) -ne (Get-FileSha256 $sources[$name])) { $failures.Add("$name differs from its source.") }
        }
        # A released README stays on nuget.org unchanged, so it links to the tree of its own tag, not to a moving branch.
        if ($RepositoryUrl -and $entries.ContainsKey('README.md')) {
            $readme = [System.Text.Encoding]::UTF8.GetString((Read-ZipEntryBytes $entries['README.md']))
            $pattern = "$([regex]::Escape($RepositoryUrl.TrimEnd('/')))/(?:tree|blob)/([^/\s)#]+)"
            foreach ($ref in @([regex]::Matches($readme, $pattern) | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)) {
                if ($ref -cne "v$Version") { $failures.Add("README.md links to the repository at '$ref'; the release $Version links to its tag v$Version.") }
            }
        }

        # Static web assets: exactly the files of the tracked manifest, byte for byte.
        $manifestName = 'staticwebassets/js/assets-manifest.json'
        $sourceManifest = Join-Path $project 'wwwroot/js/assets-manifest.json'
        if (-not $entries.ContainsKey($manifestName)) { $failures.Add("Missing $manifestName.") }
        else {
            $manifestBytes = Read-ZipEntryBytes $entries[$manifestName]
            if ((Get-BytesSha256 $manifestBytes) -ne (Get-FileSha256 $sourceManifest)) { $failures.Add('Packaged assets-manifest.json differs from the tracked manifest.') }
            $manifest = [System.Text.Encoding]::UTF8.GetString($manifestBytes) | ConvertFrom-Json
            $expected = @{ $manifestName = $true }
            foreach ($file in $manifest.files) {
                $name = "staticwebassets/$($file.path)"
                $expected[$name] = $true
                if (-not $entries.ContainsKey($name)) { $failures.Add("Missing asset $($file.path)."); continue }
                $bytes = Read-ZipEntryBytes $entries[$name]
                if ($bytes.Length -ne $file.bytes -or (Get-BytesSha256 $bytes) -ne $file.sha256) { $failures.Add("Asset $($file.path) does not match its manifest hash.") }
            }
            foreach ($name in $entries.Keys) {
                if ($name.StartsWith('staticwebassets/') -and -not $expected.ContainsKey($name)) { $failures.Add("Asset $name is not in the manifest.") }
            }

            $echarts = Get-LockPackage $SourceRoot 'echarts'
            if ($Kind -eq 'Core') {
                $engineName = "staticwebassets/js/echarts-$($echarts.version).js"
                $lockHash = $echarts.files.'dist/echarts.esm.min.mjs'
                if ($manifest.runtime.version -ne $echarts.version) { $failures.Add("Runtime version $($manifest.runtime.version) is not the locked $($echarts.version).") }
                if ($manifest.runtime.sourceSha256 -ne $lockHash -or $manifest.runtime.archiveSha256 -ne $echarts.sha256) { $failures.Add('Runtime hashes in the manifest differ from sources.lock.json.') }
                if (-not $entries.ContainsKey($engineName)) { $failures.Add("Missing ECharts engine $engineName.") }
                elseif ((Get-BytesSha256 (Read-ZipEntryBytes $entries[$engineName])) -ne $lockHash) { $failures.Add("ECharts engine hash differs from sources.lock.json (dist/echarts.esm.min.mjs $lockHash).") }
                foreach ($name in $entries.Keys) { if ($name -match '(?i)wordcloud') { $failures.Add("Core contains WordCloud entry $name.") } }
            }
            else {
                $wordcloud = Get-LockPackage $SourceRoot '@qyperion/echarts-wordcloud'
                if ($manifest.package.version -ne $wordcloud.version -or $manifest.package.sha256 -ne $wordcloud.sha256) { $failures.Add('WordCloud package differs from sources.lock.json.') }
                if ($manifest.coreVersion -ne $echarts.version) { $failures.Add('WordCloud core version differs from the locked ECharts version.') }
                $installer = 'staticwebassets/js/wordcloud-installer.js'
                if (-not $entries.ContainsKey($installer) -or (Get-BytesSha256 (Read-ZipEntryBytes $entries[$installer])) -ne $wordcloud.installer.sha256) { $failures.Add('WordCloud installer differs from sources.lock.json.') }
                foreach ($name in $entries.Keys) { if ($name -match '(?i)echarts-\d|echarts\.esm') { $failures.Add("WordCloud contains a copy of ECharts: $name") } }
            }
        }

        # No absolute local path may leak, for example a PDB path in the assembly.
        $needles = Get-PrivatePathNeedles $SourceRoot $PrivatePaths
        foreach ($name in $entries.Keys) {
            $found = Find-PrivatePath (Read-ZipEntryBytes $entries[$name]) $needles
            if ($found) { $failures.Add("$name contains the private path '$found'.") }
        }
    }
    finally { $zip.Dispose() }
    , $failures.ToArray()
}

# The SourceLink map of a release: the sources mapped to /_/ by PathMap come from the raw files of the release commit.
function Get-SourceLinkJson([Parameter(Mandatory)][string]$RepositoryUrl, [Parameter(Mandatory)][string]$RepositoryCommit) {
    if ($RepositoryUrl -notmatch '^https://github\.com/([A-Za-z0-9-]+/[A-Za-z0-9._-]+?)(?:\.git)?/?$') { throw "SourceLink supports GitHub repositories only, not '$RepositoryUrl'." }
    $repository = $Matches[1]
    if ($RepositoryCommit -notmatch '^[0-9a-f]{40}$') { throw "RepositoryCommit '$RepositoryCommit' is not a full commit id." }
    '{"documents":{"/_/*":"https://raw.githubusercontent.com/' + $repository + '/' + $RepositoryCommit + '/*"}}'
}

# The symbols of a .snupkg as tools/Release/read-symbols.cs writes them: per PDB its documents, SourceLink and the
# text of every embedded source. Windows PowerShell has no portable PDB reader, so a .NET file-based app reads it.
function Read-SymbolPackage([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$WorkPath) {
    $WorkPath = Resolve-FullPath $WorkPath
    [System.IO.Directory]::CreateDirectory($WorkPath) | Out-Null
    $json = Join-Path $WorkPath "$([System.IO.Path]::GetFileName($Path)).json"
    # The repository's global.json selects the SDK.
    Invoke-Logged -FilePath 'dotnet' -LogPath "$json.log" -WorkingDirectory $PSScriptRoot `
        -ArgumentList @('run', '--file', (Join-Path $PSScriptRoot 'read-symbols.cs'), '--', (Resolve-FullPath $Path), $json)
    Read-Json $json
}

function Find-PrivateText([string]$Text, [string[]]$Needles) {
    foreach ($needle in $Needles) { if ($Text.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return $needle } }
    $null
}

# Checks the PDB of a symbol package as Read-SymbolPackage returns it. Fixtures break a real reading, so the checks
# are separate from reading the package.
function Test-Symbols {
    param(
        [Parameter(Mandatory)]$Symbols,
        [Parameter(Mandatory)][ValidateSet('Core', 'WordCloud')][string]$Kind,
        [string[]]$Needles = @(),
        [string]$RepositoryUrl,
        [string]$RepositoryCommit
    )
    $failures = New-Object System.Collections.Generic.List[string]
    $expected = "lib/net10.0/$(Get-AssemblyName $Kind).pdb"
    $pdbs = @($Symbols.pdbs)
    if ($pdbs.Count -ne 1 -or $pdbs[0].path -cne $expected) { $failures.Add("The symbol package must hold exactly one PDB, $expected."); return , $failures.ToArray() }
    $pdb = $pdbs[0]
    $embedded = @{}
    foreach ($source in @($pdb.embedded)) { $embedded[$source.document] = $source.text }
    # PathMap maps the sources to /_/ and the build output to /_build/; SourceLink reaches only /_/, so the
    # generated sources of the build output must travel inside the PDB.
    foreach ($document in @($pdb.documents)) {
        if ($document -notmatch '^/_(build)?/') { $failures.Add("Document $document is not mapped to /_/ or /_build/.") }
        elseif ($document.StartsWith('/_build/') -and -not $embedded.ContainsKey($document)) { $failures.Add("Generated document $document is not embedded.") }
        $found = Find-PrivateText $document $Needles
        if ($found) { $failures.Add("Document $document contains the private path '$found'.") }
    }
    foreach ($document in $embedded.Keys) {
        $found = Find-PrivateText $embedded[$document] $Needles
        if ($found) { $failures.Add("Embedded source $document contains the private path '$found'.") }
    }
    if ([string]::IsNullOrEmpty($RepositoryUrl)) {
        if ($null -ne $pdb.sourceLink) { $failures.Add('SourceLink is present, but no repository was requested; local history must stay private.') }
    }
    else {
        $sourceLink = Get-SourceLinkJson $RepositoryUrl $RepositoryCommit
        if ($pdb.sourceLink -cne $sourceLink) { $failures.Add("SourceLink must be $sourceLink, found '$($pdb.sourceLink)'.") }
    }
    , $failures.ToArray()
}

# Returns the list of failures of a .snupkg; an empty list means the symbol package passed.
function Test-SymbolPackage {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][ValidateSet('Core', 'WordCloud')][string]$Kind,
        [Parameter(Mandatory)][string]$SourceRoot,
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][string]$WorkPath,
        [string]$RepositoryUrl,
        [string]$RepositoryCommit,
        [string[]]$PrivatePaths = @()
    )
    $failures = New-Object System.Collections.Generic.List[string]
    $id = Get-PackageId $Kind
    $needles = Get-PrivatePathNeedles $SourceRoot $PrivatePaths
    $zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-FullPath $Path))
    try {
        $entries = @{}
        foreach ($entry in $zip.Entries) { $entries[$entry.FullName] = $entry }
        $allowed = @('^_rels/\.rels$', '^\[Content_Types\]\.xml$', '^package/services/metadata/core-properties/[0-9a-z]+\.psmdcp$',
            "^$([regex]::Escape($id))\.nuspec$", "^lib/net10\.0/$([regex]::Escape((Get-AssemblyName $Kind)))\.pdb$")
        foreach ($name in $entries.Keys) { if (-not ($allowed | Where-Object { $name -match $_ })) { $failures.Add("Unexpected symbol package entry: $name") } }
        $nuspecEntry = $entries["$id.nuspec"]
        if ($null -eq $nuspecEntry) { $failures.Add("Missing $id.nuspec in the symbol package.") }
        else {
            [xml]$nuspec = [System.Text.Encoding]::UTF8.GetString((Read-ZipEntryBytes $nuspecEntry)).TrimStart([char]0xFEFF)
            $metadata = $nuspec.package.metadata
            if ((Get-XmlChild $metadata 'id') -ne $id -or (Get-XmlChild $metadata 'version') -ne $Version) { $failures.Add("The symbol package must be $id $Version.") }
            $types = @($metadata.SelectNodes("*[local-name()='packageTypes']/*[local-name()='packageType']") | ForEach-Object { $_.GetAttribute('name') })
            if (($types -join ',') -cne 'SymbolsPackage') { $failures.Add("The symbol package type must be SymbolsPackage, found '$($types -join ',')'.") }
        }
        foreach ($name in $entries.Keys) {
            $found = Find-PrivatePath (Read-ZipEntryBytes $entries[$name]) $needles
            if ($found) { $failures.Add("$name contains the private path '$found'.") }
        }
    }
    finally { $zip.Dispose() }
    $symbols = Read-SymbolPackage -Path $Path -WorkPath $WorkPath
    foreach ($failure in (Test-Symbols -Symbols $symbols -Kind $Kind -Needles $needles -RepositoryUrl $RepositoryUrl -RepositoryCommit $RepositoryCommit)) { $failures.Add($failure) }
    , $failures.ToArray()
}

# Consumers may reference their own projects, never the library sources.
function Test-PackageOnlyConsumer {
    param([Parameter(Mandatory)][string]$ConsumerRoot)
    $failures = New-Object System.Collections.Generic.List[string]
    $projects = @(Get-ChildItem -LiteralPath $ConsumerRoot -Recurse -Filter *.csproj | Where-Object { $_.FullName -notmatch '\\(bin|obj)\\' })
    if ($projects.Count -eq 0) { $failures.Add("No consumer projects under $ConsumerRoot.") }
    foreach ($project in $projects) {
        [xml]$xml = Get-Content -LiteralPath $project.FullName -Raw
        foreach ($reference in @($xml.SelectNodes('//ProjectReference'))) {
            $include = $reference.GetAttribute('Include')
            $target = if ([System.IO.Path]::IsPathRooted($include)) { $include } else { Join-Path $project.DirectoryName $include }
            if (-not (Test-PathInside $target $ConsumerRoot) -or $include -match '(?i)BlazorECharts') {
                $failures.Add("$($project.Name) uses ProjectReference '$include'; consumers must use PackageReference only.")
            }
        }
        foreach ($reference in @($xml.SelectNodes('//PackageReference'))) {
            $include = $reference.GetAttribute('Include')
            if ($script:UnprefixedPackageIds -contains $include) { $failures.Add("$($project.Name) references the package '$include' without the owner prefix; use $((Get-PackageIds) -join ' or ').") }
            elseif ((Get-PackageIds) -contains $include -and $reference.GetAttribute('Version') -ne '$(BlazorEChartsVersion)') {
                $failures.Add("$($project.Name) must reference $include with Version=`"`$(BlazorEChartsVersion)`".")
            }
        }
        foreach ($reference in @($xml.SelectNodes('//Reference') | Where-Object { $_.GetAttribute('Include') -like '*BlazorECharts*' })) {
            $failures.Add("$($project.Name) uses an assembly Reference to $($reference.GetAttribute('Include')).")
        }
    }
    , $failures.ToArray()
}

# The restored graph must take every library package from the local feed at the expected version. A library
# named like an assembly is either the source project or a package that is not ours.
function Test-ConsumerRestore {
    param([Parameter(Mandatory)][string]$AssetsFile, [Parameter(Mandatory)][string]$Version, [string[]]$Packages = @((Get-PackageId Core)))
    $failures = New-Object System.Collections.Generic.List[string]
    $assets = Read-Json $AssetsFile
    $libraries = @((Get-PackageIds) + $script:UnprefixedPackageIds)
    foreach ($property in $assets.libraries.PSObject.Properties) {
        $name = $property.Name.Split('/')[0]
        if ($libraries -notcontains $name) { continue }
        if ($property.Value.type -ne 'package') { $failures.Add("$($property.Name) resolved as '$($property.Value.type)', not as a package.") }
        elseif ($script:UnprefixedPackageIds -contains $name) { $failures.Add("$($property.Name) is the package $name without the owner prefix, not ours.") }
        elseif ($property.Name.Split('/')[1] -ne $Version) { $failures.Add("$($property.Name) is not version $Version.") }
    }
    foreach ($package in $Packages) {
        if (-not ($assets.libraries.PSObject.Properties.Name -contains "$package/$Version")) { $failures.Add("$package/$Version is not in the restored graph.") }
    }
    , $failures.ToArray()
}

# A NuGet.Config that maps the library packages to the local feed only and keeps a private package cache.
function Write-ConsumerNuGetConfig {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$FeedPath, [Parameter(Mandatory)][string]$CachePath)
    $escapedFeed = [System.Security.SecurityElement]::Escape($FeedPath)
    $escapedCache = [System.Security.SecurityElement]::Escape($CachePath)
    $patterns = @(Get-PackageIds | ForEach-Object { "      <package pattern=`"$_`" />" }) -join "`r`n"
    Set-Content -LiteralPath $Path -Encoding UTF8 -Value @"
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <config>
    <add key="globalPackagesFolder" value="$escapedCache" />
  </config>
  <packageSources>
    <clear />
    <add key="blazorecharts-local" value="$escapedFeed" />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
  </packageSources>
  <packageSourceMapping>
    <packageSource key="blazorecharts-local">
$patterns
    </packageSource>
    <packageSource key="nuget.org">
      <package pattern="*" />
    </packageSource>
  </packageSourceMapping>
  <fallbackPackageFolders>
    <clear />
  </fallbackPackageFolders>
</configuration>
"@
}

# A cached package with the same version would hide a changed nupkg.
function Reset-PackageCache([Parameter(Mandatory)][string]$CachePath) {
    [System.IO.Directory]::CreateDirectory($CachePath) | Out-Null
    foreach ($id in (Get-PackageIds)) {
        $cached = Join-Path $CachePath $id.ToLowerInvariant()
        if (Test-Path -LiteralPath $cached) { Remove-Item -LiteralPath $cached -Recurse -Force }
    }
}

# Copies the tracked consumer sources; untracked and ignored files stay behind. -Include limits the copy to these top-level entries.
function Copy-ConsumerTemplate {
    param([Parameter(Mandatory)][string]$Template, [Parameter(Mandatory)][string]$Destination, [string[]]$Include = @())
    # ls-files in a subdirectory lists paths relative to it; -z keeps names with spaces or quotes verbatim.
    $files = @((Invoke-GitCommand $Template @('ls-files', '-z', '--', '.')) -join "`n" -split "`0" | Where-Object { $_ -ne '' })
    if ($files.Count -eq 0) { throw "$Template has no tracked consumer files." }
    foreach ($relative in $files) {
        if ($Include.Count -ne 0 -and -not ($Include -contains $relative.Split('/')[0])) { continue }
        $target = Join-Path $Destination $relative
        [System.IO.Directory]::CreateDirectory((Split-Path $target)) | Out-Null
        Copy-Item -LiteralPath (Join-Path $Template $relative) -Destination $target
    }
}

# The cached package must be the feed's file, not an older or remote package with the same id.
function Test-CachedPackage {
    param([Parameter(Mandatory)][string]$CachePath, [Parameter(Mandatory)][string]$FeedPath, [Parameter(Mandatory)][string]$Version, [string[]]$Packages)
    $failures = New-Object System.Collections.Generic.List[string]
    foreach ($id in $Packages) {
        $metadataPath = Join-Path $CachePath "$($id.ToLowerInvariant())/$Version/.nupkg.metadata"
        if (-not (Test-Path -LiteralPath $metadataPath)) { $failures.Add("$id $Version is not in the private cache."); continue }
        $metadata = Read-Json $metadataPath
        $sha = [System.Security.Cryptography.SHA512]::Create()
        try { $sha512 = [Convert]::ToBase64String($sha.ComputeHash([System.IO.File]::ReadAllBytes((Join-Path $FeedPath "$id.$Version.nupkg")))) } finally { $sha.Dispose() }
        if ($metadata.source.TrimEnd('\') -ne $FeedPath) { $failures.Add("$id was restored from '$($metadata.source)', not from the local feed.") }
        if ($metadata.contentHash -ne $sha512) { $failures.Add("$id in the cache differs from the feed package.") }
    }
    , $failures.ToArray()
}

# Trim analysis warnings from a build or publish log, one entry per distinct warning.
function Get-TrimWarnings([Parameter(Mandatory)][string]$LogPath) {
    $seen = @{}
    $warnings = New-Object System.Collections.Generic.List[object]
    foreach ($line in (Get-Content -LiteralPath $LogPath -Encoding UTF8)) {
        if ($line -notmatch '\bwarning (IL\d{4}):\s*(.*)$') { continue }
        $code = $Matches[1]
        # MSBuild appends the project path; the location before the code is kept only as an origin hint.
        $text = ($Matches[2] -replace '\s*\[[^\]]+\.csproj\]\s*$', '').Trim()
        $location = ($line.Substring(0, $line.IndexOf("warning $code")) -replace '(Trim analysis|AOT analysis)\s*$', '').Trim(' ', ':')
        $key = "$code|$text"
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true
        $warnings.Add([pscustomobject]@{ Code = $code; Text = $text; Location = $location })
    }
    , $warnings.ToArray()
}

# A warning that names a BlazorECharts member or points into the packaged sources (PathMap /_/) fails.
# A third-party warning passes only when the explained list (code plus a message pattern) covers it;
# anything else fails as unexplained. The location is not matched by name: work paths may contain the repository name.
function Test-TrimWarnings {
    param([object[]]$Warnings = @(), [object[]]$Known = @())
    $failures = New-Object System.Collections.Generic.List[string]
    foreach ($warning in $Warnings) {
        if ($warning.Text -match '\bBlazorECharts\b' -or $warning.Location -match '^/_/') { $failures.Add("Own $($warning.Code): $($warning.Text)"); continue }
        $explained = @($Known | Where-Object { $_.code -eq $warning.Code -and $warning.Text -match $_.pattern })
        if ($explained.Count -eq 0) { $failures.Add("Unexplained $($warning.Code): $($warning.Text)") }
    }
    , $failures.ToArray()
}

function Write-Failures([string]$Title, [string[]]$Failures) {
    if ($Failures.Count -eq 0) { Write-Host "PASS $Title"; return }
    Write-Host "FAIL $Title"
    foreach ($failure in $Failures) { Write-Host "  - $failure" }
}

# Runs git in a repository and returns its standard output as an array, also for one line or none.
# Standard error never mixes into the result; a nonzero exit code throws with it.
function Invoke-GitCommand([Parameter(Mandatory)][string]$Root, [string[]]$Arguments = @()) {
    $errors = [System.IO.Path]::GetTempFileName()
    $saved = $ErrorActionPreference
    try {
        # Native stderr must not become a terminating error in Windows PowerShell.
        $ErrorActionPreference = 'Continue'
        $output = @(& git -C $Root @Arguments 2> $errors | ForEach-Object { "$_" })
        $code = $LASTEXITCODE
        $message = (Get-Content -LiteralPath $errors -Raw) -replace '\s+', ' '
    }
    finally {
        $ErrorActionPreference = $saved
        Remove-Item -LiteralPath $errors -Force -ErrorAction SilentlyContinue
    }
    if ($code -ne 0) { throw "git $($Arguments -join ' ') in $Root failed with exit code ${code}: $message" }
    , $output
}

$script:OutputMarker = '.blazorecharts-output'

# The tools replace entries only in a directory they own: a new or empty one gets the marker file, a
# marked one is reused. Anything else is refused, so a wrong argument cannot delete foreign data.
function Initialize-OutputDirectory([Parameter(Mandatory)][string]$Path) {
    $Path = Resolve-FullPath $Path
    $marker = Join-Path $Path $script:OutputMarker
    if (Test-Path -LiteralPath $Path -PathType Leaf) { throw "Output directory $Path is a file." }
    if (Test-Path -LiteralPath $Path) {
        if (-not (Test-Path -LiteralPath $marker -PathType Leaf) -and @(Get-ChildItem -LiteralPath $Path -Force).Count -ne 0) {
            throw "Output directory $Path is not empty and has no $($script:OutputMarker) file, so the release tools did not create it. Pass a new or empty directory."
        }
    }
    else { [System.IO.Directory]::CreateDirectory($Path) | Out-Null }
    Set-Content -LiteralPath $marker -Encoding ASCII -Value 'Created by tools/Release. The tools may replace every entry of this directory.'
    $Path
}

# Removes every entry of an owned output directory except its marker.
function Clear-OutputDirectory([Parameter(Mandatory)][string]$Path) {
    $Path = Initialize-OutputDirectory $Path
    foreach ($entry in @(Get-ChildItem -LiteralPath $Path -Force | Where-Object { $_.Name -ne $script:OutputMarker })) {
        Remove-Item -LiteralPath $entry.FullName -Recurse -Force
    }
    $Path
}

# Removes the named entries of an owned output directory and creates the named subdirectories empty.
function Reset-OutputEntries([Parameter(Mandatory)][string]$Path, [string[]]$Remove = @(), [string[]]$Create = @()) {
    $Path = Initialize-OutputDirectory $Path
    foreach ($name in @($Remove + $Create)) {
        $entry = Join-Path $Path $name
        if (Test-Path -LiteralPath $entry) { Remove-Item -LiteralPath $entry -Recurse -Force }
    }
    foreach ($name in $Create) { [System.IO.Directory]::CreateDirectory((Join-Path $Path $name)) | Out-Null }
    $Path
}

# Path and size of every blob in HEAD.
function Get-HeadBlobSizes([Parameter(Mandatory)][string]$SourceRoot) {
    $lines = Invoke-GitCommand $SourceRoot @('-c', 'core.quotepath=off', 'ls-tree', '-r', '-l', '--full-tree', 'HEAD')
    , @($lines | ForEach-Object {
        if ($_ -notmatch '^\d{6} (\w+) [0-9a-f]{40} +(\S+)\t(.+)$') { throw "Unexpected ls-tree line: $_" }
        if ($Matches[1] -eq 'blob') { [pscustomobject]@{ path = $Matches[3]; bytes = [long]$Matches[2] } }
    })
}

# GitHub rejects blobs over 100 MiB and warns over 50 MiB; a pushable public tree stays at or under 50 MiB.
function Test-BlobSizes([object[]]$Blobs, [long]$Limit = 52428800) {
    , @(@($Blobs) | Where-Object { $_ -and $_.bytes -gt $Limit } |
        ForEach-Object { "Tracked file $($_.path) has $($_.bytes) bytes, over the $Limit-byte limit of a GitHub push; split or shrink it." })
}

Export-ModuleMember -Function Get-PackageId, Get-PackageIds, Get-AssemblyName, Get-UnprefixedPackageIds, Get-SourceLinkJson, Read-SymbolPackage, Test-Symbols,
    Test-SymbolPackage, Resolve-FullPath, Test-PathInside, Invoke-Logged, Invoke-LoggedProcess, Get-BytesSha256, Get-FileSha256,
    Read-ZipEntryBytes, Read-Json, Get-LockPackage, Test-NuGetPackage, Test-PackageOnlyConsumer, Test-ConsumerRestore, Write-Failures,
    Write-ConsumerNuGetConfig, Reset-PackageCache, Copy-ConsumerTemplate, Test-CachedPackage, Get-TrimWarnings, Test-TrimWarnings,
    Get-HeadBlobSizes, Test-BlobSizes, Invoke-GitCommand, Initialize-OutputDirectory, Clear-OutputDirectory, Reset-OutputEntries
