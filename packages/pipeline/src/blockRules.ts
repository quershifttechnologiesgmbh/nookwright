/**
 * Blöcke sperren und ersetzen (W3-BL, Beta-Wunsch, Konzept W2UX §4.3 B2–B4): eine Projekt-Einstellung, die App und
 * Engine-API gleich anwenden. Eine Stelle für die Regel (CLAUDE.md „keine Regel nur in der App“):
 *
 * - `blockRulesContext(ctx, rules)` liefert den Kontext, mit dem ein Projekt gebaut wird: Die **Materialisierung** sieht
 *   eine Plattform-Sicht, in der gesperrte Blöcke fehlen (`PlatformView.bans`, Ersatzkette in `@mcda/materialize`), und
 *   die **Auswahl** (Einrichtung, Licht-Pass, Außen-Deko, Gelände-Objekte, Tauschen) eine Katalog-Sicht
 *   (`blockRulesCatalog`): Varianten mit gesperrten Blöcken sind ausgeblendet; Komponenten ohne erlaubte Variante und –
 *   mit dem Preset – Komponenten mit `obtainability: survival_rare` treten zurück, solange eine andere die Tags erfüllt
 *   (sonst bleiben sie, ihre gesperrten Blöcke ersetzt die Materialisierung).
 * - Ohne Regeln (`undefined` oder leere Liste) liefert sie **denselben** Kontext: bitgleich.
 *
 * Die Liste des Presets „Nur leicht farmbar“ steht in `@mcda/platform` (`HARD_TO_FARM`); das Preset schreibt sie beim
 * Einschalten in `banned` (einzeln anpassbar, Nutzerentscheidung 26.09.2026) – ein gespeichertes Projekt bleibt so
 * gleich, auch wenn die Liste später wächst.
 */
import { type Catalog, type ComponentDef } from '@mcda/catalog';
import { expandComponent } from '@mcda/furnishing';
import { bannedNames, type PlatformView } from '@mcda/materialize';
import { HARD_TO_FARM, HARD_TO_FARM_BLOCKS, hardToFarmReason, normalizeId, type HardToFarmGroup } from '@mcda/platform';
import type { PipelineContext } from './world.js';

/** Presets der Block-Regeln. */
export const BLOCK_RULE_PRESETS = ['easy_farm'] as const;
export type BlockRulePreset = (typeof BLOCK_RULE_PRESETS)[number];

/** Projekt-Einstellung „Blöcke sperren“. */
export interface BlockRules {
  /** Gesperrte Block-IDs (ohne `minecraft:`), sortiert. */
  readonly banned: readonly string[];
  /** Feste Ersetzungen: gesperrter Block → Ersatzblock (optional; sonst wählt die Materialisierung). */
  readonly replace?: Readonly<Record<string, string>>;
  /** Preset, aus dem die Liste stammt (nur Anzeige und Rückstufung seltener Komponenten). */
  readonly preset?: BlockRulePreset;
}

/** Blöcke des Presets „Nur leicht farmbar“. */
export const EASY_FARM_BLOCKS: readonly string[] = HARD_TO_FARM_BLOCKS;
/** Gruppen des Presets mit Begründung (Anzeige, `catalog_describe`). */
export const EASY_FARM_GROUPS: readonly HardToFarmGroup[] = HARD_TO_FARM;
/** Warum steht ein Block im Preset? (`undefined`: steht nicht darin) */
export const easyFarmReason = (block: string): string | undefined => hardToFarmReason(block);

const BLOCK_ID = /^[a-z0-9_]+$/;
const cleanId = (id: string): string | undefined => {
  const n = normalizeId(id.trim().toLowerCase());
  return BLOCK_ID.test(n) ? n : undefined;
};

/**
 * Regeln in Normalform: IDs ohne Namensraum, sortiert, ohne Doppel; Ersetzungen nur für gesperrte Blöcke und nie auf
 * einen gesperrten Block; `undefined`, wenn nichts gesperrt ist (= keine Regeln, bitgleich).
 */
