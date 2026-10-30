// Test-only provider fixtures. They import the test page coordinator (routed by runtime.spec.ts) and the locked runtime.
export async function runProviderProbe() {
  const loaderUrl = new URL('__test/page-runtime.js', document.baseURI).href;
  const runtimeUrl = new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href;
  const { PageRuntime } = await import(loaderUrl);
  const runtime = await import(runtimeUrl);
  const importer = url => import(url);
  const page = new PageRuntime(importer, document.baseURI, runtimeUrl);
  const first = await page.load({ provider: 'module', moduleUrl: runtimeUrl });
  const second = await page.load({ provider: 'module', moduleUrl: runtimeUrl });
  const code = async operation => { try { await operation(); return 'unexpected-success'; } catch (error) { return error.code; } };
  const conflict = await code(() => page.load());
  const customUrl = new URL('harness/runtime-provider.js', document.baseURI).href;
  const custom = new PageRuntime(importer, document.baseURI, runtimeUrl);
  const customRuntime = await custom.load({ provider: 'custom', moduleUrl: customUrl });
  const badVersion = await code(() => new PageRuntime(async () => ({ ...runtime, version: '5' }), document.baseURI, runtimeUrl).load());
  const badCapability = await code(() => new PageRuntime(async () => ({ ...runtime, init: undefined }), document.baseURI, runtimeUrl).load());
  let available = false;
  const retryPage = new PageRuntime(async () => { if (!available) throw new Error('fixture offline'); return runtime; }, document.baseURI, runtimeUrl);
  await code(() => retryPage.load());
  available = true;
  const retried = await retryPage.load({}, true);
  return { version: customRuntime.version, sameIdentity: first === second && first === customRuntime,
    conflict, badVersion, badCapability, retry: retried.version };
}
