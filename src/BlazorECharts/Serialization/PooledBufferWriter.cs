using System.Buffers;

namespace BlazorECharts.Serialization;

// Grows through ArrayPool buffers, so a large payload leaves no large-object garbage besides its final copy.
internal sealed class PooledBufferWriter : IBufferWriter<byte>, IDisposable
{
    private byte[] _buffer = ArrayPool<byte>.Shared.Rent(4096);
    private int _written;

    public ReadOnlySpan<byte> WrittenSpan => _buffer.AsSpan(0, _written);
    public int WrittenCount => _written;

    public void Advance(int count)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(count);
        if (count > _buffer.Length - _written)
            throw new InvalidOperationException("Cannot advance past the end of the buffer.");

        _written += count;
    }

    public Memory<byte> GetMemory(int sizeHint = 0)
    {
        Reserve(sizeHint);
        return _buffer.AsMemory(_written);
    }

    public Span<byte> GetSpan(int sizeHint = 0)
    {
        Reserve(sizeHint);
        return _buffer.AsSpan(_written);
    }

    private void Reserve(int sizeHint)
    {
        ObjectDisposedException.ThrowIf(_written < 0, this);
        var needed = Math.Max(sizeHint, 1);
        if (_buffer.Length - _written >= needed)
            return;

        var next = ArrayPool<byte>.Shared.Rent((int)Math.Min(Array.MaxLength, Math.Max((long)_buffer.Length * 2, (long)_written + needed)));
        _buffer.AsSpan(0, _written).CopyTo(next);
        ArrayPool<byte>.Shared.Return(_buffer);
        _buffer = next;
    }

    public void Dispose()
    {
        if (_written < 0)
            return;

        ArrayPool<byte>.Shared.Return(_buffer);
        _buffer = [];
        _written = -1;
    }
}
