/**
 * Einbettungs-Protokoll, Website-Seite (website/js/embed-model.js): Warteschlange bis `ready`, genau eine Zustellung je
 * Übergabe, Absender-Prüfung, Ablehnung durch den Editor (`nookwright:rejected`) und Hinweis ohne `ready`
 * (Review R1-08, R1-09). Die Gegenseite (packages/app/src/embed.ts) nimmt die Nachrichten an.
 */
import { describe, expect, it } from 'vitest';
import { acceptDescribe } from '../../packages/app/src/embed.js';
import { EMBED_READY, EMBED_REJECTED, NO_READY_TEXT, createEmbedBridge, rejectedText } from '../js/embed-model.js';
import { createKiController, describeMessage, interpretationOf } from '../js/ki-model.js';

const ORIGIN = 'https://nookwright.example';

function setup() {
  const posted: Array<{ msg: unknown; origin: string }> = [];
  const frame = { postMessage: (msg: unknown, origin: string) => posted.push({ msg, origin }) };
  const notes: string[] = [];
  const timers = new Map<number, () => void>();
  let n = 1;
  const bridge = createEmbedBridge({
    origin: ORIGIN,
    frameWindow: () => frame,
    notify: (t: string) => { notes.push(t); },
    setTimer: ((f: () => void) => { const id = n++; timers.set(id, f); return id; }) as never,
    clearTimer: ((id: number) => { timers.delete(id); }) as never,
  });
  const fire = () => { for (const [id, f] of [...timers]) { timers.delete(id); f(); } };
  return { bridge, frame, posted, notes, timers, fire };
}
const msg = (prompt: string) => describeMessage(prompt, undefined);

describe('Warteschlange und Zustellung', () => {
  it('vor `ready` wartet die letzte Beschreibung; nach `ready` genau eine Zustellung an den eigenen Ursprung', () => {
    const s = setup();
    s.bridge.describe(msg('eins'));
    s.bridge.describe(msg('zwei'));
    expect(s.posted).toHaveLength(0);
    expect(s.bridge.handleMessage({ origin: ORIGIN, source: s.frame, data: { type: EMBED_READY } })).toBe(true);
    expect(s.posted).toEqual([{ msg: { type: 'nookwright:describe', prompt: 'zwei' }, origin: ORIGIN }]);
    s.bridge.handleMessage({ origin: ORIGIN, source: s.frame, data: { type: EMBED_READY } });
    expect(s.posted).toHaveLength(1);
  });
  it('nach `ready` geht jede Übergabe sofort und einmal raus', () => {
    const s = setup();
    s.bridge.handleMessage({ origin: ORIGIN, source: s.frame, data: { type: EMBED_READY } });
    s.bridge.describe(msg('drei'));
    expect(s.posted.map((p) => (p.msg as { prompt: string }).prompt)).toEqual(['drei']);
  });
  it('fremder Ursprung, fremdes Fenster oder Ursprung "null" → ignoriert', () => {
    const s = setup();
    s.bridge.describe(msg('eins'));
    expect(s.bridge.handleMessage({ origin: 'https://evil.example', source: s.frame, data: { type: EMBED_READY } })).toBe(false);
    expect(s.bridge.handleMessage({ origin: ORIGIN, source: {}, data: { type: EMBED_READY } })).toBe(false);
    expect(s.posted).toHaveLength(0);
    const nul = createEmbedBridge({ origin: 'null', frameWindow: () => s.frame });
    nul.describe(msg('x'));
    expect(nul.handleMessage({ origin: 'null', source: s.frame, data: { type: EMBED_READY } })).toBe(false);
    expect(s.posted).toHaveLength(0);
  });
});

