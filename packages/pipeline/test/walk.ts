/**
 * Test-Hilfe: Begehbarkeit in der FERTIGEN Welt (Voxel-Volumen, alle Kontexte zusammen: Haus, Möbel, Gelände,
 * Pflanzen, Bauwerke). Bewusst konservativ und nah am Spiel:
 *  - Füße: Luft, dünn (Fackel, Blume) oder flach (Teppich); Kopf: Luft oder dünn; Türen und Zauntore öffnen sich;
 *    offene Falltüren flach an einer Wand (Innenhaut-Paneele, W2) wie Luft (`isWallPanel`).
 *  - Stand: darunter ein tragender Block (voll, halb, hoch – Stufe, Treppe, Zaunpfosten), keine Flüssigkeit.
 *  - Schritt: gleich hoch; 1 hinauf auf eine Treppe/Stufe oder mit Kopffreiheit zum Springen; bis 3 hinab.
 *  - Additiv (W4-B, `climb: true`): Leitern hinauf. Aus einem Stand in einer Leiterzelle klettert der Walker die Säule
 *    hinauf – eine Falltür direkt über der obersten Leiter mit gleichem `facing` zählt mit (geöffnet ist sie in Java
 *    kletterbar, Faktencheck/minecraft.wiki „Trapdoor“) – und steigt auf jeder Höhe bis eine über der Säule seitlich
 *    auf einen Stand ab. Hinab geht es an einer Leiter entlang beliebig tief (feat/underground). Ohne den Schalter
 *    bleibt alles wie vorher (keine Leitern).
 */
import type { Vec3 } from '@mcda/core';
import { WorldView, isWallPanel, type PlatformView } from '@mcda/materialize';
import type { VoxelVolume } from '@mcda/voxel';

const N4: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const standKey = (p: Vec3): string => `${p[0]},${p[1]},${p[2]}`;

export class Walker {
  private readonly view: WorldView;
  private readonly climb: boolean;

  constructor(volume: VoxelVolume, platform: PlatformView, opts: { readonly climb?: boolean } = {}) {
    this.view = new WorldView(volume, platform);
    this.climb = opts.climb === true;
  }

  /** Leiter in der Zelle (Blickrichtung) bzw. `undefined`. */
  private ladder(p: Vec3): string | undefined {
    if (!this.view.inside(p)) return undefined;
    const s = this.view.info(p).state;
    return s.name === 'ladder' ? (s.properties['facing'] ?? '') : undefined;
  }

  /** Kletterbar über einer Leiter mit Blickrichtung `facing`: Leiter oder Falltür gleicher Richtung (zu öffnen). */
  private climbable(p: Vec3, facing: string): string | undefined {
    const l = this.ladder(p);
    if (l !== undefined) return l;
    if (!this.view.inside(p)) return undefined;
    const s = this.view.info(p).state;
    return s.name.endsWith('_trapdoor') && s.properties['facing'] === facing ? facing : undefined;
  }

  private openable(p: Vec3): boolean {
    const k = this.view.info(p).kind;
    return k === 'door' || k === 'fence_gate';
  }

  /** Körper passt hindurch (Füße bzw. Kopf). */
  passable(p: Vec3, feet: boolean): boolean {
    if (!this.view.inside(p)) return true;
    const info = this.view.info(p);
    if (this.view.hasFlag(info.state, 'liquid')) return false;
    const c = info.phys.cls;
    if (this.climb && info.state.name === 'ladder') return true;
    return c === 'air' || c === 'thin' || (feet && c === 'flat') || this.openable(p) || isWallPanel(this.view, p);
  }

  /** Tragender Block unter den Füßen. */
  support(p: Vec3): boolean {
    if (!this.view.inside(p)) return false;
    const info = this.view.info(p);
    if (this.view.hasFlag(info.state, 'liquid') || this.openable(p)) return false;
    return info.phys.cls === 'full' || info.phys.cls === 'half' || info.phys.cls === 'tall';
  }

