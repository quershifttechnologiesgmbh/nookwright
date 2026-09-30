/**
 * React-Anbindung „Umgebung berechnen“ (Rollen-Vorschau und Plan „Umgebung“): Gelände + Bauwerke über
 * `surroundingsOf`, entprellt wie `useWorld` – das Raum-Malen wartet nie darauf. Bis das Ergebnis da ist, bleibt das
 * letzte sichtbar (`current = false`). Schon berechnete Zustände (Undo/Redo) erscheinen sofort.
 */
import type { Shell } from '@mcda/blueprint';
import type { Catalog } from '@mcda/catalog';
import type { ExteriorPlacement, Surroundings } from '@mcda/pipeline';
import type { TerrainStyleDef } from '@mcda/terrain';
import { useEffect, useMemo, useRef, useState } from 'react';
import { hasSurroundings, type SurroundingsState } from './surroundings.js';
import { buildingKey, cachedSurroundings, exteriorKey, surroundingsOf, type SiteDecorContext } from './surroundingsWorld.js';
import { errorMessage } from './usecases.js';

export interface SurroundingsStatus {
  /** Zuletzt berechnete Umgebung (evtl. zu einem älteren Stand, siehe `current`); `undefined` = keine. */
  readonly result: Surroundings | undefined;
  readonly current: boolean;
  readonly busy: boolean;
  readonly error: string | undefined;
  /** Dauer der letzten Berechnung. */
  readonly ms: number | undefined;
}

interface Computed {
  readonly key: string;
  readonly result?: Surroundings | undefined;
  readonly error?: string;
  readonly ms: number;
}

const NO_EXTERIOR: readonly ExteriorPlacement[] = [];

/** `exterior`: bodennahe Außen-Deko (`groundExterior`), die das Gelände als belegt kennt – wie in `baseWorldOf`.
 *  `catalog`/`dataVersion` (Q3): Komponenten-Katalog und Zielversion für die Katalog-Objekte des Geländes. */
export function useSurroundings(
  shell: Shell, sur: SurroundingsState | undefined, styles: ReadonlyMap<string, TerrainStyleDef>, seed: number, exterior: readonly ExteriorPlacement[] = NO_EXTERIOR, delayMs = 300,
  catalog?: Catalog, dataVersion?: number, themeId?: string, decor?: SiteDecorContext,
): SurroundingsStatus {
  const active = hasSurroundings(sur);
  const xKey = useMemo(() => exteriorKey(exterior), [exterior]);
  const [computed, setComputed] = useState<Computed | undefined>(undefined);
  // Schlüssel ohne Rechnen: Zustand (Identität über das Objekt selbst) + Gebäude-Sicht + Seed
  const idRef = useRef(new WeakMap<object, number>());
  const nextRef = useRef(1);
  let key = 'none';
  if (active) {
    const objectId = (o: object): number => {
      let id = idRef.current.get(o);
      if (id === undefined) idRef.current.set(o, (id = nextRef.current++));
      return id;
    };
    key = `${objectId(sur)}|${seed}|${buildingKey(shell)}|${xKey}|${catalog === undefined ? '-' : objectId(catalog)}|${dataVersion ?? 0}|${themeId ?? '-'}|${sur.siteDecor === undefined || decor === undefined ? '-' : `${sur.siteDecor}:${decor.hints.join(',')}`}`;
  }
  const inputs = useRef({ shell, sur, styles, seed, exterior, catalog, dataVersion, themeId, decor });
  inputs.current = { shell, sur, styles, seed, exterior, catalog, dataVersion, themeId, decor };
  // Schon im Zwischenspeicher (z. B. nach Undo): sofort zeigen, ohne Effekt-Runde
  const cached = active && computed?.key !== key ? cachedSurroundings(shell, sur, styles, seed, exterior, catalog, dataVersion, themeId, decor) : undefined;

  useEffect(() => {
    if (key === 'none' || computed?.key === key) return;
    const run = (): void => {
      const { shell: sh, sur: st, styles: sty, seed: sd, exterior: ex, catalog: cat, dataVersion: dv, themeId: th, decor: dc } = inputs.current;
      const t0 = performance.now();
      try {
        setComputed({ key, result: surroundingsOf(sh, st, sty, sd, ex, undefined, undefined, cat, dv, th, dc), ms: performance.now() - t0 });
      } catch (e) {
        setComputed({ key, error: errorMessage(e), ms: 0 });
      }
    };
    const timer = setTimeout(run, cached !== undefined ? 0 : delayMs);
    return () => clearTimeout(timer);
  }, [key, delayMs, computed?.key, cached]);

  if (!active) return { result: undefined, current: true, busy: false, error: undefined, ms: computed?.ms };
  const current = computed?.key === key;
  return {
    result: current ? computed.result : (cached ?? computed?.result),
    current: current || cached !== undefined,
    busy: !current && cached === undefined,
    error: current ? computed.error : undefined,
    ms: computed?.ms,
  };
}
