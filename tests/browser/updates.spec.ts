import { test, expect, type Page } from '@playwright/test';

// setOption calls the page runtime received from .NET.
const setOptions = (page: Page) => page.evaluate(async () =>
  (await import(new URL('_content/BlazorECharts/js/runtime-loader.js', document.baseURI).href)).resourceStatistics().toBrowser.setOption ?? 0);

export async function state(page: Page) {
  return page.evaluate(async () => {
    const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
    const native = ec.getInstanceByDom(document.querySelector('.update-chart'));
    return { id: native.id, option: native.getOption(), renderer: native.getZr().painter.getType() };
  });
}

for (const mode of ['server', 'wasm']) {
  test(`Updates_OrderReferenceMutation_${mode}`, async ({ page }) => {
    // Arrange
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    // Act
    await page.goto(`/harness/updates/${mode}`);

    // Assert
    await expect(page.getByTestId('ready')).toHaveText('1');

    // Act
    await page.getByRole('button', { name: 'Patch', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('patched');

    // Act
    const patched = await setOptions(page);
    await page.getByRole('button', { name: 'Parent render', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('parent render');

    // Act
    await page.getByRole('button', { name: 'Mutate only', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('mutated');

    // Act
    // The same patch again goes through the chart's ordered queue after anything the two clicks could have sent.
    await page.getByRole('button', { name: 'Patch', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('patched');
    expect(await setOptions(page)).toBe(patched + 1);
    expect((await state(page)).option.customUnknown).toEqual({ zero: 0, flag: false, empty: [] });
    expect((await state(page)).option.series[0].data).toEqual([4, 8, 3]);

    // Act
    await page.getByRole('button', { name: 'Apply mutation', exact: true }).click();

    // Assert
    await expect.poll(async () => (await state(page)).option.series[0].data).toEqual([9, 2, 7]);

    // Act
    await page.getByRole('button', { name: 'New reference', exact: true }).click();

    // Assert
    await expect.poll(async () => (await state(page)).option.series[0].data).toEqual([1, 5, 2]);
    expect(errors).toEqual([]);
  });

  test(`SetOption_RemoveSeriesWithReplaceMergeOrNotMerge_${mode}`, async ({ page }) => {
    // Act
    await page.goto(`/harness/updates/${mode}`);

    // Assert
    await expect(page.getByTestId('ready')).toHaveText('1');

    // Act
    await page.getByRole('button', { name: 'Add series', exact: true }).click();

    // Assert
    await expect.poll(async () => (await state(page)).option.series.length).toBe(2);

    // Act
    await page.getByRole('button', { name: 'Default remove', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('default merge');
    expect((await state(page)).option.series).toHaveLength(2);

    // Act
    await page.getByRole('button', { name: 'Replace remove', exact: true }).click();

    // Assert
    await expect.poll(async () => (await state(page)).option.series.length).toBe(1);

    // Act
    await page.getByRole('button', { name: 'Add series', exact: true }).click();

    // Assert
    await expect.poll(async () => (await state(page)).option.series.length).toBe(2);

    // Act
    await page.getByRole('button', { name: 'NotMerge remove', exact: true }).click();

    // Assert
    await expect.poll(async () => (await state(page)).option.series.length).toBe(1);
  });
}
