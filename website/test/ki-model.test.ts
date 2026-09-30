/**
 * KI-Architekt der Website (website/js/ki-model.js): Zustände, genau eine Anfrage je Beschreibung, 429-Sperre für jeden
 * Einstieg, Klemmen der Übergabe – gegen den Prüfer des Editors (packages/app/src/embed.ts), damit keine Übergabe still
 * scheitert (Review R1-02, R1-07, R1-08, R1-09, R1-12).
 */
import { describe, expect, it } from 'vitest';
import { parseDescribe } from '../../packages/app/src/embed.js';
import { LOCAL_CONFIDENCE, TYPE_CONFIDENCE_MIN } from '../../packages/engine/src/intent/browser.js';
import { BUILDABLE_SETTINGS } from '../../packages/pipeline/src/rules.js';
import {
  DEFAULT_BUILDABLE_SETTINGS, LONG_WAIT_S, planRows, waitText,
  DEFAULT_TYPE_CONFIDENCE_MIN, HANDOFF_LIMITS, cleanConfidence, createKiController, describeMessage, interpretationOf, invalidText,
  loadingTitle, percent, rateLocked, retryAfterSeconds, rowConfidence, sourceOf, stateFromFailure, stateFromResponse, typeDecision,
} from '../js/ki-model.js';

const JEV = {
  ok: true, model: 'typesafe/jev-1.13-20260917', interpretMs: 340,
  request: { op: 'building_generate', input: { buildingTypeId: 'tavern', size: 'L', shell: { roof: 'flat' }, seed: 7 } },
  confidence: { buildingTypeId: 1, size: 0.97, 'shell.roof': 0.91 },
};
const LOCAL_HOUSE = { ok: true, model: 'local', request: { op: 'building_generate', input: { buildingTypeId: 'house' } }, confidence: { buildingTypeId: 0.3 } };

interface FakeResponse { status: number; body?: unknown; headers?: Record<string, string> }
/** fetch-Attrappe: zählt Aufrufe, antwortet der Reihe nach; `hang` = antwortet nie (nur Abbruch). */
function fakeFetch(...responses: Array<FakeResponse | 'hang' | 'network'>) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fn = (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r === 'network') return Promise.reject(new TypeError('Failed to fetch'));
    if (r === 'hang') {
      return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    }
    const h = r?.headers ?? {};
    return Promise.resolve({
      status: r!.status,
      headers: { get: (k: string) => h[k.toLowerCase()] ?? null },
      json: () => (r!.body === undefined ? Promise.reject(new SyntaxError('no json')) : Promise.resolve(r!.body)),
    });
  };
  return { fn, calls };
}

/** Steuerung mit Uhr und Zeitgeber unter Testkontrolle. */
function controller(fetchImpl: ReturnType<typeof fakeFetch>['fn']) {
  let t = 1_000_000;
  const timers = new Map<number, () => void>();
  let next = 1;
  const states: string[] = [];
  const ki = createKiController({
    fetch: fetchImpl as never,
    now: () => t,
    clock: () => t,
    setTimer: ((f: () => void) => { const id = next++; timers.set(id, f); return id; }) as never,
    clearTimer: ((id: number) => { timers.delete(id); }) as never,
    onChange: (s: { kind: string; reason?: string }) => states.push(s.reason ? `${s.kind}:${s.reason}` : s.kind),
  });
  return {
    ki, states,
    advance(ms: number) { t += ms; },
    fireTimers() { for (const [id, f] of [...timers]) { timers.delete(id); f(); } },
  };
}

