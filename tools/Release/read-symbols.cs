#:property RestorePackagesWithLockFile=false

// Writes the symbols of a .snupkg as JSON for Test-SymbolPackage in ReleaseTools.psm1, which has no PDB reader in
// Windows PowerShell: for every portable PDB its document names, the SourceLink JSON and the text of each embedded
// source. Usage: dotnet run --file tools/Release/read-symbols.cs -- <package.snupkg> <output.json>
using System.IO.Compression;
using System.Reflection.Metadata;
using System.Text;
using System.Text.Json;

var sourceLinkKind = new Guid("CC110556-A091-4D38-9FEC-25AB9A351A6A");
var embeddedSourceKind = new Guid("0E8A571B-6926-466E-B4AD-8AB04611F5FE");

using var package = ZipFile.OpenRead(args[0]);
using var output = File.Create(args[1]);
using var writer = new Utf8JsonWriter(output, new JsonWriterOptions { Indented = true });

writer.WriteStartObject();
writer.WriteStartArray("pdbs");

var entries = package.Entries
    .Where(e => e.FullName.EndsWith(".pdb", StringComparison.OrdinalIgnoreCase))
    .OrderBy(e => e.FullName, StringComparer.Ordinal);

foreach (var entry in entries)
{
    using var memory = new MemoryStream();
    using (var stream = entry.Open())
    {
        stream.CopyTo(memory);
    }

    memory.Position = 0;
    using var provider = MetadataReaderProvider.FromPortablePdbStream(memory, MetadataStreamOptions.LeaveOpen);
    var reader = provider.GetMetadataReader();

    writer.WriteStartObject();
    writer.WriteString("path", entry.FullName);
    writer.WriteStartArray("documents");

    foreach (var handle in reader.Documents)
    {
        writer.WriteStringValue(reader.GetString(reader.GetDocument(handle).Name));
    }

    writer.WriteEndArray();

    string? sourceLink = null;
    writer.WriteStartArray("embedded");

    foreach (var handle in reader.CustomDebugInformation)
    {
        var information = reader.GetCustomDebugInformation(handle);
        var kind = reader.GetGuid(information.Kind);

        if (kind == sourceLinkKind)
        {
            sourceLink = Encoding.UTF8.GetString(reader.GetBlobBytes(information.Value));
        }
        else if (kind == embeddedSourceKind && information.Parent.Kind == HandleKind.Document)
        {
            var document = reader.GetDocument((DocumentHandle)information.Parent);

            writer.WriteStartObject();
            writer.WriteString("document", reader.GetString(document.Name));
            writer.WriteString("text", ReadEmbeddedText(reader.GetBlobBytes(information.Value)));
            writer.WriteEndObject();
        }
    }

    writer.WriteEndArray();

    if (sourceLink is null)
    {
        writer.WriteNull("sourceLink");
    }
    else
    {
        writer.WriteString("sourceLink", sourceLink);
    }

    writer.WriteEndObject();
}

writer.WriteEndArray();
writer.WriteEndObject();

// The blob starts with the uncompressed size: 0 means that the text follows as is, otherwise it is deflated.
static string ReadEmbeddedText(byte[] blob)
{
    var size = BitConverter.ToInt32(blob, 0);

    if (size == 0)
    {
        return Encoding.UTF8.GetString(blob, 4, blob.Length - 4);
    }

    using var deflate = new DeflateStream(new MemoryStream(blob, 4, blob.Length - 4), CompressionMode.Decompress);
    var text = new byte[size];
    deflate.ReadExactly(text);

    return Encoding.UTF8.GetString(text);
}
