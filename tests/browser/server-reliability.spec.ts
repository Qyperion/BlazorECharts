import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';

// Interactive Server: lost replies, oversized events and outages, with the deterministic reconnect handler of the lifecycle harness.
async function open(page: Page, query = '') {
  await page.addInitScript(() => {
    (window as any).chartErrors = [] as { code: string; operation: string; subscriptionId?: string }[];
    document.addEventListener('blazorecharts:error', event => (window as any).chartErrors.push((event as CustomEvent).detail));
    window.addEventListener(
      'unhandledrejection',
      event => (window as any).chartErrors.push({ code: 'unhandledrejection', operation: String(event.reason) })
    );
  });
  await page.goto(`/harness/lifecycle/reliability${query}`);
  await expect(page.getByTestId('interactive')).toHaveText('True');
  await expect(page.getByTestId('ready-count')).toHaveText('1');
  await expect(page.locator('.echart')).toHaveAttribute('data-chart-state', 'Ready');
}

const codes = (page: Page) => page.evaluate(() => (window as any).chartErrors.map((e: { code: string }) => e.code) as string[]);
const rejections = (page: Page) => page.evaluate(() => (window as any).chartErrors.filter((e: { code: string }) => e.code === 'unhandledrejection'));

const statistics = (page: Page) => page.evaluate(async () =>
  (await import(new URL('_content/BlazorECharts/js/runtime-loader.js', document.baseURI).href)).resourceStatistics());

const title = (page: Page) => page.locator('.echart').evaluate(async element =>
  (await import('/_content/BlazorECharts/js/echarts-6.1.0.js')).getInstanceByDom(element)?.getOption().title[0].text);

async function limited(page: Page, action: Record<string, unknown>) {
  await page.locator('.limited-chart').evaluate(
    async (element, payload) =>
      (await import('/_content/BlazorECharts/js/echarts-6.1.0.js')).getInstanceByDom(element).dispatchAction(payload),
    action
  );
}

async function mountLimited(page: Page) {
  await page.getByRole('button', { name: 'Mount limited' }).click();
  await expect(page.getByTestId('limited')).toHaveText('ready');
}

async function serverConnection(page: Page) {
  const connections: WebSocketRoute[] = [];
  let allowConnections = true;
  await page.routeWebSocket(url => url.pathname.endsWith('/_blazor'), client => {
    if (!allowConnections) {
      void client.close();
      return;
    }

    connections.push(client, client.connectToServer());
  });
  return {
    async disconnect() {
      allowConnections = false;
      for (const socket of connections.splice(0))
        await socket.close({ code: 1012, reason: 'Reliability test disconnect' });

      await expect.poll(() => page.evaluate(() => (window as any).lifecycleConnection.down)).toBeGreaterThan(0);
    },
    async reconnect() {
      allowConnections = true;
      return page.evaluate(() => (window as any).Blazor.reconnect());
    },
  };
}

test('LostSetOptionReply_AfterReconnect_TheLatestOptionsApply', async ({ page }) => {
  // Arrange
  const connection = await serverConnection(page);
  await open(page, '?interopTimeout=3000');
  await page.evaluate(() => {
    const runtime = (globalThis as any)[Symbol.for('BlazorECharts.page-runtime.v3')];
    const setOption = runtime.setOption;
    runtime.setOption = function(...args: unknown[]) {
      const result = setOption.apply(this, args);
      if (!(window as any).holdNextReply)
        return result;

      (window as any).holdNextReply = false;

      // The browser applies the option; its reply goes out only once the connection is gone.
      return new Promise(resolve => (window as any).releaseReply = () => resolve(result));
    };
    (window as any).holdNextReply = true;
  });

  // Act
  await page.getByRole('button', { name: 'Options A' }).click();

  // Assert
  await expect.poll(() => title(page)).toBe('A');

  // Act
  await connection.disconnect();
  await page.evaluate(() => (window as any).releaseReply());

  // Assert
  expect(await connection.reconnect()).toBe(true);

  // Act
  await page.getByRole('button', { name: 'Options B' }).click();

  // Assert
  await expect.poll(() => title(page)).toBe('B');
  await expect(page.getByTestId('last-error')).toHaveText('ChartUpdateFailed/ResultTimeout');
  await expect(page.getByTestId('error-count')).toHaveText('1');
  await expect(page.locator('.echart')).toHaveAttribute('data-chart-state', 'Ready');

  // blazor.web.js rejects the reply it cannot send on the closed connection: that reply is the lost message.
  expect((await rejections(page)).filter(
    (e: { operation: string }) => !e.operation.includes("Cannot send data if the connection is not in the 'Connected' State")
  )).toEqual([]);
});

