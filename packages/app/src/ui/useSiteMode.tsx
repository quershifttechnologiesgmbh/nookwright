/**
 * Modus „Umgebung“ als ein Baustein für die Werkbank (App.tsx): Werkzeug-Zustand, Auswahl, Aktionen (über die Use
 * Cases in surroundings.ts und `run` der App – also mit Statuszeile, Fehlertext und Undo), entprellte Berechnung
 * (useSurroundings) und die Elemente Werkzeugleiste, Plan und Panel. Die App hängt nur ein.
 */
import type { Shell } from '@mcda/blueprint';
import type { Catalog } from '@mcda/catalog';
import type { Cell } from '@mcda/core';
import { siteDecorContext, type ExteriorPlacement } from '@mcda/pipeline';
import type { Landform, SiteDecorLevel, SiteLighting, SiteTemplateId, VegetationDensity, ZoneEdge, ZoneKind } from '@mcda/terrain';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { loadBundledTerrainStyles } from '../adapters/terrainStyles.js';
import { SitePlan } from '../editor/SitePlan.js';
import { SITE_TOOL_FOR_COMMAND, brushRadius, type SculptChoice, type SiteGesture, type SiteSelection, type SiteTool } from '../editor/siteGrid.js';
import * as su from '../surroundings.js';
import { surroundingsVoxels } from '../surroundingsWorld.js';
import * as uc from '../usecases.js';
import { useSurroundings, type SurroundingsStatus } from '../useSurroundings.js';
import type { WorldSurroundings } from '../useWorld.js';
import type { PreviewVoxel } from '../viewer/voxels.js';
import type { Command } from './shortcuts.js';
import { SiteToolbar } from './SiteToolbar.js';
import { SurroundingsPanel } from './SurroundingsPanel.js';

const TERRAIN = loadBundledTerrainStyles();
const DEFAULT_STYLE = TERRAIN.styles.has(su.DEFAULT_TERRAIN_STYLE) ? su.DEFAULT_TERRAIN_STYLE : (TERRAIN.options[0]?.id ?? su.DEFAULT_TERRAIN_STYLE);
const NO_VOXELS: readonly PreviewVoxel[] = [];

export interface SiteModeDeps {
  readonly session: uc.Session;
  readonly shell: Shell;
  /** Modus aktiv (Plan, Werkzeuge, Panel sichtbar). */
  readonly active: boolean;
  /** Umgebung in Vorschau und Export zeigen (Ansichts-Schalter). */
  readonly show: boolean;
  readonly run: (label: string, f: (s: uc.Session) => uc.Session) => uc.Session | undefined;
  readonly onStatus: (text: string, error?: boolean) => void;
  /** Bodennahe Außen-Deko (`uc.groundExterior`): das Gelände hält dort frei – wie in Vorschau und Export. */
  readonly exterior?: readonly ExteriorPlacement[];
  /** Katalog: angedockte Türme ändern die Hülle (Tür je Etage), betroffene Räume werden neu eingerichtet. */
  readonly catalog?: Catalog;
}

export interface SiteMode {
  readonly status: SurroundingsStatus;
  /** Zusätzliche Quader der Rollen-Vorschau (Gelände-Oberfläche, Pflanzen, Bauwerke). */
  readonly voxels: readonly PreviewVoxel[];
  /** Eingabe für `useWorld` (Blöcke/Texturen/Export); `undefined` = Haus allein. */
  readonly world: WorldSurroundings | undefined;
  readonly toolbar: (header: ReactNode) => ReactNode;
  readonly plan: ReactNode;
  readonly panel: ReactNode;
  /** Kopfzeile des Plans. */
  readonly head: string;
  /** Tastatur im Modus Umgebung; `true` = erledigt. */
  readonly onCommand: (c: Command) => boolean;
  /** Klick in 3D auf ein Bauwerk (`fort:<id>`) wählt es; `true` = erledigt. */
  readonly onPick: (owner: string | undefined) => boolean;
  /** W11-B: Werkzeug von außen wählen (Befehlssuche Strg+K). */
  readonly chooseTool: (t: SiteTool) => void;
}

