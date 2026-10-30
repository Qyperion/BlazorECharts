import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ browser }, testInfo) => {
  await testInfo.attach('browser-version', { body: browser.version(), contentType: 'text/plain' });
});

async function verifyRoundTrip(page: Page, route: string, renderer: string, location: string) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error')
      errors.push(message.text());
  });

  await page.goto(route);
  await expect(page.getByTestId('interactive')).toHaveText('true');
  await expect(page.getByTestId('renderer')).toHaveText(renderer);
  await expect(page.getByTestId('execution-location')).toHaveText(location);
  await expect(page.getByTestId('increment')).toBeEnabled();
  await expect(page.getByTestId('count')).toHaveText('0');
  await page.getByTestId('increment').click();
  await expect(page.getByTestId('count')).toHaveText('1');
  await page.getByTestId('increment').click();
  await expect(page.getByTestId('count')).toHaveText('2');
  expect(errors).toEqual([]);
}

// Self-checks of the test host: Server and WebAssembly interactivity without the library. They are not evidence of a requirement.
test('HarnessSelfCheck_ServerInteractiveRoundTrip', async ({ page }) => {
  // Act & Assert
  await verifyRoundTrip(page, '/harness/server', 'Server', 'server');
});

test('HarnessSelfCheck_WasmInteractiveRoundTrip', async ({ page }) => {
  // Act & Assert
  await verifyRoundTrip(page, '/harness/wasm', 'WebAssembly', 'browser');
});
