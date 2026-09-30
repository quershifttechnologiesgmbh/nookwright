/**
 * W14 Rechen-Worker: rechnet neben dem Haupt-Thread, was die Oberfläche sonst blockierte – dieselben Funktionen, reine
 * Daten hin und zurück. Eine Datei für beide Aufgaben (nur einmal geladen und im Cache); die App startet zwei Instanzen:
 * - „blocks“ (blocksClient.ts): Blöcke der Vorschau, Prüfbericht, Materialliste, Export-Datei, Blöcke der Vorschaubilder
 *   (`blocksJob.ts`, Materialisierung ~0,4–0,9 s je Änderung);
 * - „playability“ (playabilityClient.ts): Spielbarkeit der Assistent-Vorschläge (`playabilityJob.ts`, ~0,3–0,6 s je
 *   Kandidat).
 * Katalog, Themes, Paletten und Geländestile aus dem Bundle wie in `main.tsx`, einmal je Instanz gelesen (beim Start,
 * während der Haupt-Thread noch zeichnet); Plattform-Daten lädt der Worker selbst nach (eigene Chunks, einmal je Version).
 * Eine Anfrage nach der anderen – die Warteschlangen halten die Clients.
 */
import { browserContext } from './browserContext.js';
import { blocksJob, transferables, type BlocksReply, type BlocksRequest, type BlocksSource } from './blocksJob.js';
import { streamGzip, streamGzipAvailable } from './gzip.js';
import { bundledCatalogLoad, playabilityJob, warmPlayability, type PlayabilityReply, type PlayabilityRequest } from './playabilityJob.js';
import { loadBundledTerrainStyles } from './terrainStyles.js';

/** Schmale Sicht auf den Worker-Scope (die App-tsconfig hat die DOM-Lib, nicht die WebWorker-Lib). */
interface WorkerScope {
  onmessage: ((e: MessageEvent<BlocksRequest | PlayabilityRequest>) => void) | null;
  postMessage(message: BlocksReply | PlayabilityReply, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

let source: BlocksSource | undefined;
function blocksSource(): BlocksSource {
  if (source !== undefined) return source;
  const pipeline = browserContext(bundledCatalogLoad());
  if (pipeline === undefined) throw new Error('Katalog im Worker nicht ladbar');
  source = {
    ready: (v) => pipeline.ready(v), terrainStyles: loadBundledTerrainStyles().styles, refs: { catalog: pipeline.catalog, themes: pipeline.themes },
    ...(streamGzipAvailable() ? { gzip: streamGzip } : {}),
  };
  return source;
}

warmPlayability(); // liest den Katalog (Fehler kommen mit der ersten Anfrage)

scope.onmessage = (e) => {
  const req = e.data;
  if ('typeId' in req) {
    scope.postMessage(playabilityJob(req));
    return;
  }
  void (async () => {
    let reply: BlocksReply;
    try {
      reply = await blocksJob(req, blocksSource());
    } catch (err) {
      reply = { id: req.id, error: err instanceof Error ? err.message : String(err) };
    }
    scope.postMessage(reply, transferables(reply));
  })();
};
