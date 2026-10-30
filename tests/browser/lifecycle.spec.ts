import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';

// Instrument actual browser resources without adding test APIs to the library.
async function installCounters(page: Page) {
  await page.addInitScript(() => {
    const counts = { resize: 0, mutation: 0, errors: [] as string[], channels: [] as string[] };
    (window as any).lifecycleCounters = counts;
    for (const [key, name] of [['resize', 'ResizeObserver'], ['mutation', 'MutationObserver']] as const) {
      const Native = window[name];
      (window as any)[name] = class extends Native {
        private active = false;

        observe(...args: any[]) {
          // Blazor may create its own observers after hydration. Count library-owned observers by their allocating module.
          if (!this.active && /runtime-loader[.\w]*\.js/.test(new Error().stack ?? '')) {
            counts[key]++;
            this.active = true;
          }

          return (Native.prototype.observe as any).apply(this, args);
        }

        disconnect() {
          if (this.active) {
            counts[key]--;
            this.active = false;
          }

          super.disconnect();
        }
      };
    }

    window.addEventListener('unhandledrejection', event => counts.errors.push(String(event.reason?.stack ?? event.reason)));
    document.addEventListener('blazorecharts:error', event => counts.channels.push((event as CustomEvent).detail.code));
  });
}

async function counters(page: Page) {
  return page.evaluate(() => ({ ...(window as any).lifecycleCounters }));
}

async function open(page: Page, mode: string, query = '') {
  await installCounters(page);
  await page.goto(`/harness/lifecycle/${mode}${query}`);
  await expect(page.getByTestId('interactive')).toHaveText('True');
  return counters(page);
}

// OnReady counts every ready chart of the page, so a late or repeated OnReady shows.
async function ready(page: Page, count = 1) {
  await expect(page.getByTestId('ready-count')).toHaveText(String(count));
  await expect(page.locator('.echart')).toHaveAttribute('data-chart-state', 'Ready');
  await expect(page.locator('.echart canvas')).toHaveCount(1);
  await expect.poll(async () => {
    const c = await counters(page);
    return [c.resize, c.mutation];
  }).toEqual([1, 1]);
  expect(await page.locator('.echart canvas').evaluate((canvas: HTMLCanvasElement) =>
    canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.some((v, i) => i % 4 === 3 && v > 0))).toBe(true);
}

async function serverConnection(page: Page, fallback = false) {
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
        await socket.close({ code: 1012, reason: 'Lifecycle test disconnect' });

      if (fallback)
        await expect(page.locator('.components-reconnect-visible')).toBeAttached();
      else
        await expect.poll(() => page.evaluate(() => (window as any).lifecycleConnection.down)).toBeGreaterThan(0);
    },
    async reconnect() {
      allowConnections = true;
      return page.evaluate(() => (window as any).Blazor.reconnect());
    },
  };
}

for (const mode of ['server', 'wasm']) {
  test(`${mode}: NullInputThenOptions_InitializesOnce; RepeatedDispose_IsIdempotent`, async ({ page, browser }, info) => {
    // Act
    const baseline = await open(page, mode);

    // Assert
    await expect(page.locator('.echart canvas')).toHaveCount(0);
    for (let i = 0; i < 5; i++) {
      await page.getByRole('button', { name: 'Mount chart', exact: true }).click();
      await ready(page, i + 1);
      await page.getByRole('button', { name: 'Dispose twice' }).click();
      await expect(page.locator('.echart')).toHaveAttribute('data-chart-state', 'Disposed');
      await page.getByRole('button', { name: 'Unmount chart', exact: true }).click();
      await expect(page.locator('.echart')).toHaveCount(0);
      await expect.poll(async () => {
        const c = await counters(page);
        return [c.resize, c.mutation];
      }).toEqual([baseline.resize, baseline.mutation]);
    }

    expect((await counters(page)).errors).toEqual([]);
    await info.attach('lifecycle-resources', {
      body: JSON.stringify({ browser: browser.version(), baseline, final: await counters(page) }),
      contentType: 'application/json',
    });
  });

  test(`${mode}: HiddenContainer_InitializesAfterNonzeroSize`, async ({ page }) => {
    // Arrange
    await open(page, mode, '?hidden=true');

    // Act
    await page.getByRole('button', { name: 'Mount chart', exact: true }).click();

    // Assert
    await expect(page.locator('.echart')).toHaveAttribute('data-chart-state', 'Initializing');
    await expect(page.locator('.echart canvas')).toHaveCount(0);

    // Act
    await page.getByRole('button', { name: 'Show container' }).click();
    await ready(page);
    await page.locator('.chart-container').evaluate(element => (element as HTMLElement).style.width = '450px');

    // Assert
    await expect.poll(() => page.locator('.echart canvas').evaluate((element: HTMLCanvasElement) => element.style.width)).toBe('450px');
  });

  test(`${mode}: RemovedDom_TriggersBrowserCleanup`, async ({ page }) => {
    // Arrange
    const baseline = await open(page, mode);
    await page.getByRole('button', { name: 'Mount chart', exact: true }).click();
    await ready(page);

    // Act
    const nativeDisposed = await page.locator('.echart').evaluate(async element => {
      const echarts = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const native = echarts.getInstanceByDom(element);
      element.remove();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return native.isDisposed();
    });

    // Assert
    expect(nativeDisposed).toBe(true);
    await expect.poll(async () => {
      const c = await counters(page);
      return [c.resize, c.mutation];
    }).toEqual([baseline.resize, baseline.mutation]);
    expect((await counters(page)).errors).toEqual([]);
  });
}