describe('Antwort auswerten', () => {
  it('200 mit Plan → result, Konfidenz geklemmt und bereinigt', () => {
    const s = stateFromResponse({ status: 200, retryAfter: null, body: { ...JEV, confidence: { buildingTypeId: 1.02, size: -0.1, x: Number.NaN, y: '0.5' } }, prompt: 'p', ms: 12, now: 0 });
    expect(s).toMatchObject({ kind: 'result', model: 'typesafe/jev-1.13-20260917', ms: 12 });
    expect(s.confidence).toEqual({ buildingTypeId: 1, size: 0 });
  });
  it('429 → Wartezeit aus Retry-After, sonst aus der Meldung', () => {
    expect(stateFromResponse({ status: 429, retryAfter: '42', body: {}, prompt: 'p', ms: 0, now: 1000 })).toMatchObject({ kind: 'error', reason: 'rate', until: 43_000 });
    expect(retryAfterSeconds(null, { errors: ['Rate-Limit erreicht – in 17 s erneut versuchen'] })).toBe(17);
    expect(retryAfterSeconds(null, {})).toBe(10);
  });
  it('400/413 → invalid, 5xx → unavailable (nicht „offline“), 404/405/403/kein JSON → offline', () => {
    expect(stateFromResponse({ status: 400, retryAfter: null, body: { ok: false, errors: ['input.floors: Too big: expected number to be <=8'] }, prompt: 'p', ms: 0, now: 0 })).toMatchObject({ reason: 'invalid' });
    expect(stateFromResponse({ status: 413, retryAfter: null, body: undefined, prompt: 'p', ms: 0, now: 0 })).toMatchObject({ reason: 'invalid' });
    for (const status of [500, 502, 503, 504]) expect(stateFromResponse({ status, retryAfter: null, body: undefined, prompt: 'p', ms: 0, now: 0 })).toMatchObject({ reason: 'unavailable' });
    for (const status of [401, 403, 404, 405]) expect(stateFromResponse({ status, retryAfter: null, body: undefined, prompt: 'p', ms: 0, now: 0 })).toMatchObject({ reason: 'offline' });
    expect(stateFromResponse({ status: 200, retryAfter: null, body: '<html>', prompt: 'p', ms: 0, now: 0 })).toMatchObject({ reason: 'offline' });
  });
  it('ohne Antwort: Abbruch → leer, Zeitlimit → timeout, Netz → offline', () => {
    expect(stateFromFailure({ cancelled: true, timedOut: false, prompt: 'p' })).toEqual({ kind: 'idle', prompt: 'p', cancelled: true });
    expect(stateFromFailure({ cancelled: true, timedOut: true, prompt: 'p' })).toMatchObject({ reason: 'timeout' });
    expect(stateFromFailure({ cancelled: false, timedOut: false, prompt: 'p' })).toMatchObject({ reason: 'offline' });
  });
});

describe('Zustandsautomat', () => {
  it('eine Beschreibung = genau ein POST v1/interpret mit { prompt }; loading → result', async () => {
    const f = fakeFetch({ status: 200, body: JEV });
    const c = controller(f.fn);
    expect(await c.ki.interpret('  Große Taverne mit Flachdach  ')).toBe('done');
    expect(f.calls).toEqual([{ url: 'v1/interpret', body: { prompt: 'Große Taverne mit Flachdach' } }]);
    expect(c.states).toEqual(['loading', 'result']);
  });
  it('leer → keine Anfrage; Text wird auf 500 Zeichen gekürzt', async () => {
    const f = fakeFetch({ status: 200, body: JEV });
    const c = controller(f.fn);
    expect(await c.ki.interpret('   ')).toBe('empty');
    expect(f.calls).toHaveLength(0);
    await c.ki.interpret('x'.repeat(900));
    expect((f.calls[0]!.body as { prompt: string }).prompt).toHaveLength(500);
  });
  it('neue Anfrage überholt die laufende; nur die letzte setzt den Zustand', async () => {
    const f = fakeFetch('hang', { status: 200, body: JEV });
    const c = controller(f.fn);
    const first = c.ki.interpret('eins');
    const second = c.ki.interpret('zwei');
    expect(await first).toBe('superseded');
    expect(await second).toBe('done');
    expect(c.ki.state).toMatchObject({ kind: 'result', prompt: 'zwei' });
  });
  it('Abbrechen → leer mit Hinweis; Zeitlimit → timeout', async () => {
    const f = fakeFetch('hang');
    const c = controller(f.fn);
    const p = c.ki.interpret('eins');
    c.ki.cancel();
    await p;
    expect(c.ki.state).toMatchObject({ kind: 'idle', cancelled: true });
    const q = c.ki.interpret('zwei');
    c.fireTimers();
    await q;
    expect(c.ki.state).toMatchObject({ kind: 'error', reason: 'timeout' });
  });
  it('429-Sperre: während der Wartezeit erzeugt kein Einstieg eine Anfrage, danach wieder', async () => {
    const f = fakeFetch({ status: 429, body: { ok: false, errors: ['Rate-Limit'] }, headers: { 'retry-after': '30' } }, { status: 200, body: JEV });
    const c = controller(f.fn);
    await c.ki.interpret('Burg');
    expect(c.ki.state).toMatchObject({ kind: 'error', reason: 'rate' });
    // Enter, Beispiel-Chip, Startseite, „Nochmal senden“ – alle rufen interpret
    for (const text of ['Burg', 'Große mittelalterliche Taverne mit Flachdach', 'Kleine Hobbithöhle', 'Burg']) {
      expect(await c.ki.interpret(text)).toBe('locked');
    }
    expect(f.calls).toHaveLength(1);
    expect(c.ki.state).toMatchObject({ reason: 'rate', prompt: 'Burg' });
    c.advance(29_000);
    expect(rateLocked(c.ki.state, 1_000_000 + 29_000)).toBe(true);
    expect(await c.ki.interpret('Taverne')).toBe('locked');
    c.advance(1_000);
    expect(await c.ki.interpret('Taverne')).toBe('done');
    expect(f.calls).toHaveLength(2);
  });
  it('lastModel steuert die Lade-Überschrift: neutral, bis ein Modell geantwortet hat', async () => {
    const c1 = controller(fakeFetch({ status: 200, body: LOCAL_HOUSE }).fn);
    expect(loadingTitle(c1.ki.lastModel)).toBe('Deine Beschreibung wird gelesen …');
    await c1.ki.interpret('asdf');
    expect(loadingTitle(c1.ki.lastModel)).toBe('Deine Beschreibung wird gelesen …');
    const c2 = controller(fakeFetch({ status: 200, body: JEV }).fn);
    await c2.ki.interpret('Taverne');
    expect(loadingTitle(c2.ki.lastModel)).toBe('JEV liest deine Beschreibung …');
  });
});