export function normalizeBlockRules(r: BlockRules | undefined): BlockRules | undefined {
  if (r === undefined) return undefined;
  const banned = [...new Set(r.banned.map(cleanId).filter((b): b is string => b !== undefined))].sort();
  if (banned.length === 0) return undefined;
  const set = new Set(banned);
  const replace: Record<string, string> = {};
  for (const [from, to] of Object.entries(r.replace ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    const f = cleanId(from);
    const t = typeof to === 'string' ? cleanId(to) : undefined;
    if (f !== undefined && t !== undefined && set.has(f) && !set.has(t) && f !== t) replace[f] = t;
  }
  return {
    banned,
    ...(Object.keys(replace).length > 0 ? { replace } : {}),
    ...(r.preset !== undefined && (BLOCK_RULE_PRESETS as readonly string[]).includes(r.preset) ? { preset: r.preset } : {}),
  };
}

/** Stabiler Schlüssel der Regeln (Caches, Vergleich); `''` ohne Regeln. */
export function blockRulesKey(r: BlockRules | undefined): string {
  const n = normalizeBlockRules(r);
  if (n === undefined) return '';
  const rep = Object.entries(n.replace ?? {}).map(([a, b]) => `${a}>${b}`).join(',');
  return `${n.preset ?? ''}|${n.banned.join(',')}|${rep}`;
}

/** Preset ein- oder ausschalten: Liste hinzufügen bzw. entfernen (eigene Sperren bleiben). */
export function withBlockPreset(r: BlockRules | undefined, preset: BlockRulePreset, on: boolean): BlockRules | undefined {
  const list = preset === 'easy_farm' ? EASY_FARM_BLOCKS : [];
  const current = r?.banned ?? [];
  const banned = on ? [...current, ...list] : current.filter((b) => !list.includes(b));
  const { preset: _p, ...rest } = r ?? { banned: [] };
  return normalizeBlockRules({ ...rest, banned, ...(on ? { preset } : {}) });
}

/** Einen Block sperren bzw. freigeben (freigeben entfernt auch seine feste Ersetzung). */
export function withBlockBanned(r: BlockRules | undefined, block: string, banned: boolean): BlockRules | undefined {
  const id = cleanId(block);
  if (id === undefined) return normalizeBlockRules(r);
  const current = r?.banned ?? [];
  const next = banned ? [...current, id] : current.filter((b) => b !== id);
  const { [id]: _drop, ...replace } = r?.replace ?? {};
  // Sonderfall: Preset aus, wenn keiner seiner Blöcke mehr gesperrt ist
  const preset = r?.preset !== undefined && next.some((b) => EASY_FARM_BLOCKS.includes(b)) ? { preset: r.preset } : {};
  return normalizeBlockRules({ banned: next, ...(banned ? { replace: r?.replace ?? {} } : { replace }), ...preset });
}

/** Feste Ersetzung setzen (`to` undefined = automatisch). Der Block wird dabei gesperrt. */
export function withBlockReplacement(r: BlockRules | undefined, block: string, to: string | undefined): BlockRules | undefined {
  const id = cleanId(block);
  if (id === undefined) return normalizeBlockRules(r);
  const { [id]: _drop, ...replace } = r?.replace ?? {};
  return normalizeBlockRules({
    ...(r ?? { banned: [] }),
    banned: [...(r?.banned ?? []), id],
    replace: to === undefined ? replace : { ...replace, [id]: to },
  });
}

// ---------------------------------------------------------------------------------------------- Katalog-Sicht

/** Feste Blöcke einer Komponente bzw. Variante (Legenden, ohne Rollen). */
function fixedBlocks(def: ComponentDef, variantId: string | undefined): Set<string> {
  const out = new Set<string>();
  try {
    for (const c of expandComponent(def, variantId).cells) if (c.mat.block !== undefined) out.add(normalizeId(c.mat.block));
  } catch {
    // nicht expandierbar (unvollständige Definition): nichts ausblenden, die Einrichtung meldet es selbst
  }
  return out;
}

const catalogViews = new WeakMap<Catalog, Map<string, Catalog>>();

/**
 * Katalog-Sicht für die Auswahl (Konzept W2UX §4.3 B3): Varianten mit gesperrten Blöcken sind ausgeblendet; eine
 * Komponente ohne erlaubte Variante (bzw. ohne Varianten, mit gesperrtem Block) und – mit Preset – eine seltene
 * Komponente (`obtainability: survival_rare`) tritt zurück, solange eine andere die Tags erfüllt. `get`/`find` liefern
 * weiter die Originale. Ohne Regeln: derselbe Katalog.
 */
export function blockRulesCatalog(catalog: Catalog, rules: BlockRules | undefined): Catalog {
  const n = normalizeBlockRules(rules);
  if (n === undefined) return catalog;
  const key = blockRulesKey(n);
  let views = catalogViews.get(catalog);
  if (views === undefined) catalogViews.set(catalog, (views = new Map()));
  const hit = views.get(key);
  if (hit !== undefined) return hit;
  const banned = bannedNames(n.banned);
  const hits = (blocks: ReadonlySet<string>): boolean => [...blocks].some((b) => banned.has(b));
  const rewritten = new Map<string, ComponentDef | undefined>();
  const tainted = new Set<string>();
  for (const def of catalog.all()) {
    if (def.variants === undefined) {
      if (hits(fixedBlocks(def, undefined))) tainted.add(def.id);
      continue;
    }
    const clean = def.variants.filter((v) => !hits(fixedBlocks(def, v.id)));
    if (clean.length === 0) tainted.add(def.id);
    else if (clean.length < def.variants.length) rewritten.set(def.id, { ...def, variants: clean });
  }
  const rare = n.preset === 'easy_farm';
  const view = catalog.choiceView({
    rewrite: (d) => rewritten.get(d.id),
    demote: (d) => tainted.has(d.id) || (rare && d.obtainability === 'survival_rare'),
  });
  views.set(key, view);
  return view;
}

/** Varianten, die die Katalog-Sicht einer Komponente ausblendet (für die Anzeige „ersetzt 1 Möbel-Variante“). */
export function hiddenVariants(catalog: Catalog, rules: BlockRules | undefined): ReadonlyArray<{ readonly componentId: string; readonly variantId: string }> {
  const n = normalizeBlockRules(rules);
  if (n === undefined) return [];
  const banned = bannedNames(n.banned);
  const out: { componentId: string; variantId: string }[] = [];
  for (const def of catalog.all()) {
    for (const v of def.variants ?? []) {
      if ([...fixedBlocks(def, v.id)].some((b) => banned.has(b))) out.push({ componentId: def.id, variantId: v.id });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- Kontext

const contexts = new WeakMap<PipelineContext, Map<string, PipelineContext>>();
/** Bereits abgeleitete Kontexte → ihr Regel-Schlüssel (kein zweites Umwickeln in `generateBase` → `generateWith`). */
const derived = new WeakMap<PipelineContext, string>();

/**
 * Kontext eines Projekts mit Block-Regeln: Katalog-Sicht für die Auswahl, Plattform-Sicht mit Sperren für die
 * Materialisierung. Ohne Regeln derselbe Kontext (bitgleich); je Kontext und Regeln zwischengespeichert.
 */
export function blockRulesContext(ctx: PipelineContext, rules: BlockRules | undefined): PipelineContext {
  const n = normalizeBlockRules(rules);
  if (n === undefined) return ctx;
  const key = blockRulesKey(n);
  if (derived.get(ctx) === key) return ctx;
  let map = contexts.get(ctx);
  if (map === undefined) contexts.set(ctx, (map = new Map()));
  const hit = map.get(key);
  if (hit !== undefined) return hit;
  const replace = new Map(Object.entries(n.replace ?? {}));
  const views = new Map<string, PlatformView>();
  const platform = (version: string): PlatformView => {
    let v = views.get(version);
    if (v === undefined) views.set(version, (v = { ...ctx.platform(version), bans: { banned: n.banned, ...(replace.size > 0 ? { replace } : {}) } }));
    return v;
  };
  const out: PipelineContext = { ...ctx, catalog: blockRulesCatalog(ctx.catalog, n), platform };
  map.set(key, out);
  derived.set(out, key);
  return out;
}