test('InitFailure_ExplicitRetryCreatesNewGeneration', async ({ page }) => {
  // Arrange
  let available = false;
  await page.route('**/runtime-loader*.js*', async route => available ? route.continue() : route.fulfill({ status: 503, body: 'offline' }));
  await open(page, 'server');

  // Act
  await page.getByRole('button', { name: 'Mount chart', exact: true }).click();

  // Assert
  await expect(page.getByTestId('error-count')).toHaveText('1');
  await expect(page.locator('.echart')).toHaveAttribute('data-chart-state', 'Failed');

  // Act
  available = true;
  await page.getByRole('button', { name: 'Retry chart' }).click();
  await ready(page);

  // Assert
  await expect(page.getByTestId('generation')).toHaveText('2');
});

test('DisposeDuringImport_NoLateChartOrReady', async ({ page }) => {
  // Arrange
  let release!: () => void;
  const pending = new Promise<void>(resolve => release = resolve);
  await page.route('**/echarts-6.1.0.js*', async route => {
    await pending;
    await route.continue();
  });
  const baseline = await open(page, 'server');

  // Act
  await page.getByRole('button', { name: 'Mount chart', exact: true }).click();

  // Assert
  await expect(page.locator('.echart')).toHaveAttribute('data-chart-state', 'Initializing');

  // Act
  await page.getByRole('button', { name: 'Unmount chart', exact: true }).click();
  release();
  await page.getByRole('button', { name: 'Mount chart', exact: true }).click();
  await ready(page);
  await page.getByRole('button', { name: 'Unmount chart', exact: true }).click();

  // Assert
  await expect.poll(async () => {
    const c = await counters(page);
    return [c.resize, c.mutation];
  }).toEqual([baseline.resize, baseline.mutation]);
  expect((await counters(page)).errors).toEqual([]);
});

test('ServerReconnect_PreservesLiveInstanceWithoutDuplicate', async ({ page }, info) => {
  // Arrange
  const connection = await serverConnection(page);
  await open(page, 'server');
  await page.getByRole('button', { name: 'Mount chart', exact: true }).click();
  await ready(page);
  const before = await counters(page);
  const id = await page.locator('.echart').getAttribute('_echarts_instance_');

  // Act
  await connection.disconnect();

  // Assert
  expect(await connection.reconnect()).toBe(true);

  // Act
  await page.getByRole('button', { name: 'Parent render' }).click();

  // Assert
  await expect(page.getByTestId('parent-renders')).toHaveText('1');
  expect(await page.locator('.echart').getAttribute('_echarts_instance_')).toBe(id);

  // Act
  await ready(page);
  const after = await counters(page);

  // Assert
  expect([after.resize, after.mutation]).toEqual([before.resize, before.mutation]);
  expect(after.errors).toEqual([]);
  await info.attach('server-reconnect', {
    body: JSON.stringify({ id, before, after, connection: await page.evaluate(() => (window as any).lifecycleConnection) }),
    contentType: 'application/json',
  });
});

