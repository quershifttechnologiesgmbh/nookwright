/**
 * Dach und Traufe: D12 Schornstein, D10 Traufenlaternen, D13 Firstschmuck (research/18 D12/D13/L2, research/16
 * D6/D9/D10).
 *
 * D12 – nur über einer Feuerstelle (Einrichtung, Tags `hearth`/`forge`/`fireplace`/`hearth_living`), einer je Raum.
 *   W2 (Baustandard D7): Austritt neben dem First (1–2 unter der höchsten Dachzelle des Raums), sonst auf dem First,
 *   bei Gleichstand am nächsten zur Feuerstelle. Schaft auf der Dachzelle, Kopf ≥ 2 über der Dachfläche am Austritt,
 *   der Kopf ≥ 1 frei über jeder Dachzelle darunter; oben ein Lagerfeuer, darüber 3 Zellen Luft (kein Deckel,
 *   Faktencheck #13). Formen 1 × 1, 2 × 1 und gestuft (`CHIMNEY_FORMS`), eine je Gebäude.
 *   W3 (27.09.2026, plan/spikes/W3RD_dachdetails.md): ruhige Silhouette – der Kopf ist ein Mantel aus offenen
 *   Falltüren um das Lagerfeuer (Lage des Lagerfeuers) statt eines Kragrings; keine Lage ist breiter als die darunter.
 * D10 – an jeder Außenecke unter dem Überstand (Unterseite trägt), dazu im Takt 8/Dichte entlang der Traufe der
 *   untersten Etage, nie vor Scheiben und nicht im Eingangsbereich (±2 um Türen; dort hängen die Eingangslaternen).
 * D13 – Firstschmuck an beiden Enden jedes Firsts (paarweise). Nicht auf einer unteren Firststufe (schwebte eine halbe
 *   Lage darüber). W3 (27.09.2026): Firstabschluss (aufgebogene Treppe der Dachkante) statt Endstab mit Blitzableiter
 *   bzw. Banner – die Stäbe wirkten wie Antennen; die Stäbe entlang des Firsts (Dichte ≥ 1,5) entfallen. W4: nicht auf
 *   zwei Firstreihen (zwei Treppen nebeneinander wirkten wie Hörner); ein einreihiger First endet in einer unteren Stufe,
 *   auf der nichts steht – der Firstabschluss entfällt damit bei den heutigen Dachformen (Firstende glatt).
 */
import type { FacadeGridLine, ShellAnchor } from '@mcda/blueprint';
import type { Catalog } from '@mcda/catalog';
import type { HorizontalDir, Rng, Vec3 } from '@mcda/core';
import { OPP, alongOf, step, up, type ExteriorSite, type Part } from './site.js';
import { DEFAULT_CHIMNEY_TAGS, type ExteriorStyle, type InteriorPlacement } from './types.js';

/**
 * Schornstein-Satz (W2, Baustandard D7, X3 K5): Formen 1 × 1, 2 × 1 (zwei Züge) und gestuft (breiter Fuß), alle mit
 * Kopf; `head` = Lagen vom Fuß (Dachfläche + 1) bis zur Kopflage ohne Dehnung. W3: Kopflage = Lage des Lagerfeuers mit
 * dem Falltür-Mantel. Fuß und Kopflage liegen entlang der Höhenlinie des Dachs (First-Richtung), der Kopf schwebt ≥ 1
 * über jeder Dachzelle darunter.
 */
const CHIMNEY_FORMS = {
  single: { componentId: 'exterior/chimney', variant: (m: string): string => m, head: 1 },
  wide: { componentId: 'exterior/chimney', variant: (m: string): string => `${m}_wide`, head: 1 },
  stepped: { componentId: 'exterior/chimney_corbelled', variant: (m: string): string => m, head: 3 },
} as const;
type ChimneyForm = keyof typeof CHIMNEY_FORMS;
/** Schaftzelle über der Austrittsspalte (Mitte der Fußreihe, bei 2 × 1 der erste Zug). */
const CHIMNEY_LOCAL: Vec3 = [1, 0, 1];

