namespace BlazorECharts.Runtime;

// Acceptance sequence/revision never reset. Generation changes when the native instance changes.
internal readonly record struct ChartRevision(int Generation, long Revision, long Sequence);
