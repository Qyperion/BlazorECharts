import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page, browser }, info) => {
  const captured: string[] = [];
  errors.set(page, captured);
  page.on('pageerror', error => captured.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !(info.title === 'MaskImage_FailureRejects' && message.text().includes('404'))) {
      captured.push(message.text());
    }
  });
  await info.attach('browser-version', { body: browser.version(), contentType: 'text/plain' });
  const response = await page.goto('/compatibility/');
  expect(response!.headers()['content-security-policy']).toContain("script-src 'self'");
  await expect(page.getByTestId('status')).toHaveText('ready');
});

test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

test('PackageDistribution_RendersTheUmdBundle', async ({ page }) => {
  // Act
  await page.goto('/compatibility/?distribution');

  // Assert
  await expect(page.getByTestId('status')).toHaveText('ready');
  expect(await page.evaluate(() => (window as any).probe.versions().entryPath)).toBe('upstream-distribution');

  // Act
  const result = await page.evaluate(() => (window as any).probe.render('canvas'));

  // Assert
  expect(result.count).toBe(200);
});

test('ExactPair_ReportsLockedVersions', async ({ page }) => {
  // Arrange
  const lock = JSON.parse(await readFile('schemas/upstream/sources.lock.json', 'utf8'));
  const pkg = lock.packages.find((p: any) => p.name === '@qyperion/echarts-wordcloud');

  // Act
  const result = await page.evaluate(() => (window as any).probe.versions());

  // Assert
  expect(result.echarts).toBe('6.1.0');
  expect(result.package).toBe('@qyperion/echarts-wordcloud');
  expect(result.wordcloud).toBe('3.0.0');
  expect(result.archiveHash).toBe(pkg.sha256);
  expect(result.installerHash).toBe(pkg.installer.sha256);
});

test('RegisterIntoPassedRuntime_UsesSingleIdentity', async ({ page }) => {
  // Act
  const result = await page.evaluate(() => (window as any).probe.identity());

  // Assert
  expect(result).toEqual({ sameInstance: true, registrations: 1, globalAbsent: true });

  // Act
  const meta = JSON.parse(await readFile('artifacts/compatibility/installer.meta.json', 'utf8'));

  // Assert
  expect(Object.keys(meta.inputs).some(p => /upstream[\\/]echarts[\\/]/.test(p))).toBe(false);
});

for (const renderer of ['canvas', 'svg']) {
  test(`WordCloud_CanvasAndSvg_Render200Words (${renderer})`, async ({ page }, info) => {
    // Act
    const result = await page.evaluate(r => (window as any).probe.render(r), renderer);

    // Assert
    expect(result.count).toBe(200);
    expect(result.names).toContain('W199');
    expect(result.shapeCalls).toBeGreaterThan(0);
    expect(result.colorCalls).toBeGreaterThanOrEqual(200);
    expect(result.rotations).toContain(Math.PI / 2);
    expect(result.lastFill).toBe('rgb(255,0,255)');
    expect(result.signal).toBe('wordcloudstop');
    await info.attach('layout', { body: JSON.stringify(result), contentType: 'application/json' });
    await page.screenshot({ path: `artifacts/compatibility/${renderer}.png` });
  });
}

test('MaskImage_DecodeBeforeLayout', async ({ page }, info) => {
  // Arrange
  const result = await page.evaluate(() => (window as any).probe.mask());

  // Act
  await info.attach('mask', { body: JSON.stringify(result), contentType: 'application/json' });

  // Assert
  expect(result.decodedBeforeLayout).toBe(true);
  expect(result.count).toBeGreaterThan(0);
  expect(result.outside).toEqual([]);
});

test('MaskImage_FailureRejects', async ({ page }) => {
  // Act
  const result = await page.evaluate(() => (window as any).probe.badMask());

  // Assert
  expect(result.error).toMatch(/mask.*decode/i);
  expect(result.started).toBe(false);
});

test('Layout_UpdateResizeDispose_NoLateDrawing', async ({ page }, info) => {
  // Arrange
  const result = await page.evaluate(() => (window as any).probe.lifecycle());

  // Act
  await info.attach('lifecycle', { body: JSON.stringify(result), contentType: 'application/json' });

  // Assert
  expect(result.updated).toBe(200);
  expect(result.resized).toBe(200);
  expect(result.lateDraws).toBe(0);
  expect(result.supersededDraws).toBe(0);
  expect(result.pendingListeners).toBe(0);
  expect(result.remount).toBe(200);
});

for (const renderer of ['canvas', 'svg']) {
  test(`Export_AfterLayoutContainsLastWord (${renderer})`, async ({ page }, info) => {
    // Arrange
    const result = await page.evaluate(r => (window as any).probe.exportProof(r), renderer);
    const { image, ...evidence } = result;

    // Act
    await writeFile(
      `artifacts/compatibility/export.${renderer === 'svg' ? 'svg' : 'png'}`,
      renderer === 'svg' ? result.svg : Buffer.from(image.split(',')[1], 'base64')
    );

    // Assert
    expect(result.count).toBe(200);
    expect(result.beforeCount).toBeLessThan(200);
    expect(result.lastWord).toBe('W199');
    expect(result.finalPixels).toBeGreaterThan(0);
    expect(result.beforePixels).toBe(0);
    if (renderer === 'svg')
      expect(result.svg).toContain('W199');

    await info.attach('export-proof', { body: JSON.stringify(evidence), contentType: 'application/json' });
  });
}