describe('Hinweise statt still scheitern', () => {
  it('`nookwright:rejected` → Hinweis mit lesbarem Grund; Kürzel und lange Texte ohne Grund', () => {
    const s = setup();
    s.bridge.handleMessage({ origin: ORIGIN, source: s.frame, data: { type: EMBED_REJECTED, reason: 'Die Erkennung passt nicht zum Vertrag' } });
    expect(s.notes).toEqual(['Der Editor konnte die Beschreibung nicht übernehmen. Füge sie dort unter „Beschreibe dein Gebäude“ ein. Grund: Die Erkennung passt nicht zum Vertrag.']);
    expect(rejectedText('invalid-interpretation')).not.toMatch(/Grund/);
    expect(rejectedText('x '.repeat(200))).not.toMatch(/Grund/);
    expect(rejectedText(42)).not.toMatch(/Grund/);
  });
  it('R2-05: Vertragsdetails nie als Grund, nur Nutzersprache', () => {
    for (const r of ['request.op ist ungültig', 'interpretation fehlt oder hat die falsche Form', 'confidence > 1 bei buildingTypeId',
      'Unbekannte Operation rooms_generate', 'Expected string, received number', 'Feld input.floors zu groß', 'Wert muss <= 8 sein']) {
      expect(rejectedText(r), r).not.toMatch(/Grund/);
    }
    expect(rejectedText('Die Beschreibung war zu lang')).toMatch(/Grund: Die Beschreibung war zu lang\.$/);
  });
  it('`rejected` aus fremder Quelle → kein Hinweis', () => {
    const s = setup();
    s.bridge.handleMessage({ origin: 'https://evil.example', source: s.frame, data: { type: EMBED_REJECTED, reason: 'x y' } });
    expect(s.notes).toHaveLength(0);
  });
  it('Editor geladen, aber kein `ready` → Hinweis nach der Frist; spätes `ready` stellt trotzdem zu', () => {
    const s = setup();
    s.bridge.describe(msg('eins'));
    s.bridge.frameLoaded();
    s.fire();
    expect(s.notes).toEqual([NO_READY_TEXT]);
    s.bridge.handleMessage({ origin: ORIGIN, source: s.frame, data: { type: EMBED_READY } });
    expect(s.posted).toHaveLength(1);
  });
  it('mit `ready` vor Ablauf der Frist → kein Hinweis', () => {
    const s = setup();
    s.bridge.describe(msg('eins'));
    s.bridge.frameLoaded();
    s.bridge.handleMessage({ origin: ORIGIN, source: s.frame, data: { type: EMBED_READY } });
    s.fire();
    expect(s.notes).toHaveLength(0);
  });
});

describe('Ende zu Ende: KI-Architekt → Editor', () => {
  it('genau ein /v1/interpret je Übergabe, und der Editor nimmt die Nachricht an', async () => {
    let calls = 0;
    const fetchImpl = () => {
      calls++;
      return Promise.resolve({
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve({ ok: true, model: 'typesafe/jev-1.13-20260917', request: { op: 'building_generate', input: { buildingTypeId: 'hobbit', front: 'east' } }, confidence: { buildingTypeId: 1, front: 1.3 } }),
      });
    };
    const ki = createKiController({ fetch: fetchImpl as never });
    await ki.interpret('Kleine Hobbithöhle, Eingang nach Osten');
    const s = setup();
    s.bridge.describe(describeMessage(ki.state.prompt, interpretationOf(ki.state)));
    s.bridge.handleMessage({ origin: ORIGIN, source: s.frame, data: { type: EMBED_READY } });
    expect(calls).toBe(1);
    expect(s.posted).toHaveLength(1);
    // Gegenseite: so prüft der Editor die Nachricht (Ursprung, Elternfenster, Form)
    const parent = {};
    const accepted = acceptDescribe({ origin: ORIGIN, source: parent, data: s.posted[0]!.msg }, { parent, location: { origin: ORIGIN } });
    expect(accepted).toMatchObject({ prompt: 'Kleine Hobbithöhle, Eingang nach Osten', interpretation: { confidence: { buildingTypeId: 1, front: 1 } } });
  });
});
