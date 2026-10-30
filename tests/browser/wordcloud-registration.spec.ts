import { test, expect } from '@playwright/test';

for (const mode of ['server', 'wasm']) {
  test(`WordCloudRegistration_UsesOnlyCoreRuntime ${mode}`, async ({ page }) => {
    // Act
    await page.goto(`/harness/wordcloud-registration/${mode}`);

    // Assert
    await expect(page.getByTestId('status')).toHaveText('ready');
    await expect.poll(() => page.evaluate(async () => {
      const e = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      return [...document.querySelectorAll('.wordcloud-chart')].map(el => {
        const c = e.getInstanceByDom(el);
        const words = c?.getModel().getSeriesByType('wordCloud')[0]?.getData();
        return words ? Array.from({ length: words.count() }, (_, i) => !!words.getItemGraphicEl(i)).filter(Boolean).length : 0;
      });
    })).toEqual([20, 20]);

    // Act
    const state = await page.evaluate(async () => {
      const e = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const m = await import('/_content/BlazorECharts.WordCloud/js/wordcloud-extension.js');
      m.register(e);
      m.register(e);
      return {
        shape: globalThis.__wordCloudShapeCalls > 0,
        color: globalThis.__wordCloudColorCalls >= 40,
        global: !!globalThis.echarts,
        types: e.getInstanceByDom(document.querySelector('.wordcloud-chart')).getOption().series.map(s => s.type),
      };
    });

    // Assert
    expect(state).toEqual({ shape: true, color: true, global: false, types: ['pie', 'wordCloud'] });

    // Act
    await page.getByRole('button', { name: 'Round trip', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('roundtrip');

    // Act
    await page.getByRole('button', { name: 'Dispose first', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('survived');
    await expect(page.locator('.wordcloud-chart canvas')).toHaveCount(1);
  });

  test(`WordCloud_MaskDecodeFailureIsObservable ${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/wordcloud-registration/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Broken mask', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toContainText('Image decode/CORS failed:');
  });

  test(`WordCloud_MaskUsesDecodedNativeImage ${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/wordcloud-registration/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Mask', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('mask');
    await expect.poll(() => page.evaluate(async () => {
      const e = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const c = e.getInstanceByDom(document.querySelectorAll('.wordcloud-chart')[1]);
      const model = c.getModel().getSeriesByType('wordCloud')[0];
      const image = model.get('maskImage');
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth === 700 && model.getData().getItemGraphicEl(19) != null;
    })).toBe(true);
  });

  for (const allowed of [false, true])
    test(`WordCloud_InlinePolicy ${mode} ${allowed}`, async ({ page }) => {
      // Arrange
      await page.goto(`/harness/wordcloud-registration/${mode}${allowed ? '?inline=1' : ''}`);
      await expect(page.getByTestId('status')).toHaveText('ready');

      // Act
      await page.getByRole('button', { name: 'Inline', exact: true }).click();

      // Assert
      if (allowed) {
        await expect(page.getByTestId('status')).toHaveText('inline');
        expect(await page.evaluate(async () => {
          const e = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
          const option = e.getInstanceByDom(document.querySelectorAll('.wordcloud-chart')[1]).getOption().series[0];
          return [option.shape(0), option.textStyle.color({})];
        })).toEqual([1, '#2468ac']);
      } else
        await expect(page.getByTestId('status')).toContainText('requires AllowInlineJavaScript=true');
    });

  test(`WordCloudClick_DeliversChartEventsClick ${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/wordcloud-registration/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Subscribe click', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('subscribed');

    // Act
    const center = () => page.evaluate(async () => {
      const e = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const element = document.querySelectorAll('.wordcloud-chart')[1];
      const word = e.getInstanceByDom(element).getModel().getSeriesByType('wordCloud')[0].getData().getItemGraphicEl(3);
      if (!word)
        return null;

      element.scrollIntoView({ block: 'center' });
      const bounds = word.getBoundingRect().clone();
      bounds.applyTransform(word.getComputedTransform());
      const box = element.getBoundingClientRect();
      return { x: box.left + bounds.x + bounds.width / 2, y: box.top + bounds.y + bounds.height / 2 };
    });

    // Assert
    await expect.poll(center).not.toBeNull();

    // Act
    const target = (await center())!;
    await page.mouse.click(target.x, target.y);

    // Assert
    await expect(page.getByTestId('clicked')).toHaveText('series:wordCloud:1:3:Word03');
  });

  test(`WordCloudTextStyle_NativeDashesAndRichTokens ${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/wordcloud-registration/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Text styles', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('textstyles');
    await expect.poll(() => page.evaluate(async () => {
      const e = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const model = e.getInstanceByDom(document.querySelectorAll('.wordcloud-chart')[1]).getModel().getSeriesByType('wordCloud')[0];
      const style = model.getData().getItemGraphicEl(0)?.style;
      return style && {
        borderDash: style.borderDash,
        lineDash: style.lineDash,
        overflow: style.overflow,
        lineOverflow: style.lineOverflow,
        ellipsis: style.ellipsis,
        tokenFill: style.rich?.token?.fill,
        tokenDash: style.rich?.token?.lineDash,
      };
    })).toEqual({
      borderDash: [4, 2],
      lineDash: 3,
      overflow: 'truncate',
      lineOverflow: 'truncate',
      ellipsis: '~',
      tokenFill: 'red',
      tokenDash: [2, 1],
    });
  });
}

test('WordCloud_RemainsOptionalOnCorePages', async ({ page }) => {
  // Arrange
  const optional: string[] = [];
  page.on('request', r => {
    if (r.url().includes('/_content/BlazorECharts.WordCloud/'))
      optional.push(r.url());
  });

  // Act
  await page.goto('/harness/functions/server');

  // Assert
  await expect(page.getByTestId('status')).toHaveText('ready');
  expect(optional).toEqual([]);
});
