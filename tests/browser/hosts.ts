import { chromium, firefox, webkit } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function port(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? String(fallback));
  if (!Number.isInteger(value) || value < 1 || value > 65535)
    throw new Error(`${name} must be a valid TCP port.`);

  return value;
}

/** The Blazor Web App demo (Server, WebAssembly and Auto). */
export const demoURL = `http://127.0.0.1:${port('BLAZOR_ECHARTS_DEMO_PORT', 5189)}`;

/** The standalone WebAssembly demo served by the development server. */
export const standaloneURL = `http://127.0.0.1:${port('BLAZOR_ECHARTS_STANDALONE_PORT', 5186)}`;

export type MatrixBrowser = {
  id: string;
  engine: 'chromium' | 'firefox' | 'webkit';
  channel?: string;

  /** Null when the executable is present; otherwise why the browser is NOT_VERIFIED. */
  missing: string | null;
};

function installed(paths: string[]): boolean {
  return paths.some(path => path && existsSync(path));
}

const programFiles = [
  process.env.PROGRAMFILES ?? 'C:\\Program Files',
  process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)',
  process.env.LOCALAPPDATA ?? '',
];

const chromePaths = process.platform === 'win32' ? programFiles.map(root => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))
  : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : ['/opt/google/chrome/chrome'];

const edgePaths = process.platform === 'win32' ? programFiles.map(root => join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  : process.platform === 'darwin' ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'] : ['/opt/microsoft/msedge/msedge'];

const bundled = (engine: 'chromium' | 'firefox' | 'webkit', type: { executablePath(): string }) =>
  installed([type.executablePath()])
    ? null
    : `The Playwright ${engine} build for this @playwright/test version is not installed (npx playwright install ${engine}).`;

/** Browsers of the compatibility matrix. Missing browsers are reported, never installed by the tests. */
export const matrixBrowsers: MatrixBrowser[] = [
  { id: 'chrome', engine: 'chromium', channel: 'chrome', missing: installed(chromePaths) ? null : 'Google Chrome is not installed.' },
  { id: 'msedge', engine: 'chromium', channel: 'msedge', missing: installed(edgePaths) ? null : 'Microsoft Edge is not installed.' },
  { id: 'chromium', engine: 'chromium', missing: bundled('chromium', chromium) },
  { id: 'firefox', engine: 'firefox', missing: bundled('firefox', firefox) },
  { id: 'webkit', engine: 'webkit', missing: bundled('webkit', webkit) },
];
