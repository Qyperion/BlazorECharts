import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fixtureFont } from './font-fixture.ts';

mkdirSync('artifacts/wordcloud', { recursive: true });

for (const mode of ['server', 'wasm'])
  test(`WordCloudTooltip_ItemStringObjectAndSeriesCascade ${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/wordcloud/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Tooltip WordCloud', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('tooltip');

    // Act
    const chart = page.locator('.tooltip-wordcloud');

    // Assert
    for (const [index, text] of [[0, 'item string'], [1, 'item object Beta'], [2, 'series Gamma']] as const) {
      await chart.evaluate(
        async (element, index) => {
          const bridge = await import('/_content/BlazorECharts/js/runtime-loader.js');
          bridge.getECharts().getInstanceByDom(element).dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: index });
        },
        index
      );
      await expect(chart).toContainText(text, { useInnerText: true });
    }
  });

for (const mode of ['server', 'wasm'])
  test(`WordCloudSeed_RepeatsLayoutWithLayersAndVisualMapOpacity ${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/wordcloud/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');
    const words = () => page.evaluate(async () => {
      const bridge = await import('/_content/BlazorECharts/js/runtime-loader.js');
      const data = bridge.getECharts()
        .getInstanceByDom(document.querySelector('.seeded-wordcloud'))
        .getModel()
        .getSeriesByType('wordCloud')[0]
        .getData();
      return Array.from({ length: data.count() }, (_, i) => data.getItemGraphicEl(i))
        .map((element, i) => element && {
          value: data.get('value', i),
          x: element.x,
          y: element.y,
          rotation: element.rotation,
          z: element.z,
          zlevel: element.zlevel,
          opacity: element.style.opacity,
        })
        .filter(Boolean);
    });

    // Act
    await page.getByRole('button', { name: 'Seeded WordCloud', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('seeded');

    // Act
    const first = await words();

    // Assert
    expect(first.length).toBeGreaterThan(20);
    expect(new Set(first.map(word => word.rotation)).size).toBeGreaterThan(1);
    for (const word of first) {
      expect(word.z, `${word.value}`).toBe(3);
      expect(word.zlevel, `${word.value}`).toBe(1);
      expect(word.opacity, `${word.value}`).toBeCloseTo(0.2 + 0.8 * (word.value - 1) / 29, 5);
    }

    // Act
    await page.getByRole('button', { name: 'Resize Seeded WordCloud', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('resized');
    expect(await words()).toEqual(first);
  });

for (const mode of ['server', 'wasm'])
  test(`WordCloudNonAnimatedLayout_10000WordsComplete ${mode}`, async ({ page }) => {
    // Arrange
    test.setTimeout(120_000);

    const failures: string[] = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && /call stack/i.test(message.text()))
        failures.push(message.text());
    });
    await page.goto(`/harness/wordcloud/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Large WordCloud', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('large', { timeout: 60_000 });

    // Act
    const result = await page.evaluate(async () => {
      const bridge = await import('/_content/BlazorECharts/js/runtime-loader.js');
      const series = bridge.getECharts().getInstanceByDom(
        document.querySelector('.managed-wordcloud-canvas')
      ).getModel().getSeriesByType('wordCloud')[0];
      const data = series.getData();
      return {
        count: data.count(),
        layoutAnimation: series.option.layoutAnimation,
        rendered: Array.from({ length: data.count() }, (_, i) => !!data.getItemGraphicEl(i)).filter(Boolean).length,
      };
    });

    // Assert
    expect(result.count).toBe(10_000);
    expect(result.layoutAnimation).toBeUndefined();
    expect(result.rendered).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

for (const mode of ['server', 'wasm'])
  test.describe(mode, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/harness/wordcloud/${mode}`);
      await expect(page.getByTestId('status')).toHaveText('ready');
      await page.evaluate(async () => {
        globalThis.wc = await import('/modules/wordcloud-fixtures.js');
        await wc.setup();
      });
    });

    test.afterEach(async ({ page }) => {
      const result = await page.evaluate(() => wc.cleanup());
      expect(result.listeners).toBe(0);
      expect(result.timers).toBe(0);
      expect(result.statistics).toEqual({ entries: 0, leases: 0, results: 0 });
    });

    for (const svg of [false, true])
      test(`WordCloudManagedExport_WaitsActualLayout ${mode} ${svg}`, async ({ page }) => {
        // Act
        await page.getByRole('button', { name: svg ? 'Stable WordCloud SVG' : 'Stable WordCloud PNG', exact: true }).click();

        // Assert
        await expect(page.getByTestId('status')).toHaveText('exported');

        // Act
        const value = await page.getByTestId('managed-export').innerText();

        // Assert
        if (svg)
          expect(value).toContain('Україна0199');
        else
          expect(value).toMatch(/^data:image\/png;base64,/);

        expect(await page.evaluate(
          async svg => {
            const bridge = await import('/_content/BlazorECharts/js/runtime-loader.js');
            const data = bridge.getECharts()
              .getInstanceByDom(document.querySelector(svg ? '.managed-wordcloud-svg' : '.managed-wordcloud-canvas'))
              .getModel()
              .getSeriesByType('wordCloud')[0]
              .getData();
            return Array.from({ length: data.count() }, (_, i) => !!data.getItemGraphicEl(i)).filter(Boolean).length;
          },
          svg
        )).toBe(200);
      });

    test(`WordCloudFinished_IsNotAssumedLayoutComplete ${mode}`, async ({ page }) => {
      // Act
      await page.evaluate(() => {
        wc.hold('SlowFirst');
        wc.update(0, 200, 'SlowFirst');
        void wc.capture(0);
      });

      // Assert
      // ECharts reports finished while the layout still waits for its font; the capture must not take it for the end.
      await expect.poll(() => page.evaluate(() => wc.state().events.some(e => e.index === 0 && e.kind === 'finished'))).toBe(true);

      // Act
      await page.evaluate(() => wc.settle());

      // Assert
      expect(await page.evaluate(() => wc.state().capture.status)).toBe('pending');
      expect(await page.evaluate(() => wc.state().rendered[0].length)).toBe(0);

      // Act
      await page.evaluate(() => wc.release('SlowFirst'));

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('done');
      expect(await page.evaluate(() => wc.state().rendered[0].length)).toBe(200);

      // Act
      const events = await page.evaluate(() => wc.state().events.filter(e => e.index === 0));

      // Assert
      expect(events.some(e => e.kind === 'finished' && e.count < 200)).toBe(true);
      expect(events.some(e => e.kind === 'stop' && e.count === 200)).toBe(true);
      writeFileSync(`artifacts/wordcloud/${mode}-events.json`, JSON.stringify(events, null, 2));
    });

    for (const action of ['hideLoading', 'highlight'])
      test(`WordCloudActiveLayout_SurvivesNonLayoutRevision ${mode} ${action}`, async ({ page }) => {
        // Act
        await page.evaluate(
          action => {
            wc.hold('ActiveFont');
            wc.update(0, 20, 'ActiveFont');
            wc.nonLayout(0, action);
            void wc.capture(0);
          },
          action
        );
        await page.evaluate(() => wc.settle());

        // Assert
        expect(await page.evaluate(() => wc.state().capture.status)).toBe('pending');

        // Act
        await page.evaluate(() => wc.release('ActiveFont'));

        // Assert
        await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('done');
        expect(await page.evaluate(() => wc.state().rendered[0].length)).toBe(20);
      });

    for (const rich of [false, true])
      test(`WordCloudItemFonts_RealFailureReportsAndDrawsFallbackFont ${mode} ${rich}`, async ({ page }) => {
        // Arrange
        const requests: string[] = [];
        page.on('request', request => {
          if (request.url().endsWith('/missing-item-font.woff2'))
            requests.push(request.url());
        });
        await page.route('**/missing-item-font.woff2', route => route.fulfill({ status: 404, body: 'missing font' }));
        await page.addStyleTag({
          content: "@font-face{font-family:ItemFace;src:url('/missing-item-font.woff2');font-style:italic;font-weight:bold}",
        });

        // Act
        await page.evaluate(
          rich => {
            wc.itemFonts('ItemFace', rich);
            void wc.capture(0);
          },
          rich
        );

        // Assert
        await expect.poll(() => page.evaluate(() => wc.state().capture.status), { timeout: 3000 }).toBe('error');
        expect(requests.length).toBeGreaterThan(0);
        expect(await page.evaluate(() => wc.state().capture.error)).toContain('LayoutFailed');
        await expect.poll(() => page.evaluate(() => wc.state().rendered[0].length)).toBe(2);
        expect(await page.evaluate(() => wc.browserErrorDetails())).toEqual([{ code: 'LayoutFailed', operation: 'layout:WordCloud' }]);
      });

    for (const rich of [false, true])
      test(`WordCloudItemFonts_RealDelayedResourceBlocksLayout ${mode} ${rich}`, async ({ page }) => {
        // Arrange
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let requested = false;
        await page.route('**/delayed-item-font.ttf', async route => {
          requested = true;
          await gate;
          await route.fulfill({ contentType: 'font/ttf', body: fixtureFont('DelayedItemFace') });
        });
        await page.addStyleTag({
          content: "@font-face{font-family:DelayedItemFace;src:url('/delayed-item-font.ttf');font-style:italic;font-weight:bold}",
        });
        try {
          // Act
          await page.evaluate(
            rich => {
              wc.itemFonts('DelayedItemFace', rich);
              void wc.capture(0);
            },
            rich
          );

          // Assert
          await expect.poll(() => requested).toBe(true);
          expect(await page.evaluate(() => wc.state().capture.status)).toBe('pending');
          expect(await page.evaluate(() => wc.state().rendered[0].length)).toBe(0);

          // Act
          release();

          // Assert
          await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('done');
          expect(await page.evaluate(() => document.fonts.check('italic bold 16px DelayedItemFace'))).toBe(true);
          expect(await page.evaluate(() => wc.state().rendered[0].length)).toBe(2);
        } finally {
          release();
        }
      });

    test(`WordCloudLayoutFailure_PersistsAcrossVisualActionsUntilReplacement ${mode}`, async ({ page }) => {
      // Act
      await page.evaluate(() => {
        wc.hold('CarriedFailure');
        wc.update(0, 20, 'CarriedFailure');
        wc.nonLayout(0, 'hideLoading');
        void wc.capture(0);
        wc.release('CarriedFailure', true);
      });

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('error');

      // Act
      await page.evaluate(() => {
        wc.nonLayout(0, 'highlight');
        void wc.capture(0);
      });

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('error');

      // Act
      await page.evaluate(() => {
        wc.update(0, 20);
        void wc.capture(0);
      });

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('done');
    });

    for (const kind of ['size', 'token'])
      test(`WordCloudFontNormalization_MatchesPinnedRenderer ${mode} ${kind}`, async ({ page }) => {
        // Arrange
        await page.route('**/unused-token-font.woff2', route => route.fulfill({ status: 404, body: 'unused' }));
        await page.addStyleTag({ content: "@font-face{font-family:UnusedInvalidTokenFace;src:url('/unused-token-font.woff2')}" });

        // Act
        await page.evaluate(
          kind => {
            wc.fontEdgeCase(kind);
            void wc.capture(0);
          },
          kind
        );

        // Assert
        await expect.poll(() => page.evaluate(() => wc.state().capture.status), { timeout: 3000 }).toBe('done');
        expect(await page.evaluate(() => wc.state().rendered[0].length)).toBe(2);
      });

    test(`WordCloudOldCompletion_CannotReleaseLatestRevision ${mode}`, async ({ page }) => {
      // Act
      await page.evaluate(() => {
        wc.hold('OldFont');
        wc.update(0, 200, 'OldFont');
        globalThis.oldLayout = wc.oldCanvas(0);
        void wc.capture(0);
      });
      await page.evaluate(() => {
        wc.hold('NewFont');
        wc.update(0, 1, 'NewFont', 'Новий');
        wc.release('OldFont');
        oldLayout.dispatchEvent(new Event('wordcloudstop'));
        wc.resize(0);
      });
      await page.evaluate(() => wc.settle());

      // Assert
      expect(await page.evaluate(() => wc.state().capture.status)).toBe('pending');

      // Act
      await page.evaluate(() => wc.release('NewFont'));

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('done');
      expect(await page.evaluate(() => wc.state().rendered[0])).toEqual(['Новий0000']);
    });

    test(`WordCloudEmptyAndCancelledLayout_Terminate ${mode}`, async ({ page }) => {
      // Act
      await page.evaluate(() => {
        wc.update(0, 0);
        void wc.capture(0);
      });

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('done');

      // Act
      await page.evaluate(() => {
        wc.hold('CancelFont');
        wc.update(0, 200, 'CancelFont');
        void wc.capture(0);
        wc.cancel(0);
      });

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('error');
      expect(await page.evaluate(() => wc.state().capture.error)).toContain('LayoutCancelled');

      // Act
      await page.evaluate(() => {
        wc.update(0, 1);
        void wc.capture(0);
      });

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('done');
    });

    for (const index of [0, 1])
      test(`WordCloudExport_MatchesFinalRenderedSet ${mode} ${index}`, async ({ page }) => {
        // Act
        await page.evaluate(
          index => {
            wc.update(index, 200);
            void wc.capture(index, index === 0 ? 'getDataURL' : 'renderToSVGString');
          },
          index
        );

        // Assert
        await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('done');

        // Act
        const state = await page.evaluate(() => wc.state());

        // Assert
        expect(state.rendered[index]).toHaveLength(200);

        // Act
        const value = state.capture.value.value;

        // Assert
        if (index === 1) {
          const labels = await page.evaluate(
            svg => [...new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('text')].map(e => e.textContent),
            value
          );
          expect(labels.sort()).toEqual([...state.rendered[1]].sort());
          writeFileSync(`artifacts/wordcloud/${mode}.svg`, value);
        } else {
          const pixels = await page.evaluate(
            async data => {
              const im = new Image();
              im.src = data;
              await im.decode();
              const c = document.createElement('canvas');
              c.width = im.width;
              c.height = im.height;
              const ctx = c.getContext('2d');
              ctx.drawImage(im, 0, 0);
              const bytes = ctx.getImageData(0, 0, c.width, c.height).data;
              let magenta = 0;
              let blue = 0;
              for (let i = 0; i < bytes.length; i += 4) {
                if (bytes[i] > 200 && bytes[i + 1] < 80 && bytes[i + 2] > 200)
                  magenta++;

                if (bytes[i] < 80 && bytes[i + 1] > 50 && bytes[i + 2] > 100)
                  blue++;
              }

              return { width: im.width, height: im.height, magenta, blue };
            },
            value
          );
          expect(pixels.width).toBe(700);
          expect(pixels.height).toBe(400);
          expect(pixels.magenta).toBeGreaterThan(0);
          expect(pixels.blue).toBeGreaterThan(1000);
          writeFileSync(`artifacts/wordcloud/${mode}.png`, Buffer.from(value.split(',')[1], 'base64'));
        }
      });

    test(`ConnectedWordCloudExport_WaitsSlowMember ${mode}`, async ({ page }) => {
      // Act
      await page.evaluate(() => {
        wc.hold('FastFont');
        wc.hold('SlowFont');
        wc.update(0, 20, 'FastFont');
        wc.update(2, 200, 'SlowFont');
        wc.standard();
        wc.connect();
        void wc.capture(0, 'getConnectedDataURL');
      });
      await page.evaluate(() => wc.release('FastFont'));

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().rendered[0].length)).toBe(20);
      expect(await page.evaluate(() => wc.state().capture.status)).toBe('pending');

      // Act
      await page.evaluate(() => wc.release('SlowFont'));

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('done');
      expect(await page.evaluate(() => wc.state().rendered[2].length)).toBe(200);
      writeFileSync(
        `artifacts/wordcloud/${mode}-connected.png`,
        Buffer.from((await page.evaluate(() => wc.state().capture.value.value)).split(',')[1], 'base64')
      );
    });

    test(`ConnectedWordCloudExport_VisualActionKeepsSlowLayout ${mode}`, async ({ page }) => {
      // Act
      await page.evaluate(() => {
        wc.hold('ConnectedCarried');
        wc.update(0, 1);
        wc.update(2, 200, 'ConnectedCarried');
        wc.standard();
        wc.connect();
        wc.nonLayout(2, 'highlight');
        void wc.capture(0, 'getConnectedDataURL');
      });
      await page.evaluate(() => wc.settle());

      // Assert
      expect(await page.evaluate(() => wc.state().capture.status)).toBe('pending');

      // Act
      await page.evaluate(() => wc.release('ConnectedCarried'));

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('done');
      expect(await page.evaluate(() => wc.state().rendered[2].length)).toBe(200);
    });

    test(`WordCloudReadiness_CoversFontsMasksAndDisposal ${mode}`, async ({ page }) => {
      // Act
      await page.evaluate(() => {
        wc.hold('FailFont');
        wc.update(0, 200, 'FailFont');
        void wc.capture(0);
        wc.release('FailFont', true);
      });

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('error');
      expect(await page.evaluate(() => wc.state().capture.error)).toContain('font failed');

      // Act
      await page.evaluate(() => {
        wc.hold('DisposeFont');
        wc.update(0, 2000, 'DisposeFont');
        void wc.capture(0);
        wc.dispose(0);
        wc.release('DisposeFont');
      });

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('error');
      expect(await page.evaluate(() => wc.state().capture.error)).toMatch(/disposed/i);
    });

    test(`WordCloudResourceFailure_ReleasesPluginListeners ${mode}`, async ({ page }) => {
      // Arrange
      await page.route('**/missing-wordcloud-mask.svg', route => route.fulfill({ status: 404, body: 'missing mask' }));

      // Act
      await page.evaluate(async () => {
        await wc.mask(new URL('/missing-wordcloud-mask.svg', location.href).href);
        void wc.capture(0);
      });

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('error');
      expect(await page.evaluate(() => wc.state().capture.error)).toContain('LayoutFailed');
      expect(await page.evaluate(() => wc.listeners())).toBe(0);
      expect(await page.evaluate(() => wc.state().rendered[0].length)).toBe(0);

      // Act
      await page.evaluate(() => {
        wc.hold('FailedFont');
        wc.update(0, 20, 'FailedFont');
        void wc.capture(0);
        wc.release('FailedFont', true);
      });

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('error');
      await expect.poll(() => page.evaluate(() => wc.state().rendered[0].length)).toBe(20);
      await expect.poll(() => page.evaluate(() => wc.listeners())).toBe(0);
    });

    test(`WordCloudCancellationDuringDraw_DoesNotScheduleAnotherIteration ${mode}`, async ({ page }) => {
      // Act
      await page.evaluate(() => {
        wc.update(0, 2000);
        wc.cancelDuringDraw();
        void wc.capture(0);
      });

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('error');
      expect(await page.evaluate(() => globalThis.wcPendingWithoutCancel)).toBe(1);
      expect(await page.evaluate(() => globalThis.wcPendingAfterCancel)).toBe(0);
    });

    test(`WordCloudNonAnimatedLayout_CancelsInitialTimer ${mode}`, async ({ page }) => {
      // Act
      await page.evaluate(() => {
        wc.update(0, 200, 'Arial', 'W', { layoutAnimation: false });
        void wc.capture(0);
      });

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('done');
      expect(await page.evaluate(() => wc.state().rendered[0].length)).toBe(200);

      // Act
      await page.evaluate(() => {
        wc.update(0, 2000, 'Arial', 'Скасований', { layoutAnimation: false });
        wc.cancelOnStart();
        void wc.capture(0);
      });

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('error');

      // Act
      const start = await page.evaluate(() => globalThis.wcStartTimeouts);

      // Assert
      expect(start).toHaveLength(1);
      expect(await page.evaluate(() => wc.timerIds().clearedTimeouts)).toEqual(start);
      expect(await page.evaluate(() => globalThis.wcPendingTimeoutAfterCancel)).toBe(0);
    });

    test(`WordCloudAnimatedCancel_DoesNotClearTimeoutWithImmediateId ${mode}`, async ({ page }) => {
      // Act
      await page.evaluate(() => {
        wc.update(0, 2000);
        void wc.capture(0);
      });

      // Assert
      await expect.poll(() => page.evaluate(() => wc.draws())).toBeGreaterThan(5);

      // Act
      const pending = await page.evaluate(() => {
        const pending = wc.timerIds().pendingImmediate;
        wc.cancel(0);
        return pending;
      });

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('error');

      // Act
      const ids = await page.evaluate(() => wc.timerIds());

      // Assert
      expect(ids.immediate.length).toBeGreaterThan(5);
      expect(pending).toHaveLength(1);
      expect(ids.clearedImmediates).toEqual(pending);
      expect(ids.clearedTimeouts).toEqual([]);
    });

    test(`WordCloudFailedFirstRender_UpdatesAndDisposes ${mode}`, async ({ page }) => {
      // Act & Assert
      expect(await page.evaluate(() => wc.failedFirstRender(0))).toContain('formatter failed');
      expect(await page.evaluate(() => wc.replaceWithPie(0))).toBeNull();
      expect(await page.evaluate(() => wc.disposeChecked(0))).toBeNull();
      expect(await page.evaluate(() => wc.registered(0))).toBe(false);
      await expect.poll(() => page.evaluate(() => wc.pendingTimers())).toBe(0);
    });

    test(`WordCloudBrush_KeepsWordsAndExport ${mode}`, async ({ page }) => {
      // Act
      await page.evaluate(() => {
        wc.brushed(1);
        void wc.capture(1, 'awaitStable');
      });

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('done');
      expect(await page.evaluate(() => wc.attached(1))).toBe(20);

      // Act
      await page.evaluate(() => {
        wc.brush(1);
        void wc.capture(1, 'renderToSVGString');
      });

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('done');
      expect(await page.evaluate(() => wc.attached(1))).toBe(20);

      // Act
      const svg = await page.evaluate(() => wc.state().capture.value.value);
      const labels = await page.evaluate(
        svg => [...new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('text')].map(
          e => e.textContent
        ).filter(t => t?.startsWith('Слово')),
        svg
      );

      // Assert
      expect(labels).toHaveLength(20);
    });

    test(`WordCloudHangingFont_FallsBackAfterTimeout ${mode}`, async ({ page }) => {
      // Arrange
      test.setTimeout(30_000);

      let requested = false;
      await page.route('**/hanging-wordcloud-font.woff2', () => { requested = true; });
      await page.addStyleTag({ content: "@font-face{font-family:HangingFace;src:url('/hanging-wordcloud-font.woff2')}" });
      const started = Date.now();

      // Act
      await page.evaluate(() => {
        wc.update(0, 20, 'HangingFace');
        void wc.capture(0, 'getDataURL', 15000);
      });

      // Assert
      await expect.poll(() => requested).toBe(true);
      await expect.poll(() => page.evaluate(() => wc.state().capture.status), { timeout: 8000 }).toBe('error');
      expect(Date.now() - started).toBeLessThan(8000);

      // The layout gave up on the font only after the 3 s font timeout of the page clock, not at once.
      expect(await page.evaluate(() => wc.state().capture.endedAt - wc.state().capture.startedAt)).toBeGreaterThanOrEqual(3000);
      expect(await page.evaluate(() => wc.state().capture.error)).toMatch(/LayoutFailed[\s\S]*HangingFace/);
      await expect.poll(() => page.evaluate(() => wc.state().rendered[0].length)).toBe(20);
      expect(await page.evaluate(() => wc.browserErrorDetails())).toEqual([{ code: 'LayoutFailed', operation: 'layout:WordCloud' }]);
    });

    test(`WordCloudInvalidUnquotedFamily_FailsAndDrawsFallback ${mode}`, async ({ page }) => {
      // Act
      await page.evaluate(() => {
        wc.update(0, 20, 'M PLUS 1p');
        void wc.capture(0);
      });

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('error');
      expect(await page.evaluate(() => wc.state().capture.error)).toContain('LayoutFailed');
      await expect.poll(() => page.evaluate(() => wc.state().rendered[0].length)).toBe(20);
      expect(await page.evaluate(() => wc.browserErrorDetails())).toEqual([{ code: 'LayoutFailed', operation: 'layout:WordCloud' }]);
    });

    test(`WordCloudForeignChart_RendersWithoutStability ${mode}`, async ({ page }) => {
      // Arrange
      const errors: string[] = [];

      // Act
      page.on('pageerror', error => errors.push(error.message));

      // Assert
      expect(await page.evaluate(() => wc.foreign([[20, { layoutAnimation: false }], [20, {}]]))).toEqual([]);
      await expect.poll(() => page.evaluate(() => wc.foreignRendered())).toBe(20);
      expect(errors).toEqual([]);
    });

    test(`WordCloudMaskDecode_AndCorsFailureAreObserved ${mode}`, async ({ page }) => {
      // Arrange
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      let requested = false;
      await page.route('**/slow-wordcloud-mask.svg', async route => {
        requested = true;
        await gate;
        await route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="700" height="400"><rect width="700" height="400" fill="black"/></svg>',
        });
      });
      try {
        // Act
        await page.evaluate(async () => {
          await wc.mask(new URL('/slow-wordcloud-mask.svg', location.href).href);
          void wc.capture(0);
        });

        // Assert
        await expect.poll(() => requested).toBe(true);

        // Act
        await page.evaluate(() => wc.settle());

        // Assert
        expect(await page.evaluate(() => wc.state().capture.status)).toBe('pending');

        // Act
        release();

        // Assert
        await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('done');
        expect(await page.evaluate(() => wc.state().rendered[0].length)).toBe(20);
      } finally {
        release();
      }

      // Act
      await page.evaluate(async () => {
        const url = new URL('/modules/wordcloud-mask.svg', location.href);
        url.hostname = location.hostname === '127.0.0.1' ? 'localhost' : '127.0.0.1';
        await wc.mask(url.href);
        void wc.capture(0);
      });

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('error');
      expect(await page.evaluate(() => wc.state().capture.error)).toContain('LayoutFailed');
    });

    test(`WordCloudAsyncFailure_RejectsWithoutUnhandledError ${mode}`, async ({ page }) => {
      // Arrange
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));

      // Act
      await page.evaluate(async () => {
        await wc.brokenShape();
        void wc.capture(0);
      });

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('error');
      expect(await page.evaluate(() => wc.state().capture.error)).toContain('shape callback failed');
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => wc.listeners())).toBe(0);
      expect(await page.evaluate(() => wc.browserErrorDetails())).toEqual([{ code: 'LayoutFailed', operation: 'layout:WordCloud' }]);
    });

    test(`WordCloudOverallDeadline_DoesNotRestartAfterFontReady ${mode}`, async ({ page }) => {
      // The page clock times the deadline: a restart at the second layout would end it a full deadline after that layout.

      // Arrange
      const deadline = 1000;
      await page.evaluate(
        deadline => {
          wc.hold('FirstDeadline');
          wc.hold('SecondDeadline');
          wc.update(0, 200, 'FirstDeadline');
          void wc.capture(0, 'getDataURL', deadline);
        },
        deadline
      );
      await page.waitForFunction(() => performance.now() - wc.state().capture.startedAt >= 300);

      // Act
      const relayout = await page.evaluate(() => {
        wc.release('FirstDeadline');
        wc.update(0, 200, 'SecondDeadline');
        return performance.now() - wc.state().capture.startedAt;
      });

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status), { timeout: 5000 }).toBe('error');

      // Act
      const capture = await page.evaluate(() => wc.state().capture);

      // Assert
      expect(capture.error).toContain('StabilityTimeout');
      expect(relayout).toBeLessThan(deadline);
      expect(capture.endedAt - capture.startedAt).toBeGreaterThanOrEqual(deadline);
      expect(capture.endedAt - capture.startedAt).toBeLessThan(relayout + deadline);
      await page.evaluate(() => wc.release('SecondDeadline'));
    });

    test(`WordCloudRecreate_DiscardsOldGeneration ${mode}`, async ({ page }) => {
      // Act
      await page.evaluate(() => {
        wc.hold('RecreateFont');
        wc.update(0, 20, 'RecreateFont');
        globalThis.oldLayout = wc.oldCanvas(0);
        void wc.capture(0, 'awaitStable');
        wc.recreate(0);
        oldLayout.dispatchEvent(new Event('wordcloudstop'));
      });
      await page.evaluate(() => wc.settle());

      // Assert
      expect(await page.evaluate(() => wc.state().capture.status)).toBe('pending');

      // Act
      await page.evaluate(() => wc.release('RecreateFont'));

      // Assert
      await expect.poll(() => page.evaluate(() => wc.state().capture.status)).toBe('done');
      expect(await page.evaluate(() => wc.state().rendered[0].length)).toBe(20);
    });

    for (const index of [0, 1])
      test(`WordCloudLargeUnicode_FinalRenderedSetAndCleanup ${mode} ${index}`, async ({ page }) => {
        // Act
        await page.evaluate(
          index => {
            wc.update(index, 2000, 'Arial', 'ДовгеУкраїнськеСлово');
            void wc.capture(index, index === 0 ? 'getDataURL' : 'renderToSVGString', 30000);
          },
          index
        );

        // Assert
        await expect.poll(() => page.evaluate(() => wc.state().capture.status), { timeout: 35000 }).toBe('done');

        // Act
        const state = await page.evaluate(() => wc.state());

        // Assert
        expect(state.rendered[index].length).toBeGreaterThan(0);
        expect(state.rendered[index].length).toBeLessThan(2000);
        if (index === 1) {
          const labels = await page.evaluate(
            svg => [...new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('text')].map(e => e.textContent),
            state.capture.value.value
          );
          expect(labels.sort()).toEqual([...state.rendered[index]].sort());
        }

        // Act
        await page.evaluate(index => wc.dispose(index), index);
        const before = await page.evaluate(() => wc.statistics());
        await page.evaluate(() => wc.settle());

        // Assert
        expect(await page.evaluate(() => wc.statistics())).toEqual(before);
      });
  });
