import { parseJson5Text } from './json5Text.js';
import { ComponentDefSchema, RESERVED_AIR, RESERVED_EMPTY, type ComponentDef, type MaterialSpec, type SocketDef } from './schema.js';

export type ValidationResult<T> = { ok: true; value: T; warnings: string[] } | { ok: false; errors: string[]; warnings: string[] };

interface Content {
  layers?: string[][] | undefined;
  legend?: Record<string, MaterialSpec> | undefined;
  cells?: unknown[] | undefined;
  sockets?: SocketDef[] | undefined;
}

/** Fachliche Prüfungen, die das Schema allein nicht ausdrückt. */
function checkContent(c: Content, where: string, errors: string[], warnings: string[]): void {
  if (c.layers !== undefined && c.cells !== undefined) errors.push(`${where}: entweder layers oder cells, nicht beides`);
  if (c.layers !== undefined) {
    if (c.legend === undefined) errors.push(`${where}: layers ohne legend`);
    const rows = c.layers[0]?.length ?? 0;
    const width = c.layers[0]?.[0]?.length ?? 0;
    if (rows === 0 || width === 0) errors.push(`${where}: leere Schicht`);
    const used = new Set<string>();
    c.layers.forEach((layer, y) => {
      if (layer.length !== rows) errors.push(`${where}: Schicht y=${y} hat ${layer.length} Zeilen, erwartet ${rows} (mit '.' auffüllen)`);
      layer.forEach((row, z) => {
        if (row.length !== width) errors.push(`${where}: Zeile y=${y} z=${z} ist ${row.length} breit, erwartet ${width}`);
        for (const ch of row) {
          if (ch === RESERVED_EMPTY || ch === RESERVED_AIR) continue;
          used.add(ch);
          if (c.legend !== undefined && !(ch in c.legend)) errors.push(`${where}: Zeichen '${ch}' (y=${y}, z=${z}) fehlt in legend`);
        }
      });
    });
    for (const k of Object.keys(c.legend ?? {})) {
      if (k === RESERVED_EMPTY || k === RESERVED_AIR) errors.push(`${where}: '${k}' ist reserviert und darf nicht in legend stehen`);
      else if (!used.has(k)) warnings.push(`${where}: legend-Zeichen '${k}' wird nicht benutzt`);
    }
  } else if (c.legend !== undefined) {
    errors.push(`${where}: legend ohne layers`);
  }
  const ids = new Set<string>();
  for (const s of c.sockets ?? []) {
    if (ids.has(s.id)) errors.push(`${where}: Socket-ID '${s.id}' doppelt`);
    ids.add(s.id);
  }
  for (const s of c.sockets ?? []) {
    if (s.pairWith !== undefined && !ids.has(s.pairWith)) errors.push(`${where}: Socket '${s.id}' verweist auf unbekanntes pairWith '${s.pairWith}'`);
  }
}

function hasContent(c: Content): boolean {
  return c.layers !== undefined || c.cells !== undefined;
}

export function validateComponentDef(input: unknown): ValidationResult<ComponentDef> {
  const parsed = ComponentDefSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.length > 0 ? i.path.join('.') : '(wurzel)'}: ${i.message}`),
      warnings: [],
    };
  }
  const def = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  checkContent(def, def.id, errors, warnings);
  if (def.variants === undefined) {
    if (!hasContent(def)) errors.push(`${def.id}: weder Inhalt (layers/cells) noch Varianten`);
  } else {
    const vids = new Set<string>();
    for (const v of def.variants) {
      if (vids.has(v.id)) errors.push(`${def.id}: Varianten-ID '${v.id}' doppelt`);
      vids.add(v.id);
      checkContent(v, `${def.id}#${v.id}`, errors, warnings);
      if (!hasContent(v) && !hasContent(def)) errors.push(`${def.id}#${v.id}: Variante ohne Inhalt und keine Basis-Inhalte`);
    }
  }
  if (def.minVersion !== undefined && def.maxVersion !== undefined && def.minVersion > def.maxVersion) {
    errors.push(`${def.id}: minVersion > maxVersion`);
  }
  if (def.wallHeight !== undefined && def.mount !== 'wall') warnings.push(`${def.id}: wallHeight gilt nur für mount "wall"`);
  return errors.length > 0 ? { ok: false, errors, warnings } : { ok: true, value: def, warnings };
}

/** Liest eine Komponente aus JSON5-Text (Katalog-Dateien erlauben Kommentare). */
export function parseComponentDef(text: string, source = '<text>'): ValidationResult<ComponentDef> {
  let raw: unknown;
  try {
    raw = parseJson5Text(text);
  } catch (e) {
    return { ok: false, errors: [`${source}: JSON5-Fehler: ${(e as Error).message}`], warnings: [] };
  }
  const r = validateComponentDef(raw);
  if (r.ok) return r;
  return { ok: false, errors: r.errors.map((m) => `${source}: ${m}`), warnings: r.warnings };
}
