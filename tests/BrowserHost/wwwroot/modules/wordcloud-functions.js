export function shape(theta) { globalThis.__wordCloudShapeCalls = (globalThis.__wordCloudShapeCalls ?? 0) + 1; return 1; }
export function color(params) { globalThis.__wordCloudColorCalls = (globalThis.__wordCloudColorCalls ?? 0) + 1; return params.dataIndex === 19 ? '#dc2782' : '#2768ac'; }
