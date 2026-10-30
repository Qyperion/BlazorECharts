#Requires -Version 5.1
<#
.SYNOPSIS
RED fixtures for the release tools: each one breaks a real package or consumer and requires the
matching check to reject it. Exits with 1 when a broken input is accepted.
#>
param(
    [Parameter(Mandatory)][string]$SourceRoot,
    [Parameter(Mandatory)][string]$FeedPath,
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][string]$WorkPath
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'ReleaseTools.psm1') -Force

function Edit-PackageCopy([string]$Name, [scriptblock]$Edit, [ValidateSet('Core', 'WordCloud')][string]$Kind = 'Core') {
    $copy = Join-Path $WorkPath "$Name.nupkg"
    Copy-Item -LiteralPath (Join-Path $FeedPath "$(Get-PackageId $Kind).$Version.nupkg") -Destination $copy -Force
    $zip = [System.IO.Compression.ZipFile]::Open($copy, [System.IO.Compression.ZipArchiveMode]::Update)
    try { & $Edit $zip } finally { $zip.Dispose() }
    $copy
}
function Set-ZipEntry([System.IO.Compression.ZipArchive]$Zip, [string]$Name, [byte[]]$Bytes) {
    $Zip.GetEntry($Name).Delete()
    $stream = $Zip.CreateEntry($Name).Open()
    try { $stream.Write($Bytes, 0, $Bytes.Length) } finally { $stream.Dispose() }
}
# Rewrites the nuspec of a package copy; the edit receives its metadata node.
function Edit-NuspecCopy([string]$Name, [ValidateSet('Core', 'WordCloud')][string]$Kind, [scriptblock]$EditMetadata) {
    $entry = "$(Get-PackageId $Kind).nuspec"
    Edit-PackageCopy $Name -Kind $Kind -Edit {
        param($zip)
        [xml]$nuspec = [System.Text.Encoding]::UTF8.GetString((Read-ZipEntryBytes $zip.GetEntry($entry))).TrimStart([char]0xFEFF)
        & $EditMetadata $nuspec.package.metadata
        Set-ZipEntry $zip $entry ([System.Text.Encoding]::UTF8.GetBytes($nuspec.OuterXml))
    }
}
function Assert-Rejected([string]$Name, [string[]]$Failures, [string]$Pattern) {
    if (@($Failures | Where-Object { $_ -match $Pattern }).Count -gt 0) { Write-Host "PASS $Name"; return $true }
    Write-Host "FAIL $Name was not rejected with /$Pattern/. Failures: $($Failures -join ' | ')"
    $false
}

