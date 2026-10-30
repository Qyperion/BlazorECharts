// A plain static file host for published standalone WebAssembly output: no ASP.NET Core, no compression
// negotiation, no server-side fallback beyond index.html for client routes.
// Usage: node static-host.mjs <wwwroot> <port>
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const [root, port] = [resolve(process.argv[2] ?? ''), Number(process.argv[3])];
if (!process.argv[2] || !Number.isInteger(port)) throw new Error('Usage: node static-host.mjs <wwwroot> <port>');

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.wasm': 'application/wasm', '.dat': 'application/octet-stream', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

async function file(path) {
  try { const info = await stat(path); return info.isFile() ? info : null; } catch { return null; }
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  let path = normalize(join(root, decodeURIComponent(url.pathname)));
  if (path !== root && !path.startsWith(root + sep)) { response.writeHead(400).end(); return; }
  let info = await file(path);
  // Client routes have no extension; missing assets stay 404.
  if (!info && !extname(url.pathname)) { path = join(root, 'index.html'); info = await file(path); }
  if (!info) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'content-length': info.size, 'cache-control': 'no-store' });
  if (request.method === 'HEAD') { response.end(); return; }
  createReadStream(path).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`Serving ${root} on http://127.0.0.1:${port}`));