/**
 * `avoid`: Spalten (x,z), die bei gleicher Höhe hintanstehen (Firstenden – dort sitzt der Firstschmuck).
 * W2 (D7): Austritt bevorzugt neben dem First (2, dann 1 unter der höchsten Dachzelle des Raums), sonst auf dem First, dann
 * tiefer; je Gleichstand näher an der Feuerstelle. Die Form gilt je Gebäude (ein Kit); passt sie nirgends, der 1 × 1.
 */
export function planChimneys(
  site: ExteriorSite, catalog: Catalog, placements: readonly InteriorPlacement[], style: ExteriorStyle, rng: Rng, warnings: string[], avoid: ReadonlySet<string> = new Set(),
): void {
  const tags = new Set(style.chimneyTags ?? DEFAULT_CHIMNEY_TAGS);
  const material = rng.fork('chimney').chance(2 / 3) ? 'brick' : 'stone';
  const roll = rng.fork('chimney-form').next();
  const preferred: ChimneyForm = roll < 0.5 ? 'single' : roll < 0.75 ? 'wide' : 'stepped';
  const forms: readonly ChimneyForm[] = preferred === 'single' ? ['single'] : [preferred, 'single'];
  const byRoom = new Map<string, Vec3[]>();
  for (const p of placements) {
    const def = catalog.find(p.componentId);
    if (def === undefined || !def.tags.some((t) => tags.has(t))) continue;
    const roomId = p.roomId ?? roomOf(site, p.cells);
    if (roomId === undefined) continue;
    byRoom.set(roomId, [...(byRoom.get(roomId) ?? []), ...p.cells]);
  }
  for (const [roomId, cells] of [...byRoom].sort((a, b) => a[0].localeCompare(b[0]))) {
    const room = site.shell.rooms.get(roomId);
    if (room === undefined) continue;
    const cx = cells.reduce((s, c) => s + c[0], 0) / cells.length;
    const cz = cells.reduce((s, c) => s + c[2], 0) / cells.length;
    const cands = room.interior.toArray()
      .map(([x, z]) => ({ x, z, top: site.top(x, z), dist: Math.abs(x - cx) + Math.abs(z - cz), end: avoid.has(`${x},${z}`) ? 1 : 0 }))
      .filter((c) => { const k = site.at([c.x, c.top, c.z])?.kind; return k === 'roof' || k === 'ceiling'; });
    const ridge = Math.max(...cands.map((c) => c.top));
    // neben dem First: 2 darunter (der Kopf ragt dann nur knapp über den First), dann 1 darunter, dann auf dem First,
    // dann tiefer
    const rank = (top: number): number => (ridge - top === 2 ? 0 : ridge - top === 1 ? 1 : ridge === top ? 2 : 1 + ridge - top);
    cands.sort((a, b) => rank(a.top) - rank(b.top) || a.end - b.end || a.dist - b.dist || a.x - b.x || a.z - b.z);
    let done = false;
    for (const form of forms) {
      for (const c of cands) {
        if (tryChimney(site, form, material, c, room.floorIndex, ridge)) {
          done = true;
          break;
        }
      }
      if (done) break;
    }
    if (!done) warnings.push(`Schornstein über ${roomId}: kein freier Austritt im Dach`);
  }
}

/**
 * W4 (M8, plan/spikes/W4F_dachproportion.md): Oberkante des Firsts über der Spalte – bergauf (höchster Nachbar), bis es
 * nicht mehr steigt. Unter einem Krüppelwalm bzw. Walm endet der Weg am abgewalmten, tieferen Firstende.
 */
function ridgeAbove(site: ExteriorSite, x0: number, z0: number): number {
  let x = x0;
  let z = z0;
  for (let guard = 0; guard < 64; guard++) {
    const h = site.top(x, z);
    let best: readonly [number, number] | undefined;
    for (const s of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (site.top(x + s[0], z + s[1]) > h && (best === undefined || site.top(x + s[0], z + s[1]) > site.top(x + best[0], z + best[1]))) best = s;
    }
    if (best === undefined) break;
    x += best[0];
    z += best[1];
  }
  return site.top(x, z);
}

