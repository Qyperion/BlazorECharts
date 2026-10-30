import { afterEach, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import * as loader from '../../../src/BlazorECharts/JavaScript/runtime-loader.ts';
import * as stable from '../../../src/BlazorECharts/JavaScript/blazor-echarts.ts';
import { PageRuntime } from '../../../src/BlazorECharts/JavaScript/page-runtime.ts';
import { pageRuntimeKey, runtimeProtocol } from '../../../src/BlazorECharts/JavaScript/runtime-protocol.ts';

const exported = (bundle: string) => [...bundle.matchAll(/export\s*\{([^}]*)\}/g)]
  .flatMap(m => m[1].split(',').map(name => name.trim().split(/\s+as\s+/).pop()!).filter(Boolean))
  .sort();

test('StableModule_ExportsOnlyTheDocumentedBrowserApi', async () => {
  // Act
  const module = await import('../../../src/BlazorECharts/JavaScript/blazor-echarts.ts');

  // Assert
  expect(Object.keys(module).sort()).toEqual(['getECharts', 'stabilityParticipant', 'tryStabilityParticipant']);

  // Act
  const bundle = readFileSync('src/BlazorECharts/wwwroot/js/blazor-echarts.js', 'utf8');

  // Assert
  expect(exported(bundle)).toEqual(['getECharts', 'stabilityParticipant', 'tryStabilityParticipant']);

  // The page coordinator comes from its global key: a failed request of the interop module URL cannot break this module.
  expect(bundle).not.toMatch(/\bimport\b|runtime-loader/);
  expect(bundle).toContain(`"BlazorECharts.page-runtime.v${runtimeProtocol}"`);
});

test('InteropModule_DoesNotExportThePageRuntimeClass', () => {
  // Act
  const names = exported(readFileSync('src/BlazorECharts/wwwroot/js/runtime-loader.js', 'utf8'));

  // Assert
  expect(names).toContain('openFacade');
  expect(names).not.toContain('PageRuntime');

  // Test fixtures reach the group coordinator through the page runtime key, as they reach PageRuntime.
  expect(names).not.toContain('groupMembership');

  // Act
  const bundle = readFileSync('src/BlazorECharts/wwwroot/js/runtime-loader.js', 'utf8');

  // Assert
  expect(bundle).not.toContain('retainBindings');
  expect(bundle).not.toMatch(/method\s*===\s*"time\.roundTime"/);
});

const globals = globalThis as unknown as Record<symbol, unknown>;

afterEach(() => { delete globals[pageRuntimeKey]; });

test('StabilityParticipant_HasAFrozenParticipantAndTicketShape', async () => {
  // Arrange
  const chart = { setOption() {}, dispose() {}, isDisposed: () => false, on() {}, off() {} };
  const base = 'https://example.test/charts-test/';
  globals[pageRuntimeKey] = new PageRuntime(
    async () => ({
      version: '6.1.0',
      use() {},
      dispose() {},
      registerMap() {},
      registerTheme() {},
      registerLocale() {},
      connect() {},
      disconnect() {},
      getInstanceById() {},
      getInstanceByDom() {},
      graphic: {},
      init: () => chart,
    }),
    base,
    `${base}_content/BlazorECharts/js/echarts-6.1.0.js`
  );
  await loader.openFacade(runtimeProtocol, 'a', {}, []);
  loader.createChart('a', {} as HTMLElement, null, {});

  // Act
  const participant = stable.stabilityParticipant(chart as never);

  // Assert
  expect(Object.keys(participant)).toEqual(['begin']);
  expect(Object.isFrozen(participant)).toBe(true);

  // Act
  const ticket = participant.begin('shape', 'layout');

  // Assert
  expect(Object.keys(ticket)).toEqual(['generation', 'revision', 'token', 'complete', 'cancel', 'fail', 'retire']);
  expect(Object.isFrozen(ticket)).toBe(true);
  expect(ticket).toMatchObject({ generation: expect.any(Number), revision: expect.any(Number), token: expect.any(Number) });

  // Arrange
  ticket.retire();

  // Act & Assert
  expect(() => (participant.begin as (name: string) => unknown)('missing scope')).toThrow(/LayoutScopeInvalid/);
});
