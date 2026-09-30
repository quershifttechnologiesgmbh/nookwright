/**
 * Projektdatei der App (`.projekt.json`) ↔ Engine-Session (C1). Format, Version/Migration, Grenzen und tolerantes Lesen
 * kommen aus `@mcda/projectfile` – demselben Code, mit dem die App lädt und speichert. Hier nur die Abbildung:
 *
 * - **Laden:** Einstellungen → Stil der Session (`shellOptions` + `exteriorOptions`, wie die App ihre Hülle baut),
 *   Umgebung → Gelände-Aggregat (nur wenn eingeschaltet), Bauwerke, angedockte Türme.
 * - **Speichern:** Teile, die per API unverändert sind (Stil, Gelände, Bauwerke), schreibt die Engine exakt so zurück,
 *   wie sie in der Datei standen (Dichte je Raum, „Gelände aus“, Rand, Bauwerks-IDs bleiben). Geänderte Teile werden aus
 *   dem Stand der Session übersetzt (`styleFromBuild`, `structureItemsOf`).
 */
import {
  MARGIN_RANGE, attachedTowersOf, ensembleOf, exteriorOptions, shellOptions, shellStyle, structureItemsOf, structuresInput, styleFromBuild, toProjectFile,
  type FileSettings, type ProjectContent, type ProjectFile, type SurroundingsState,
} from '@mcda/projectfile';
import { parapetSpecsFor, roomCellsOf, roomVolumeOf, shellFor } from '@mcda/pipeline';
import { Site } from '@mcda/terrain';
import type { AppFileState, ProjectSession, SessionBuild } from './session.js';
import { NO_REDO } from './session.js';

/** JSON mit sortierten Schlüsseln: gleicher Inhalt = gleicher Text. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

const keysOf = (s: Pick<ProjectSession, 'build' | 'site' | 'structures' | 'attachedTowers'>): AppFileState['keys'] => ({
  build: stable(s.build),
  site: stable(s.site?.history ?? null),
  structures: stable([s.structures ?? null, s.attachedTowers]),
});

/** Stil der Session aus den Einstellungen einer App-Datei – dieselbe Abbildung wie Hülle und Außen-Deko der App. */
export function buildOfSettings(settings: FileSettings, surroundings: SurroundingsState | undefined): SessionBuild {
  const style = shellStyle({ ...settings, surroundings });
  const exterior = exteriorOptions(style.exterior);
  // F-Ensemble: Schalter der Umgebung (fehlt = Standard des Anwendungsdienstes), gleiche Regel wie die App
  const ensemble = ensembleOf(surroundings);
  // feat/gelaende: Geländeform der Umgebung → Stil der Session (`build.landform`), wie in der App (`surroundingsInput`)
  const landform = surroundings?.landform;
  return {
    ...shellOptions(style), ...(exterior !== undefined ? { exterior } : {}), ...(ensemble !== undefined ? { ensemble } : {}),
    ...(landform !== undefined ? { landform } : {}),
    // feat/site-decor: Grundstücks-Deko der Umgebung (fehlt = aus)
    ...(surroundings?.siteDecor !== undefined ? { siteDecor: surroundings.siteDecor } : {}),
    // WS-Verwitterung: erzählende Verwitterung der Umgebung (fehlt = aus)
    ...(surroundings?.weathering !== undefined ? { weathering: surroundings.weathering } : {}),
    // TX-B: Oberflächen-Textur der Umgebung (fehlt = aus)
    ...(surroundings?.surfaceTexture !== undefined ? { surfaceTexture: surroundings.surfaceTexture } : {}),
  };
}

/** Inhalt einer App-Datei → neue Session. */
export function sessionFromAppFile(id: string, c: ProjectContent): ProjectSession {
  const sur = c.surroundings;
  const build = buildOfSettings(c.settings, sur);
  // BT01: Wehrplatten sind an einen Baukörper gebunden – die Spalten/Höhe leitet die Engine aus derselben Hülle ab
  // wie die App (`parapetSpecsFor`), damit App und Engine dasselbe bauen.
  const parapet = sur === undefined ? undefined : (item: Parameters<NonNullable<Parameters<typeof structuresInput>[1]>>[0]) =>
    item.volumeId === undefined ? undefined : parapetSpecsFor(shellFor(c.project, build), [{ ...item, volumeId: item.volumeId }], roomVolumeOf(c.project.state), roomCellsOf(c.project.state))[0];
  const partial = {
    build,
    site: sur?.terrain === true && sur.site !== undefined ? Site.fromHistory(sur.site) : undefined,
    structures: sur === undefined ? undefined : structuresInput(sur, parapet),
    attachedTowers: attachedTowersOf(sur),
  };
  return { id, project: c.project, ...partial, redo: NO_REDO, app: { settings: c.settings, surroundings: sur, keys: keysOf(partial) } };
}

