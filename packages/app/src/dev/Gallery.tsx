/**
 * Dev-Galerie (nur `vite dev`, Adresse `/?galerie`): Testszenen für den Blockrenderer, die kein bearbeitbares
 * Projekt sind – das Blockmuster (Sonderfälle der Blockmodelle) und die Große Halle ohne Licht-Pass (Spawn-Stellen).
 * Ersetzt die frühere eigenständige Viewer-Demo (Port 5174). Nutzt dieselben Bausteine wie die Arbeitsfläche
 * (`TextureViewer` mit Lichtleiste, `useTextures`, Lichtregeln, Pipeline-Kontext) – keine zweite Implementierung.
 * Beispielhaus und Halle mit Licht-Pass sind in der App Vorlagen (Projekt-Panel → Vorlage).
 */
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { CellSet, type Vec3 } from '@mcda/core';
import { generate, type PipelineContext } from '@mcda/pipeline';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import type { LazyPipelineContext } from '../adapters/browserContext.js';
import { DISCLAIMER } from '../brand.js';
import { registryBlockInfo } from '../textures/assets.js';
import { useTextures } from '../textures/useTextures.js';
import { DEFAULT_LIGHTING, type PreviewLighting } from '../ui/viewModel.js';
import type { ViewerScene } from '../viewer/TextureViewer.js';
import { showcase } from './showcase.js';

const TextureViewer = lazy(() => import('../viewer/TextureViewer.js'));

const VERSION = '1.21.11';

type SceneId = 'showcase' | 'hall' | 'hallLit';
const SCENES: ReadonlyArray<{ readonly id: SceneId; readonly label: string }> = [
  { id: 'showcase', label: 'Blockmuster (Renderer-Sonderfälle)' },
  { id: 'hall', label: 'Große Halle ohne Licht-Pass (Spawn-Stellen)' },
  { id: 'hallLit', label: 'Große Halle mit Licht-Pass' },
];

interface Built {
  readonly scene: ViewerScene;
  readonly info: string;
}

function build(id: SceneId, ctx: PipelineContext | undefined, themeId: string, seed: number): Built | undefined {
  if (id === 'showcase') {
    const volume = showcase();
    return { scene: { source: volume, maxY: undefined }, info: 'Treppenformen, Zäune, Scheiben, Laternen, Betten, Türen, Truhen, Schilder, Banner, Rahmen' };
  }
  if (ctx === undefined) return undefined;
  const p = Project.create({ id: 'galerie', name: 'Große Halle', seed, themeId, targetVersion: TARGET_VERSIONS[VERSION] });
  p.paintRoom(0, CellSet.rect(0, 0, 24, 18), 'bedroom');
  const t0 = performance.now();
  const world = generate(p, ctx, { roof: 'hip', ...(id === 'hall' ? { lighting: false } : {}) });
  const dark = world.materialized.light.darkCells.map((d) => d.pos as Vec3);
  return {
    scene: { source: world.materialized.volume, maxY: undefined, spawnCells: dark },
    info: `${p.state.placements.length} Möbel · Pipeline ${Math.round(performance.now() - t0)} ms · ${dark.length} dunkle Zellen (Spawn-Report)`,
  };
}

export function Gallery({ pipeline }: { pipeline: LazyPipelineContext | undefined }) {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [sceneId, setSceneId] = useState<SceneId>(() => (SCENES.some((s) => s.id === params.get('szene')) ? (params.get('szene') as SceneId) : 'showcase'));
  const [themeId, setThemeId] = useState(() => params.get('theme') ?? 'medieval');
  const [seed, setSeed] = useState(2026);
  const [cut, setCut] = useState<number | undefined>(undefined);
  const [grid, setGrid] = useState(true);
  const [lighting, setLighting] = useState<PreviewLighting>({ ...DEFAULT_LIGHTING, spawnHighlight: true });
  const [ctx, setCtx] = useState<PipelineContext | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const textures = useTextures(VERSION);
  const tex = textures.state;
  const ensure = textures.ensureLoaded;

  useEffect(() => {
    if (tex.kind === 'available') ensure();
  }, [tex, ensure]);
  useEffect(() => {
    pipeline?.ready(VERSION).then(setCtx, (e: unknown) => setLoadError(`Plattform-Daten: ${e instanceof Error ? e.message : String(e)}`));
  }, [pipeline]);

  const platform = ctx?.platform(VERSION);
  const result = useMemo((): { built?: Built; error?: string } => {
    try {
      const b = build(sceneId, ctx, themeId, seed);
      return b === undefined ? {} : { built: b };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [sceneId, ctx, themeId, seed]);
  const built = result.built;
  const error = loadError ?? result.error;
  const height = built?.scene.source.size[1] ?? 1;
  // Szenenwechsel passt die Kamera an (fitKey), Theme/Seed/Schnitt nicht
  const scene = useMemo(
    () => (built === undefined ? undefined : { ...built.scene, maxY: cut === undefined ? undefined : built.scene.source.origin[1] + cut, fitKey: sceneId }),
    [built, cut, sceneId],
  );
  const blockInfo = useMemo(() => (platform === undefined ? undefined : registryBlockInfo(platform.registry)), [platform]);
  const themes = pipeline?.themes.ids() ?? [];

  return (
    <div className="gallery">
      <header className="topbar">
        <strong className="brand">Dev-Galerie</strong>
        <label>
          Szene{' '}
          <select value={sceneId} onChange={(e) => setSceneId(e.target.value as SceneId)}>
            {SCENES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {sceneId !== 'showcase' && (
          <>
            <label>
              Theme{' '}
              <select value={themeId} onChange={(e) => setThemeId(e.target.value)}>
                {themes.map((id) => (
                  <option key={id} value={id}>
                    {pipeline?.themes.get(id).name ?? id}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => setSeed((s) => s + 1)} title="Seed + 1">
              Neu würfeln ({seed})
            </button>
          </>
        )}
        <label className="cut">
          Schnitt
          <input type="range" min={0} max={height} value={cut ?? height} onChange={(e) => setCut(Number(e.target.value) >= height ? undefined : Number(e.target.value))} />
          <span className="mono">{cut === undefined ? 'alles' : `y ≤ ${cut}`}</span>
        </label>
        <label>
          <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> Raster
        </label>
        <a href="./">Zur App</a>
      </header>
      <main className="gallery-stage">
        {error !== undefined ? (
          <p className="status error">{error}</p>
        ) : tex.kind !== 'ready' ? (
          <div className="viewer">
            <div className="viewer-failure">{tex.kind === 'none' ? 'Keine Texturquelle: local/mc-assets fehlt (npx tsx packages/viewer/scripts/extract-assets.ts) oder eigenes JAR in der App laden.' : 'Texturen werden geladen …'}</div>
          </div>
        ) : (
          <Suspense fallback={<div className="viewer" />}>
            <TextureViewer assets={tex.assets} blockInfo={blockInfo} platform={platform} scene={scene} lighting={lighting} onLighting={setLighting} grid={grid} />
          </Suspense>
        )}
      </main>
      <footer className="statusbar">
        <span>{built?.info ?? 'Szene wird gebaut …'}</span>
        <span className="disclaimer">{DISCLAIMER}</span>
      </footer>
    </div>
  );
}
