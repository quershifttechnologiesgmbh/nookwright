/**
 * React-Anbindung der Vorschau „Texturen“: findet beim Start eine Quelle (Cache des eigenen JARs, sonst im
 * Entwicklungsserver `local/mc-assets`), lädt die Assets erst beim ersten Öffnen des Modus und liest auf
 * Wunsch ein JAR (Dateiauswahl, lokal, im Worker). Ohne Quelle bleibt der Modus deaktiviert (siehe `textureMode`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { streamGzip } from '../adapters/gzip.js';
import { streamInflateAvailable } from '../adapters/inflate.js';
import { indexedDbTextureCache } from '../adapters/textureCache.js';
import { assetsFromBundle, jarProgress, packTextures, pickSource, unpackTextures, type TextureAssets, type TextureCache, type TextureSourceInfo, type TextureState } from './assets.js';

export interface TexturesApi {
  readonly state: TextureState;
  /** Letzte Meldung (z. B. „kein Client-JAR“, „Cache gespeichert“); der Zustand davor bleibt erhalten. */
  readonly notice: { readonly text: string; readonly error: boolean } | undefined;
  /** Liegen Assets im lokalen Cache? (Anzeige, „Cache löschen“) */
  readonly cached: boolean;
  /** Kann dieser Browser JARs entpacken? */
  readonly canReadJar: boolean;
  /** Assets laden, falls nur „verfügbar“ (beim Öffnen des Modus). */
  ensureLoaded(): void;
  loadJar(file: File): void;
  clearCache(): void;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function useTextures(preferredVersion: string, cache: TextureCache = defaultCache()): TexturesApi {
  const [state, setState] = useState<TextureState>({ kind: 'probing' });
  const [notice, setNotice] = useState<TexturesApi['notice']>(undefined);
  const [cached, setCached] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const devVersions = useRef<string[] | undefined>(undefined);
  const preferred = useRef(preferredVersion);
  preferred.current = preferredVersion;
  const [canReadJar] = useState(streamInflateAvailable);

  // Start: Quelle suchen (nur Kurzinfos, keine großen Daten)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const meta = await cache.meta();
      if (import.meta.env.DEV) {
        const { devTextureVersions } = await import('../adapters/devTextures.js');
        devVersions.current = await devTextureVersions();
      }
      if (cancelled) return;
      setCached(meta !== undefined);
      const source = pickSource(meta, devVersions.current, preferred.current);
      setState((s) => (s.kind === 'probing' ? (source === undefined ? { kind: 'none' } : { kind: 'available', source }) : s));
    })();
    return () => {
      cancelled = true;
    };
  }, [cache]);

  const loadSource = useCallback(
    async (source: TextureSourceInfo): Promise<TextureAssets> => {
      if (source.origin === 'cache') {
        const assets = await unpackTextures(await cache.load(), streamGzip);
        if (assets === undefined) throw new Error('Der Textur-Cache ist unvollständig oder veraltet – bitte das JAR erneut laden');
        return assets;
      }
      if (source.origin === 'dev' && import.meta.env.DEV) {
        const [{ loadDevTextures }, { streamInflate }] = await Promise.all([import('../adapters/devTextures.js'), import('../adapters/inflate.js')]);
        return loadDevTextures(source.version, streamInflate.inflate);
      }
      throw new Error(`Keine Texturquelle „${source.origin}“`);
    },
    [cache],
  );

  const ensureLoaded = useCallback(() => {
    const s = stateRef.current;
    if (s.kind !== 'available') return;
    setState({ kind: 'loading', message: `Texturen werden geladen (${s.source.label}) …` });
    const t0 = performance.now();
    loadSource(s.source).then(
      (assets) => {
        setState({ kind: 'ready', assets });
        setNotice({ text: `Texturen geladen: ${assets.label} (${Math.round(performance.now() - t0)} ms)`, error: false });
      },
      (e: unknown) => {
        // Cache kaputt → auf Dev-Assets ausweichen (falls vorhanden), sonst deaktivieren
        const fallback = s.source.origin === 'cache' ? pickSource(undefined, devVersions.current, preferred.current) : undefined;
        setState(fallback === undefined ? { kind: 'none' } : { kind: 'available', source: fallback });
        setNotice({ text: errorText(e), error: true });
      },
    );
  }, [loadSource]);

  const loadJar = useCallback(
    (file: File) => {
      const before = stateRef.current;
      setState({ kind: 'loading', message: `${file.name} wird lokal gelesen …`, progress: 0 });
      setNotice(undefined);
      const t0 = performance.now();
      void (async () => {
        let assets: TextureAssets;
        try {
          const { bundleJarFile } = await import('../adapters/jarTextures.js');
          const bundle = await bundleJarFile(file, (phase, done, total) => {
            const p = jarProgress(phase, done, total);
            setState({ kind: 'loading', message: p.message, progress: p.progress });
          });
          assets = assetsFromBundle(bundle, 'jar', `${file.name} (Minecraft ${bundle.version})`);
        } catch (e) {
          setState(before.kind === 'loading' || before.kind === 'probing' ? { kind: 'none' } : before);
          setNotice({ text: `JAR konnte nicht gelesen werden: ${errorText(e)}`, error: true });
          return;
        }
        setState({ kind: 'ready', assets });
        const ms = Math.round(performance.now() - t0);
        // Lokal cachen (optional): der nächste Start braucht das JAR nicht mehr
        let saved = false;
        try {
          saved = await cache.save(await packTextures(assets, streamGzip));
        } catch {
          saved = false;
        }
        setCached(saved);
        setNotice({
          text: `${assets.label} gelesen (${ms} ms) · ${saved ? 'lokal im Browser gespeichert' : 'ohne Cache (IndexedDB nicht verfügbar) – beim nächsten Start erneut laden'}`,
          error: false,
        });
      })();
    },
    [cache],
  );

  const clearCache = useCallback(() => {
    void cache.clear().then((ok) => {
      setCached(false);
      setNotice({ text: ok ? 'Textur-Cache gelöscht' : 'Textur-Cache konnte nicht gelöscht werden', error: !ok });
      const s = stateRef.current;
      const fromCache = (s.kind === 'ready' && s.assets.origin === 'cache') || (s.kind === 'available' && s.source.origin === 'cache');
      if (fromCache) {
        const source = pickSource(undefined, devVersions.current, preferred.current);
        setState(source === undefined ? { kind: 'none' } : { kind: 'available', source });
      }
    });
  }, [cache]);

  return { state, notice, cached, canReadJar, ensureLoaded, loadJar, clearCache };
}

let sharedCache: TextureCache | undefined;
function defaultCache(): TextureCache {
  sharedCache ??= indexedDbTextureCache();
  return sharedCache;
}
