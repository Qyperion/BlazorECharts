import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateBindings, requireHydrationSupport } from '../../../src/BlazorECharts/JavaScript/binding-validation.ts';
import { PageRuntime } from '../../../src/BlazorECharts/JavaScript/page-runtime.ts';

function fixture(exports: Record<string, unknown> | Promise<Record<string, unknown>>, inline = false) {
  let option: any = {};
  const native = {
    setOption(v: unknown) {
      option = v;
    },
    getOption: () => option,
    dispose() {},
  };
  const runtime = {
    version: '6.1.0',
    init: () => native,
    getInstanceByDom() {},
    getInstanceById() {},
    dispose() {},
    use() {},
    registerMap() {},
    registerTheme() {},
    registerLocale() {},
    connect() {},
    disconnect() {},
    graphic: {},
  };
  const page = new PageRuntime(
    async url => url.endsWith('echarts.js') ? runtime : await exports,
    'https://test.local/app/',
    'https://test.local/app/echarts.js'
  );
  return {
    page,
    native,
    get option() {
      return option;
    },
    async start() {
      await page.openFacade('a', { allowInlineJavaScript: inline } as any);
      return page.createChart('a', {} as HTMLElement, null, {})!;
    },
  };
}

describe('executable bindings', () => {
  it('NativeRegistrations_RetainBrowserCallbackDependenciesForThePage', async () => {
    // Arrange
    const f = fixture({});
    await f.start();
    const selected: any = await f.page.load();
    let registered: any;
    selected.registerPreprocessor = (callback: unknown) => { registered = callback; };
    const formatter = () => 'persistent';

    // A module-produced native function is accepted as a persistent callback argument.
    const producer = fixture({ create: () => formatter });
    await producer.start();
    const result: any = await producer.page.createNative('a', 'module', { moduleUrl: './native.js', exportName: 'create' }, {
      json: { args: [] },
      bindings: [],
    });
    const native: any = await producer.page.load();
    native.registerPreprocessor = selected.registerPreprocessor;
    await producer.page.invokeNative('a', 'registerPreprocessor', false, {
      json: { args: [null] },
      bindings: [{ ...result.bindings[0], path: ['args', 0] }],
    });
    await producer.page.releaseResult('a', result.leaseId);

    // Act
    producer.page.releaseFacade('a');

    // Assert
    expect(registered()).toBe('persistent');
    expect(producer.page.referenceStatistics().entries).toBe(1);
  });

  it('GraphicBridge_ConstructsNativeObjects_AndPreservesTheReceiver', async () => {
    // Arrange
    const f = fixture({});
    await f.start();

    // The selected runtime is the only source of graphic constructors.
    const selected: any = await f.page.load();

    // Act
    selected.graphic.Rect = class Rect {
      constructor(readonly options: unknown) {}
    };

    // Assert
    selected.graphic.clipRectByRect = function(a: unknown) {
      expect(this).toBe(selected.graphic);
      return a;
    };

    // Act
    const rect: any = await f.page.invokeNative('a', 'graphic.Rect', true, { json: { args: [{ shape: { width: 5 } }] }, bindings: [] });

    // Assert
    expect(rect.bindings[0].path).toEqual([]);

    // Act
    const clipped: any = await f.page.invokeNative('a', 'graphic.clipRectByRect', false, { json: { args: [{ width: 5 }] }, bindings: [] });

    // Assert
    expect(clipped.value).toEqual({ width: 5 });

    // Arrange
    await f.page.releaseResult('a', rect.leaseId);

    // Act & Assert
    await expect(f.page.invokeNative('a', '__proto__.polluted', false, { json: { args: [] }, bindings: [] })).rejects.toThrow(/public|allowed/);
  });

  it('NativeValues_PreserveOwnershipAndErrors', async () => {
    // Arrange
    class BrowserObject {
      disposed = false;

      dispose() {
        this.disposed = true;
      }
    }

    const borrowed = new BrowserObject();
    const f = fixture({ create: () => borrowed });
    const id = await f.start();
    const result: any = await f.page.createNative('a', 'module', { moduleUrl: './native.js', exportName: 'create' }, {
      json: { args: [] },
      bindings: [],
    });
    await f.page.setOption('a', id, { json: { native: null }, bindings: [{ ...result.bindings[0], path: ['native'] }] }, {});

    // Act
    await f.page.releaseResult('a', result.leaseId);

    // Assert
    expect(f.option.native).toBe(borrowed);

    // Act
    f.page.disposeChart('a', id);

    // Assert
    expect(borrowed.disposed).toBe(false);
  });

  it('FailedHydration_RollsBackAcquisition_AndForeignHandlesFail', async () => {
    // Arrange
    const f = fixture({ create: () => new Map(), format: 1 });
    const id = await f.start();
    const result: any = await f.page.createNative('a', 'module', { moduleUrl: './native.js', exportName: 'create' }, {
      json: { args: [] },
      bindings: [],
    });
    const reference = { ...result.bindings[0], path: ['object'] };

    // Act & Assert
    await expect(
      f.page.setOption('a', id, { json: { object: null, formatter: null }, bindings: [reference, { ...moduleBinding, path: ['formatter'] }] }, {})
    ).rejects.toThrow(/format/);

    // Arrange
    await f.page.releaseResult('a', result.leaseId);

    // Act & Assert
    await expect(f.page.setOption('a', id, { json: { object: null }, bindings: [reference] }, {})).rejects.toThrow(/token/);
    expect(() => f.page.setOption('a', id, { json: { object: null }, bindings: [{ ...reference, runtimeId: 'foreign' }] }, {})).toThrow(/runtime/);
  });

  it('ModuleCallbacks_RunSynchronouslyInBrowser', async () => {
    // Arrange
    const format = (v: number) => `value:${v}`;
    const f = fixture({ format });
    const id = await f.start();
    const prepared = { json: { tooltip: { formatter: null } }, bindings: [{ ...moduleBinding, path: ['tooltip', 'formatter'] }] };

    // Act
    await f.page.setOption('a', id, prepared, {});

    // Assert
    expect(f.option.tooltip.formatter(7)).toBe('value:7');
    expect(f.option.tooltip.formatter).toBe(format);
    expect(prepared.json.tooltip.formatter).toBeNull();
  });

  it('InlineCallbacks_RequireExplicitOptIn', async () => {
    // Arrange
    const descriptor = { kind: 'inline' as const, token: 'binding:0', signature: 'formatter', path: ['formatter'], source: '(v) => v + 1' };
    const disabled = fixture({});
    const a = await disabled.start();

    // Act & Assert
    await expect(
      Promise.resolve().then(() => disabled.page.setOption('a', a, { json: { formatter: null }, bindings: [descriptor] }, {}))
    ).rejects.toThrow(/formatter.*AllowInlineJavaScript/);

    // Act
    const enabled = fixture({}, true);
    const b = await enabled.start();
    await enabled.page.setOption('a', b, { json: { formatter: null }, bindings: [descriptor] }, {});

    // Assert
    expect(enabled.option.formatter(4)).toBe(5);
  });

  it('GetOption_FunctionDomRoundTrip retains identity after releasing the snapshot', async () => {
    // Arrange
    const fn = () => 'retained';
    const f = fixture({ format: fn });
    const id = await f.start();
    await f.page.setOption('a', id, { json: { formatter: null }, bindings: [{ ...moduleBinding, path: ['formatter'] }] }, {});
    const result: any = f.page.invokeMethod('a', id, 'getOption', []);
    await f.page.setOption('a', id, { json: result.value, bindings: result.bindings }, { notMerge: true });

    // Act
    await f.page.releaseResult('a', result.leaseId);

    // Assert
    expect(f.option.formatter).toBe(fn);
    expect(f.option.formatter()).toBe('retained');

    // Arrange
    f.page.disposeChart('a', id);
    const next = f.page.createChart('a', {} as HTMLElement, null, {})!;

    // Act & Assert
    await expect(Promise.resolve().then(() => f.page.setOption('a', next, { json: result.value, bindings: result.bindings }, {}))).rejects.toThrow(
      /disposed.*token|token.*disposed/
    );
  });

  it('DisposeDuringHydration_RejectsLateBindings', async () => {
    // Arrange
    const pending = Promise.withResolvers<Record<string, unknown>>();
    const f = fixture(pending.promise);
    const id = await f.start();
    const applying = Promise.resolve().then(
      () => f.page.setOption('a', id, { json: { formatter: null }, bindings: [{ ...moduleBinding, path: ['formatter'] }] }, {})
    );

    // Act & Assert
    // Attach a rejection observer before cleanup, as real interop does.
    const rejection = expect(applying).rejects.toThrow(/disposed|generation/i);

    // Act
    await Promise.resolve();
    f.page.disposeChart('a', id);
    pending.resolve({ format: () => 'late' });
    await rejection;

    // Assert
    expect(f.option).toEqual({});
  });

  it('MissingExport_ReportsPathModuleAndExport', async () => {
    // Arrange
    const f = fixture({ format: 42 });
    const id = await f.start();

    // Act & Assert
    await expect(Promise.resolve().then(
      () => f.page.setOption('a', id, { json: { formatter: null }, bindings: [{ ...moduleBinding, path: ['formatter'] }] }, {})
    )).rejects.toThrow(/formatter.*format.js.*format/);
    expect(f.option).toEqual({});
  });
});

