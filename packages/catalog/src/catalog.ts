import type { RoomTypeDef } from './roomtype.js';
import type { ComponentDef } from './schema.js';

/** Unveränderlicher Katalog (Read Model). Enthält nur validierte Definitionen. */
export class Catalog {
  private readonly byId: ReadonlyMap<string, ComponentDef>;
  private readonly byTagIndex: ReadonlyMap<string, readonly ComponentDef[]>;
  private readonly roomTypes: ReadonlyMap<string, RoomTypeDef>;
  /** Additiv (W3-BL): Auswahl-Sicht für `byTags` (siehe `choiceView`); fehlt = alle Definitionen unverändert. */
  private readonly choice: ChoiceView | undefined;

  private constructor(defs: readonly ComponentDef[], roomTypes: readonly RoomTypeDef[], choice?: ChoiceView) {
    this.choice = choice;
    const byId = new Map<string, ComponentDef>();
    const byTag = new Map<string, ComponentDef[]>();
    for (const d of defs) {
      if (byId.has(d.id)) throw new Error(`Komponente '${d.id}' ist doppelt im Katalog`);
      byId.set(d.id, d);
      for (const t of d.tags) {
        const list = byTag.get(t) ?? [];
        list.push(d);
        byTag.set(t, list);
      }
    }
    this.byId = byId;
    this.byTagIndex = byTag;
    const rts = new Map<string, RoomTypeDef>();
    for (const rt of roomTypes) {
      if (rts.has(rt.id)) throw new Error(`Raumtyp '${rt.id}' ist doppelt im Katalog`);
      rts.set(rt.id, rt);
    }
    this.roomTypes = rts;
  }

  static of(defs: readonly ComponentDef[], roomTypes: readonly RoomTypeDef[] = []): Catalog {
    return new Catalog(defs, roomTypes);
  }

  /**
   * Additiv (W3-BL, Blöcke sperren): Sicht für die **Auswahl** (Einrichtung, Licht-Pass, Außen-Deko, Tauschen). `byTags`
   * liefert die umgeschriebenen Definitionen (`choice.rewrite`, z. B. ohne Varianten mit gesperrten Blöcken) und lässt
   * `choice.demote`-Definitionen weg, solange eine andere die Tags erfüllt; `get`/`find`/`all` liefern weiter die
   * Originale (bestehende Platzierungen bleiben auflösbar). Ohne Wirkung (keine Umschreibung) bleibt `byTags`
   * elementgleich – der Solver ist dann bitgleich.
   */
  choiceView(choice: ChoiceView): Catalog {
    return new Catalog([...this.byId.values()], [...this.roomTypes.values()], choice);
  }

  roomType(id: string): RoomTypeDef {
    const rt = this.roomTypes.get(id);
    if (rt === undefined) throw new Error(`Unbekannter Raumtyp '${id}'`);
    return rt;
  }

  roomTypeIds(): string[] {
    return [...this.roomTypes.keys()].sort();
  }

  /** Tags, die ein Raumtyp verlangt, für die aber keine Komponente existiert (Katalog-Lint). */
  missingTags(roomTypeId: string, dataVersion?: number): string[] {
    const rt = this.roomType(roomTypeId);
    const missing = [...rt.required, ...rt.optional].flatMap((e) => (this.byTags(e.tags, dataVersion).length === 0 ? [e.tags.join('|')] : []));
    // Wunsch-Lichtquellen des Licht-Passes (einzeln: jede genannte Art sollte es geben)
    for (const t of rt.lighting?.prefer ?? []) if (this.byTags([t], dataVersion).length === 0) missing.push(t);
    return missing;
  }

  get size(): number {
    return this.byId.size;
  }

  get(id: string): ComponentDef {
    const d = this.byId.get(id);
    if (d === undefined) throw new Error(`Unbekannte Komponente '${id}'`);
    return d;
  }

  find(id: string): ComponentDef | undefined {
    return this.byId.get(id);
  }

  /** Alle Komponenten mit mindestens einem der Tags, die in der Zielversion existieren. */
  byTags(tags: readonly string[], dataVersion?: number): ComponentDef[] {
    const seen = new Set<string>();
    const out: ComponentDef[] = [];
    for (const t of tags) {
      for (const d of this.byTagIndex.get(t) ?? []) {
        if (seen.has(d.id)) continue;
        if (dataVersion !== undefined && !availableIn(d, dataVersion)) continue;
        seen.add(d.id);
        out.push(d);
      }
    }
    const sorted = out.sort((a, b) => a.id.localeCompare(b.id));
    const choice = this.choice;
    if (choice === undefined) return sorted;
    const shown = sorted.map((d) => choice.rewrite?.(d) ?? d);
    if (choice.demote === undefined) return shown;
    const kept = shown.filter((d) => !choice.demote!(d));
    return kept.length > 0 ? kept : shown;
  }

  all(): ComponentDef[] {
    return [...this.byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}

/**
 * Auswahl-Sicht eines Katalogs (W3-BL): `rewrite` ersetzt eine Definition für die Auswahl (gleiche ID, z. B. weniger
 * Varianten; `undefined` = unverändert), `demote` stellt Definitionen zurück – sie erscheinen nur, wenn keine andere die
 * Tags erfüllt (lieber ein Ersatz-Block als ein fehlendes Pflichtmöbel).
 */
export interface ChoiceView {
  readonly rewrite?: (def: ComponentDef) => ComponentDef | undefined;
  readonly demote?: (def: ComponentDef) => boolean;
}

export function availableIn(def: Pick<ComponentDef, 'minVersion' | 'maxVersion'>, dataVersion: number): boolean {
  return (def.minVersion === undefined || dataVersion >= def.minVersion) && (def.maxVersion === undefined || dataVersion <= def.maxVersion);
}
