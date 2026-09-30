/**
 * Gesperrte Blöcke (W3-BL, Konzept W2UX §4.3 B2): Sicht der Materialisierung, in der gesperrte Blöcke „fehlen“.
 *
 * - **Theme-Rollen:** Die Theme-Auflösung (`ThemeResolver`) behandelt einen gesperrten Block wie einen Block, den es in
 *   der Zielversion nicht gibt – Mischungs-Einträge fallen heraus (Gewichte neu normiert), dann greift die bestehende
 *   Ersatzkette (Versions-, Rollen-, Plattform-Fallback). Erst wenn alles scheitert, ersetzt `substitute` den Block.
 * - **Feste Blöcke** (Möbel-Legenden, Innenhaut, Schnee …): `substituteState` tauscht den fertigen Zustand gegen einen
 *   Ersatz mit übernommenen Eigenschaften (Ausrichtung, Hälfte, Achse …). Reihenfolge der Kandidaten: feste Ersetzung
 *   des Nutzers → kuratierte Liste der Plattform (`BLOCK_SUBSTITUTES`) → nächstes Familienmitglied derselben Art und
 *   Form (`familySubstitutes`, nach Farbe). Ein automatischer Kandidat muss dieselbe Physik-Klasse haben und mindestens
 *   so hell leuchten (Licht-Garantie: 0 dunkle Zellen).
 *
 * Ohne Sperren (`PlatformView.bans` fehlt oder ist leer) wird nichts hiervon benutzt – die Welt bleibt bitgleich.
 */
import { BLOCK_RENAMES, BLOCK_SUBSTITUTES, familySubstitutes, normalizeId, wallVariants, type PropertyMap } from '@mcda/platform';
import { blockState, type BlockState } from '@mcda/voxel';
import { emission } from './light.js';
import type { BlockBans, PlatformView } from './types.js';

/** Liegende Kopf-Drehung (0–15) → waagerechte Blickrichtung. */
const ROTATION_FACING = ['south', 'west', 'north', 'east'] as const;

/** Gesperrte Namen samt Wandformen (`torch` → `wall_torch`) und Umbenennungen (`chain` ↔ `iron_chain`), ohne Namensraum. */
export function bannedNames(names: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const n of names) {
    const id = normalizeId(n);
    out.add(id);
    for (const w of wallVariants(id)) out.add(w);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of BLOCK_RENAMES) {
      if (out.has(r.from) && !out.has(r.to)) { out.add(r.to); grew = true; }
      if (out.has(r.to) && !out.has(r.from)) { out.add(r.from); grew = true; }
    }
  }
  return out;
}

/** Sperr-Index einer Materialisierung (je Zielversion). */
export class BanIndex {
  private readonly banned: ReadonlySet<string>;
  private readonly replace: ReadonlyMap<string, string>;
  private readonly subCache = new Map<string, readonly string[]>();

  constructor(bans: BlockBans, private readonly platform: PlatformView) {
    this.banned = bannedNames(bans.banned);
    const replace = new Map<string, string>();
    for (const [from, to] of bans.replace ?? new Map<string, string>()) replace.set(normalizeId(from), normalizeId(to));
    this.replace = replace;
  }

  /** Gibt es überhaupt Sperren? */
  get active(): boolean {
    return this.banned.size > 0;
  }

  isBanned(name: string): boolean {
    return this.banned.has(normalizeId(name));
  }

  /**
   * Block für die Theme-Auflösung: erlaubt → er selbst; gesperrt → feste Ersetzung des Nutzers (falls es sie in der
   * Version gibt und sie selbst erlaubt ist), sonst `undefined` (= „fehlt“, die Ersatzkette sucht weiter).
   */
  usable(name: string): string | undefined {
    if (!this.isBanned(name)) return name;
    const r = this.replace.get(normalizeId(name));
    return r !== undefined && !this.isBanned(r) && this.platform.registry.hasBlock(r) ? r : undefined;
  }

  /** Kandidaten für einen gesperrten Block, beste zuerst (ohne Prüfung von Physik und Licht). */
  candidates(name: string): readonly string[] {
    const n = normalizeId(name);
    let list = this.subCache.get(n);
    if (list === undefined) {
      const fixed = this.replace.get(n);
      list = [...new Set([...(fixed !== undefined ? [fixed] : []), ...(BLOCK_SUBSTITUTES[n] ?? []), ...familySubstitutes(this.platform.families, n)])]
        .filter((b) => b !== n && !this.isBanned(b) && this.platform.registry.hasBlock(b));
      this.subCache.set(n, list);
    }
    return list;
  }

  /** Ersatz-Blockname (ohne Zustand) – für die Theme-Auflösung, wenn die Ersatzkette nichts Erlaubtes findet. */
  substitute(name: string): string | undefined {
    const state = this.platform.registry.defaultState(name);
    if (state === undefined) return this.candidates(name)[0];
    return this.substituteState(state)?.name;
  }

  /** Physik-Klasse des Standard-Zustands (unbekannt: `undefined`). */
  private cls(name: string): string | undefined {
    const b = this.platform.physics.blocks[name];
    return b?.cls;
  }

  /**
   * Gesperrter Zustand → Ersatz-Zustand mit übernommenen Eigenschaften; `undefined`, wenn kein Kandidat passt.
   * Feste Ersetzungen des Nutzers gelten ohne Physik-/Lichtprüfung (seine Wahl), automatische nur mit gleicher
   * Physik-Klasse und mindestens gleicher Leuchtkraft.
   */
  substituteState(state: BlockState): BlockState | undefined {
    const name = normalizeId(state.name);
    const fixed = this.replace.get(name);
    const light = emission(state);
    const cls = this.cls(name);
    for (const cand of this.candidates(name)) {
      const next = this.carry(state, cand);
      if (next === undefined) continue;
      if (cand === fixed) return next;
      if (cls !== undefined && this.cls(cand) !== cls) continue;
      if (emission(next) < light) continue;
      return next;
    }
    return undefined;
  }

  /** Eigenschaften übernehmen, die der Ersatz kennt (samt Übersetzung Blickrichtung/Hängen/Kopf-Drehung). */
  private carry(state: BlockState, cand: string): BlockState | undefined {
    const allowed = this.platform.registry.listProperties(cand);
    if (allowed === undefined) return undefined;
    const props: Record<string, string> = {};
    const ok = (k: string, v: string): boolean => allowed[k]?.includes(v) === true;
    for (const [k, v] of Object.entries(state.properties)) if (ok(k, v)) props[k] = v;
    const p: PropertyMap = state.properties;
    if (allowed['hanging'] !== undefined) {
      // Endstab nach unten / Glocke an der Decke → hängende Laterne; sonst stehend
      const hang = p['facing'] === 'down' || p['attachment'] === 'ceiling';
      props['hanging'] = hang ? 'true' : 'false';
    }
    if (allowed['facing'] !== undefined && props['facing'] === undefined && p['rotation'] !== undefined) {
      const f = ROTATION_FACING[Math.round(Number(p['rotation']) / 4) % 4]!;
      if (ok('facing', f)) props['facing'] = f;
    }
    try {
      const full = this.platform.registry.resolveState(cand, props);
      return blockState(full.name, full.properties);
    } catch {
      return undefined;
    }
  }
}

/** Sperr-Index für eine Plattform-Sicht; `undefined` ohne (wirksame) Sperren. */
export function banIndexOf(platform: PlatformView): BanIndex | undefined {
  const bans = platform.bans;
  if (bans === undefined || bans.banned.length === 0) return undefined;
  return new BanIndex(bans, platform);
}
