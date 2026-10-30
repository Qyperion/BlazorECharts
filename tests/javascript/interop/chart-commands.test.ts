import { describe, expect, it } from 'vitest';
import { PageRuntime } from '../../../src/BlazorECharts/JavaScript/page-runtime.ts';
import { ChartSnapshot } from '../../../src/BlazorECharts/JavaScript/chart-snapshot.ts';

function fixture() {
  const natives: any[] = [];
  const runtime = {
    version: '6.1.0',
    graphic: {},
    use() {},
    dispose() {},
    registerMap() {},
    registerTheme() {},
    registerLocale() {},
    connect() {},
    disconnect() {},
    getInstanceById() {},
    getInstanceByDom() {},
    init(_el: HTMLElement, theme: string | null, init: unknown) {
      const native = {
        options: {} as any,
        disposed: false,
        themes: [] as string[],
        theme,
        init,
        getOption() {
          return structuredClone(this.options);
        },
        setOption(value: any, update: any) {
          this.options = update.notMerge ? value : { ...this.options, ...value };
        },
        setTheme(value: string) {
          this.themes.push(value);
        },
        dispose() {
          this.disposed = true;
        },
        resize() {},
      };
      natives.push(native);
      return native;
    },
  };
  const page = new PageRuntime(async () => runtime, 'https://example.test/', 'https://example.test/ec.js');
  return { page, natives };
}

describe('ordered native commands and internal snapshot', () => {
  it('ImperativeTheme_SurvivesRendererRecreation_UntilDeclarativeThemeChanges', async () => {
    // Arrange
    const { page, natives } = fixture();
    await page.openFacade('a');
    const id = page.createChart('a', {} as HTMLElement, null, {})!;
    page.setOption('a', id, { json: { series: [] }, bindings: [] }, {});
    page.invokeMethod('a', id, 'setTheme', [{ backgroundColor: '#123456' }, {}]);

    // Act
    page.recreateChart('a', id, { renderer: 'svg' }, null);

    // Assert
    expect(natives[1].theme).toEqual({ backgroundColor: '#123456' });

    // Act
    page.recreateChart('a', id, { renderer: 'canvas' }, 'dark');

    // Assert
    expect(natives[2].theme).toBe('dark');

    // Act
    page.invokeMethod('a', id, 'setTheme', ['light', {}]);
    page.recreateChart('a', id, { renderer: 'svg' }, 'dark');

    // Assert
    expect(natives[3].theme).toBe('light');

    // Act
    page.setTheme('a', id, null);
    page.recreateChart('a', id, { renderer: 'canvas' }, null);

    // Assert
    expect(natives[4].theme).toBeNull();
  });

  it('Snapshot_DropsInheritedPaletteSuffix_WithoutInsertingObjectPlaceholders', () => {
    // Arrange
    let option = { color: ['a', 'b', 'c'] };
    const native = { setOption() {}, dispose() {}, getOption: () => structuredClone(option) };
    const snapshot = new ChartSnapshot();
    snapshot.applied(native, {}, {});
    option = { color: ['red', 'blue', 'c'] };

    // Act
    snapshot.applied(native, { color: ['red', 'blue'] }, {});

    // Assert
    expect(snapshot.forRecreation(native)).toEqual({ color: ['red', 'blue'] });
  });

  it('Snapshot_OmitsInheritedDefaults_ButKeepsExplicitEqualDefaultsAndRuntimeChanges', () => {
    // Arrange
    let option = {
      backgroundColor: '#000',
      color: ['default'],
      dataZoom: [{ start: 0, end: 100 }],
      series: [{ id: 'a', type: 'bar', data: [1], itemStyle: { borderWidth: 0 } }],
    };
    const native = { setOption() {}, dispose() {}, getOption: () => structuredClone(option) };
    const snapshot = new ChartSnapshot();
    snapshot.applied(native, { backgroundColor: '#000', dataZoom: [{}], series: { id: 'a', type: 'bar', data: [1] } }, {});
    option.dataZoom[0].start = 50;

    // Act
    const retained = snapshot.forRecreation(native);

    // Assert
    expect(retained).toEqual({ backgroundColor: '#000', dataZoom: [{ start: 50 }], series: [{ id: 'a', type: 'bar', data: [1] }] });

    // Act
    option = { ...option, color: ['new theme'] };
    snapshot.recreated(native, retained);

    // Assert
    expect(snapshot.forRecreation(native)).toEqual(retained);
  });

  it('DisposeOrRetry_RejectsStaleGenerationCompletion_without_destroying_the_current_chart', async () => {
    // Arrange
    const { page, natives } = fixture();
    await page.openFacade('a');
    const id = page.createChart('a', {} as HTMLElement, null, {})!;
    page.setOption('a', id, { json: { marker: 1 }, bindings: [] }, {}, 1, 1, 1);
    page.recreateChart('a', id, {}, null, 2, 2, 2);

    // Act & Assert
    expect(() => page.setOption('a', id, { json: { marker: 0 }, bindings: [] }, {}, 1, 3, 3)).toThrow(/obsolete/);
    expect(() => page.recreateChart('a', id, {}, null, 1, 4, 4)).toThrow(/obsolete/);
    expect(natives[1].disposed).toBe(false);

    // Act
    page.setOption('a', id, { json: { marker: 5 }, bindings: [] }, {}, 2, 5, 5);

    // Assert
    expect(natives[1].options.marker).toBe(5);
  });

  it('Theme_UsesNativeSetTheme', async () => {
    // Arrange
    const { page, natives } = fixture();
    await page.openFacade('a');
    const id = page.createChart('a', {} as HTMLElement, null, {})!;

    // Act
    page.setTheme('a', id, 'dark');
    page.setTheme('a', id, null);

    // Assert
    expect(natives).toHaveLength(1);
    expect(natives[0].themes).toEqual(['dark', 'default']);
    expect(natives[0].disposed).toBe(false);
  });

  it('RendererChange_RecreatesAndRestoresPrimitiveState', async () => {
    // Arrange
    const { page, natives } = fixture();
    await page.openFacade('a');
    const id = page.createChart('a', {} as HTMLElement, null, {})!;
    page.setOption('a', id, { json: { series: [], unknown: { zero: 0, empty: [], flag: false } }, bindings: [] }, {});
    page.setOption('a', id, { json: { patch: 9 }, bindings: [] }, {});

    // Act
    page.recreateChart('a', id, { renderer: 'svg' }, 'dark');

    // Assert
    expect(natives).toHaveLength(2);
    expect(natives[0].disposed).toBe(true);
    expect(natives[1].init).toEqual({ renderer: 'svg' });
    expect(natives[1].options).toEqual({ series: [], unknown: { zero: 0, empty: [], flag: false }, patch: 9 });

    // Act
    page.setOption('a', id, { json: { after: true }, bindings: [] }, {});

    // Assert
    expect(natives[1].options.after).toBe(true);

    // Act
    page.disposeChart('a', id);

    // Assert
    expect(natives[1].disposed).toBe(true);
  });
});