/** Spalte höchstens 1 (Schachbrett) von einem Anbau-Grundriss (`Shell.annexes`) entfernt. */
function nearAnnex(site: ExteriorSite, x: number, z: number): boolean {
  return (site.shell.annexes ?? []).some((a) => [-1, 0, 1].some((dx) => [-1, 0, 1].some((dz) => a.footprint.has(x + dx, z + dz))));
}

/** Setzt einen Schornstein der Form auf die Dachspalte `c` (Fuß bündig auf gleich hohen Dachzellen, Kopf frei, Rauch frei). */
function tryChimney(site: ExteriorSite, form: ChimneyForm, material: string, c: { readonly x: number; readonly z: number; readonly top: number }, floorIndex: number, ridge = -Infinity): boolean {
  const f = CHIMNEY_FORMS[form];
  const base: Vec3 = [c.x, c.top + 1, c.z];
  // Fuß entlang der Höhenlinie: gleich hohe Nachbarn in x → Breite entlang x (Front Süd/Nord), sonst entlang z
  const alongX = site.top(c.x + 1, c.z) === c.top || site.top(c.x - 1, c.z) === c.top;
  const facings: readonly HorizontalDir[] = alongX ? ['south', 'north', 'east', 'west'] : ['east', 'west', 'south', 'north'];
  for (const facing of facings) {
    const part0: Part = { componentId: f.componentId, variantId: f.variant(material), facing, local: CHIMNEY_LOCAL, at: base };
    const p0 = site.placed(part0);
    // Fuß: jede Zelle der untersten Lage steht bündig auf einer Dachzelle gleicher Höhe
    const foot = p0.cells.filter((q) => q.pos[1] === base[1]);
    if (!foot.every((q) => site.top(q.pos[0], q.pos[2]) === c.top && ['roof', 'ceiling'].includes(site.at([q.pos[0], c.top, q.pos[2]])?.kind ?? ''))) continue;
    // W4 (M8): der Fuß endet ≥ 2 Spalten vor der Dachkante (die Höhenlinie läuft über beide Enden weiter) und steht unter
    // dem vollen First – am Krüppelwalm stand der gestufte Fuß sonst von vorn über der Dachkante (farmhouse-rustic)
    if (foot.some((q) => ridgeAbove(site, q.pos[0], q.pos[2]) < ridge)) continue;
    if (foot.length > 1) {
      const xs = foot.map((q) => q.pos[0]);
      const zs = foot.map((q) => q.pos[2]);
      const [ax, az] = Math.max(...xs) > Math.min(...xs) ? [1, 0] : [0, 1];
      const lo: Vec3 = [Math.min(...xs), c.top, Math.min(...zs)];
      const hi: Vec3 = [Math.max(...xs), c.top, Math.max(...zs)];
      const beyond = [1, 2].flatMap((k) => [[lo[0] - k * ax, lo[2] - k * az], [hi[0] + k * ax, hi[2] + k * az]] as const);
      if (!beyond.every(([bx, bz]) => site.top(bx, bz) >= c.top)) continue;
    }
    // Kopf (Lagerfeuer mit Falltür-Mantel) ≥ 1 frei über jeder Dachzelle darunter und ≥ 3 über der Dachfläche am Austritt
    // Abstand ≥ 2 zu angedockten Bauwerken (Turmdach und -kranz ragen über ihren Grundriss hinaus)
    if (p0.cells.some((q) => nearAnnex(site, q.pos[0], q.pos[2]))) continue;
    const crownY = base[1] + f.head;
    const crown = p0.cells.filter((q) => q.pos[1] === crownY);
    const under = Math.max(...crown.map((q) => site.top(q.pos[0], q.pos[2])));
    // W3: Lagerfeuer eine Lage höher als die frühere Kronenlage (Kopf ≥ 3 über der Dachfläche am Austritt) – neben dem
    // First (2 darunter) liegt der Kopf so 1 über dem First und bleibt von vorn sichtbar
    const head = Math.max(c.top + 3, under + 2, crownY);
    const n = head - crownY;
    if (n > 8) continue;
    const part: Part = { ...part0, stretch: n };
    const fires = site.placed(part).cells.filter((q) => q.mat.block === 'minecraft:campfire').map((q) => q.pos);
    const smoke = fires.flatMap((q) => [1, 2, 3].map((k): Vec3 => [q[0], q[1] + k, q[2]]));
    if (site.commit('chimneys', 'hearth', floorIndex, [part], () => smoke.every((s) => site.outside(s) && !site.isTaken(s))).length > 0) {
      for (const s of smoke) site.reserve(s, 'walk');
      return true;
    }
  }
  return false;
}

