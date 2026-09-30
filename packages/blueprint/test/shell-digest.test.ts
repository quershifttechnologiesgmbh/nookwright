/**
 * Prüfsummen der Hülle (B2): Stand VOR Gauben, Giebelfenster-„aus“, Auskragungs-Hinweis. Ohne neue Optionen muss jede
 * Hülle zellgleich bleiben (Zellen, Anker, Warnungen, Raumsicht) – für alle 9 Dachformen, schlicht, mit Dach-Details
 * und mit Außenprofil, an Rechteck, Beispielhaus, L-Grundriss und zweistöckigem Haus.
 */
import { describe, expect, it } from 'vitest';
import { deriveShell, type RoofStyle, type Shell, type ShellOptions } from '../src/index.js';
import { LAYOUTS } from './support/houses.js';

const ROOFS: readonly RoofStyle[] = ['flat', 'hip', 'gable', 'shed', 'half_hip', 'dutch_gable', 'mansard', 'gambrel', 'saltbox'];

const DIGEST_OPTIONS: ReadonlyArray<readonly [string, Omit<ShellOptions, 'roof'>]> = [
  ['schlicht', {}],
  ['Details', { roofDetail: { pitch: 'steep', trim: true, verge: 'closed', flare: true } }],
  ['Profil', { roofDetail: { trim: true }, facade: { plinthProfile: true, cornice: true, quoins: true, brackets: 3, pilasters: 4 } }],
];

function digest(s: Shell): string {
  const rooms = [...s.rooms.values()].map((r) => ({ ...r, interior: [...r.interior], blocked: [...(r.blocked ?? [])] }));
  const text = JSON.stringify({ cells: s.cells, anchors: s.anchors, warnings: s.warnings, rooms });
  let h = 0x811c9dc5;
  for (let k = 0; k < text.length; k++) h = Math.imul(h ^ text.charCodeAt(k), 0x01000193) >>> 0;
  return `${text.length}:${h.toString(16)}`;
}

describe('Prüfsummen: ohne neue Optionen zellgleich (Stand vor B2)', () => {
  it('alle Grundrisse × 9 Dachformen × schlicht/Details/Profil', () => {
    const out: string[] = [];
    for (const [name, make] of LAYOUTS) {
      const p = make();
      for (const [label, opts] of DIGEST_OPTIONS) {
        out.push(`${name} · ${label}: ${ROOFS.map((roof) => digest(deriveShell(p.state, { roof, ...opts }))).join(' ')}`);
      }
    }
    // Einzige gewollte Änderung (B2): „Auskragung · Profil“ – Konsolen tragen die Auskragung, die Warnung entfällt
    // (vorher 65004:299fdbb6 89447:90cbbf5 …; Zellen und Anker unverändert, siehe facade.test.ts)
    // W2 (26.09.2026): Regeln D2–D4, D6, D8 – Giebelfeld `wall_gable` (D4, alle Satteldach-Formen, auch schlicht),
    // Traufe ohne Wandband (D2, steil/Mansarde/Gambrel), Windbrett nur bei steilem Ortgang (D3) und Sohlbalken mit Kante
    // (D4), Kappung an höheren Wänden ≤ 2 (D6), Flachdach mit Gesims (D8, nur mit Details). Das Dachhöhen-Budget (D5)
    // und „Pult ≤ 7“ (D8) wirken nur mit `heightBudget: true` – gewählte Neigung und Form gelten genau.
    // W3 (27.09.2026): Dach-Teilung – nur „Beispielhaus · Details/Profil“, Gambrel (Außenmaß 13, über dem Budget) wird
    // zu parallelen Gambreldächern; alle übrigen Summen unverändert (Gauben, Schornstein, Konsolen liegen nicht hier)
    // W4 (27.09.2026): D5 präzisiert – eingeschossige Dächer mit Details bekommen Kniestock (Rechteck, Beispielhaus,
    // L-Grundriss: alle geneigten Formen außer Pult), Ortgang-Unterseite endet über der Traufunterkante, Okulus-Ecken Wand
    // (zweistöckig/Auskragung: nur Traufecke und Okulus); schlichte Dächer und Walm/Flach ohne Details unverändert
    // W4-E (27.09.2026): Dachraum-Licht – alle geneigten Dächer bekommen Laternen auf dem Dachboden (`isAtticLight`,
    // plan/spikes/W4E_feinschliff.md); Flachdach-Summen unverändert
    // W5 (27.09.2026): Eckquader bis zur Traufunterkante (N1) – alle „Profil“-Summen mit Eckquadern (Deckenring- und
    // Kniestock-Ecke werden Pfeiler `wall_quoin`); Mehrgeschosser-D5 (N7) – nur das Pultdach-Haus mit Vorderseite
    // (Saltbox, „zweistöckig“/„Auskragung“ · Details/Profil) bekommt einen Kniestock; alles übrige unverändert
    // W13-E (2026-09-28): Giebelfenster Drillingsfenster 3 × 2 bzw. Band 3 × 1 statt Okulus (Plus las sich als Kreuz) –
    // die Zeilen „Details“/„Profil“ mit Okulus neu (git show 08cf7e70 für die alten Werte)
    expect(out).toMatchInlineSnapshot(`
      [
        "Rechteck 11×9 · schlicht: 32229:31c6cd47 56158:9f900826 58890:428ab360 70095:abea84ec 59071:6874d989 56742:142f0ea0 60826:9a48f0ba 63430:23f16fca 65091:46bf589",
        "Rechteck 11×9 · Details: 37584:9b5bae42 73185:21e85f5e 82564:76b188ae 95336:e14c8802 80702:b598b8bc 74554:e1dff0f8 69825:c1553ebd 75669:e75d9e38 95436:63f1795c",
        "Rechteck 11×9 · Profil: 45514:3b288bb5 71593:ba3d452b 74487:d2321357 78495:2bd89e50 74524:9061bcc 72185:df15aeb5 79811:2eb9ce81 82231:572869ff 84249:11d6cdaa",
        "Beispielhaus · schlicht: 88107:5532af3a 146259:320b0cda 152164:a8712deb 181777:6c8398d0 152007:42b82e14 148573:c1949e89 158553:c6e9bced 164084:c44dbb1 164355:9759c13d",
        "Beispielhaus · Details: 97217:7100d413 186871:10c8ff5b 203474:aebb02ce 245294:28552142 200603:7ce20ad7 191523:f485e484 177019:bda4c60 187980:ddb3e09f 228199:a5acdc72",
        "Beispielhaus · Profil: 112073:a8574d4b 181446:9aee2271 187557:dfd0e0ec 197475:6fd3b061 187242:d0e499e1 183758:24f8fc4c 193780:ba7f5456 199135:9190bdfc 199803:ba930e3a",
        "L-Grundriss · schlicht: 51502:25db9351 87041:cff6f470 89472:19edb287 106639:716f14cb 89898:d66c4d9a 88187:f3b1f383 94724:579a3776 98058:d12805b3 93997:ac493203",
        "L-Grundriss · Details: 59071:829b07ee 112697:a5d03ec5 121537:ba753af3 141086:475ed367 118780:fdd709d1 114838:605c1c37 102432:4d429cb1 108570:4fe7e887 131201:a64291e4",
        "L-Grundriss · Profil: 70319:1e5dfdb7 104212:d466dd60 106897:3f1f4ae1 118508:53b71776 107072:dd589d1c 105361:649bb1dc 117124:95c1a2bd 120209:7b85a2a9 116533:daf053bc",
        "zweistöckig · schlicht: 131829:1f2fd98d 191063:c7185cee 196000:a0004a53 216977:4faf7f8 195847:ba6babad 192514:fe98410e 200185:2c396f02 205171:37fdd15f 204981:774f9be8",
        "zweistöckig · Details: 142455:e3c427a9 202147:834f2ef4 220274:d320f43d 264403:79fed694 217494:b69cd35a 207351:16ecb9f7 195458:4a765d5a 208994:c8a08a2 252193:fede754b",
        "zweistöckig · Profil: 165634:18b190e 215435:8b715d2a 218377:b014427f 239122:80f8fdf4 218030:48c6943f 214593:547e44f2 224628:79296183 230099:ddb39eb2 227864:5a6bbfc",
        "Auskragung · schlicht: 53211:fb24a2fe 77223:2d900b17 79996:fae16441 91310:4f3ca437 80177:c4007fcf 77814:fc347726 81963:d72f9fe5 84607:8e719b78 86236:9bb5a0d5",
        "Auskragung · Details: 58568:63d79d75 83271:cc313615 92896:51e12846 116655:e64c9c45 90930:33820719 84638:79b4f01b 79911:f9e87a69 86001:7c1873f7 113119:a3699883",
        "Auskragung · Profil: 70276:90623ed3 89463:8cc4e3c4 92096:32ebde40 103355:116076b6 92017:3a4470b2 90054:e347560d 94203:d9b3457a 96333:431aca2b 98334:d411b732",
      ]
    `);
  });
});

