import { expect, it } from 'vitest';
import { ExtensionRegistry } from '../../../src/BlazorECharts/JavaScript/extension-registry.ts';

const base = 'https://example.test/charts-test/';

it('Extension_WaitsForRuntime_RegistersOnce', async () => {
  // Arrange
  const ready = Promise.withResolvers<object>();
  const native = {};

  // Act
  const events: string[] = [];

  // Assert
  const registry = new ExtensionRegistry(
    () => ready.promise,
    async url => ({
      register(runtime: object) {
        expect(runtime).toBe(native);
        events.push(url);
      },
    }),
    base
  );

  // Act
  const a = { id: 'a', version: '1', dependencies: ['b'], moduleUrl: './a.js' };
  const b = { id: 'b', version: '1', dependencies: [], moduleUrl: './b.js' };
  const first = registry.registerAll([a, b]);
  const second = registry.registerAll([b, { ...a, moduleUrl: `${base}a.js` }]);
  await Promise.resolve();

  // Assert
  expect(events).toEqual([]);

  // Act
  ready.resolve(native);
  await Promise.all([first, second]);

  // Assert
  expect(events).toEqual([`${base}b.js`, `${base}a.js`]);
});

it('Extension_DependencyCycle_Rejects', async () => {
  // Arrange
  const registry = new ExtensionRegistry(async () => ({}), async () => ({ register() {} }), base);

  // Act & Assert
  await expect(registry.registerAll([
    { id: 'a', version: '1', dependencies: ['b'], moduleUrl: 'a.js' },
    { id: 'b', version: '1', dependencies: ['a'], moduleUrl: 'b.js' },
  ])).rejects.toMatchObject({ code: 'ExtensionDependencyCycle' });
});

it('Extension_ConflictsAndMissingDependenciesFailBeforeRegistration', async () => {
  // Arrange
  let registrations = 0;
  const registry = new ExtensionRegistry(
    async () => ({}),
    async () => ({
      register() {
        registrations++;
      },
    }),
    base
  );
  const a = { id: 'a', version: '1', dependencies: [], moduleUrl: 'a.js' };
  await registry.registerAll([a]);

  // Act & Assert
  await expect(registry.registerAll([{ ...a, version: '2' }])).rejects.toMatchObject({ code: 'ExtensionIdentityConflict' });
  await expect(registry.registerAll([{ ...a, id: 'c', dependencies: ['missing'] }])).rejects.toMatchObject({ code: 'ExtensionDependencyMissing' });
  expect(registrations).toBe(1);
});

it('Extension_FailedRegistrationRequiresExplicitRetry', async () => {
  // Arrange
  let available = false;
  let attempts = 0;
  const registry = new ExtensionRegistry(
    async () => ({}),
    async () => ({
      register() {
        attempts++;
        if (!available)
          throw new Error('registration failed');
      },
    }),
    base
  );
  const descriptor = { id: 'a', version: '1', dependencies: [], moduleUrl: 'a.js' };

  // Act & Assert
  await expect(registry.registerAll([descriptor])).rejects.toThrow('registration failed');

  // Arrange
  available = true;

  // Act & Assert
  await expect(registry.registerAll([descriptor])).rejects.toThrow();
  expect(attempts).toBe(1);

  // Act
  await registry.registerAll([descriptor], true);

  // Assert
  expect(attempts).toBe(2);
});
