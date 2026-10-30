import { test, expect } from '@playwright/test';

// Zones with offsets that are not whole hours: ECharts parseDate reads only the hours of an offset.
for (const timezoneId of ['Asia/Kolkata', 'America/St_Johns']) {
  test.describe(timezoneId, () => {
    test.use({ timezoneId });

    for (const mode of ['server', 'wasm']) {
      test(`Dates_ReachEChartsAsTheWrittenInstant ${mode}`, async ({ page }) => {
        // Arrange
        const issues: string[] = [];
        page.on('pageerror', e => issues.push(e.message));
        page.on('console', m => {
          if (['warning', 'error'].includes(m.type()))
            issues.push(m.text());
        });
        await page.goto(`/harness/coordinates/${mode}`);
        await expect(page.getByTestId('status')).toHaveText('ready');

        // Act
        const coordinates = await page.locator('.component-chart').evaluate(async el => {
          const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
          const model = ec.getInstanceByDom(el).getModel();
          const data = model.getSeriesByIndex(0).getData();
          return { min: model.getComponent('xAxis', 0).axis.scale.getExtent()[0], when: [0, 1, 2].map(i => data.get('when', i)) };
        });

        // Assert
        expect(coordinates.when).toEqual([Date.UTC(2026, 9, 17), Date.UTC(2026, 9, 18), Date.UTC(2026, 9, 19)]);
        expect(coordinates.min).toBe(Date.UTC(2026, 9, 17));

        // Act
        await page.getByRole('button', { name: 'Dates', exact: true }).click();

        // Assert
        await expect(page.getByTestId('status')).toHaveText('dates');

        // Act
        const state = await page.locator('.component-chart').evaluate(async el => {
          const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
          const data = ec.getInstanceByDom(el).getModel().getSeriesByIndex(0).getData();
          return {
            offset: new Date(2026, 9, 19).getTimezoneOffset(),
            values: Array.from({ length: data.count() }, (_, i) => data.get('x', i)),
            wallClock: new Date(2026, 9, 19, 8, 30, 0, 500).getTime(),
            day: new Date(2026, 9, 19).getTime(),
          };
        });

        // Assert
        expect(Math.abs(state.offset) % 60).toBe(30);
        expect(state.values).toEqual([
          Date.UTC(2026, 9, 19, 8, 30, 0, 100),
          Date.UTC(2026, 9, 19, 8, 30, 0, 500),
          Date.UTC(2026, 9, 19, 8, 30, 0, 120),
          Date.UTC(2026, 9, 19, 8, 30, 0, 7),
          Date.UTC(2026, 9, 19, 8, 30, 0, 250),
          state.wallClock,
          state.day,
        ]);
        expect(issues).toEqual([]);
      });
    }
  });
}