export function useSiteMode(d: SiteModeDeps): SiteMode {
  const { session, shell, run, onStatus } = d;
  const sur = session.surroundings;
  /** Baukörper des Projekts (BT01): eine Wehrplatte ohne Baukörper wird im Panel als „wird nicht gebaut" gezeigt. */
  const volumeIds = useMemo(() => new Set(session.project.state.rooms.map((r) => r.volumeId ?? 'v0')), [session.project.state.rooms]);
  const [tool, setTool] = useState<SiteTool>('zone');
  const [zoneKind, setZoneKind] = useState<ZoneKind>('field');
  const [sculpt, setSculpt] = useState<SculptChoice>({ tool: 'raise', amount: 2, level: 0, radius: su.BRUSH_RANGE.smooth });
  const [pathRadius, setPathRadius] = useState<number>(su.BRUSH_RANGE.path);
  const [wall, setWall] = useState<su.WallChoice>(su.DEFAULT_WALL);
  const [gate, setGate] = useState<su.GateChoice>(su.DEFAULT_GATE);
  const [tower, setTower] = useState<su.TowerChoice>(su.DEFAULT_TOWER);
  const [windmill, setWindmill] = useState<su.WindmillChoice>(su.DEFAULT_WINDMILL);
  const [annex, setAnnex] = useState<su.AnnexChoice>(su.DEFAULT_ANNEX);
  const [selection, setSelection] = useState<SiteSelection | undefined>(undefined);
  const catalog = d.catalog;

  const site = su.siteOf(sur);
  const shown = d.show ? sur : undefined;
  // Q3: Komponenten-Katalog und Zielversion mitgeben – das Gelände setzt Katalog-Objekte in den Außenzonen.
  // W3-BL: Gelände-Objekte aus der Sicht der Block-Regeln (derselbe Katalog wie `baseWorldOf`, sonst verfehlt der Cache)
  const choice = useMemo(() => (catalog === undefined ? undefined : uc.selectionCatalog(catalog, uc.shellStyle(session))), [catalog, session]);
  const status = useSurroundings(shell, shown, TERRAIN.styles, session.project.state.seed, d.exterior, 300, choice, session.project.state.targetVersion.dataVersion, session.project.state.themeId, siteDecorContext(session.project.state));
  const voxels = useMemo(() => (status.result === undefined ? NO_VOXELS : surroundingsVoxels(status.result)), [status.result]);
  const world = useMemo((): WorldSurroundings | undefined => (su.hasSurroundings(shown) ? { state: shown, styles: TERRAIN.styles } : undefined), [shown]);

  // Auswahl gilt nur, solange es das Bauwerk bzw. die Zone gibt
  const selected: SiteSelection | undefined =
    selection === undefined
      ? undefined
      : selection.kind === 'structure'
        ? su.structureById(sur, selection.id) !== undefined
          ? selection
          : undefined
        : site?.zones.some((z) => z.id === selection.id) === true
          ? selection
          : undefined;

  const selectStructure = (id: string | undefined): void => setSelection(id === undefined ? undefined : { kind: 'structure', id });

  const onWall = (points: readonly Cell[], closed: boolean): void => {
    let id: string | undefined;
    run(`Mauer gezogen (${points.length} Punkte${closed ? ', Ring' : ''})`, (s) => {
      const r = su.addWall(s, points, closed, wall);
      id = r.id;
      return r.session;
    });
    if (id !== undefined) selectStructure(id);
  };

  const onGesture = (g: SiteGesture): void => {
    switch (g.kind) {
      case 'select': {
        const item = su.structureAt(sur, g.cell);
        const zone = item === undefined ? su.zoneAt(site, g.cell) : undefined;
        setSelection(item !== undefined ? { kind: 'structure', id: item.id } : zone !== undefined ? { kind: 'zone', id: zone.id } : undefined);
        return;
      }
      case 'drag': {
        const item = su.structureAt(sur, g.start);
        if (item === undefined) {
          onStatus('Verschieben: auf einem Bauwerk anfangen zu ziehen');
          return;
        }
        run(`${item.id} verschoben`, (s) => su.moveStructure(s, item.id, g.end[0] - g.start[0], g.end[1] - g.start[1]));
        selectStructure(item.id);
        return;
      }
      case 'zone': {
        let zoneId: string | undefined;
        run(`${su.zoneLabel(zoneKind)} gemalt`, (s) => {
          const r = su.paintZone(s, zoneKind, g.rect);
          zoneId = r.zoneId;
          return r.session;
        });
        if (zoneId !== undefined) setSelection({ kind: 'zone', id: zoneId });
        return;
      }
      case 'eraseZone':
        run('Zonen radiert', (s) => su.eraseZones(s, g.rect));
        return;
      case 'sculpt': {
        const label = su.SCULPT_OPTIONS.find((o) => o.id === sculpt.tool)?.label ?? sculpt.tool;
        run(`Gelände: ${label}`, (s) => su.sculpt(s, sculpt.tool, g.rect, { amount: sculpt.amount, level: sculpt.level }));
        return;
      }
      case 'resetSculpt':
        run('Gelände: natürlich', (s) => su.sculpt(s, 'reset', g.rect));
        return;
      case 'plot':
        run('Grundstück gesetzt', (s) => su.setPlot(s, g.rect));
        return;
      case 'gate': {
        let wallId: string | undefined;
        run('Tor gesetzt', (s) => {
          const r = su.addGate(s, g.cell, gate);
          wallId = r.wallId;
          return r.session;
        });
        if (wallId !== undefined) selectStructure(wallId);
        return;
      }
      case 'removeGate':
        run('Tor entfernt', (s) => su.removeGateAt(s, g.cell));
        return;
      case 'place': {
        let id: string | undefined;
        const what = tool === 'windmill' ? 'Windmühle' : tool === 'annex' ? su.annexLabel(annex.kind) : 'Turm';
        run(`${what} gesetzt`, (s) => {
          const r = tool === 'windmill' ? su.addWindmill(s, g.cell, windmill) : tool === 'annex' ? su.addAnnexTower(s, catalog, g.cell, annex) : su.addTower(s, g.cell, tower);
          id = r.id;
          return r.session;
        });
        if (id !== undefined) selectStructure(id);
        return;
      }
      case 'remove': {
        const item = su.structureAt(sur, g.cell);
        if (item === undefined) onStatus('Hier ist kein Bauwerk (Rechtsklick auf ein Bauwerk entfernt es)');
        else run(`${item.id} entfernt`, (s) => su.removeStructure(s, item.id, catalog));
        return;
      }
      case 'brush': {
        // Pinselstrich: Weg (Zone `path`) bzw. Glätten; rechts radiert Zonen bzw. setzt auf natürlich
        if (tool === 'sculpt') {
          if (g.button === 'right') run('Gelände: natürlich', (s) => su.sculpt(s, 'reset', g.cells));
          else run('Gelände geglättet', (s) => su.sculpt(s, sculpt.tool, g.cells));
        } else if (g.button === 'right') run('Zonen radiert', (s) => su.eraseZones(s, g.cells));
        else {
          let zoneId: string | undefined;
          run(`${su.zoneLabel(zoneKind)} gemalt`, (s) => {
            const r = su.paintZone(s, zoneKind, g.cells);
            zoneId = r.zoneId;
            return r.session;
          });
          if (zoneId !== undefined) setSelection({ kind: 'zone', id: zoneId });
        }
        return;
      }
      case 'wallPoint':
      case 'wallUndoPoint':
        return; // erledigt der Plan selbst (Entwurf des Mauerzugs)
    }
  };

  const removeSelected = (): boolean => {
    if (selected === undefined) return false;
    if (selected.kind === 'structure') run(`${selected.id} entfernt`, (s) => su.removeStructure(s, selected.id, catalog));
    else run(`Zone ${selected.id} entfernt`, (s) => su.removeZone(s, selected.id));
    setSelection(undefined);
    return true;
  };

  const onCommand = (c: Command): boolean => {
    const t = SITE_TOOL_FOR_COMMAND[c];
    if (t !== undefined) {
      setTool(t);
      return true;
    }
    if (c === 'site.path') {
      setZoneKind('path');
      setTool('zone');
      return true;
    }
    if (c === 'site.smooth') {
      setSculpt((sc) => ({ ...sc, tool: 'smooth' }));
      setTool('sculpt');
      return true;
    }
    if (c === 'room.delete') return removeSelected() || true;
    if (c === 'room.reroll') {
      run('Gelände neu gewürfelt', su.rerollTerrain);
      return true;
    }
    if (c === 'escape') setSelection(undefined);
    return false;
  };

  const onPick = useCallback((owner: string | undefined): boolean => {
    const id = su.structureIdFromOwner(owner);
    if (id === undefined) return false;
    setSelection({ kind: 'structure', id });
    return true;
  }, []);

  const actions = {
    onTerrain: (on: boolean) => run(on ? 'Gelände an' : 'Gelände aus', (s) => su.setTerrainEnabled(s, on, DEFAULT_STYLE)),
    onLandform: (form: Landform) => run(`Geländeform: ${su.LANDFORM_OPTIONS.find((o) => o.id === form)?.label ?? form}`, (s) => su.setLandform(s, form)),
    onEnsemble: (on: boolean) => run(on ? 'Brücken und Rundwege an' : 'Brücken und Rundwege aus', (s) => su.setEnsemble(s, on)),
    onSiteDecor: (level: SiteDecorLevel) => run(`Grundstücks-Deko: ${su.SITE_DECOR_OPTIONS.find((o) => o.id === level)?.label ?? level}`, (s) => su.setSiteDecor(s, level)),
    onWeathering: (level: 'off' | su.WeatheringLevel) => run(`Verwitterung: ${su.WEATHERING_OPTIONS.find((o) => o.id === level)?.label ?? level}`, (s) => su.setWeathering(s, level)),
    onSurfaceTexture: (level: 'off' | su.SurfaceTextureLevel) => run(`Oberflächen-Textur: ${su.SURFACE_TEXTURE_OPTIONS.find((o) => o.id === level)?.label ?? level}`, (s) => su.setSurfaceTexture(s, level)),
    onStyle: (id: string) => run(`Geländestil: ${TERRAIN.options.find((o) => o.id === id)?.name ?? id}`, (s) => su.setTerrainStyle(s, id)),
    onMargin: (m: number) => run(`Grundstück: Haus + ${m} Blöcke Rand`, (s) => su.fitPlot(s, m)),
    onReroll: () => run('Gelände neu gewürfelt', su.rerollTerrain),
    onVegetation: (patch: Partial<VegetationDensity>) => run('Vegetationsdichte geändert', (s) => su.setVegetation(s, patch)),
    onResetTerrain: () => run('Terraforming zurückgesetzt', su.resetAllTerrain),
    onZoneKind: (id: string, kind: ZoneKind) => run(`Zone ${id}: ${su.zoneLabel(kind)}`, (s) => su.setZoneKind(s, id, kind)),
    onZoneEdge: (id: string, edge: ZoneEdge) => run(`Zone ${id}: Rand ${su.EDGE_OPTIONS.find((o) => o.id === edge)?.label ?? edge}`, (s) => su.setZoneEdge(s, id, edge)),
    onLighting: (l: SiteLighting) => run(`Außenbeleuchtung: ${su.lightingLabel(l)}`, (s) => su.setSiteLighting(s, l)),
    onTemplate: (t: SiteTemplateId) => {
      // Geländestil der Vorlage nur, wenn der Katalog ihn kennt – sonst bleibt der bisherige
      const styleId = TERRAIN.styles.has(t) ? t : (site?.styleId ?? DEFAULT_STYLE);
      run(`Vorlage ${su.SITE_TEMPLATE_OPTIONS.find((o) => o.id === t)?.label ?? t} angelegt (Rückgängig stellt die Zonen wieder her)`, (s) => su.applySiteTemplate(s, t, { styleId }));
    },
    onRemoveZone: (id: string) => run(`Zone ${id} entfernt`, (s) => su.removeZone(s, id)),
    onSelect: setSelection,
    onRemove: (id: string) => run(`${id} entfernt`, (s) => su.removeStructure(s, id, catalog)),
    onAnnex: (id: string, choice: su.AnnexChoice) => run(`${su.annexLabel(choice.kind)} ${id} geändert`, (s) => su.setAnnexChoice(s, catalog, id, choice)),
    onWall: (id: string, patch: su.WallPatch) => run(`Mauer ${id} geändert`, (s) => su.updateWall(s, id, patch)),
    onTower: (id: string, choice: su.TowerChoice) => run(`Turm ${id} geändert`, (s) => su.setTowerChoice(s, id, choice)),
    onWindmill: (id: string, patch: su.WindmillPatch) => run(`Windmühle ${id} geändert`, (s) => su.updateWindmill(s, id, patch)),
    onRemoveGate: (wallId: string, i: number) => run('Tor entfernt', (s) => su.removeGate(s, wallId, i)),
  };

  const summary = site === undefined ? undefined : su.siteSummary(site);
  const brush = brushRadius(tool, zoneKind, sculpt, pathRadius);
  const toolHint: Readonly<Record<SiteTool, string>> = {
    select: 'Klick wählt · Ziehen verschiebt ein Bauwerk · rechts radiert Zonen',
    zone: brush !== undefined ? `${su.zoneLabel(zoneKind)}: Pinsel ziehen malt · rechts radiert` : `${su.zoneLabel(zoneKind)}: ziehen malt · rechts radiert · Klick wählt`,
    sculpt: brush !== undefined ? 'Glätten: Pinsel ziehen · rechts = natürlich' : 'ziehen formt · rechts = natürlich',
    plot: 'Rechteck aufziehen = Grundstück',
    wall: 'Punkte klicken · Doppelklick beendet · erster Punkt schließt den Ring',
    gate: 'Klick auf eine Mauer · rechts entfernt',
    tower: 'Klick setzt · rechts entfernt',
    windmill: 'Klick setzt · rechts entfernt',
    annex: `${su.annexLabel(annex.kind)}: Klick an eine Außenwand · rechts entfernt`,
  };
  const head = `${summary !== undefined ? `Grundstück ${summary.w} × ${summary.d}${sur?.terrain === true ? '' : ' (Gelände aus)'}` : 'kein Gelände'} · ${toolHint[tool]}`;

  const plan = d.active ? (
    <SitePlan
      state={session.project.state}
      shell={shell}
      sur={sur}
      around={status.result}
      tool={tool}
      zoneKind={zoneKind}
      sculptTool={sculpt.tool}
      brush={brush}
      tower={tower}
      windmill={windmill}
      annex={annex}
      selected={selected}
      onGesture={onGesture}
      onWall={onWall}
      onHint={(text) => onStatus(text)}
    />
  ) : null;

  const styleLighting = su.styleLighting(site === undefined ? undefined : TERRAIN.styles.get(site.styleId));
  const panel = d.active ? (
    <SurroundingsPanel sur={sur} site={site} shell={shell} styles={TERRAIN.options} styleLighting={styleLighting} status={status} selected={selected} actions={actions} volumeIds={volumeIds} />
  ) : null;

  const toolbar = (header: ReactNode): ReactNode => (
    <SiteToolbar
      header={header}
      tool={tool}
      onTool={setTool}
      zoneKind={zoneKind}
      onZoneKind={(k) => {
        setZoneKind(k);
        setTool('zone');
      }}
      pathRadius={pathRadius}
      onPathRadius={setPathRadius}
      sculpt={sculpt}
      onSculpt={setSculpt}
      wall={wall}
      onWall={setWall}
      gate={gate}
      onGate={setGate}
      tower={tower}
      onTower={setTower}
      windmill={windmill}
      onWindmill={setWindmill}
      annex={annex}
      onAnnex={setAnnex}
    />
  );

  /** W11-B: Werkzeug von außen wählen (Befehlssuche Strg+K). */
  const chooseTool = (t: SiteTool): void => setTool(t);
  return { status, voxels, world, toolbar, plan, panel, head, onCommand, onPick, chooseTool };
}