test('DisconnectedCircuit_FailureUsesErrorChannel', async ({ page }) => {
  // Arrange
  const connection = await serverConnection(page);
  await open(page, 'server');
  await page.getByRole('button', { name: 'Mount chart', exact: true }).click();
  await ready(page);

  // Force a native resize failure while connected, then with the real circuit disconnected.
  await page.locator('.echart').evaluate(async element => {
    const echarts = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
    const native = echarts.getInstanceByDom(element);
    native.resize = () => { throw new Error('Resize failure fixture'); };
  });

  // Act
  await page.locator('.chart-container').evaluate(element => (element as HTMLElement).style.width = '500px');

  // Assert
  await expect(page.getByTestId('last-error')).toHaveText('ChartResizeFailed');

  // Act
  await connection.disconnect();
  await page.locator('.chart-container').evaluate(element => (element as HTMLElement).style.width = '450px');

  // Assert
  // Server can queue a .NET callback until reconnection; the DOM error channel is immediate.
  await expect.poll(async () => (await counters(page)).channels.filter((code: string) => code === 'ChartResizeFailed').length).toBe(2);
  await expect.poll(async () => (await counters(page)).channels).toContain('CircuitDisconnected');
  await expect(page.getByTestId('error-count')).toHaveText('1');
  expect((await counters(page)).errors).toEqual([]);

  // Act
  // Cleanup is browser-owned even with no working .NET callback channel.
  await page.locator('.chart-container').evaluate(element => element.remove());

  // Assert
  await expect.poll(async () => {
    const c = await counters(page);
    return [c.resize, c.mutation];
  }).toEqual([0, 0]);
  expect((await counters(page)).errors).toEqual([]);
});

test('DefaultFallbackReconnectUi_PreventsDisconnectedCallbacks', async ({ page }) => {
  // Exercise Blazor's own fallback display with no custom handler or synthetic connection events.

  // Arrange
  await page.route('**/harness/boot*.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'Blazor.start({circuit:{reconnectionOptions:{maxRetries:0}}});',
  }));
  const connection = await serverConnection(page, true);
  await open(page, 'server');
  await page.getByRole('button', { name: 'Mount chart', exact: true }).click();
  await ready(page);
  const id = await page.locator('.echart').getAttribute('_echarts_instance_');
  await page.locator('.echart').evaluate(async element => {
    const echarts = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
    const native = echarts.getInstanceByDom(element);
    const resize = native.resize;
    native.resize = function(...args: unknown[]) {
      if ((window as any).forceResizeError)
        throw new Error('Fallback circuit error fixture');

      return resize.apply(this, args);
    };
    (window as any).forceResizeError = true;
  });
  await connection.disconnect();

  // Act
  await page.locator('.chart-container').evaluate(element => (element as HTMLElement).style.width = '450px');

  // Assert
  await expect.poll(async () => (await counters(page)).channels).toContain('ChartResizeFailed');

  // Act
  // Allow microtasks plus an animation frame to surface any fire-and-forget framework send rejection.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));

  // Assert
  expect((await counters(page)).errors).toEqual([]);
  expect((await counters(page)).channels).toContain('CircuitDisconnected');

  // Act
  await page.evaluate(() => (window as any).forceResizeError = false);

  // Assert
  expect(await connection.reconnect()).toBe(true);

  // Act
  await page.getByRole('button', { name: 'Parent render' }).click();

  // Assert
  await expect(page.getByTestId('parent-renders')).toHaveText('1');
  expect(await page.locator('.echart').getAttribute('_echarts_instance_')).toBe(id);

  // Act
  await ready(page);
  await page.getByRole('button', { name: 'Unmount chart', exact: true }).click();

  // Assert
  await expect.poll(async () => {
    const c = await counters(page);
    return [c.resize, c.mutation];
  }).toEqual([0, 0]);
  expect((await counters(page)).errors).toEqual([]);
});

test('SizeLostBetweenReadyAndAllocation_KeepsWaitingInSameGeneration', async ({ page }) => {
  // Arrange
  await open(page, 'server', '?hidden=true');

  // Act
  await page.getByRole('button', { name: 'Mount chart', exact: true }).click();

  // Assert
  await expect(page.locator('.echart')).toHaveAttribute('data-chart-state', 'Initializing');
  await expect.poll(async () => (await counters(page)).resize).toBe(1);

  // Act
  await page.evaluate(() => {
    const runtime = (globalThis as any)[Symbol.for('BlazorECharts.page-runtime.v3')];
    const original = runtime.createChart;
    runtime.createChart = function(...args: any[]) {
      if (!(window as any).sizeLostBeforeAllocation) {
        (window as any).sizeLostBeforeAllocation = true;
        (document.querySelector('.chart-container') as HTMLElement).style.display = 'none';
      }

      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Show container' }).click();

  // Assert
  await expect.poll(() => page.evaluate(() => (window as any).sizeLostBeforeAllocation)).toBe(true);

  // Act
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));

  // Assert
  await expect(page.locator('.echart')).toHaveAttribute('data-chart-state', 'Initializing');
  await expect(page.getByTestId('error-count')).toHaveText('0');
  await expect(page.locator('.echart canvas')).toHaveCount(0);

  // Act
  await page.locator('.chart-container').evaluate(element => (element as HTMLElement).style.display = 'block');
  await ready(page);

  // Assert
  await expect(page.getByTestId('generation')).toHaveText('1');
});
