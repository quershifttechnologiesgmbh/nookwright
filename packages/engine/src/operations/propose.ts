/**
 * `building_propose`: mehrere Grundriss-Varianten eines Bautyps schnell planen (ohne Welt, je ≤ ~250 ms) – wie die
 * drei Vorschläge des Bautyp-Assistenten der App. Die gewählte Variante baut `building_generate` bzw.
 * `project_create` mit demselben `seed`.
 *
 * W7-E (W1-G M2): ohne doppelte Grundrisse wie der Assistent – Kandidaten der Reihe nach (`hashSeed(seed, 'vorschlag',
 * n)`, dahinter eine Reserve von {@link PROPOSAL_RESERVE}), gleiche Grundrisse (`planLayoutKey`) übersprungen, reicht die
 * Reserve nicht, füllen Doppel auf (`distinctPicks`, @mcda/pipeline). Ohne Doppel genau die bisherigen Vorschläge.
 *
 * W8-E (27.09.2026): nur spielbare Vorschläge – ein Kandidat, dem ein Pflichtobjekt fehlt (oder Eingang, Zugang, Treppe),
 * wird wie ein Doppel übersprungen, die Reserve füllt auf (`playablePicks`/`playabilityIssues`, @mcda/pipeline, dieselbe
 * Regel wie der Assistent). Reicht die Reserve nicht, kommt der Kandidat mit `playable: false`, `notice` und einer Warnung
 * – nie still. `playable: false` in der Eingabe schaltet die Prüfung ab (Antwort wie vor W8-E).
 *
 * feat/pareto-proposals: `pareto: true` bewertet einen Pool (`poolSize`, Standard {@link PARETO_POOL}) und wählt
 * „Am schönsten / Am praktischsten / Ausgewogen“ (`paretoProposals`, @mcda/pipeline, dieselbe Regel wie der Assistent).
 * Pareto schließt die Spielbarkeit ein (harter Filter, dieselbe Regel `playabilityOf`), unabhängig von `playable`. Ist kein
 * Kandidat spielbar, gilt der W8-E-Weg oben – mit den Befunden der schon bewerteten Kandidaten (keine zweite Prüfung),
 * dazu Pool-Bericht und Warnung (Review A3).
 */
import { z } from 'zod';
import { planBuilding } from '@mcda/archetype';
import { hashSeed } from '@mcda/core';
import {
  PARETO_POOL, PARETO_RESERVE, PROPOSAL_LABEL_TEXT, archetypeContext, distinctCount, distinctPicks, noPlayableNotice, paretoProposals, planLayoutKey,
  playabilityIssues, playabilityText, playablePicks, playableDistinct, type ParetoResult, type PlayabilityFinding,
} from '@mcda/pipeline';
import { defineOperation } from '../operation.js';
import { idsOf, type Vocabulary } from '../vocabulary.js';
import { buildingParams, buildingTypeFields } from './building.js';

const Int = z.number().int();

/** Zusätzliche Kandidaten je Runde, wenn Vorschläge denselben Grundriss haben (wie der App-Assistent, W1G_treue.md §4). */
export const PROPOSAL_RESERVE = 6;