try {
    $SourceRoot = Resolve-FullPath $SourceRoot
    $WorkPath = Initialize-OutputDirectory $WorkPath
    $results = @()
    $engine = "staticwebassets/js/echarts-$((Get-LockPackage $SourceRoot 'echarts').version).js"
    $coreId = Get-PackageId Core

    $missing = Edit-PackageCopy 'missing-runtime' { param($zip) $zip.GetEntry($engine).Delete() }
    $results += Assert-Rejected 'MissingRuntimeAssetFailsInspection' `
        (Test-NuGetPackage -Path $missing -Kind Core -SourceRoot $SourceRoot -Version $Version) 'Missing (asset|ECharts engine).*echarts-'

    # The tampered engine also gets a self-consistent manifest, so only the source lock can reject it.
    $tampered = Edit-PackageCopy 'wrong-engine' {
        param($zip)
        $original = Read-ZipEntryBytes $zip.GetEntry($engine)
        $suffix = [System.Text.Encoding]::UTF8.GetBytes("`n// tampered`n")
        $bytes = New-Object byte[] ($original.Length + $suffix.Length)
        [Array]::Copy($original, $bytes, $original.Length)
        [Array]::Copy($suffix, 0, $bytes, $original.Length, $suffix.Length)
        $hash = Get-BytesSha256 $bytes
        $manifestName = 'staticwebassets/js/assets-manifest.json'
        $manifest = [System.Text.Encoding]::UTF8.GetString((Read-ZipEntryBytes $zip.GetEntry($manifestName))) | ConvertFrom-Json
        $manifest.runtime.sourceSha256 = $hash
        foreach ($file in $manifest.files) { if ("staticwebassets/$($file.path)" -eq $engine) { $file.sha256 = $hash; $file.bytes = $bytes.Length } }
        Set-ZipEntry $zip $engine $bytes
        Set-ZipEntry $zip $manifestName ([System.Text.Encoding]::UTF8.GetBytes(($manifest | ConvertTo-Json -Depth 5)))
    }
    $results += Assert-Rejected 'WrongEngineHashFailsInspection' `
        (Test-NuGetPackage -Path $tampered -Kind Core -SourceRoot $SourceRoot -Version $Version) 'sources\.lock\.json'

    # NuGet reads a bare version as ">= version": a newer core with another ECharts would satisfy it.
    $openRange = Edit-NuspecCopy 'wordcloud-open-core-range' WordCloud {
        param($metadata)
        $metadata.SelectSingleNode("*[local-name()='dependencies']//*[local-name()='dependency'][@id='$coreId']").SetAttribute('version', $Version)
    }
    $results += Assert-Rejected 'WordCloudOpenCoreRangeFailsInspection' `
        (Test-NuGetPackage -Path $openRange -Kind WordCloud -SourceRoot $SourceRoot -Version $Version) "must depend on exactly $([regex]::Escape($coreId)) \[$([regex]::Escape($Version))\]"

    # The ids carry the owner prefix: BlazorEcharts on nuget.org (ids ignore case) is another owner's package.
    $unprefixed = Edit-NuspecCopy 'core-unprefixed-id' Core { param($metadata) $metadata.SelectSingleNode("*[local-name()='id']").InnerText = 'BlazorECharts' }
    $results += Assert-Rejected 'CoreUnprefixedIdFailsInspection' `
        (Test-NuGetPackage -Path $unprefixed -Kind Core -SourceRoot $SourceRoot -Version $Version) "^nuspec id is 'BlazorECharts', expected '$([regex]::Escape($coreId))'\."
    $unprefixedCore = Edit-NuspecCopy 'wordcloud-unprefixed-core' WordCloud {
        param($metadata)
        $metadata.SelectSingleNode("*[local-name()='dependencies']//*[local-name()='dependency'][@id='$coreId']").SetAttribute('id', 'BlazorECharts')
    }
    $results += Assert-Rejected 'WordCloudUnprefixedCoreDependencyFailsInspection' `
        (Test-NuGetPackage -Path $unprefixedCore -Kind WordCloud -SourceRoot $SourceRoot -Version $Version) '^Unexpected dependency .*id=BlazorECharts;'

    $newerPatch = Edit-NuspecCopy 'core-components-web-newer-patch' Core {
        param($metadata)
        $metadata.SelectSingleNode("*[local-name()='dependencies']//*[local-name()='dependency'][@id='Microsoft.AspNetCore.Components.Web']").SetAttribute('version', '10.0.13')
    }
    $results += Assert-Rejected 'CoreComponentsWebAboveMinimumFailsInspection' `
        (Test-NuGetPackage -Path $newerPatch -Kind Core -SourceRoot $SourceRoot -Version $Version) 'must depend on Microsoft\.AspNetCore\.Components\.Web 10\.0\.0, found ''10\.0\.13'''

    # A stray PackageReference, a changed exclude or a new metadata element would enter the immutable nuspec unreviewed.
    foreach ($kind in @('Core', 'WordCloud')) {
        $extra = Edit-NuspecCopy "$($kind.ToLowerInvariant())-extra-dependency" $kind {
            param($metadata)
            $group = $metadata.SelectSingleNode("*[local-name()='dependencies']/*[local-name()='group']")
            $dependency = $group.OwnerDocument.CreateElement('dependency', $group.NamespaceURI)
            $dependency.SetAttribute('id', 'Newtonsoft.Json'); $dependency.SetAttribute('version', '13.0.3'); $dependency.SetAttribute('exclude', 'Build,Analyzers')
            [void]$group.AppendChild($dependency)
        }
        $results += Assert-Rejected "${kind}ExtraDependencyFailsInspection" `
            (Test-NuGetPackage -Path $extra -Kind $kind -SourceRoot $SourceRoot -Version $Version) '^Unexpected dependency .*Newtonsoft\.Json'
    }
    $exclude = Edit-NuspecCopy 'core-changed-exclude' Core {
        param($metadata)
        $metadata.SelectSingleNode("*[local-name()='dependencies']//*[local-name()='dependency']").SetAttribute('exclude', 'Build')
    }
    $results += Assert-Rejected 'CoreChangedExcludeFailsInspection' `
        (Test-NuGetPackage -Path $exclude -Kind Core -SourceRoot $SourceRoot -Version $Version) '^Unexpected dependency .*exclude=Build;'
    foreach ($element in @('developmentDependency', 'frameworkReferences')) {
        $added = Edit-NuspecCopy "core-$($element.ToLowerInvariant())" Core {
            param($metadata)
            $node = $metadata.OwnerDocument.CreateElement($element, $metadata.NamespaceURI)
            if ($element -eq 'developmentDependency') { $node.InnerText = 'true' }
            else {
                $group = $node.AppendChild($metadata.OwnerDocument.CreateElement('group', $metadata.NamespaceURI))
                $group.SetAttribute('targetFramework', 'net10.0')
                $reference = $group.AppendChild($metadata.OwnerDocument.CreateElement('frameworkReference', $metadata.NamespaceURI))
                $reference.SetAttribute('name', 'Microsoft.AspNetCore.App')
            }
            [void]$metadata.AppendChild($node)
        }
        $results += Assert-Rejected "CoreMetadata$($element.Substring(0, 1).ToUpperInvariant() + $element.Substring(1))FailsInspection" `
            (Test-NuGetPackage -Path $added -Kind Core -SourceRoot $SourceRoot -Version $Version) "^Unexpected nuspec metadata element $element\."
    }

    # The README of a release links to the docs of its own tag; the working README names the next release.
    $release = Test-NuGetPackage -Path (Join-Path $FeedPath "$coreId.$Version.nupkg") -Kind Core -SourceRoot $SourceRoot -Version '9.9.9' `
        -RepositoryUrl 'https://github.com/Qyperion/BlazorECharts' -RepositoryCommit '0123456789abcdef0123456789abcdef01234567'
    $results += Assert-Rejected 'ReleaseReadmeLinkedToAnotherVersionFailsInspection' $release "^README\.md links to the repository at 'v[^']+'; the release 9\.9\.9 links to its tag v9\.9\.9\."

    # Symbols: each fixture breaks a fresh reading of the real core symbol package.
    $symbolsJson = Join-Path $WorkPath 'symbols'
    Read-SymbolPackage -Path (Join-Path $FeedPath "$coreId.$Version.snupkg") -WorkPath $symbolsJson | Out-Null
    # The fixtures start from the local form of the symbols: a release feed also carries its SourceLink.
    $readSymbols = {
        $read = Read-Json (Join-Path $symbolsJson "$coreId.$Version.snupkg.json")
        $read.pdbs[0].sourceLink = $null
        $read
    }
    $needles = @($SourceRoot, $SourceRoot.Replace('\', '/'))
    [string[]]$baseline = Test-Symbols -Symbols (& $readSymbols) -Kind Core -Needles $needles
    if ($baseline.Count -eq 0) { Write-Host 'PASS RealSymbolsPassInspection'; $results += $true }
    else { Write-Host "FAIL RealSymbolsPassInspection: $($baseline -join ' | ')"; $results += $false }
    $symbols = & $readSymbols
    $symbols.pdbs[0].embedded[0].text += "`n#line 1 `"$SourceRoot\src\BlazorECharts\EChart.razor`""
    $results += Assert-Rejected 'SymbolsEmbeddedPrivatePathFailsInspection' (Test-Symbols -Symbols $symbols -Kind Core -Needles $needles) '^Embedded source /_build/.* contains the private path'
    $symbols = & $readSymbols
    $symbols.pdbs[0].documents += "$SourceRoot\src\BlazorECharts\EChart.razor"
    $results += Assert-Rejected 'SymbolsUnmappedDocumentFailsInspection' (Test-Symbols -Symbols $symbols -Kind Core -Needles $needles) '^Document .*EChart\.razor is not mapped to /_/ or /_build/\.'
    $symbols = & $readSymbols
    $symbols.pdbs[0].documents += '/_build/obj/BlazorECharts/release/Generated.g.cs'
    $results += Assert-Rejected 'SymbolsUnembeddedGeneratedSourceFailsInspection' (Test-Symbols -Symbols $symbols -Kind Core -Needles $needles) '^Generated document /_build/obj/BlazorECharts/release/Generated\.g\.cs is not embedded\.'
    $repository = 'https://github.com/Qyperion/BlazorECharts'
    $symbols = & $readSymbols
    $symbols.pdbs[0].sourceLink = Get-SourceLinkJson $repository 'fedcba9876543210fedcba9876543210fedcba98'
    $results += Assert-Rejected 'SymbolsSourceLinkOfAnotherCommitFailsInspection' `
        (Test-Symbols -Symbols $symbols -Kind Core -Needles $needles -RepositoryUrl $repository -RepositoryCommit '0123456789abcdef0123456789abcdef01234567') '^SourceLink must be .*/0123456789abcdef0123456789abcdef01234567/\*'
    $results += Assert-Rejected 'SymbolsSourceLinkWithoutRepositoryFailsInspection' (Test-Symbols -Symbols $symbols -Kind Core -Needles $needles) 'local history must stay private'

    # Both packages distribute third-party code under other licenses; a bare MIT expression hides them.
    foreach ($kind in @('Core', 'WordCloud')) {
        $mitOnly = Edit-NuspecCopy "$($kind.ToLowerInvariant())-mit-only-license" $kind {
            param($metadata)
            $metadata.SelectSingleNode("*[local-name()='license']").InnerText = 'MIT'
        }
        $results += Assert-Rejected "${kind}MitOnlyLicenseFailsInspection" `
            (Test-NuGetPackage -Path $mitOnly -Kind $kind -SourceRoot $SourceRoot -Version $Version) '^License expression must be '
    }

    $consumer = Join-Path $WorkPath 'project-reference'
    if (Test-Path -LiteralPath $consumer) { Remove-Item -LiteralPath $consumer -Recurse -Force }
    New-Item -ItemType Directory -Path $consumer | Out-Null
    $project = Join-Path $consumer 'Server.csproj'
    Copy-Item -LiteralPath (Join-Path $SourceRoot 'tests/PackageConsumer/Server/Server.csproj') -Destination $project
    $text = (Get-Content -LiteralPath $project -Raw).Replace('</Project>',
        "  <ItemGroup>`n    <ProjectReference Include=`"$SourceRoot\src\BlazorECharts\BlazorECharts.csproj`" />`n  </ItemGroup>`n</Project>")
    Set-Content -LiteralPath $project -Value $text -Encoding UTF8
    $assets = Join-Path $consumer 'project.assets.json'
    Set-Content -LiteralPath $assets -Encoding UTF8 -Value (@{ libraries = @{ "BlazorECharts/$Version" = @{ type = 'project'; path = '../../src/BlazorECharts/BlazorECharts.csproj' } } } | ConvertTo-Json -Depth 4)
    $results += Assert-Rejected 'PackageConsumerCannotUseProjectReference' @(
        (Test-PackageOnlyConsumer -ConsumerRoot $consumer) + (Test-ConsumerRestore -AssetsFile $assets -Version $Version)) 'ProjectReference'
    $results += Assert-Rejected 'PackageConsumerCannotRestoreProject' (Test-ConsumerRestore -AssetsFile $assets -Version $Version) "resolved as 'project'"

    $foreign = Join-Path $WorkPath 'foreign-package'
    if (Test-Path -LiteralPath $foreign) { Remove-Item -LiteralPath $foreign -Recurse -Force }
    New-Item -ItemType Directory -Path $foreign | Out-Null
    $project = Join-Path $foreign 'Server.csproj'
    $text = (Get-Content -LiteralPath (Join-Path $SourceRoot 'tests/PackageConsumer/Server/Server.csproj') -Raw).Replace("Include=`"$coreId`"", 'Include="BlazorEcharts"')
    Set-Content -LiteralPath $project -Value $text -Encoding UTF8
    $results += Assert-Rejected 'PackageConsumerCannotReferenceUnprefixedId' (Test-PackageOnlyConsumer -ConsumerRoot $foreign) "references the package 'BlazorEcharts' without the owner prefix"
    $assets = Join-Path $foreign 'project.assets.json'
    Set-Content -LiteralPath $assets -Encoding UTF8 -Value (@{ libraries = @{ 'BlazorEcharts/1.0.3' = @{ type = 'package'; path = 'blazorecharts/1.0.3' }
        "$coreId/$Version" = @{ type = 'package'; path = "$($coreId.ToLowerInvariant())/$Version" } } } | ConvertTo-Json -Depth 4)
    $results += Assert-Rejected 'PackageConsumerCannotRestoreUnprefixedId' (Test-ConsumerRestore -AssetsFile $assets -Version $Version) '^BlazorEcharts/1\.0\.3 is the package BlazorEcharts without the owner prefix'

    # The warning gate of test-aot.ps1: a log in the real ILLink and compiler formats, under a path that names the repository.
    $known = @((Read-Json (Join-Path $PSScriptRoot 'aot-known-warnings.json')).warnings)
    $log = Join-Path $WorkPath 'publish-warnings.log'
    Set-Content -LiteralPath $log -Encoding UTF8 -Value @(
        "  Optimizing assemblies for size. This process might take a while.",
        "     1>ILLink : Trim analysis warning IL2091: BlazorECharts.Runtime.EChartsRuntime.<RuntimeCallAsync>d__95<T>.MoveNext(): 'TValue' generic argument does not satisfy 'DynamicallyAccessedMemberTypes.PublicConstructors'. [W:\work\BlazorECharts\Standalone.csproj]",
        "ILLink : Trim analysis warning IL2026: Contoso.Charts.Loader.Load(String): Using member 'System.Reflection.Assembly.GetTypes()' which has 'RequiresUnreferencedCodeAttribute'. [W:\work\BlazorECharts\Standalone.csproj]",
        "W:\work\BlazorECharts\obj\App_razor.g.cs(80,13): warning IL2111: Method 'Microsoft.AspNetCore.Components.Routing.Router.NotFoundPage.set' with parameters or return value with ``DynamicallyAccessedMembersAttribute`` is accessed via reflection. Trimmer can't guarantee availability of the requirements of the method. [W:\work\BlazorECharts\Standalone.csproj]")
    $warnings = Get-TrimWarnings $log
    $gate = Test-TrimWarnings -Warnings $warnings -Known $known
    $results += Assert-Rejected 'OwnTrimWarningFailsAotGate' $gate '^Own IL2091: BlazorECharts\.Runtime\.EChartsRuntime'
    $results += Assert-Rejected 'UnexplainedTrimWarningFailsAotGate' $gate '^Unexplained IL2026: Contoso\.'
    $explained = @($gate | Where-Object { $_ -match 'Router\.NotFoundPage' })
    if ($warnings.Count -eq 3 -and $gate.Count -eq 2 -and $explained.Count -eq 0) { Write-Host 'PASS ExplainedFrameworkWarningPassesAotGate'; $results += $true }
    else { Write-Host "FAIL ExplainedFrameworkWarningPassesAotGate: $($warnings.Count) warnings, gate: $($gate -join ' | ')"; $results += $false }

    if ($results -contains $false) { exit 1 }
    exit 0
}
catch {
    Write-Host "FAIL release-tool fixtures: $($_.Exception.Message)"
    exit 1
}
