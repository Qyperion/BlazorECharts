namespace BlazorECharts.Runtime;

// Each key passes at most once per window, and at most perWindow keys pass in all: neither a failing mousemove handler
// nor a client that sends made-up error codes can flood the log.
internal sealed class LogThrottle(TimeSpan window, int perWindow)
{
    private readonly object _gate = new();
    private readonly HashSet<string> _keys = [];
    private long _windowEnd;
    private int _suppressed;

    // Suppressed counts the entries dropped since the previous one that passed.
    internal bool TryEnter(string key, out int suppressed)
    {
        var now = Environment.TickCount64;
        lock (_gate)
        {
            if (now >= _windowEnd)
            {
                _keys.Clear();
                _windowEnd = now + (long)window.TotalMilliseconds;
            }

            if (_keys.Count >= perWindow || !_keys.Add(key))
            {
                _suppressed++;
                suppressed = 0;
                return false;
            }

            suppressed = _suppressed;
            _suppressed = 0;
            return true;
        }
    }
}