describe('Baukörper (V0): ohne wirksame Baukörper zellgleich', () => {
  it('leerer Zusatz-Baukörper bzw. alle Räume in EINEM neuen Baukörper ohne Eigenschaften: gleiche Prüfsummen', () => {
    for (const [name, make] of LAYOUTS) {
      const plain = make();
      const spare = make();
      spare.addVolume({ name: 'leer', roof: 'gable', baseOffset: 3 });
      const moved = make();
      const added = moved.addVolume({ name: 'alles' })[0]!;
      if (added.type !== 'VolumeAdded') throw new Error(added.type);
      moved.assignRoomVolume(moved.state.rooms.map((r) => r.id), added.volume.id);
      expect(moved.state.links, name).toEqual(plain.state.links);
      for (const [label, opts] of DIGEST_OPTIONS) {
        for (const roof of ROOFS) {
          const ref = digest(deriveShell(plain.state, { roof, ...opts }));
          expect(digest(deriveShell(spare.state, { roof, ...opts })), `${name} · ${label} · ${roof}: leerer Baukörper`).toBe(ref);
          expect(digest(deriveShell(moved.state, { roof, ...opts })), `${name} · ${label} · ${roof}: ein Baukörper`).toBe(ref);
        }
      }
    }
  });

  it('Basishöhe des einzigen Baukörpers verschiebt die ganze Hülle (Zellen, Anker, Raumsicht) um genau diese Höhe', () => {
    const up = (s: Shell, dy: number): Shell => ({
      ...s,
      cells: s.cells.map((c) => ({ ...c, pos: [c.pos[0], c.pos[1] + dy, c.pos[2]] as const })),
      anchors: (s.anchors ?? []).map((a) => ({ ...a, pos: [a.pos[0], a.pos[1] + dy, a.pos[2]] as const })),
      rooms: new Map([...s.rooms].map(([id, r]) => [id, { ...r, baseY: r.baseY + dy }] as const)),
    });
    for (const [name, make] of LAYOUTS) {
      const plain = make();
      const raised = make();
      raised.changeVolume('v0', { baseOffset: 5 });
      for (const [label, opts] of DIGEST_OPTIONS) {
        for (const roof of ['hip', 'gable', 'mansard'] as const) {
          expect(digest(deriveShell(raised.state, { roof, ...opts })), `${name} · ${label} · ${roof}`).toBe(digest(up(deriveShell(plain.state, { roof, ...opts }), 5)));
        }
      }
    }
  });
});