describe('Plan oder „Kein Bautyp erkannt“ (R1-02)', () => {
  const result = (body: typeof JEV | typeof LOCAL_HOUSE) => stateFromResponse({ status: 200, retryAfter: null, body, prompt: 'p', ms: 1, now: 0 });
  it('lokale Sicherheit unter der Schwelle → kein Plan', () => {
    expect(typeDecision(result(LOCAL_HOUSE), null)).toMatchObject({ kind: 'notype', reason: 'uncertain', typeId: 'house' });
  });
  it('Rückfall-Schwelle der Website = Schwelle von Engine und Editor', () => {
    expect(DEFAULT_TYPE_CONFIDENCE_MIN).toBe(TYPE_CONFIDENCE_MIN);
  });
  it('lokale Stufen: angenommen → kein Plan, Kompositum und ausdrücklich → Plan', () => {
    const at = (c: number) => typeDecision(result({ ...LOCAL_HOUSE, confidence: { buildingTypeId: c } }), { typeConfidenceMin: TYPE_CONFIDENCE_MIN }).kind;
    expect(at(LOCAL_CONFIDENCE.assumed)).toBe('notype');
    expect(at(LOCAL_CONFIDENCE.compound)).toBe('plan');
    expect(at(LOCAL_CONFIDENCE.explicit)).toBe('plan');
  });
  it('Chat-Modell ohne Sicherheitswerte → Plan wie genannt', () => {
    const chat = stateFromResponse({ status: 200, retryAfter: null, body: { ok: true, model: 'openai/gpt-oss-20b', request: { op: 'building_generate', input: { buildingTypeId: 'house' } } }, prompt: 'p', ms: 1, now: 0 });
    expect(typeDecision(chat, null).kind).toBe('plan');
  });
  it('Schwelle aus dem Vokabular gilt', () => {
    const s = result({ ...LOCAL_HOUSE, confidence: { buildingTypeId: 0.65 } });
    expect(typeDecision(s, null).kind).toBe('plan');
    expect(typeDecision(s, { typeConfidenceMin: 0.7 }).kind).toBe('notype');
  });
  it('sicherer Bautyp → Plan; andere Operation → kein Plan', () => {
    expect(typeDecision(result(JEV), null)).toMatchObject({ kind: 'plan', typeId: 'tavern' });
    const rooms = stateFromResponse({ status: 200, retryAfter: null, body: { ok: true, model: 'local', request: { op: 'rooms_generate', input: {} } }, prompt: 'p', ms: 1, now: 0 });
    expect(typeDecision(rooms, null)).toMatchObject({ kind: 'notype', reason: 'op' });
  });
});