export const buildingPropose = defineOperation({
  id: 'building_propose',
  summary: 'Mehrere Grundriss-Varianten eines Bautyps vorschlagen (Maße, Etagen, Räume) – zum Vergleichen, bevor gebaut wird.',
  cacheable: true,
  input: (v: Vocabulary) => z.object({
    ...buildingTypeFields(v),
    themeId: z.enum(idsOf(v.themes)).optional().describe('Theme (für Stil-Hinweise)'),
    seed: Int.min(0).max(2 ** 31 - 1).default(1).describe('Basis-Seed der Vorschläge'),
    count: Int.min(1).max(6).default(3).describe('Anzahl Vorschläge'),
    playable: z.boolean().default(true)
      .describe('Nur spielbare Vorschläge (W8-E): Kandidaten ohne Pflichtobjekt, Eingang, Zugang oder Treppe überspringen; false = ohne Prüfung (schneller)'),
    pareto: z.boolean().optional().describe(
      'Mehrziel-Vorschläge (Standard aus): einen Kandidaten-Pool einrichten und bewerten (Einrichtung, Fassade, Tageslicht, '
      + 'Laufwege, kurze Wege, Lager/Arbeit, Kompaktheit), nur spielbare (schließt playable ein), aus der Pareto-Front '
      + '„Am schönsten“, „Am praktischsten“ und „Ausgewogen“ mit Begründung wählen. Dauert je Kandidat 0,1–0,7 s'),
    poolSize: Int.min(3).max(12).optional().describe(`Kandidaten im Pool bei pareto (Standard ${PARETO_POOL})`),
  }).strict(),
  run(i, ctx) {
    const def = ctx.buildingTypes.get(i.buildingTypeId);
    const params = { ...buildingParams(i), ...(i.themeId !== undefined ? { themeId: i.themeId } : {}) };
    const pareto = i.pareto === true ? paretoRun(def, params, i.seed, i.poolSize ?? PARETO_POOL, i.count, ctx) : undefined;
    if (pareto !== undefined && pareto.res.picks.length > 0) return { data: paretoData(def.id, pareto) };
    // Pareto schließt die Spielbarkeit ein; ohne spielbaren Kandidaten weiter wie W8-E
    const checkPlayable = i.playable || pareto !== undefined;
    const arch = archetypeContext(ctx.catalog, ctx.themes);
    const planned: { seed: number; plan: ReturnType<typeof planBuilding> }[] = [];
    const keys: string[] = [];
    // W8-E: Spielbarkeit je Kandidat (teuer: Einrichtung), nur für Kandidaten, die gezeigt würden, je Seed einmal
    const findings = new Map<number, PlayabilityFinding[]>();
    // Schon bewertete Pool-Kandidaten (gleiche Seeds `hashSeed(seed, 'vorschlag', n)`): Befunde übernehmen, nicht neu prüfen
    pareto?.res.candidates.forEach((c, n) => findings.set(n, [...c.findings]));
    const check = (n: number): boolean => {
      let f = findings.get(n);
      if (f === undefined) findings.set(n, (f = playabilityIssues(def, params, planned[n]!.seed, ctx)));
      return f.length === 0;
    };
    const playable: (boolean | undefined)[] = [];
    const enough = (): boolean => (checkPlayable ? playableDistinct(keys, playable) >= i.count : distinctCount(keys) >= i.count);
    for (let n = 0; n < i.count + PROPOSAL_RESERVE && !enough(); n++) {
      const seed = hashSeed(i.seed, 'vorschlag', n) % 2 ** 31;
      const plan = planBuilding(def, { ...params, reroll: i.rerollCount }, seed, arch);
      planned.push({ seed, plan });
      const key = planLayoutKey(plan);
      // Doppel eines schon spielbaren Grundrisses: erst beim Auffüllen prüfen (wie `playablePicks`)
      playable.push(!checkPlayable || keys.some((k, m) => k === key && playable[m] === true) ? undefined : check(n));
      keys.push(key);
    }
    const chosen = checkPlayable ? playablePicks(keys, i.count, check) : { picks: distinctPicks(keys, i.count), unplayable: [] };
    const picks = chosen.picks;
    const warnings: string[] = [];
    const playableFields = (n: number): { playable: boolean; notice?: string } => {
      if (!chosen.unplayable.includes(n)) return { playable: true };
      const notice = playabilityText(findings.get(n) ?? [], ctx.catalog);
      warnings.push(`Vorschlag ${planned[n]!.seed} nicht spielbar (keine spielbare Variante in der Reserve): ${notice}`);
      return { playable: false, notice };
    };
    const proposals = picks.map((n) => ({ ...proposalFacts(planned[n]!.seed, planned[n]!.plan), ...(checkPlayable ? playableFields(n) : {}) }));
    // W7-E: wie viele verschiedene Grundrisse gezeigt werden (weniger als `count`, wenn der Bautyp nicht mehr hergibt)
    return {
      data: {
        buildingTypeId: def.id, proposals, distinct: distinctCount(picks.map((n) => keys[n])),
        // W8-E: übersprungene unspielbare Kandidaten (Seeds) und Warnungen, falls die Reserve nicht reichte
        ...(checkPlayable ? { skipped: [...findings].filter(([n, f]) => f.length > 0 && !picks.includes(n)).map(([n]) => planned[n]!.seed) } : {}),
        ...(warnings.length > 0 || pareto !== undefined
          ? { warnings: [...(pareto !== undefined ? [noPlayableNotice(pareto.res.candidates)] : []), ...warnings] } : {}),
        // Review A3: Pareto an, aber kein Kandidat spielbar – Pool-Bericht, nie still
        ...(pareto !== undefined ? { pareto: poolReport(pareto) } : {}),
      },
    };
  },
});