test('EventOverTheDefaultLimit_IsEventTooLarge_AndTheCircuitStaysAlive', async ({ page }) => {
  // Arrange
  await open(page);
  await mountLimited(page);

  // Act
  // Brushing all 10 000 points sends about 50 KB, over the default 32 KiB SignalR limit.
  await limited(page, { type: 'brush', areas: [{ brushType: 'lineX', xAxisIndex: 0, coordRange: [0, 99] }] });

  // Assert
  await expect.poll(() => codes(page)).toContain('EventTooLarge');

  // Act
  const error = await page.evaluate(() => (window as any).chartErrors.find((e: { code: string }) => e.code === 'EventTooLarge'));

  // Assert
  expect(error).toMatchObject({ operation: 'event:brushselected', subscriptionId: expect.any(String) });

  // Act
  await page.getByRole('button', { name: 'Ping' }).click();

  // Assert
  await expect(page.getByTestId('pings')).toHaveText('1');
  expect(await statistics(page)).toMatchObject({ deliveries: 0, eventLeases: 0 });
  await expect(page.getByTestId('brushes')).toHaveText('0');

  // Act
  await limited(page, { type: 'brush', areas: [{ brushType: 'lineX', xAxisIndex: 0, coordRange: [0, 1] }] });

  // Assert
  await expect(page.getByTestId('brushes')).toHaveText('1');

  // Act
  // A result over the default limit fails the call, not the circuit.
  await page.getByRole('button', { name: 'Read limited' }).click();

  // Assert
  await expect(page.getByTestId('limited')).toHaveText('JSException:ResultTooLarge');

  // Act
  await page.getByRole('button', { name: 'Ping' }).click();

  // Assert
  await expect(page.getByTestId('pings')).toHaveText('2');
  expect(await rejections(page)).toEqual([]);
});

test('EventDuringARealOutage_IsCircuitDisconnected_AndNotDelivered', async ({ page }) => {
  // Arrange
  const connection = await serverConnection(page);
  await open(page);
  await mountLimited(page);
  await connection.disconnect();

  // Act
  await limited(page, { type: 'highlight', seriesIndex: 0, dataIndex: 1 });

  // Assert
  await expect.poll(() => codes(page)).toContain('CircuitDisconnected');
  expect(await statistics(page)).toMatchObject({ deliveries: 0, eventLeases: 0 });
  expect(await connection.reconnect()).toBe(true);

  // Act
  await page.getByRole('button', { name: 'Ping' }).click();

  // Assert
  await expect(page.getByTestId('pings')).toHaveText('1');
  await expect(page.getByTestId('highlights')).toHaveText('0');

  // Act
  await limited(page, { type: 'highlight', seriesIndex: 0, dataIndex: 2 });

  // Assert
  await expect(page.getByTestId('highlights')).toHaveText('1');
  expect(await rejections(page)).toEqual([]);
});

test('ContainerRemovedDuringAnOutage_DisposesTheComponentAfterReconnect', async ({ page }) => {
  // Arrange
  const connection = await serverConnection(page);
  await open(page);
  await connection.disconnect();

  // Act
  // The browser disposes the chart itself; the component learns of the removal after reconnection.
  await page.locator('.chart-container').evaluate(element => element.remove());

  // Assert
  await expect.poll(async () => (await statistics(page)).charts).toBe(0);
  expect(await connection.reconnect()).toBe(true);

  // Act & Assert
  await expect(async () => {
    await page.getByRole('button', { name: 'Probe' }).click();
    await expect(page.getByTestId('probe')).toHaveText(/^Disposed:/, { timeout: 1_000 });
  }).toPass();
  expect(await rejections(page)).toEqual([]);
});

test('PausedAndResumedCircuit_KeepsOneLiveChart', async ({ page }) => {
  // Act
  await open(page);

  // Assert
  expect(await page.evaluate(() => (window as any).Blazor.pauseCircuit())).toBe(true);
  expect(await page.evaluate(() => (window as any).Blazor.resumeCircuit())).toBe(true);
  await expect(page.getByTestId('interactive')).toHaveText('True');
  await expect(page.locator('.echart')).toHaveAttribute('data-chart-state', 'Ready');
  await expect(page.locator('.echart canvas')).toHaveCount(1);

  // The paused circuit cannot release its facade; the resumed one owns the only chart.
  await expect.poll(async () => {
    const s = await statistics(page);
    return [s.charts, s.observations];
  }).toEqual([1, 1]);

  // Act
  await page.getByRole('button', { name: 'Options B' }).click();

  // Assert
  await expect.poll(() => title(page)).toBe('B');
  expect(await codes(page)).toEqual([]);
});

// Each circuit message arrives 50 ms later in both directions: a 100 ms round trip, pipelined like a real network.
async function delayCircuit(page: Page, oneWay: number) {
  await page.routeWebSocket(url => url.pathname.endsWith('/_blazor'), client => {
    const server = client.connectToServer();
    client.onMessage(message => { setTimeout(() => server.send(message), oneWay); });
    server.onMessage(message => { setTimeout(() => client.send(message), oneWay); });
  });
}

for (const mode of ['server', 'wasm']) {
  test(`Dashboard_TwelveCharts_AreCreatedConcurrently_${mode}`, async ({ page }) => {
    // Arrange
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    if (mode === 'server')
      await delayCircuit(page, 50);

    // Act
    await page.goto(`/harness/dashboard/${mode}`);

    // Assert
    await expect(page.getByTestId('interactive')).toHaveText('True');

    // Act
    const start = Date.now();
    await page.getByRole('button', { name: 'Mount', exact: true }).click();

    // Assert
    await expect(page.getByTestId('ready')).toHaveText('12');

    // Act
    const elapsed = Date.now() - start;

    test.info().annotations.push({ type: 'twelve-ready-ms', description: String(elapsed) });

    // Assert
    // About 1.3 s; creating one chart at a time, two round trips each, took 3.9 s.
    if (mode === 'server')
      expect(elapsed).toBeLessThan(2_000);

    await expect(page.getByTestId('error-count')).toHaveText('0');
    expect(errors).toEqual([]);
  });
}