  canStand(p: Vec3): boolean {
    return this.view.inside(p) && this.passable(p, true) && this.passable([p[0], p[1] + 1, p[2]], false) && this.support([p[0], p[1] - 1, p[2]]);
  }

  private halfBelow(p: Vec3): boolean {
    return this.view.info([p[0], p[1] - 1, p[2]]).phys.cls === 'half';
  }

  /** Alle von `starts` aus erreichbaren Standplätze (Schlüssel "x,y,z"). */
  reach(starts: readonly Vec3[]): Set<string> {
    const seen = new Set<string>();
    const queue: Vec3[] = [];
    const visit = (p: Vec3): void => {
      const k = standKey(p);
      if (seen.has(k) || !this.canStand(p)) return;
      seen.add(k);
      queue.push(p);
    };
    for (const s of starts) visit(s);
    while (queue.length > 0) {
      const [x, y, z] = queue.pop()!;
      const facing = this.climb ? this.ladder([x, y, z]) : undefined;
      if (facing !== undefined) {
        // Säule hinauf (Leitern, darüber höchstens eine Falltür gleicher Richtung), auf jeder Höhe seitlich absteigen
        let top = y;
        let f: string | undefined = facing;
        while (f !== undefined && this.view.info([x, top, z]).state.name === 'ladder') {
          f = this.climbable([x, top + 1, z], f);
          if (f !== undefined) top++;
        }
        for (let h = y + 1; h <= top + 1; h++) for (const [dx, dz] of N4) if (this.canStand([x + dx, h, z + dz])) visit([x + dx, h, z + dz]);
      }
      // Leiter unter den Füßen: an ihr hinab bis zum ersten Stand (feat/underground)
      if (this.climb) {
        for (let d = y - 1; this.ladder([x, d, z]) !== undefined; d--) {
          if (this.canStand([x, d, z])) {
            visit([x, d, z]);
            break;
          }
        }
      }
      for (const [dx, dz] of N4) {
        const nx = x + dx;
        const nz = z + dz;
        const up: Vec3 = [nx, y + 1, nz];
        if (this.canStand(up) && (this.halfBelow(up) || this.passable([x, y + 2, z], false))) visit(up);
        // mit `climb`: eine Stufe hinab wie hinauf (Spiegel der Regel oben) – von einer halben Stufe bzw. Treppe genügt
        // die Kopffreiheit über der Zielspalte (Treppe hinab unter der Deckenkante, feat/underground). Bewusst ohne Prüfung
        // von y + 1 über dem Ziel (Review-Hinweis geprüft): unter der Deckenöffnung des Laufs ist dort die Bodenplatte
        // darüber – der Walker fände den Weg hinab sonst nie, obwohl über jeder Stufe 2 Blöcke frei sind (eigener Test
        // „Kopfhöhe“ in underground.test.ts); darum nur mit `climb`
        const down: Vec3 = [nx, y - 1, nz];
        if (this.climb && this.halfBelow([x, y, z]) && this.passable([nx, y, nz], true) && this.canStand(down)) visit(down);
        if (!this.passable([nx, y, nz], true) || !this.passable([nx, y + 1, nz], false)) continue;
        if (this.canStand([nx, y, nz])) {
          visit([nx, y, nz]);
          continue;
        }
        // bis 3 hinab; mit `climb` an einer Leiter entlang beliebig tief (Java: Leitern lassen sich hinabsteigen –
        // feat/underground, Leiter in den Keller eines Turms)
        for (let d = 1; d <= 3 || (this.climb && this.ladder([nx, y - d + 1, nz]) !== undefined); d++) {
          const q: Vec3 = [nx, y - d, nz];
          if (!this.passable(q, true)) break;
          if (this.canStand(q)) {
            visit(q);
            break;
          }
        }
      }
    }
    return seen;
  }
}