const moduleBinding = { kind: 'module' as const, token: 'binding:0', signature: 'fixture:formatter', moduleUrl: './format.js', exportName: 'format' };

describe('binding transport validation (no execution)', () => {
  it('accepts the exact wire fixture emitted by the C# serializer contract test', () => {
    // Arrange
    const prepared = JSON.parse(readFileSync(new URL('./fixtures/prepared-option.json', import.meta.url), 'utf8'));

    // Act & Assert
    expect(() => validateBindings(prepared.json, prepared.bindings, { allowInlineJavaScript: true, runtimeId: 'page' })).not.toThrow();
  });

  it('accepts exact key/index paths, including escaped keys and prototype-like own keys', () => {
    // Arrange
    const json = JSON.parse('{"data":[{"a.b\\\"\\\\":null,"0":null,"__proto__":null}]}');
    const bindings = ['a.b"\\', '0', '__proto__'].map((key, i) => ({ ...moduleBinding, token: `binding:${i}`, path: ['data', 0, key] }));

    // Act & Assert
    expect(() => validateBindings(json, bindings)).not.toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('ordinary JavaScript-looking strings and descriptor-looking raw JSON stay data', () => {
    // Act & Assert
    expect(() => validateBindings({ formatter: 'function() { throw 1 }', kind: 'inline', source: 'throw 1' }, [])).not.toThrow();
  });

  it('inline is opt-in and validation never executes its source', () => {
    // Arrange
    const binding = {
      kind: 'inline',
      token: 'binding:0',
      signature: 'fixture:formatter',
      path: ['formatter'],
      source: 'throw new Error("never execute")',
    };

    // Act & Assert
    expect(() => validateBindings({ formatter: null }, [binding])).toThrow(/formatter.*AllowInlineJavaScript/);
    expect(() => validateBindings({ formatter: null }, [binding], { allowInlineJavaScript: true })).not.toThrow();
  });

  it.each([
    { ...moduleBinding, path: ['missing'] },
    { ...moduleBinding, path: ['data', '0'] },
    { ...moduleBinding, path: ['data', -1] },
    { ...moduleBinding, path: ['data', 0.5] },
    { ...moduleBinding, path: [] },
    { ...moduleBinding, path: ['formatter'], kind: 'unknown' },
    { ...moduleBinding, path: ['formatter'], exportName: '' },
    { ...moduleBinding, path: ['formatter'], signature: '' },
    { ...moduleBinding, path: ['formatter'], source: 'conflicting inline' },
  ])('rejects malformed/mismatched descriptor %# before any acquisition', binding => {
    // Act & Assert
    expect(() => validateBindings({ formatter: null, data: [null] }, [binding])).toThrow();
  });

  it('rejects non-null placeholders, inherited properties and duplicate paths', () => {
    // Arrange
    const binding = { ...moduleBinding, path: ['formatter'] };

    // Act & Assert
    expect(() => validateBindings({ formatter: 'ordinary string' }, [binding])).toThrow(/placeholder/);
    expect(() => validateBindings(Object.create({ formatter: null }), [binding])).toThrow(/own/);
    expect(() => validateBindings({ formatter: null }, [binding, { ...binding, token: 'binding:1' }])).toThrow(/Duplicate/);
  });

  it('validates object runtime and owner identity without accepting cross-page handles', () => {
    // Arrange
    const binding = { kind: 'object', path: ['image'], token: 'object:1', runtimeId: 'page', ownerId: 'consumer' };

    // Act & Assert
    expect(() => validateBindings({ image: null }, [binding], { runtimeId: 'page' })).not.toThrow();
    expect(() => validateBindings({ image: null }, [binding], { runtimeId: 'foreign' })).toThrow(/runtime/);
    expect(() => validateBindings({ image: null }, [{ ...binding, ownerId: '' }], { runtimeId: 'page' })).toThrow(/ownerId/);
    expect(() => validateBindings({ image: null }, [{ ...binding, source: 'fake' }], { runtimeId: 'page' })).toThrow();
  });

  it('primitive runtimes explicitly reject pending hydration', () => {
    // Act & Assert
    expect(() => requireHydrationSupport([])).not.toThrow();
    expect(() => requireHydrationSupport([{ ...moduleBinding, path: ['formatter'] }])).toThrow(/hydration.*formatter/);
  });

  it('rejects duplicate function tokens without rejecting a shared native object at two paths', () => {
    // Act & Assert
    expect(() => validateBindings({ a: null, b: null }, [
      { ...moduleBinding, path: ['a'] },
      { ...moduleBinding, path: ['b'] },
    ])).toThrow(/Duplicate function token/);

    // Arrange
    const binding = { kind: 'object', token: 'object:1', runtimeId: 'page', ownerId: 'owner' };

    // Act & Assert
    expect(() => validateBindings(
      { a: null, b: null },
      [
        { ...binding, path: ['a'] },
        { ...binding, path: ['b'] },
      ],
      { runtimeId: 'page' }
    )).not.toThrow();
  });
});
