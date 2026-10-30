import type { Page } from '@playwright/test';

export async function installChartResourceCounters(page: Page) {
  await page.addInitScript(() => {
    const counts = { resize: 0, mutation: 0, errors: [] as string[] };
    (window as any).chartResources = counts;
    for (const [key, name] of [['resize', 'ResizeObserver'], ['mutation', 'MutationObserver']] as const) {
      const Native = window[name];
      (window as any)[name] = class extends Native {
        private active = false;

        observe(...args: any[]) {
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

    window.addEventListener('unhandledrejection', event => counts.errors.push(String(event.reason)));
  });
}

export const chartResources = (page: Page) => page.evaluate(() => ({ ...(window as any).chartResources }));
