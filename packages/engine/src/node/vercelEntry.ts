/**
 * Einstieg des Vercel-Function-Bündels (W8-V; gebündelt von `deploy/vercel/build.mjs` nach `<name>.func/index.mjs`).
 * Die Node-Runtime ruft den Standard-Export mit `(IncomingMessage, ServerResponse)` auf; er übersetzt in
 * `Request`/`Response` und ruft den Handler aus `vercel.ts`. Engine und Handler entstehen einmal je Instanz
 * (Modulebene; Kaltstart lädt den Katalog), der Katalog liegt als Kopie neben dem Bündel (`./catalog`,
 * überschreibbar mit `ENGINE_CATALOG_DIR`).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { catalogDirFromEnv, nodeEngine } from './config.js';
import { vercelHandlerFromEnv, type VercelHandler } from './vercel.js';

const t0 = performance.now();
const catalogDir = catalogDirFromEnv(process.env, fileURLToPath(new URL('./catalog', import.meta.url)));
const engine = nodeEngine(catalogDir);
export const handler: VercelHandler = vercelHandlerFromEnv(engine);
console.log(JSON.stringify({ level: 'info', msg: 'Function gestartet', coldStartMs: Math.round(performance.now() - t0), node: process.version, ...handler.mode }));

/** Node-Anfrage → `Request` (Body nur bei Methoden mit Body; Größenlimit prüft der Handler beim Lesen). */
export function toRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    for (const x of Array.isArray(v) ? v : [v]) headers.append(k, x);
  }
  const proto = String(req.headers['x-forwarded-proto'] ?? 'https').split(',').at(-1)?.trim() === 'http' ? 'http' : 'https';
  const host = req.headers.host ?? 'localhost';
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  let url: string;
  try {
    url = new URL(req.url ?? '/', `${proto}://${host}`).href;
  } catch {
    url = new URL(req.url ?? '/', 'https://localhost').href;
  }
  return new Request(url, {
    method: req.method ?? 'GET', headers,
    ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: 'half' } : {}),
  } as RequestInit);
}

export default async function vercelNodeListener(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const response = await handler(toRequest(req), { ip: req.socket.remoteAddress });
  const body = req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(body);
  // Unvollständig gelesener Body (413, 403 …): Rest verwerfen
  if (!req.complete) req.resume();
}
