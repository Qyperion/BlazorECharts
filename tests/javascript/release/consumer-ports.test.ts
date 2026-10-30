import { expect, test } from 'vitest';
import { aotPorts, consumerPorts } from '../../PackageConsumer/ports.ts';

test('ConsumerPorts_DefaultToEightPortsFrom5201', () => {
  // Act & Assert
  expect(consumerPorts({})).toEqual({
    server: 5201,
    serverSubpath: 5202,
    cdn: 5203,
    custom: 5204,
    wasm: 5205,
    wasmSubpath: 5206,
    coreOnly: 5207,
    library: 5208,
  });
  expect(aotPorts({})).toEqual({ trimmed: 5211, aot: 5212 });
});

test('ConsumerPorts_StartAtTheConfiguredPort', () => {
  // Act & Assert
  expect(Object.values(consumerPorts({ BLAZOR_ECHARTS_CONSUMER_PORT: '15201' }))).toEqual([15201, 15202, 15203, 15204, 15205, 15206, 15207, 15208]);
  expect(aotPorts({ BLAZOR_ECHARTS_AOT_PORT: '15211' })).toEqual({ trimmed: 15211, aot: 15212 });
});

test('ConsumerPorts_RejectInvalidValues', () => {
  // Act & Assert
  for (const value of ['abc', '0', '5201.5', '65530'])
    expect(() => consumerPorts({ BLAZOR_ECHARTS_CONSUMER_PORT: value }), value).toThrow(/BLAZOR_ECHARTS_CONSUMER_PORT/);

  expect(() => aotPorts({ BLAZOR_ECHARTS_AOT_PORT: '65535' })).toThrow(/BLAZOR_ECHARTS_AOT_PORT/);
});