/** Raum einer Platzierung ohne Raum-ID: Raum, dessen Innenfläche und Etage die erste Zelle enthält. */
function roomOf(site: ExteriorSite, cells: readonly Vec3[]): string | undefined {
  const c = cells[0];
  if (c === undefined) return undefined;
  for (const r of site.shell.rooms.values()) if (r.interior.has(c[0], c[2]) && c[1] >= r.baseY && c[1] < r.baseY + r.height) return r.roomId;
  return undefined;
}

export function planEaveLanterns(site: ExteriorSite, anchors: readonly ShellAnchor[], doors: readonly ShellAnchor[], d: number): void {
  // Ecken: Diagonalzelle unter dem Überstand (erste Hüllzelle darüber trägt), ab Kopfhöhe
  const spots: Array<{ readonly a: ShellAnchor; readonly at: Vec3; readonly key: string }> = [];
  const crowded = new Set<string>();
  for (const a of anchors.filter((x) => x.kind === 'corner')) {
    const level = site.levelOf(a.floorIndex, a.pos);
    if (level === undefined) continue;
    let y = level.baseY + 2;
    while (y <= level.topY + 2 && site.at(up([a.pos[0], y, a.pos[2]])) === undefined) y++;
    const at: Vec3 = [a.pos[0], y, a.pos[2]];
    if (y > level.topY + 2 || !site.hangsFrom(at)) continue;
    const key = `${a.floorIndex}|${level.y0}`;
    spots.push({ a, at, key });
    // W5 (27.09.2026, Review W4-R N9, F7 „je Pfosten höchstens 1 Zubehör“): trägt eine der beiden Wände an dieser Ecke auf
    // derselben Etage schon Laternen (Fenstermodul, Eingang, Akzent), hingen in der Ansicht zwei Laternen übereinander an
    // der Gebäudekante (Beispielhaus: Traufe + Fensterlaterne unter dem Band). Dann entfallen die Ecklaternen dieser Etage
    // ganz (wie ein Modul, F6) – nicht nur an dieser Ecke, sonst hätte die Front eine Ecke mit und eine ohne Laterne.
    if (([0, 2] as const).some((ax) => site.lanternInRow(ax, a.pos[ax], level.baseY, level.topY + 2))) crowded.add(key);
  }
  for (const { a, at, key } of spots) {
    if (!crowded.has(key)) site.commit('eaveLanterns', 'corner', a.floorIndex, [{ componentId: 'exterior/eave_lantern', facing: a.facing, at }]);
  }
  // Takt entlang der Traufen der untersten Etage, zwischen den Ecken (−1 und span) gleichmäßig verteilt
  if (d < 1) return;
  const lowest = Math.min(...anchors.filter((x) => x.kind === 'eave').map((x) => x.floorIndex));
  const every = Math.max(3, Math.round(8 / d));
  for (const a of anchors.filter((x) => x.kind === 'eave' && x.floorIndex === lowest)) {
    const along = alongOf(a.facing);
    const at = (k: number): Vec3 => [a.pos[0] + (along === 'east' ? k : 0), a.pos[1], a.pos[2] + (along === 'south' ? k : 0)];
    const nearDoor = (p: Vec3): boolean => doors.some((dr) => dr.facing === a.facing && Math.abs(dr.pos[0] - p[0]) + Math.abs(dr.pos[2] - p[2]) <= 2);
    for (const k of between(a.span ?? 1, every)) {
      const p = at(k);
      if (nearDoor(p) || !site.hangsFrom(p)) continue;
      site.commit('eaveLanterns', 'eave', a.floorIndex, [{ componentId: 'exterior/eave_lantern', facing: a.facing, at: p }]);
    }
  }
}

