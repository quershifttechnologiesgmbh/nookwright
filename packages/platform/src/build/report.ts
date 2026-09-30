/**
 * Build: lesbare Berichte für Reviews bei Versions-Updates (Familien-Matrix als Markdown, Kennzahlen).
 * Landen in raw/reports/ (gitignored), NICHT in data/.
 */
import { FAMILY_KINDS, PHYSICS_CLASSES, PHYSICS_FLAGS, type FamilyData, type PhysicsData, type RegistryData } from '../types.js';
import type { RegistryDiff } from './diff.js';
import { CORE_SHAPES } from './families.js';

// ------------------------------------------------------------ Kennzahlen

export function buildSummary(input: {
  registries: readonly RegistryData[];
  families: readonly FamilyData[];
  physics: readonly PhysicsData[];
  diffs: readonly RegistryDiff[];
  /** Blöcke mit Kollisionsdaten in der primären PrismarineJS-Version */
  primaryCollisionBlocks: ReadonlySet<string>;
  sources: Readonly<Record<string, unknown>>;
}): unknown {
  return {
    generatedFrom: input.sources,
    versions: input.registries.map((r, i) => {
      const fam = input.families[i];
      const phys = input.physics[i];
      if (!fam || !phys) throw new Error(`Daten für ${r.version} unvollständig`);
      const byKind: Record<string, number> = {};
      for (const f of Object.values(fam.families)) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
      const cls: Record<string, number> = Object.fromEntries(PHYSICS_CLASSES.map((c) => [c, 0]));
      const flags: Record<string, number> = Object.fromEntries(PHYSICS_FLAGS.map((c) => [c, 0]));
      let variable = 0;
      const bySrc: Record<string, number> = {};
      for (const p of Object.values(phys.blocks)) {
        cls[p.cls] = (cls[p.cls] ?? 0) + 1;
        for (const f of p.flags) flags[f] = (flags[f] ?? 0) + 1;
        if (p.by || p.classes) variable++;
        const src = p.src.startsWith('heuristic') ? 'heuristic' : p.src;
        bySrc[src] = (bySrc[src] ?? 0) + 1;
      }
      const stateCount = Object.values(r.blocks).reduce(
        (n, b) => n + Object.values(b.properties).reduce((m, v) => m * v.length, 1),
        0,
      );
      return {
        version: r.version,
        dataVersion: r.dataVersion,
        blocks: Object.keys(r.blocks).length,
        blockStates: stateCount,
        items: r.items.length,
        lootTables: r.lootTables.length,
        blockTags: Object.keys(r.blockTags).length,
        families: Object.keys(fam.families).length,
        familiesByKind: byKind,
        gaps: fam.gaps.length,
        gapsWithoutFallback: fam.gaps.filter((g) => g.fallback.length === 0).length,
        gapsShapeAbsentInKind: fam.gaps.filter((g) => g.shapeAbsentInKind).length,
        physicsClasses: cls,
        physicsFlags: flags,
        physicsVariableBlocks: variable,
        physicsSources: bySrc,
        unknownPhysics: phys.unknown.length,
        notInPrimaryCollision: Object.keys(r.blocks).filter((b) => !input.primaryCollisionBlocks.has(b)).length,
      };
    }),
    diffs: input.diffs.map((d) => ({
      from: d.from,
      to: d.to,
      blocksAdded: d.blocks.added.length,
      blocksRemoved: d.blocks.removed.length,
      itemsAdded: d.items.added.length,
      itemsRemoved: d.items.removed.length,
      lootAdded: d.lootTables.added.length,
      lootRemoved: d.lootTables.removed.length,
      blocksWithPropertyChanges: d.propertyChanges.length,
      blocksWithDefaultChanges: d.propertyChanges.filter((c) => Object.keys(c.changedDefaults).length > 0).length,
      renames: d.probableRenames,
    })),
  };
}

// ------------------------------------------------------------ Familien-Matrix (Markdown)

