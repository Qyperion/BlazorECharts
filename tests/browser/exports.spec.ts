import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { countColorPixels, countFilledShapes } from './image-pixels.ts';

const artifact = join(process.cwd(), 'artifacts', 'exports');
mkdirSync(artifact, { recursive: true });

// Two animation frames give a wrongly accepted completion time to capture. With browser set, the export must
// also still be pending in the page accounting; without it, the export waits in .NET for managed member work.
async function stillWaiting(page: Page, browser = true) {
  const pending = () => page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return (await import(new URL('_content/BlazorECharts/js/runtime-loader.js', document.baseURI).href)).resourceStatistics().exports;
  });

  // With Interactive Server the click reaches the browser export only after a round trip to the circuit.
  if (browser)
    await expect.poll(pending).toBeGreaterThan(0);

  await expect(page.getByTestId('status')).toHaveText('waiting');
}

async function moduleFor(page: any, action: string, selector = '.export-a', extra?: any) {
  return page.evaluate(
    async ({ action, selector, extra }: any) => {
      const module = await import(new URL('modules/delayed-layout.js', document.baseURI).href);
      return module[action](selector, extra);
    },
    { action, selector, extra }
  );
}

for (const mode of ['server', 'wasm']) {
  test.describe(mode, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/harness/exports/${mode}`);
      await expect(page.getByTestId('ready')).toHaveText('ready');
    });

    test(`Export_ProducesInspectablePngSvg_${mode}`, async ({ page }) => {
      // Arrange
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));

      // Act
      await page.getByRole('button', { name: 'PNG', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toHaveText('png');

      // Act
      const png = await page.getByTestId('result').innerText();
      const dimensions = await page.evaluate(
        async data => {
          const image = new Image();
          image.src = data;
          await image.decode();
          return [image.naturalWidth, image.naturalHeight];
        },
        png
      );

      // Assert
      expect(dimensions).toEqual([640, 400]);
      expect(png).toMatch(/^data:image\/png;base64,/);

      // The probe draws its bars in magenta, a color nothing else on the chart uses.
      expect(await countColorPixels(page, png, '#ff00ff')).toBeGreaterThan(5_000);

      // Act
      writeFileSync(join(artifact, `${mode}.png`), Buffer.from(png.split(',')[1], 'base64'));
      await page.getByRole('button', { name: 'JPEG', exact: true }).click();

      // Assert
      await expect(page.getByTestId('result')).toHaveText(/^data:image\/jpeg;base64,/);
      expect(await countColorPixels(page, await page.getByTestId('result').innerText(), '#ff00ff', 60)).toBeGreaterThan(1_000);

      // Act
      await page.getByRole('button', { name: 'SVG markup', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toHaveText('svg');

      // Act
      const svg = await page.getByTestId('result').innerText();

      // Assert
      expect(await page.evaluate(
        s => {
          const d = new DOMParser().parseFromString(s, 'image/svg+xml');
          return [
            d.querySelector('parsererror') === null,
            d.documentElement.tagName,
            d.documentElement.hasAttribute('viewBox'),
            d.documentElement.textContent?.includes('Synthetic C'),
          ];
        },
        svg
      )).toEqual([true, 'svg', true, true]);

      // Both magenta bars are shapes of the exported markup.
      expect(await countFilledShapes(page, svg, '#ff00ff')).toBe(2);

      // Act
      writeFileSync(join(artifact, `${mode}.svg`), svg);
      await page.getByRole('button', { name: 'SVG data URL', exact: true }).click();

      // Assert
      await expect(page.getByTestId('result')).toHaveText(/^data:image\/svg\+xml/);

      // Act
      await page.getByRole('button', { name: 'Unsupported SVG', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toContainText('ExportRendererUnsupported');

      // Act
      await page.getByRole('button', { name: 'Canvas references', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toHaveText('canvas references released');
      expect(errors).toEqual([]);
    });

    test(`Stable_OldRevisionCannotCompleteNewWait_${mode}`, async ({ page }) => {
      // Arrange
      await moduleFor(page, 'begin');

      // Act
      await page.getByRole('button', { name: 'PNG', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toHaveText('waiting');

      // Act
      await moduleFor(page, 'updateAndBegin');
      await moduleFor(page, 'completeOld');
      await stillWaiting(page);
      await moduleFor(page, 'complete');

      // Assert
      await expect(page.getByTestId('status')).toHaveText('png');
      expect(await moduleFor(page, 'captureCount')).toBe(1);
    });

    test(`ConnectedExport_WaitsAllAndRechecksMembership_${mode}`, async ({ page }) => {
      // Act
      await page.getByRole('button', { name: 'Connect canvas', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toHaveText('connected canvas');

      // Act
      await moduleFor(page, 'begin', '.export-b');
      await page.getByRole('button', { name: 'Connected PNG', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toHaveText('waiting');

      // Act
      await moduleFor(page, 'begin', '.export-a');
      await moduleFor(page, 'complete', '.export-b');
      await stillWaiting(page);
      await moduleFor(page, 'complete', '.export-a');

      // Assert
      await expect(page.getByTestId('status')).toHaveText('connected png');

      // Act
      const png = await page.getByTestId('result').innerText();

      // Assert
      expect(await page.evaluate(
        async data => {
          const im = new Image();
          im.src = data;
          await im.decode();
          return [im.width, im.height];
        },
        png
      )).toEqual([660, 200]);
      expect(await countColorPixels(page, png, '#ff00ff')).toBeGreaterThan(2_000);

      // Act
      writeFileSync(join(artifact, `${mode}-connected.png`), Buffer.from(png.split(',')[1], 'base64'));
      await page.getByRole('button', { name: 'Connect svg', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toHaveText('connected svg');

      // Act
      await page.getByRole('button', { name: 'Connected SVG', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toContainText('ExportUpstreamFailed');
      writeFileSync(join(artifact, `${mode}-connected-svg-error.txt`), await page.getByTestId('status').innerText());
    });

    test(`Stability_TimeoutCancelFailureAndDispose_${mode}`, async ({ page }) => {
      // Arrange
      await moduleFor(page, 'begin');

      // Act
      await page.getByRole('button', { name: 'Short timeout', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toContainText(/timeout/i);

      // Act
      await page.getByRole('button', { name: 'Zero timeout', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toContainText('greater than zero');

      // Act
      await page.getByRole('button', { name: 'Cancel wait', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toHaveText('cancelled');

      // Act
      await moduleFor(page, 'fail');
      await page.getByRole('button', { name: 'PNG', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toContainText('synthetic failure');

      // Act
      await moduleFor(page, 'updateAndBegin');
      await page.getByRole('button', { name: 'Wait and dispose', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toHaveText('disposed wait cancelled');
    });

    test(`RepeatedExports_DoNotRetainResultsOrListeners_${mode}`, async ({ page }) => {
      // Act
      const before = await moduleFor(page, 'statistics');

      // Assert
      for (let i = 0; i < 5; i++) {
        await page.getByRole('button', { name: 'Canvas references', exact: true }).click();
        await expect(page.getByTestId('status')).toHaveText('canvas references released');
        await page.getByRole('button', { name: 'PNG', exact: true }).click();
        await expect(page.getByTestId('status')).toHaveText('png');
      }

      expect(await moduleFor(page, 'statistics')).toEqual(before);
    });

    test(`ConnectedMembership_JoinAndLeaveDuringWait_${mode}`, async ({ page }) => {
      // Act
      await page.getByRole('button', { name: 'Connect canvas', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toHaveText('connected canvas');

      // Act
      await moduleFor(page, 'leave', '.export-b');
      await moduleFor(page, 'begin', '.export-a');
      await moduleFor(page, 'begin', '.export-b');
      await page.getByRole('button', { name: 'Connected PNG', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toHaveText('waiting');

      // Act
      await moduleFor(page, 'join', '.export-b');
      await moduleFor(page, 'complete', '.export-a');
      await stillWaiting(page);
      await moduleFor(page, 'leave', '.export-b');

      // Assert
      await expect(page.getByTestId('status')).toHaveText('connected png');
    });

    test(`ImageReadiness_DelayedSvgImagePreventsCapture_${mode}`, async ({ page }) => {
      // Arrange
      let release!: () => void;
      const gate = new Promise<void>(r => release = r);
      await page.route('**/slow-export.svg', async route => {
        await gate;
        await route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
        });
      });
      await moduleFor(page, 'image', '.export-c');

      // Act
      await page.getByRole('button', { name: 'SVG markup', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toHaveText('waiting');

      // Act
      await stillWaiting(page);
      release();

      // Assert
      await expect(page.getByTestId('status')).toHaveText('svg');
    });

    test(`ConnectedExport_WaitsForAcceptedManagedMemberWork_${mode}`, async ({ page }) => {
      // Act
      await page.getByRole('button', { name: 'Connect canvas', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toHaveText('connected canvas');

      // Act
      await moduleFor(page, 'blockMemberRead', '.export-b');
      await page.getByRole('button', { name: 'Accept member update', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toHaveText('member update accepted');

      // Act
      await page.getByRole('button', { name: 'Connected PNG', exact: true }).click();
      await stillWaiting(page, false);
      await moduleFor(page, 'unblockMemberRead', '.export-b');

      // Assert
      await expect(page.getByTestId('status')).toHaveText('connected png');
      expect(await moduleFor(page, 'seriesData', '.export-b')).toEqual([7, 9]);
    });

    test(`ConnectedExport_DoesNotLeakNativeRenderers_${mode}`, async ({ page }) => {
      // Act
      await page.getByRole('button', { name: 'Connect canvas', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toHaveText('connected canvas');

      // Act
      await page.getByRole('button', { name: 'Connect svg', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toHaveText('connected svg');

      // Act
      await moduleFor(page, 'rendererCheckpoint');

      // Assert
      for (let i = 0; i < 3; i++) {
        await page.getByRole('button', { name: 'Connected PNG', exact: true }).click();
        await expect(page.getByTestId('status')).toHaveText('connected png');
        await page.getByRole('button', { name: 'Connected SVG', exact: true }).click();
        await expect(page.getByTestId('status')).toContainText('ExportUpstreamFailed');
      }

      expect(await moduleFor(page, 'liveRenderersSinceCheckpoint')).toEqual([]);
    });

    test(`ConnectedExport_LeavingMemberDoesNotHoldManagedBarrier_${mode}`, async ({ page }) => {
      // Act
      await page.getByRole('button', { name: 'Connect canvas', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toHaveText('connected canvas');

      // Act
      await moduleFor(page, 'blockMemberRead', '.export-b');
      await page.getByRole('button', { name: 'Accept member update', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toHaveText('member update accepted');

      // Act
      await page.getByRole('button', { name: 'Connected PNG', exact: true }).click();
      await stillWaiting(page, false);
      await moduleFor(page, 'leave', '.export-b');

      // Assert
      await expect(page.getByTestId('status')).toHaveText('connected png');
      await moduleFor(page, 'unblockMemberRead', '.export-b');
    });

    test(`BackgroundPatterns_WaitForChartAndExportResources_${mode}`, async ({ page }) => {
      // Act & Assert
      for (const kind of ['chart', 'export', 'connected']) {
        let release!: () => void;
        const gate = new Promise<void>(r => release = r);
        await page.route(`**/slow-background-${kind}.png`, async route => {
          await gate;
          await route.fulfill({
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#00ff00"/></svg>',
          });
        });
        if (kind === 'connected') {
          await page.getByRole('button', { name: 'Connect canvas', exact: true }).click();
          await expect(page.getByTestId('status')).toHaveText('connected canvas');
        }

        await moduleFor(page, 'background', '.export-a', kind);
        await page.getByRole('button', {
          name: kind === 'chart' ? 'Chart PNG' : kind === 'export' ? 'Pattern PNG' : 'Pattern connected PNG',
          exact: true,
        }).click();
        await stillWaiting(page);
        release();
        await expect(page.getByTestId('status')).toHaveText(kind === 'connected' ? 'connected png' : 'png');
        expect(await page.evaluate(
          async (data: string) => {
            const image = new Image();
            image.src = data;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(image, 0, 0);
            return Array.from(ctx.getImageData(0, 0, 1, 1).data);
          },
          await page.getByTestId('result').innerText()
        )).toEqual([0, 255, 0, 255]);
        await page.unroute(`**/slow-background-${kind}.png`);
      }
    });

    test(`BackgroundPatterns_FailedResourceRejectsExport_${mode}`, async ({ page }) => {
      // Arrange
      await page.route('**/slow-background-export.png', route => route.fulfill({ status: 404, body: 'missing image' }));

      // Act
      await page.getByRole('button', { name: 'Pattern PNG', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toContainText('ImageLoadFailed');
    });
  });
}
