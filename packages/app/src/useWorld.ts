/**
 * React-Anbindung „Blöcke berechnen“: materialisiert das Projekt nur bei Bedarf (Blockvorschau oder
 * Export-Dialog offen) und entprellt: erst wenn sich der Projektzustand `delayMs` lang nicht ändert.
 * Mausereignisse ändern den Zustand nicht (Malen committet erst beim Loslassen), Kamera und Ansicht auch nicht.
 * Die Plattform-Daten der Zielversion werden dabei einmalig nachgeladen. Mit `around` (Umgebung: Gelände,
 * Bauwerke) entsteht Haus + Umgebung als EINE Welt (`baseWorldOf`) – dieselbe Welt nutzt der Export.
 */
import type { Project, ProjectState } from '@mcda/blueprint';
import type { MaterialSurroundings, World } from '@mcda/pipeline';

/** Welt samt Umgebung (für die Materialliste: Haus und Gelände getrennt, W3-BL). */
export type WorldWithSurroundings = World & { readonly surroundings?: MaterialSurroundings };
import type { TerrainStyleDef } from '@mcda/terrain';
import { useEffect, useRef, useState } from 'react';
import type { LazyPipelineContext } from './adapters/browserContext.js';
import { worldOf } from './exporting.js';
import type { SurroundingsState } from './surroundings.js';
import { baseWorldOf } from './surroundingsWorld.js';
import { errorMessage, styleKey, type ShellStyle } from './usecases.js';

interface Computed {
  readonly state: ProjectState;
  /** `styleKey` des Hüllen-Stils. */
  readonly style: string;
  /** Umgebung, mit der gerechnet wurde (`undefined` = Haus allein). */
  readonly around: SurroundingsState | undefined;
  readonly world?: WorldWithSurroundings;
  readonly error?: string;
  readonly ms: number;
}

export interface WorldStatus {
  /** Zuletzt berechnete Blöcke (evtl. zu einem älteren Zustand, siehe `current`). */
  readonly world: WorldWithSurroundings | undefined;
  /** Gehört `world` bzw. `error` zum aktuellen Projektzustand? */
  readonly current: boolean;
  /** Berechnung angefordert, aber noch nicht fertig. */
  readonly busy: boolean;
  readonly error: string | undefined;
  /** Dauer der letzten Materialisierung (ohne Laden der Plattform-Daten). */
  readonly ms: number | undefined;
}

/** Umgebung für die Welt (Gelände + Bauwerke, surroundings.ts): Zustand und Geländestile. */
export interface WorldSurroundings {
  readonly state: SurroundingsState | undefined;
  readonly styles: ReadonlyMap<string, TerrainStyleDef>;
}

export function useWorld(project: Project, pipeline: LazyPipelineContext | undefined, enabled: boolean, style: ShellStyle, delayMs = 250, around?: WorldSurroundings): WorldStatus {
  const [computed, setComputed] = useState<Computed | undefined>(undefined);
  const computedRef = useRef(computed);
  computedRef.current = computed;
  const key = styleKey(style);
  const styleRef = useRef(style);
  styleRef.current = style;
  const aroundState = around?.state;
  const aroundRef = useRef(around);
  aroundRef.current = around;

  useEffect(() => {
    if (!enabled || pipeline === undefined) return;
    if (computedRef.current?.state === project.state && computedRef.current.style === key && computedRef.current.around === aroundState) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const state = project.state;
        try {
          const ctx = await pipeline.ready(state.targetVersion.name);
          if (cancelled) return;
          const t0 = performance.now();
          const a = aroundRef.current;
          const world = a?.state !== undefined ? baseWorldOf(project, ctx, styleRef.current, a.state, a.styles) : worldOf(project, ctx, styleRef.current);
          if (!cancelled) setComputed({ state, style: key, around: aroundState, world, ms: performance.now() - t0 });
        } catch (e) {
          if (!cancelled) setComputed({ state, style: key, around: aroundState, error: errorMessage(e), ms: 0 });
        }
      })();
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project, pipeline, enabled, key, delayMs, aroundState]);

  const current = computed?.state === project.state && computed.style === key && computed.around === aroundState;
  return {
    world: computed?.world,
    current,
    busy: enabled && pipeline !== undefined && !current,
    error: current ? computed?.error : undefined,
    ms: computed?.ms,
  };
}