/** true, wenn der Blockname dem erwarteten Muster folgt (dann nur ✓ in der Matrix). */
function isStandardName(fid: string, dye: string | undefined, kind: string, shape: string, block: string): boolean {
  const sing = fid.replace(/s$/, ''); // stone_bricks → stone_brick
  const cands = [
    `${fid}_${shape}`,
    `${sing}_${shape}`,
    `${shape}_${fid}`, // chiseled_x, cracked_x, mossy_x, infested_x
    `stripped_${fid}_${shape.replace(/^stripped_/, '')}`,
  ];
  if (shape === 'block') cands.push(fid, `${fid}_block`);
  if (dye) cands.push(`${dye}_${shape}`, `${dye}_${shape.replace(/^glazed$/, 'glazed_terracotta')}`, `${fid}_${shape}`);
  if (kind === 'copper') {
    const p = fid.replace(/copper$/, '');
    cands.push(`${p}${shape}_copper`, `${p}${shape.replace(/^cut_/, 'cut_copper_')}`, `${p}copper`);
  }
  if (kind === 'glass' && shape === 'pane') cands.push(`${fid}_pane`);
  return cands.includes(block);
}

export function familiesMarkdown(fd: FamilyData): string {
  const lines: string[] = [];
  lines.push(`# Familien × Formen – Minecraft ${fd.version}`, '');
  lines.push(
    'Generiert von `packages/platform` (npm run generate). Legende: `✓` = `<familie>_<form>`, `✗` = Lücke (Kern-Form fehlt), `·` = nicht vorhanden (keine Kern-Form), sonst abweichender Blockname (`~` = Familienname).',
    '',
  );
  for (const kind of FAMILY_KINDS) {
    const fams = Object.values(fd.families).filter((f) => f.kind === kind);
    if (fams.length === 0) continue;
    const core = CORE_SHAPES[kind];
    const extra = [...new Set(fams.flatMap((f) => Object.keys(f.shapes)))]
      .filter((s) => !core.includes(s) && !(kind === 'wood' && s === 'block') && !(kind === 'copper' && (s === 'stairs' || s === 'slab')))
      .sort();
    const cols = [...core, ...extra];
    lines.push(`## ${kind} (${fams.length})`, '');
    lines.push(`| Familie | ${cols.join(' | ')} |`);
    lines.push(`|---|${cols.map(() => ':-:').join('|')}|`);
    for (const f of fams) {
      const fid = f.id.replace(/^color:/, '');
      const fcore = f.core ?? core;
      const cells = cols.map((s) => {
        const b = f.shapes[s];
        if (!b) return fcore.includes(s) ? '✗' : '·';
        return isStandardName(fid, f.dye, kind, s, b) ? '✓' : `\`${b.split(fid).join('~')}\``;
      });
      lines.push(`| ${f.id} | ${cells.join(' | ')} |`);
    }
    lines.push('');
  }
  lines.push('## Lücken und Fallback-Vorschläge', '');
  lines.push('| Art | Familie | Form | in Art vorhanden? | Fallback-Kette |');
  lines.push('|---|---|---|---|---|');
  for (const g of fd.gaps) {
    const chain = g.fallback.map((s) => `\`${s.block}\` (${s.why})`).join(' → ') || '— (kein Block-Ersatz)';
    lines.push(`| ${g.kind} | ${g.family} | ${g.shape} | ${g.shapeAbsentInKind ? 'nein' : 'ja'} | ${chain} |`);
  }
  lines.push('');
  const vf = Object.entries(fd.versionFallbacks);
  if (vf.length > 0) {
    lines.push('## Familien der neuesten Version, die hier fehlen', '');
    for (const [k, v] of vf) lines.push(`- \`${k}\` → ${v.map((x) => `\`${x}\``).join(', ') || '— (kein Ersatz, manuell kuratieren)'}`);
    lines.push('');
  }
  if (Object.keys(fd.ignored).length > 0) {
    lines.push('## Ignoriert', '');
    for (const [k, v] of Object.entries(fd.ignored)) lines.push(`- \`${k}\`: ${v}`);
  }
  return `${lines.join('\n')}\n`;
}
