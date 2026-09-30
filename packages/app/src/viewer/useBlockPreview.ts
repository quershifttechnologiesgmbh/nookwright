/**
 * W14: React-Anbindung „Vorschau: Blöcke“ über den Blöcke-Worker (adapters/blocksClient.ts) – wie `useWorld`
 * entprellt (erst wenn sich der Stand `delayMs` lang nicht ändert) und mit denselben Schlüsseln (Projektzustand,
 * Stil-Schlüssel, Umgebung), aber die Materialisierung läuft neben dem Haupt-Thread. Die zuletzt berechneten Quader
 * bleiben sichtbar, bis neue da sind. Fällt der Worker aus, meldet der Hook `failed` – die App rechnet dann selbst.
 */
import type { ProjectState } from '@mcda/blueprint';
import { useEffect, useRef, useState } from 'react';
import { BlocksSuperseded, BlocksWorkerFailed, type BlocksClient } from '../adapters/blocksClient.js';
import { unpackVoxels, type BlocksStats, type WorldReport } from '../adapters/blocksJob.js';
import type { MaterialData } from '../ui/materialRows.js';
import { serializeProject } from '../projectFile.js';
import type { SurroundingsState } from '../surroundings.js';
import type { Session } from '../usecases.js';
import type { PreviewVoxel } from './voxels.js';

interface Computed {
  readonly state: ProjectState;
  readonly style: string;
  readonly around: SurroundingsState | undefined;
  readonly voxels?: readonly PreviewVoxel[];
  readonly stats?: BlocksStats;
  readonly report?: WorldReport;
  readonly material?: MaterialData;
  readonly error?: string;
  readonly ms: number;
}

export interface BlockPreview {
  /** Zuletzt berechnete Quader (evtl. zu einem älteren Stand, siehe `current`); `undefined` = noch keine. */
  readonly voxels: readonly PreviewVoxel[] | undefined;
  readonly current: boolean;
  readonly busy: boolean;
  readonly error: string | undefined;
  /** Kennzahlen der Statuszeile zum aktuellen Stand. */
  readonly stats: BlocksStats | undefined;
  /** Prüfbericht (Export-Dialog, ohne Erreichbarkeit) zum aktuellen Stand. */
  readonly report: WorldReport | undefined;
  /** Daten des Tabs „Material“ zum aktuellen Stand. */
  readonly material: MaterialData | undefined;
  /** Hat der zuletzt berechnete Stand eine Umgebung? (auch während neu gerechnet wird) */
  readonly hasSurroundings: boolean;
  readonly ms: number | undefined;
  /** Worker ausgefallen → Haupt-Thread-Weg (`useWorld`). */
  readonly failed: boolean;
}

/**
 * Zuletzt berechnete Stände nach Projektdatei (fester Speicherzeitpunkt, also nur der Inhalt): Rückgängig und
 * Wiederholen kehren zu einem schon berechneten Stand zurück – dann ohne Worker und mit denselben Quadern (die 3D-Ansicht
 * baut nichts neu). Der Worker selbst kennt die Zustände nicht wieder (jede Anfrage liest die Datei neu).
 */
const recent: Array<{ readonly file: string; readonly around: boolean; readonly voxels: readonly PreviewVoxel[]; readonly stats: BlocksStats; readonly report: WorldReport; readonly material: MaterialData; readonly ms: number }> = [];
const RECENT = 4;
const FIXED_TIME = new Date(0);

export function useBlockPreview(
  session: Session, client: BlocksClient | undefined, enabled: boolean, styleKey: string, around: SurroundingsState | undefined, delayMs = 250,
): BlockPreview {
  const [computed, setComputed] = useState<Computed | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const computedRef = useRef(computed);
  computedRef.current = computed;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const state = session.project.state;
  const on = enabled && client !== undefined && !failed;

  useEffect(() => {
    if (!on || client === undefined) return;
    const c = computedRef.current;
    if (c?.state === state && c.style === styleKey && c.around === around) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const file = serializeProject(sessionRef.current, { savedAt: FIXED_TIME });
      const withAround = around !== undefined;
      const i = recent.findIndex((e) => e.file === file && e.around === withAround);
      if (i >= 0) {
        const [hit] = recent.splice(i, 1);
        recent.unshift(hit!);
        setComputed({ state, style: styleKey, around, voxels: hit!.voxels, stats: hit!.stats, report: hit!.report, material: hit!.material, ms: hit!.ms });
        return;
      }
      client.compute(file, withAround).then(
        (r) => {
          const voxels = unpackVoxels(r.voxels);
          recent.unshift({ file, around: withAround, voxels, stats: r.stats, report: r.report, material: r.material, ms: r.ms });
          recent.length = Math.min(recent.length, RECENT);
          if (!cancelled) setComputed({ state, style: styleKey, around, voxels, stats: r.stats, report: r.report, material: r.material, ms: r.ms });
        },
        (e: unknown) => {
          if (cancelled || e instanceof BlocksSuperseded) return;
          if (e instanceof BlocksWorkerFailed) setFailed(true);
          else setComputed({ state, style: styleKey, around, error: e instanceof Error ? e.message : String(e), ms: 0 });
        },
      );
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [on, client, state, styleKey, around, delayMs]);

  const current = computed?.state === state && computed.style === styleKey && computed.around === around;
  const last = computed?.voxels !== undefined ? computed : undefined;
  return {
    voxels: last?.voxels,
    current,
    busy: on && !current,
    error: current ? computed?.error : undefined,
    stats: current ? computed?.stats : undefined,
    report: current ? computed?.report : undefined,
    material: current ? computed?.material : undefined,
    hasSurroundings: last?.material?.hasSurroundings === true,
    ms: computed?.ms,
    failed,
  };
}