/**
 * W3 (27.09.2026, plan/spikes/W3RD_dachdetails.md): Traufkonsolen im Takt – je Traufe eine umgedrehte Treppe der
 * Dachkante (`exterior/eave_brace`, Rücken zur Wand) unter dem Überstand an jedem Pfosten des Fassadenrasters und an
 * beiden Enden; Lücken über 5 (Raster ohne Pfosten, ohne Raster die ganze Traufe) werden je Lücke spiegelsymmetrisch
 * mit Abstand ≤ 4 gefüllt, nie vor einer Scheibe.
 * Läuft nach den Laternen: ein Pfosten mit Laterne behält die Laterne (eine Treppe trägt keine hängende Laterne), und
 * im Eingangsbereich (±1 um Außentüren) bleibt die Traufe frei (Vordach, Portal). W4-D: Gruppe `eaveBraces` (eigener
 * Schalter „Traufkonsolen“); die ID behält das Präfix `eaveLanterns` – der Platzierungs-Seed hängt an der ID, so
 * bleiben die Blöcke bitgleich.
 */
export function planEaveBraces(site: ExteriorSite, grid: readonly FacadeGridLine[] | undefined, anchors: readonly ShellAnchor[], doors: readonly ShellAnchor[]): void {
  const eaves = anchors.filter((x) => x.kind === 'eave');
  for (const a of [...eaves, ...kneeEaves(site, grid, eaves)]) {
    const along = alongOf(a.facing);
    const ns = a.facing === 'north' || a.facing === 'south';
    const start = ns ? a.pos[0] : a.pos[2];
    const span = a.span ?? 1;
    const wall = step(a.pos, OPP[a.facing]);
    const wallPlane = ns ? wall[2] : wall[0];
    const level = site.levelOf(a.floorIndex, a.pos);
    const line = grid?.find((g) => g.out === a.facing && g.plane === wallPlane && (level === undefined || g.y0 === level.y0) && g.from <= start + span - 1 && g.to >= start);
    const at = (k: number): Vec3 => [a.pos[0] + (along === 'east' ? k : 0), a.pos[1], a.pos[2] + (along === 'south' ? k : 0)];
    // W7 (27.09.2026, plan/spikes/W7A_ruhe.md): im Fachwerk nur an Ständern (`studs`, die Felder sind dort zusammengelegt)
    const grid0 = line !== undefined
      ? [line.from, ...(line.studs ?? line.posts), line.to].map((p) => p - start).filter((k) => k >= 0 && k < span)
      : [0, span - 1];
    // Takt: Lücken über 5 (Raster ohne Pfosten, Steinwand) gleichmäßig mit Abstand ≤ 4 füllen – je Lücke
    // spiegelsymmetrisch, vor Scheiben entfällt die Stelle; im Fachwerk (`studs`) nicht – dort liegt dazwischen Putz
    const ks = [...new Set(grid0)].sort((p, q) => p - q).flatMap((k, j, all) => {
      const next = all[j + 1];
      if (next === undefined || next - k <= 5 || line?.studs !== undefined) return [k];
      const n = Math.ceil((next - k) / 4);
      const g = next - k;
      const off = (i: number): number => (2 * i <= n ? Math.round((i * g) / n) : g - Math.round(((n - i) * g) / n));
      return [k, ...Array.from({ length: n - 1 }, (_, i) => k + off(i + 1))];
    });
    // Eingangsbereich: ±1 um die Tür, nur an der Traufe über ihrem Geschoss (Vordach, Portal)
    const nearDoor = (p: Vec3): boolean => doors.some((dr) => dr.facing === a.facing && Math.abs(dr.pos[0] - p[0]) + Math.abs(dr.pos[2] - p[2]) <= 1 && p[1] - dr.pos[1] <= 4);
    for (const k of [...new Set(ks)].sort((p, q) => p - q)) {
      const p = at(k);
      // an der Wand: dahinter Wand bzw. Pfosten (keine Scheibe, keine Tür), darüber trägt die Traufe
      // W5 (27.09.2026, Review N3): die Konsole steht in der Traufzone und gehört zur Dachkante – außerhalb des
      // Deko-Budgets der Wandreihen (`site.eaveZone`), wie in W3-RD gedacht
      // (W5: vor dem Rähm – Deckenbalken in der Wandebene, Traufe auf Deckenhöhe + 1 – steht sie ebenso)
      if (nearDoor(p) || !(site.solidWall(step(p, OPP[a.facing])) || site.at(step(p, OPP[a.facing]))?.kind === 'ceiling') || site.at(up(p))?.kind !== 'roof') continue;
      site.commit('eaveBraces', 'eave', a.floorIndex, [{ componentId: 'exterior/eave_brace', variantId: 'corbel', facing: a.facing, at: p }], undefined, 'eaveLanterns');
    }
  }
}

