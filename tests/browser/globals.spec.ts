import { test, expect } from '@playwright/test';

for (const mode of ['server', 'wasm']) {
  test(`GlobalHelpers_PreserveMetadataOptionalRestAndNumericPredicates ${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/globals/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Helper regressions', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('regressions:registered:1:2');
  });

  test(`MapRoundTrip_PreservesGeoJsonAndSvg ${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/globals/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Maps', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('maps:True:False:True');
    await expect(page.locator('.global-chart canvas')).toHaveCount(2);

    // Act
    const value = await page.locator('.global-chart').first().evaluate(async element => {
      const e = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const map = e.getMap('test-geo');
      return { type: e.getInstanceByDom(element).getOption().series[0].type, map: map.geoJSON, svg: e.getMap('test-svg') };
    });

    // Assert
    expect(value.type).toBe('map');
    expect(value.map.features[0].properties.name).toBe('A');
    expect(value.svg).toBe(false);
  });

  test(`CustomSeries_RegisteredRenderItemAndTypedGraphicHandlers ${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/globals/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Custom series', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('custom-series');

    // Act
    const chart = page.locator('.global-chart').first();
    const inspect = () => chart.evaluate(async element => {
      const e = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const fixture = await import('/modules/custom-registration.js');
      const ec = e.getInstanceByDom(element);
      const list = ec.getZr().storage.getDisplayList();
      const option = ec.getOption();
      const label = list.find((el: any) => el.parent?.style?.text === 'outer')?.parent;
      return {
        renderItem: option.series[0].renderItem,
        renders: fixture.state.renders,
        over: fixture.state.over,
        bars: list.filter((el: any) => el.type === 'rect' && el.style.fill === '#4f46e5').length,
        position: label?.textConfig?.position,
      };
    });

    // Assert
    expect(await inspect()).toMatchObject({ renderItem: 'probe-registered', bars: 3, position: 'right' });
    expect((await inspect()).renders).toBeGreaterThanOrEqual(3);

    // Act
    const box = (await chart.boundingBox())!;
    await page.mouse.move(box.x + 340, box.y + 180);

    // Assert
    await expect.poll(async () => (await inspect()).over).toBeGreaterThan(0);
  });

  test(`RegisterLocale_TypedOptionDrivesLegendSelector ${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/globals/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Typed locale', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('locale');

    // Act
    const texts = await page.locator('.locale-chart').evaluate(async element => {
      const e = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      return e.getInstanceByDom(element).getZr().storage.getDisplayList().map((el: any) => el.style?.text).filter(Boolean);
    });

    // Assert
    expect(texts).toEqual(expect.arrayContaining(['All typed', 'Inverse typed']));
  });

  test(`LookupAndDispose_ByNativeIdAndElement ${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/globals/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Lookup and dispose', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('lookup:True:True:True:True:True:True');

    // Act
    const native = await page.locator('.lookup-chart').evaluateAll(async elements => {
      const e = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      return elements.map(
        element => ({ instance: !!e.getInstanceByDom(element as HTMLElement), canvases: element.querySelectorAll('canvas').length })
      );
    });

    // Assert
    expect(native).toEqual([{ instance: false, canvases: 0 }, { instance: false, canvases: 0 }]);
    expect(await page.locator('.global-chart canvas').count()).toBe(2);
  });

  test(`RegisterMap_StringGeoJsonWithTypedSpecialAreas ${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/globals/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'String map', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('string-map:2:100:50:20:True');

    // Act
    const value = await page.locator('.global-chart').first().evaluate(async element => {
      const e = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const map = e.getMap('string-geo');
      const ec = e.getInstanceByDom(element) as any;
      const geo = ec.getModel().getSeriesByIndex(0).coordinateSystem;
      const rect = (name: string) => {
        const r = geo.getRegion(name).getBoundingRect();
        return [r.x, r.y, r.width, r.height];
      };
      return { type: typeof map.geoJSON, areas: map.specialAreas, a: rect('A'), b: rect('B') };
    });

    // Assert
    expect(value).toEqual({ type: 'object', areas: { B: { left: 100, top: 50, width: 20 } }, a: [0, 0, 10, 10], b: [100, 50, 20, 20] });
  });

  test(`Groups_TrackConnectDisconnectAndMembers ${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/globals/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Connect', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('connected:True');

    // Act
    await page.getByRole('button', { name: 'Highlight', exact: true }).click();

    // Assert
    await expect(page.getByTestId('deliveries')).toHaveText('1');

    // Act
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('disconnected');

    // Act
    await page.getByRole('button', { name: 'Highlight', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('highlighted:2');
    await expect(page.getByTestId('deliveries')).toHaveText('1');

    // Act
    await page.getByRole('button', { name: 'Helpers', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('helpers:1.23:1.20:4,6:rgba(128,128,128,1)');
  });
}
