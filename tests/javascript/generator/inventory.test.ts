import { expect, test } from 'vitest';
import { resolve } from 'node:path';
import { extractDeclarations } from '../../../tools/BindingGenerator/src/extract.ts';
import { reconcileDocumentation } from '../../../tools/BindingGenerator/src/reconcile-docs.ts';
import * as inventory from '../../../tools/BindingGenerator/src/inventory-public-api.ts';
import * as runtime from '../../../tools/BindingGenerator/src/runtime-inventory.ts';

const fixture = resolve('tests/javascript/generator/fixtures/upstream-added-removed.d.ts');

function schema() {
  const s = extractDeclarations([fixture]);
  reconcileDocumentation(s, resolve('tests/javascript/generator/fixtures/docs-drift.json'));
  inventory.inventoryPublicApi(s);
  return s;
}

test('Inventory_EventIndexSignature_DoesNotClaimTypedPayloadCoverage', () => {
  // Arrange
  const s = schema();

  // Act
  const event = s.records.find(r => r.publicPath === 'events.legendselectchanged')!;

  // Assert
  expect(event.status).toBe('unresolved');
  expect(event.inventory?.requirements).toContain('event-payload');
  expect(event.implementationReferences).toEqual([]);
});

test('Inventory_PublicMethods_PreserveOverloadsAndReturnKinds', () => {
  // Arrange
  const s = schema();
  const methods = s.records.filter(r => r.kind === 'method');

  // Act
  const setOption = methods.find(r => r.publicPath === 'echartsInstance.setOption')!;

  // Assert
  expect(s.types.find(t => t.id === setOption.type)!.signatures).toHaveLength(2);
  expect(methods.find(r => r.publicPath === 'echartsInstance.getDom')!.inventory?.requirements).toContain('browser-reference');
  expect(methods.find(r => r.publicPath === 'echarts.init')!.inventory?.category).toBe('global-method');
  expect(s.records.some(r => r.publicPath === 'echarts.graphic.clipRectByRect')).toBe(true);
  expect(methods.some(r => r.publicPath === 'echarts.Callback')).toBe(false);
});

test('Runtime_StaticRegistrations_KeepSource_AndDynamicSitesStayVisible', () => {
  // Arrange
  const s = schema();

  // Act
  const result = runtime.scanRuntime(s, resolve('tests/javascript/generator/fixtures/runtime-actions.js'), 'fixture', 'test');

  // Assert
  expect(result.registrations.map(r => [r.action, r.event])).toEqual([['change', 'changed'], ['select', 'selected'], ['brushEnd', 'brushend']]);
  expect(result.dynamicSites).toHaveLength(1);
  expect(s.records.find(r => r.publicPath === 'runtime.action.change')).toMatchObject({ status: 'unresolved' });
  expect(s.diagnostics.some(d => d.code === 'DYNAMIC_ACTION_REGISTRATION')).toBe(true);
});