/**
 * W5 (27.09.2026, Review N3): Traufen über einem **Kniestock** (W4-F). Die Hülle meldet Traufanker nur bis Deckenhöhe
 * + 2 (`blueprint/shell/anchors.ts`); hebt der Kniestock das Dach höher, fehlt der Anker – und mit ihm die Konsolen.
 * Hier je Linie des Fassadenrasters ohne eigenen Traufanker: je Wandspalte die unterste Dachzelle vor der Wand über der
 * obersten Wandreihe, traufartig (Treppe steigt zur Wand an, nicht obere Hälfte; sonst ein Block/eine Stufe in einer
 * waagrechten Reihe wie in `anchors.ts`), darunter Außenluft vor einer Wandzelle (Kniestock). Läufe gleicher Höhe
 * werden zu Traufen (nur für die Konsolen; Laternen und Hülle bleiben unberührt).
 */
function kneeEaves(site: ExteriorSite, grid: readonly FacadeGridLine[] | undefined, eaves: readonly ShellAnchor[]): ShellAnchor[] {
  const out: ShellAnchor[] = [];
  for (const g of grid ?? []) {
    const ns = g.out === 'north' || g.out === 'south';
    const wallAt = (u: number, y: number): Vec3 => (ns ? [u, y, g.plane] : [g.plane, y, u]);
    const level = site.levelOf(g.floorIndex, wallAt(Math.round((g.from + g.to) / 2), g.y0 + 1));
    if (level === undefined) continue;
    // Linie hat schon eine Traufe (Anker der Hülle): nichts ergänzen
    const covered = eaves.some((a) => a.facing === g.out && (ns ? a.pos[2] - STEP_Z[g.out] : a.pos[0] - STEP_X[g.out]) === g.plane
      && a.pos[1] > level.baseY && a.pos[1] <= level.topY + 1);
    if (covered) continue;
    const rows: Array<{ u: number; y: number }> = [];
    for (let u = g.from; u <= g.to; u++) {
      let y = -Infinity;
      for (let h = level.topY + 1; h <= level.topY + 6; h++) {
        const roof = site.at(step(wallAt(u, h), g.out));
        if (roof === undefined) continue;
        if (roof.kind !== 'roof') break;
        const eaveLike = roof.shape === 'stairs' ? roof.orient?.facing === OPP[g.out] && roof.orient.half !== 'top' : true;
        if (eaveLike && h - 1 > level.topY) y = h - 1;
        break;
      }
      if (y === -Infinity) continue;
      const front = step(wallAt(u, y), g.out);
      if (site.at(wallAt(u, y)) === undefined || !site.outside(front)) continue;
      rows.push({ u, y });
    }
    // Läufe benachbarter Spalten gleicher Höhe (Blöcke/Stufen nur in waagrechten Reihen ≥ 2)
    for (let s = 0; s < rows.length; ) {
      let e = s + 1;
      while (e < rows.length && rows[e]!.u === rows[e - 1]!.u + 1 && rows[e]!.y === rows[s]!.y) e++;
      const run = rows.slice(s, e);
      const first = run[0]!;
      const roof = site.at(up(step(wallAt(first.u, first.y), g.out)));
      if (run.length >= 2 || roof?.shape === 'stairs') {
        out.push({ kind: 'eave', pos: step(wallAt(first.u, first.y), g.out), facing: g.out, span: run.length, floorIndex: g.floorIndex });
      }
      s = e;
    }
  }
  return out;
}

