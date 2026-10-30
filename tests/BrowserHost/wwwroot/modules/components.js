export function timeLabel(value) {
    window.componentTimeLabels = (window.componentTimeLabels || 0) + 1;
    return new Date(value).toISOString().slice(5, 10);
}
export function typedRows() { return new Float64Array([Date.UTC(2026,9,17),1,Date.UTC(2026,9,18),10,Date.UTC(2026,9,19),100]); }