/** Session → App-Datei (unveränderte Teile exakt wie geladen, siehe Kopf). */
export function appFileOf(s: ProjectSession, savedAt: Date): ProjectFile {
  const app = s.app;
  const now = keysOf(s);
  const rooms = new Set(s.project.state.rooms.map((r) => r.id));
  const density = new Map([...(app?.settings.density ?? new Map<string, number>())].filter(([id]) => rooms.has(id)));
  const settings: FileSettings = app !== undefined && now.build === app.keys.build
    ? { ...app.settings, density }
    : (() => {
        const { towers: _t, ...style } = styleFromBuild(s.build);
        return { ...style, density };
      })();
  const old = app?.surroundings;
  const siteSame = app !== undefined && now.site === app.keys.site;
  const structuresSame = app !== undefined && now.structures === app.keys.structures;
  let surroundings: SurroundingsState | undefined;
  if (siteSame && structuresSame) surroundings = old;
  else {
    const site = siteSame ? { site: old?.site, terrain: old?.terrain ?? false } : { site: s.site?.history, terrain: s.site !== undefined };
    const items = structuresSame && old !== undefined ? { structures: old.structures, seq: old.seq } : structureItemsOf(s.structures, s.attachedTowers);
    surroundings = site.site === undefined && items.structures.length === 0 && old === undefined ? undefined : {
      ...(site.site !== undefined ? { site: site.site } : {}),
      terrain: site.site !== undefined && site.terrain,
      margin: old?.margin ?? MARGIN_RANGE.standard,
      ...items,
    };
  }
  // F-Ensemble: der Schalter steht in der Session im Stil (`build.ensemble`, auch per project_style), in der Datei in der Umgebung
  const ensemble = s.build.ensemble === undefined ? undefined : s.build.ensemble !== false;
  if (surroundings !== undefined && ensemble !== undefined && surroundings.ensemble !== ensemble) surroundings = { ...surroundings, ensemble };
  // feat/gelaende: dasselbe für die Geländeform (`build.landform`)
  const landform = s.build.landform === 'flat' ? undefined : s.build.landform;
  if (surroundings !== undefined && surroundings.landform !== landform) {
    const { landform: _old, ...rest } = surroundings;
    surroundings = landform === undefined ? rest : { ...rest, landform };
  }
  // feat/site-decor: Grundstücks-Deko steht in der Session im Stil (`build.siteDecor`, auch per project_style), in der Datei in der Umgebung
  if (surroundings !== undefined && surroundings.siteDecor !== s.build.siteDecor) {
    const { siteDecor: _old, ...rest } = surroundings;
    surroundings = s.build.siteDecor === undefined || s.build.siteDecor === 'off' ? rest : { ...rest, siteDecor: s.build.siteDecor };
  }
  // WS-Verwitterung: dasselbe für die erzählende Verwitterung (`build.weathering`); ohne Umgebung legt sie eine leere an
  const weathering = s.build.weathering === undefined || s.build.weathering === 'off' ? undefined : s.build.weathering;
  if (weathering !== undefined && surroundings === undefined) {
    surroundings = { terrain: false, margin: MARGIN_RANGE.standard, structures: [], seq: 1, weathering };
  } else if (surroundings !== undefined && surroundings.weathering !== weathering) {
    const { weathering: _old, ...rest } = surroundings;
    surroundings = weathering === undefined ? rest : { ...rest, weathering };
  }
  // TX-B: dasselbe für die Oberflächen-Textur (`build.surfaceTexture`)
  const surfaceTexture = s.build.surfaceTexture === undefined || s.build.surfaceTexture === 'off' ? undefined : s.build.surfaceTexture;
  if (surfaceTexture !== undefined && surroundings === undefined) {
    surroundings = { terrain: false, margin: MARGIN_RANGE.standard, structures: [], seq: 1, surfaceTexture };
  } else if (surroundings !== undefined && surroundings.surfaceTexture !== surfaceTexture) {
    const { surfaceTexture: _old, ...rest } = surroundings;
    surroundings = surfaceTexture === undefined ? rest : { ...rest, surfaceTexture };
  }
  return toProjectFile({ project: s.project, settings, surroundings }, savedAt);
}