type Plan = ReturnType<typeof planBuilding>;

/** Kennzahlen eines Vorschlags für die Antwort (Maße des Erdgeschosses und darüber, Etagen, Räume, Hinweise). */
function proposalFacts(seed: number, plan: Plan) {
  const cells = plan.rooms.filter((r) => r.floor >= 0).flatMap((r) => r.cells.toArray());
  const xs = cells.map((c) => c[0]);
  const zs = cells.map((c) => c[1]);
  return {
    seed,
    width: cells.length === 0 ? 0 : Math.max(...xs) - Math.min(...xs) + 1,
    depth: cells.length === 0 ? 0 : Math.max(...zs) - Math.min(...zs) + 1,
    floors: plan.floors.filter((f) => f.index >= 0).length,
    cellar: plan.floors.some((f) => f.index < 0),
    rooms: plan.rooms.map((r) => ({ floor: r.floor, roomTypeId: r.roomTypeId, area: r.cells.size })),
    stairs: plan.stairs.length,
    volumes: plan.volumes.length,
    warnings: [...plan.warnings],
    hints: [...plan.hints],
  };
}

interface ParetoRun {
  readonly res: ParetoResult;
}

/**
 * feat/pareto-proposals: Pool aus `poolSize` Kandidaten (dieselben Seeds wie der normale Weg, die ersten drei sind die
 * bisherigen Vorschläge; bei einigen, aber zu wenigen spielbaren bis zu {@link PARETO_RESERVE} weitere), bewertet und
 * beschriftet (`paretoProposals`, @mcda/pipeline – dieselbe Regel wie im App-Assistenten).
 */
function paretoRun(def: Parameters<typeof planBuilding>[0], params: Parameters<typeof paretoProposals>[1], seed: number, pool: number, count: number, ctx: Parameters<typeof paretoProposals>[3]): ParetoRun {
  const seeds = Array.from({ length: pool + PARETO_RESERVE }, (_, n) => hashSeed(seed, 'vorschlag', n) % 2 ** 31);
  return { res: paretoProposals(def, params, seeds.slice(0, pool), ctx, count, seeds.slice(pool)) };
}

/** Pool-Bericht: Größe, spielbare, je Kandidat Seed, Front, Befunde, Zielvektor und Rohwerte. */
function poolReport({ res }: ParetoRun) {
  const front = new Set(res.front);
  return {
    pool: res.candidates.length,
    playable: res.candidates.filter((c) => c.issues.length === 0).length,
    candidates: res.candidates.map((c, n) => ({ seed: c.seed, front: front.has(n), issues: [...c.issues], scores: { ...c.scores }, raw: { ...c.raw } })),
  };
}

/** Antwort mit beschrifteten Vorschlägen (alle spielbar: Pareto wählt nur spielbare). */
function paretoData(buildingTypeId: string, run: ParetoRun) {
  const { res } = run;
  return {
    buildingTypeId,
    proposals: res.picks.map((p) => {
      const c = res.candidates[p.index]!;
      return {
        ...proposalFacts(c.seed, c.plan), playable: true, label: p.label, labelText: PROPOSAL_LABEL_TEXT[p.label], reason: p.reason, scores: { ...c.scores },
      };
    }),
    distinct: distinctCount(res.picks.map((p) => res.candidates[p.index]!.layout)),
    pareto: poolReport(run),
  };
}
