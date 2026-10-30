import { test, expect } from '@playwright/test';

for (const mode of ['server', 'wasm']) {
  test(`PartialMatrixCoordinates_PreserveNativeMissingAxis_${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/methods/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Partial matrix', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('matrix:True:True:True:True:True:True');
  });

  test(`ImperativeTheme_SurvivesRendererRecreation_${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/methods/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Imperative theme', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('imperative theme');

    // Act
    await page.getByRole('button', { name: 'Recreate renderer', exact: true }).click();

    // Assert
    await expect(page.locator('.methods-chart svg')).toBeVisible();
    await expect.poll(() => page.locator('.methods-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      return ec.getInstanceByDom(element).getOption().backgroundColor;
    })).toBe('#123456');
  });

  test(`SnapshotNativeTokens_AreIndependentOfChart_${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/methods/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await page.locator('.methods-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const chart = ec.getInstanceByDom(element);
      const formatter = () => 'retained';
      const dom = document.createElement('div');
      (window as any).nativeMethodFixture = { formatter, dom };
      chart.setOption({ tooltip: { formatter }, nativeExtension: { dom } });
    });

    // Assert
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
      await expect(page.getByTestId('status')).toHaveText('snapshot');
      await expect.poll(async () => Number(await page.getByTestId('bindings').innerText())).toBeGreaterThanOrEqual(2);
      expect(await page.locator('.methods-chart').evaluate(async (element: HTMLElement) => {
        const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
        const chart = ec.getInstanceByDom(element);
        const options = chart.getOption();
        return [
          options.tooltip[0].formatter === (window as any).nativeMethodFixture.formatter,
          options.nativeExtension.dom === (window as any).nativeMethodFixture.dom,
          !!chart.isDisposed(),
        ];
      })).toEqual([true, true, false]);
    }
  });

  test(`InheritedEventMethods_AndNativeThemeLayout_${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/methods/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await page.locator('.methods-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      ec.getInstanceByDom(element).on(
        'nativecontext',
        function(this: any, value: unknown) { (window as any).nativeContext = { value, marker: this.marker }; }
      );
    });
    await page.getByRole('button', { name: 'Native events', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('events:True:False:legendToggleSelect');
    await expect(page.getByTestId('native-events')).toHaveText('1');
    expect(await page.evaluate(() => (window as any).nativeContext)).toEqual({ value: 0, marker: 2 });

    // Act
    await page.getByRole('button', { name: 'Theme and layout', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('theme layout');

    // Act
    const layout = JSON.parse(await page.getByTestId('result').innerText());

    // Assert
    expect(layout.width).toBe(30);
    expect(layout.height).toBe(30);
    expect(layout.content).toBeGreaterThan(0);
  });

  test(`GetOption_PreservesNormalizedArraysAndUnknownData_${mode}`, async ({ page }) => {
    // Arrange
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`/harness/methods/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Snapshot', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('snapshot');

    // Act
    const snapshot = JSON.parse(await page.getByTestId('result').innerText());

    // Assert
    expect(snapshot.title).toHaveLength(1);
    expect(snapshot.title[0].text).toBe('Methods');
    expect(snapshot.extension).toEqual({ zero: 0, flag: false, empty: [], nested: { value: null } });
    expect(snapshot.series[0].data).toEqual([[1, 2], [3, 4]]);
    expect(snapshot.xAxis).toHaveLength(1);
    expect(snapshot.yAxis).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test(`InstanceMethods_UseCorrectOverloadAndReturnShape_${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/methods/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Coordinates', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('coordinates');

    // Act
    const result = JSON.parse(await page.getByTestId('result').innerText());

    // Assert
    expect(result.scalar).toBeGreaterThan(0);
    expect(result.pixels).toHaveLength(2);
    expect(result.data[0]).toBeCloseTo(1);
    expect(result.data[1]).toBeCloseTo(2);
    expect(result.contains).toBe(true);
    expect(result.ssr).toBe(false);
    expect(result.nativeId).toMatch(/^ec_/);
    expect(result.width).toBe(640);
    expect(result.height).toBe(360);
    expect(result.ratio).toBeGreaterThan(0);
    expect(result.visual).toBe('#ff0000');

    // Act
    await page.getByRole('button', { name: 'References', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('references released:640');
  });

  test(`MultiComponentFinder_ConvertsOnCombinedCartesian_${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/methods/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Multi finder', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('multi finder');

    // Act
    const result = JSON.parse(await page.getByTestId('result').innerText());
    const native = await page.locator('.methods-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const chart = ec.getInstanceByDom(element);
      return {
        combined: chart.convertToPixel({ xAxisIndex: 1, yAxisId: 'y1' }, [25, 750]),
        first: chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [25, 750]),
      };
    });

    // Assert
    expect(result.combined).toEqual(native.combined);
    expect(result.combined).not.toEqual(native.first);
    expect(result.back[0]).toBeCloseTo(25);
    expect(result.back[1]).toBeCloseTo(750);
  });

  test(`ConvertOptions_ClampMatrixInAllThreeConversions_${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/methods/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Matrix clamp', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('clamp:True:True:True:True:0');
  });

  test(`AppendData_RespectsUpstreamSeriesSupport_${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/methods/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Append', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('appended');
    await expect.poll(() => page.locator('.methods-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      return ec.getInstanceByDom(element).getModel().getSeriesByIndex(0).getData().count();
    })).toBe(3);

    // Act
    await page.getByRole('button', { name: 'Unsupported append', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toContainText('AppendDataUnsupported');
  });

  test(`Methods_RespectGenerationAndOrdering_${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/methods/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Loading', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('loading');
    await expect.poll(() => page.locator('.methods-chart').evaluate(async (e: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      return !!ec.getInstanceByDom(e)._loadingFX;
    })).toBe(true);

    // Act
    await page.getByRole('button', { name: 'Hide and resize', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('resized:600');

    // Act
    await page.getByRole('button', { name: 'Clear', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('cleared:0');

    // Act
    await page.getByRole('button', { name: 'Dispose', exact: true }).click();

    // Assert
    // Disposing the component's handle elsewhere fails the component (ChartDisposed).
    await expect(page.getByTestId('status')).toHaveText('The chart handle was disposed outside its EChart component.');
    await expect(page.locator('.methods-chart')).toHaveAttribute('data-chart-state', 'Failed');
    await expect(page.locator('.methods-chart canvas')).toHaveCount(0);
  });
}
