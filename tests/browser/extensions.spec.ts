import { test, expect } from '@playwright/test';

for (const mode of ['server', 'wasm']) {
  test(`ConsumerExtension_UsesSameRuntime_FacadeDisposal_PreservesOtherRuntimeUser ${mode}`, async ({ page }) => {
    // Act
    await page.goto(`/harness/globals/${mode}`);

    // Assert
    await expect(page.getByTestId('status')).toHaveText('ready');
    await expect(page.locator('.global-chart canvas')).toHaveCount(2);
    expect(await page.evaluate(async () => {
      const e = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const chart = e.getInstanceByDom(document.querySelector('.global-chart'));
      return {
        once: globalThis.__consumerCount,
        same: globalThis.__consumerRuntime === e,
        background: chart.getOption().backgroundColor,
        locale: chart.getModel().getLocaleModel().get(['legend', 'selector', 'all']),
      };
    })).toEqual({ once: 1, same: true, background: '#f0f4fa', locale: 'All synthetic' });

    // Act
    await page.getByRole('button', { name: 'Dispose first', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('survived:7');
    await expect(page.locator('.global-chart canvas')).toHaveCount(1);

    // Act
    await page.getByRole('button', { name: 'Conflict', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toContainText('RuntimeConfigurationConflict');
  });

  test(`Extensions_FailedImportRequiresExplicitRetry ${mode}`, async ({ page }) => {
    // Arrange
    let failed = false;
    await page.route('**/modules/consumer-extension.js*', route => {
      if (!failed) {
        failed = true;
        return route.fulfill({ status: 503, body: 'unavailable' });
      }

      return route.continue();
    });

    // Act
    await page.goto(`/harness/globals/${mode}`);

    // Assert
    await expect(page.getByTestId('status')).toContainText('error:');

    // Act
    await page.getByRole('button', { name: 'Retry', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('ready');
    expect(await page.evaluate(() => globalThis.__consumerCount)).toBe(1);
  });
}
