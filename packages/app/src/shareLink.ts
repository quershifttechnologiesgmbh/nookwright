/**
 * Teilen per URL (DR5 K4): „Link teilen“ schreibt Bautyp, Seed, Würfel-Zähler und die Parameter des Assistenten in das
 * URL-Fragment (`@mcda/projectfile`, `encodeShareFragment`); beim Öffnen baut die App daraus dasselbe Projekt neu
 * (`typeSession`). Geteilt wird nur die Herkunft aus dem Bautyp – Änderungen im Editor danach (gemalte Räume, Möbel,
 * Stil) nicht; das sagt die Statuszeile. Keine Nutzerdaten: kein Projektname, keine Beschreibung, keine Schlüssel.
 * Der Engine-Weg für denselben Bau ist `building_generate` mit denselben Parametern.
 */
import type { BuildingTypeCatalog } from '@mcda/catalog';
import { EASY_FARM_BLOCKS, normalizeBlockRules, withBlockPreset, type BlockRules } from '@mcda/pipeline';
import { SHARE_MAX_LENGTH, decodeShareFragment, encodeShareFragment, shareParamsOf, type SharedBuild } from '@mcda/projectfile';
import { defaultParams, originParams, originType, roomOrigins, typeLabel, typeSession, type TypeContext, type TypeParams } from './buildingTypes.js';
import { DEFAULT_ROOF, errorMessage, setTargetVersion, shellStyle, type Session } from './usecases.js';

/**
 * Block-Regeln im Link kurz halten: steht das ganze Preset „Nur leicht farmbar“ in der Sperrliste, trägt der Link nur
 * `full: true` und die Sperren darüber hinaus; beim Öffnen setzt `withBlockPreset` die Liste wieder ein (bitgleich).
 */
function packBlockRules(r: BlockRules): Record<string, unknown> {
  if (r.preset !== 'easy_farm' || !EASY_FARM_BLOCKS.every((b) => r.banned.includes(b))) return { ...r };
  return { ...r, banned: r.banned.filter((b) => !EASY_FARM_BLOCKS.includes(b)), full: true };
}

function unpackBlockRules(v: unknown): BlockRules | undefined {
  if (v === null || typeof v !== 'object') return undefined;
  const { full, ...rest } = v as Record<string, unknown> & { full?: unknown };
  const r = rest as unknown as BlockRules;
  return full === true && r.preset !== undefined ? withBlockPreset({ ...r, banned: r.banned ?? [] }, r.preset, true) : normalizeBlockRules(r);
}

/** Geteilter Bau eines Projekts (`undefined`: Projekt stammt aus keinem Bautyp). */
export function shareBuildOf(s: Session, types: BuildingTypeCatalog): SharedBuild | undefined {
  const def = originType(s, types);
  const o = s.project.state.origin;
  if (def === undefined || o === undefined) return undefined;
  const style = shellStyle(s);
  const params: TypeParams = {
    ...originParams(s, def),
    ...(s.project.state.storyState !== undefined ? { storyState: s.project.state.storyState } : {}),
    ...(style.blockRules !== undefined ? { blockRules: packBlockRules(style.blockRules) as unknown as BlockRules } : {}),
    ...(s.surroundings?.ensemble !== undefined ? { ensemble: s.surroundings.ensemble } : {}),
    ...(style.facadeRhythm === true ? { facadeRhythm: 'on' as const } : {}),
  };
  return {
    buildingTypeId: def.id, seed: o.seed, rerollCount: o.rerollCount, targetVersion: s.project.state.targetVersion.name,
    params: shareParamsOf(params as unknown as Record<string, unknown>),
  };
}

/**
 * Link zum Teilen (`base` ohne Fragment, z. B. `location.href`); `undefined` ohne Bautyp. Wirft, wenn der Link zu lang
 * würde (sehr viele eigene Block-Sperren).
 */
export function shareUrlOf(s: Session, types: BuildingTypeCatalog, base: string): string | undefined {
  const b = shareBuildOf(s, types);
  if (b === undefined) return undefined;
  const hash = encodeShareFragment(b);
  if (hash.length > SHARE_MAX_LENGTH) throw new Error('Zu viele eigene Einstellungen für einen Link – bitte als Datei speichern');
  const i = base.indexOf('#');
  return `${i >= 0 ? base.slice(0, i) : base}${hash}`;
}

/** Hat das Projekt seit dem Bautyp Änderungen, die ein Link nicht mitnimmt (eigene Räume oder Undo-Schritte)? */
export function shareLosesEdits(s: Session): boolean {
  return roomOrigins(s).user > 0 || s.past.length > 0;
}

export type ShareOpen =
  | { readonly ok: true; readonly session: Session; readonly name: string; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly error: string };

/**
 * Geteilten Link öffnen: gleiche Parameter, gleicher Seed → gleiches Projekt wie beim Absender. Der Stil des bisherigen
 * Projekts spielt bewusst keine Rolle (sonst hinge das Ergebnis vom Empfänger ab).
 */
export function sessionFromShare(hashOrUrl: string, ctx: TypeContext & { readonly types: BuildingTypeCatalog }): ShareOpen {
  const d = decodeShareFragment(hashOrUrl);
  if (!d.ok) return d;
  const b = d.build;
  if (!ctx.types.ids().includes(b.buildingTypeId)) return { ok: false, error: `Bautyp „${b.buildingTypeId}“ gibt es in dieser Version nicht` };
  const def = ctx.types.get(b.buildingTypeId);
  const fresh = shellStyle({ roof: DEFAULT_ROOF });
  const shared = b.params['blockRules'] === undefined ? b.params : { ...b.params, blockRules: unpackBlockRules(b.params['blockRules']) };
  const params = { ...defaultParams(def, ctx.themes.ids(), 'medieval', fresh), ...shared } as unknown as TypeParams;
  if (!ctx.themes.ids().includes(params.themeId)) return { ok: false, error: `Theme „${params.themeId}“ gibt es in dieser Version nicht` };
  try {
    let session = typeSession(def, params, b.seed, ctx, fresh, b.rerollCount).session;
    if (b.targetVersion !== undefined && b.targetVersion !== session.project.state.targetVersion.name) {
      session = { ...setTargetVersion(session, ctx.catalog, b.targetVersion), past: [] };
    }
    return { ok: true, session, name: typeLabel(def), warnings: d.warnings };
  } catch (e) {
    return { ok: false, error: `Geteilter Link nicht lesbar: ${errorMessage(e)}` };
  }
}