describe('Übergabe an den Editor: geklemmt, vom Editor angenommen (R1-08)', () => {
  it('JEV-Antwort → genau eine describe-Nachricht mit Erkennung, die parseDescribe annimmt', () => {
    const st = stateFromResponse({ status: 200, retryAfter: null, body: JEV, prompt: 'Große Taverne', ms: 5, now: 0 });
    const msg = describeMessage(st.prompt, interpretationOf(st));
    expect(msg).toMatchObject({ type: 'nookwright:describe', prompt: 'Große Taverne', interpretation: { source: 'server', model: 'typesafe/jev-1.13-20260917' } });
    expect(parseDescribe(msg)).toMatchObject({ prompt: 'Große Taverne', interpretation: { request: { op: 'building_generate' } } });
  });
  it('feindliche Werte werden geklemmt statt verworfen: Konfidenz > 1, langes Modell, viele Felder', () => {
    const conf = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`f${i}`, 1.02]));
    const st = stateFromResponse({
      status: 200, retryAfter: null, prompt: 'p', ms: 1, now: 0,
      body: { ok: true, model: `m${'x'.repeat(300)}`, request: JEV.request, confidence: { ...conf, [`k${'y'.repeat(80)}`]: 0.5 } },
    });
    const it = interpretationOf(st)!;
    expect(it.model!.length).toBeLessThanOrEqual(HANDOFF_LIMITS.model);
    expect(Object.keys(it.confidence!)).toHaveLength(64);
    expect(Math.max(...Object.values(it.confidence!))).toBe(1);
    expect(it.note).toBeUndefined(); // Modell ohne Rückfall: kein Hinweis
    expect(interpretationOf({ ...st, model: 'local', fallback: 'x'.repeat(900) })!.note!.length).toBeLessThanOrEqual(HANDOFF_LIMITS.note);
    expect(parseDescribe(describeMessage('p', it))).toBeDefined();
  });
  it('ungültige Operation → keine Erkennung, nur der Text (der Editor erkennt selbst)', () => {
    const st = { kind: 'result', prompt: 'p', ms: 1, request: { op: 'DROP TABLE', input: {} } };
    expect(interpretationOf(st)).toBeUndefined();
    expect(parseDescribe(describeMessage('p', interpretationOf(st)))).toEqual({ prompt: 'p' });
  });
  it('Beschreibung leer → keine Nachricht; über 500 Zeichen → gekürzt und angenommen', () => {
    expect(describeMessage('   ', undefined)).toBeUndefined();
    expect(parseDescribe(describeMessage('a'.repeat(700), undefined))).toBeDefined();
  });
  it('Anzeige nie über 100 %, Zeilen-Sicherheit geklemmt', () => {
    expect(percent(1.02)).toBe(100);
    expect(percent(-1)).toBe(0);
    expect(rowConfidence({ label: 'x', value: 'y', paths: ['a', 'b'] }, { a: 1.5, b: 0.4 })).toBe(0.4);
    expect(rowConfidence({ label: 'x', value: 'y', paths: ['a'] }, { b: 0.4 })).toBe('filled');
    expect(cleanConfidence({ a: Infinity })).toBeUndefined();
  });
});

describe('Texte in Nutzersprache (R1-12)', () => {
  const vocab = { fields: { floors: { topic: 'Etagen ab Erdgeschoss, in den Grenzen der Größe' } } };
  it('400: nie der rohe Text, Feld aus dem Vokabular', () => {
    const t = invalidText('input.floors: Too big: expected number to be <=8', vocab);
    expect(t).toBe('Die Angabe „Etagen“ liegt außerhalb dessen, was der Generator bauen kann.');
    expect(invalidText('input.shell.overhang: too big', { fields: { 'shell.overhang': { topic: 'Dachüberstand in Blöcken' } } })).toContain('„Dachüberstand in Blöcken“');
    expect(invalidText('Unrecognized key: "foo"', vocab)).not.toMatch(/Unrecognized|foo/);
    expect(invalidText(undefined, null)).toMatch(/^Mindestens eine Angabe/);
  });
  it('Rückfall ohne HTTP-Codes', () => {
    const s = sourceOf({ model: 'local', fallback: 'Decisions-API: HTTP 502 nach 1 Wiederholung' });
    expect(s.note).toMatch(/nicht erreichbar/);
    expect(s.note).not.toMatch(/HTTP|502/);
  });
});

describe('Review 2', () => {
  it('R2-02: Lage außerhalb von BUILDABLE_SETTINGS → „wird noch nicht gebaut“', () => {
    expect([...DEFAULT_BUILDABLE_SETTINGS].sort()).toEqual([...BUILDABLE_SETTINGS].sort());
    const vocab = { buildableSettings: [...BUILDABLE_SETTINGS] };
    const rowFor = (kind: string) => planRows({ buildingTypeId: 'house', setting: { kind } }, { kind: 'result' }, vocab).find((r) => r.label === 'Lage')!;
    for (const kind of ['cliff', 'carved', 'stilts', 'tree', 'water', 'underwater']) {
      expect(rowFor(kind), kind).toMatchObject({ pending: true, sub: expect.stringContaining('wird noch nicht gebaut') });
    }
    for (const kind of ['ground', 'buried']) expect(rowFor(kind).pending, kind).toBeUndefined();
    // ohne Vokabular gilt derselbe Stand
    expect(planRows({ setting: { kind: 'stilts' } }, { kind: 'result' }, null)[0]).toMatchObject({ pending: true });
  });
  it('R2-04: ab 120 s Wartezeit Stunden/Uhrzeit statt Sekunden', () => {
    expect(waitText(42, 0)).toEqual({ long: false, text: '42 Sekunden' });
    expect(waitText(LONG_WAIT_S - 1, 0).long).toBe(false);
    const w = waitText(5 * 3600, Date.UTC(2026, 8, 26, 12, 0));
    expect(w.long).toBe(true);
    expect(w.text).toMatch(/^etwa 5 Stunden \(ab \d{2}:\d{2} Uhr\)$/);
    expect(waitText(600, 0).text).toMatch(/^etwa 10 Minuten/);
  });
});