const STEP_X: Readonly<Record<HorizontalDir, number>> = { north: 0, south: 0, east: 1, west: -1 };
const STEP_Z: Readonly<Record<HorizontalDir, number>> = { north: -1, south: 1, east: 0, west: 0 };

/**
 * Stellen 0 … span−1 zwischen den Endpunkten −1 und span (Ecklaternen), Abstand ≤ `every`, spiegelsymmetrisch:
 * n Intervalle; fiele die Mitte zwischen zwei Zellen, ein Intervall mehr.
 */
export function between(span: number, every: number): number[] {
  const len = span + 1;
  let n = Math.ceil(len / every);
  if (n % 2 === 0 && len % 2 === 1) n++;
  const out: number[] = [];
  for (let i = 1; i < n; i++) {
    const k = Math.round((Math.min(i, n - i) * len) / n) - 1;
    out.push(2 * i <= n ? k : span - 1 - k);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * W12-D (28.09.2026, Review R6-6): gekreuzte Windbretter am Giebel („Hörner“, norwegisch vindskier) – Katalogeinheit,
 * deren `styleTags` die Themes nennen, die sie tragen (wie die Fenstermodule). Ohne Eintrag für das Theme: nichts.
 */
export const RIDGE_CROSS_COMPONENT = 'exterior/ridge_cross';

export function planRidgeDecor(
  site: ExteriorSite, anchors: readonly ShellAnchor[], d: number, rng: Rng, catalog?: Catalog, themeId?: string,
): void {
  // W3: die Wahl zwischen Blitzableiter und Banner entfällt (beide wirkten auf dem First wie Antennen); der Zufallsstrom
  // bleibt unberührt, damit andere Gruppen gleich bleiben
  void rng;
  void d;
  const standsOn = (p: Vec3): boolean => {
    const c = site.at([p[0], p[1] - 1, p[2]]);
    return c !== undefined && c.kind === 'roof' && !(c.shape === 'slab' && c.orient?.half !== 'top') && site.top(p[0], p[2]) === p[1] - 1;
  };
  /** W13-B: unter dem Firstende liegt als oberste Zelle eine untere Platte (einreihiger First mit halber Firststufe). */
  const slabTip = (p: Vec3): boolean => {
    const c = site.at([p[0], p[1] - 1, p[2]]);
    return c !== undefined && c.kind === 'roof' && c.shape === 'slab' && c.orient?.half !== 'top' && site.top(p[0], p[2]) === p[1] - 1;
  };
  /** Firstzellen am Ende `e`: die Endzelle und quer dazu gleich hohe Firstzellen, hinter denen der First ebenfalls endet. */
  const tipCells = (e: ShellAnchor): Vec3[] => {
    const lateral = alongOf(e.facing);
    const out: Vec3[] = [e.pos];
    for (const k of [-1, 1]) {
      const p = step(e.pos, lateral, k);
      const beyond = step(p, e.facing);
      if (standsOn(p) && !(site.at([beyond[0], beyond[1] - 1, beyond[2]])?.kind === 'roof')) out.push(p);
    }
    return out;
  };
  const ends = anchors.filter((a) => a.kind === 'ridge_end');
  for (const r of anchors.filter((a) => a.kind === 'ridge')) {
    // Firstenden dieses Firsts: gleiche Höhe, auf der Firstlinie
    const alongX = r.facing === 'south';
    const span = r.span ?? 1;
    const onRidge = (p: Vec3): boolean => p[1] === r.pos[1] && (alongX
      ? p[2] === r.pos[2] && p[0] >= r.pos[0] && p[0] < r.pos[0] + span
      : p[0] === r.pos[0] && p[2] >= r.pos[2] && p[2] < r.pos[2] + span);
    const pair = ends.filter((e) => onRidge(e.pos));
    const cross = themeId === undefined ? undefined : catalog?.find(RIDGE_CROSS_COMPONENT);
    const crossed = cross !== undefined && cross.styleTags?.includes(themeId!) === true;
    // W13-B (28.09.2026): einreihiger First (ungerade Breite, z. B. das zweigeschossige Haus) endet in einer halben
    // Stufe (First-Platte). Dort kreuzen sich die Windbretter neben der Platte: je Firstende zwei Treppen der Dachkante
    // auf den obersten Ortgangtreppen links und rechts der Platte, Rücken seitlich nach außen – dasselbe V wie auf zwei
    // Firstreihen (Höhen außen 1, innen ½, Platte ½). Beide Enden oder keins; nur in Themes der Einheit.
    if (crossed && pair.length === 2 && pair.every((e) => slabTip(e.pos))) {
      const parts = pair.flatMap((e): Part[] => {
        const lateral = alongOf(e.facing);
        const tip: Vec3 = [e.pos[0], e.pos[1] - 1, e.pos[2]];
        const [p, q] = [step(tip, lateral, -1), step(tip, lateral, 1)];
        if (![p, q].every((c) => site.at([c[0], c[1] - 1, c[2]])?.kind === 'roof' && site.top(c[0], c[2]) === c[1] - 1)) return [];
        return [
          { componentId: RIDGE_CROSS_COMPONENT, variantId: 'cross', facing: OPP[lateral], at: p },
          { componentId: RIDGE_CROSS_COMPONENT, variantId: 'cross', facing: lateral, at: q },
        ];
      });
      if (parts.length === 4) site.commit('ridgeDecor', 'ridge_end', r.floorIndex, parts);
      continue;
    }
    if (pair.length !== 2 || !pair.every((e) => standsOn(e.pos))) continue;
    // W3 (plan/spikes/W3RD_dachdetails.md): Firstabschluss statt Endstab – je Firstende eine Treppe der Dachkante mit
    // dem Rücken nach außen (der First biegt am Giebel auf).
    // W4 (plan/spikes/W4F_dachproportion.md): nur auf einem einreihigen First mit Treppe – auf zwei Firstreihen (gerade
    // Breite) standen zwei aufgebogene Treppen nebeneinander und wirkten wie Hörner (house-nordic); dort endet der First glatt
    const cells = pair.map(tipCells);
    if (cells.some((c) => c.length > 1)) {
      // W12-D: auf zwei Firstreihen kreuzen sich die Windbretter über dem First – je Firstende zwei Treppen der
      // Dachkante, Rücken seitlich nach außen (V wie die gekreuzten Giebelbretter nordischer Holzhäuser,
      // en.wikipedia.org/wiki/Sod_roof, r/Minecraftbuilds 1jetil6). Beide Enden oder keins: spiegelgleich zur
      // Firstmitte und zur Firstlinie. Nur in Themes, die die Einheit in `styleTags` nennen.
      if (!crossed) continue;
      if (!cells.every((c) => c.length === 2)) continue;
      const parts = pair.flatMap((e, i): Part[] => {
        const lateral = alongOf(e.facing);
        const [p, q] = [...cells[i]!].sort((u, v) => (lateral === 'east' ? u[0] - v[0] : u[2] - v[2]));
        return [
          { componentId: RIDGE_CROSS_COMPONENT, variantId: 'cross', facing: OPP[lateral], at: p! },
          { componentId: RIDGE_CROSS_COMPONENT, variantId: 'cross', facing: lateral, at: q! },
        ];
      });
      site.commit('ridgeDecor', 'ridge_end', r.floorIndex, parts);
      continue;
    }
    const parts = pair.map((e): Part => ({ componentId: 'exterior/ridge_finial', variantId: 'tip', facing: e.facing, at: e.pos }));
    site.commit('ridgeDecor', 'ridge_end', r.floorIndex, parts);
  }
}
