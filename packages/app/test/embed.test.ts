/**
 * Einbettungs-Protokoll Website ⇄ Editor (W1, Vertrag in plan/spikes/W1_eine_app.md §3): Adresse, „bereit“,
 * strenge Prüfung von `nookwright:describe` (Ursprung, Absender, Form) und Übernahme der fertigen Erkennung über
 * denselben Weg wie `describeBuilding` (`suggestionFor`) – ohne zweiten Modellaufruf.
 */
import { describe, expect, it } from 'vitest';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import {
  EMBED_DESCRIBE, EMBED_READY, EMBED_REJECTED, MAX_PROMPT_LENGTH, REJECT_REASONS, acceptDescribe, announceReady, announceRejected, cleanPrompt, embedOptions,
  parseDescribe, parseInterpretation, readyMessage, receiveDescribe, rejectedMessage,
} from '../src/embed.js';
import { sourceText, suggestionFor } from '../src/nlPrompt.js';
import * as uc from '../src/usecases.js';

const ORIGIN = 'https://nookwright.example';
const request = { op: 'building_generate', input: { buildingTypeId: 'tavern', size: 'L', floors: 3 } };
const jev = { source: 'server', request, model: 'typesafe/jev-1.13-20260917', confidence: { buildingTypeId: 1, size: 0.97 } };

/** Fenster im iframe: eigenes Elternfenster mit Aufzeichnung von `postMessage`. */
function framed(origin = ORIGIN) {
  const posted: Array<{ message: unknown; target: string }> = [];
  const parent = { postMessage: (message: unknown, target: string) => posted.push({ message, target }) };
  return { self: { parent, location: { origin } }, parent, posted };
}

describe('Adresse: ?embed=1 und Deep-Link ?describe=', () => {
  it('eingebettet nur mit embed=1; Beschreibung getrimmt, leer oder zu lang entfällt', () => {
    expect(embedOptions('')).toEqual({ embedded: false });
    expect(embedOptions('?embed=1')).toEqual({ embedded: true });
    expect(embedOptions('?embed=true')).toEqual({ embedded: false });
    expect(embedOptions('?embed=1&describe=%20kleine%20Taverne%20')).toEqual({ embedded: true, describe: 'kleine Taverne' });
    expect(embedOptions('?describe=Wachturm')).toEqual({ embedded: false, describe: 'Wachturm' });
    expect(embedOptions('?describe=%20%20')).toEqual({ embedded: false });
    expect(embedOptions(`?describe=${'a'.repeat(MAX_PROMPT_LENGTH + 1)}`)).toEqual({ embedded: false });
    expect(cleanPrompt('a'.repeat(MAX_PROMPT_LENGTH))).toHaveLength(MAX_PROMPT_LENGTH);
    expect(cleanPrompt(42)).toBeUndefined();
  });
});

describe('Editor → Seite: nookwright:ready', () => {
  it('im iframe an das Elternfenster, nur an den eigenen Ursprung', () => {
    const { self, posted } = framed();
    expect(announceReady(self)).toBe(true);
    expect(posted).toEqual([{ message: { type: EMBED_READY }, target: ORIGIN }]);
    expect(readyMessage()).toEqual({ type: 'nookwright:ready' });
  });

  it('ohne iframe (parent === self) und bei Ursprung „null“ (file://, Sandbox) nichts senden', () => {
    const self: { parent: unknown; location: { origin: string } } = { parent: undefined, location: { origin: ORIGIN } };
    self.parent = self;
    expect(announceReady(self)).toBe(false);
    const { self: sandboxed, posted } = framed('null');
    expect(announceReady(sandboxed)).toBe(false);
    expect(posted).toEqual([]);
  });
});

describe('Seite → Editor: nookwright:describe', () => {
  const { self, parent } = framed();
  const msg = (data: unknown, over: Partial<{ origin: string; source: unknown }> = {}) => ({ origin: ORIGIN, source: parent, data, ...over });

  it('nur Beschreibung: angenommen, Editor erkennt selbst', () => {
    expect(acceptDescribe(msg({ type: EMBED_DESCRIBE, prompt: '  große Taverne ' }), self)).toEqual({ prompt: 'große Taverne' });
  });

  it('mit Erkennung der Website: Quelle, Anfrage, Modell, Konfidenz; weitere Felder der Serverantwort ignoriert', () => {
    const cmd = acceptDescribe(msg({ type: EMBED_DESCRIBE, prompt: 'große Taverne', interpretation: { ...jev, ok: true, interpretMs: 812 } }), self)!;
    expect(cmd.interpretation).toEqual(jev);
    expect(sourceText(cmd.interpretation!)).toBe('Erkannt mit JEV (typesafe/jev-1.13)');
  });

  it('fremder Ursprung, fremder Absender, Ursprung „null“: verworfen', () => {
    const data = { type: EMBED_DESCRIBE, prompt: 'Taverne' };
    expect(acceptDescribe(msg(data, { origin: 'https://evil.example' }), self)).toBeUndefined();
    expect(acceptDescribe(msg(data, { source: {} }), self)).toBeUndefined();
    expect(acceptDescribe(msg(data, { source: null }), self)).toBeUndefined();
    const { self: sandboxed, parent: p2 } = framed('null');
    expect(acceptDescribe({ origin: 'null', source: p2, data }, sandboxed)).toBeUndefined();
  });

  it('ohne iframe: Nachrichten des Fensters an sich selbst gelten (Prüfung per window.postMessage)', () => {
    const top: { parent: unknown; location: { origin: string } } = { parent: undefined, location: { origin: ORIGIN } };
    top.parent = top;
    expect(acceptDescribe({ origin: ORIGIN, source: top, data: { type: EMBED_DESCRIBE, prompt: 'Wachturm' } }, top)).toEqual({ prompt: 'Wachturm' });
  });

  it('Form streng: falscher Typ, leerer/zu langer Prompt, kaputte Erkennung → ganze Nachricht verworfen', () => {
    const bad: unknown[] = [
      null, 'nookwright:describe', [EMBED_DESCRIBE], { type: 'nookwright:other', prompt: 'x' }, { type: EMBED_DESCRIBE },
      { type: EMBED_DESCRIBE, prompt: '' }, { type: EMBED_DESCRIBE, prompt: '   ' }, { type: EMBED_DESCRIBE, prompt: 7 },
      { type: EMBED_DESCRIBE, prompt: 'x'.repeat(MAX_PROMPT_LENGTH + 1) },
      { type: EMBED_DESCRIBE, prompt: 'x', interpretation: null },
      { type: EMBED_DESCRIBE, prompt: 'x', interpretation: { ...jev, source: 'cloud' } },
      { type: EMBED_DESCRIBE, prompt: 'x', interpretation: { ...jev, request: undefined } },
      { type: EMBED_DESCRIBE, prompt: 'x', interpretation: { ...jev, request: { op: 'building_generate' } } },
      { type: EMBED_DESCRIBE, prompt: 'x', interpretation: { ...jev, request: { op: 'building_generate', input: [] } } },
      { type: EMBED_DESCRIBE, prompt: 'x', interpretation: { ...jev, request: { op: 3, input: {} } } },
      { type: EMBED_DESCRIBE, prompt: 'x', interpretation: { ...jev, request: { op: 'Building Generate!', input: {} } } },
      { type: EMBED_DESCRIBE, prompt: 'x', interpretation: { ...jev, confidence: { size: 1.2 } } },
      { type: EMBED_DESCRIBE, prompt: 'x', interpretation: { ...jev, confidence: { size: -0.1 } } },
      { type: EMBED_DESCRIBE, prompt: 'x', interpretation: { ...jev, confidence: { size: '0.9' } } },
      { type: EMBED_DESCRIBE, prompt: 'x', interpretation: { ...jev, confidence: { size: Number.NaN } } },
      { type: EMBED_DESCRIBE, prompt: 'x', interpretation: { ...jev, confidence: [0.5] } },
      { type: EMBED_DESCRIBE, prompt: 'x', interpretation: { ...jev, model: 42 } },
      { type: EMBED_DESCRIBE, prompt: 'x', interpretation: { ...jev, model: 'm'.repeat(200) } },
      { type: EMBED_DESCRIBE, prompt: 'x', interpretation: { ...jev, note: 'n'.repeat(400) } },
    ];
    for (const data of bad) expect(parseDescribe(data), JSON.stringify(data)?.slice(0, 120)).toBeUndefined();
  });

  it('R1-08: falsche Form vom Elternfenster → reject mit Grund; fremde Absender und andere Nachrichten → ignore', () => {
    const rejectOf = (data: unknown) => receiveDescribe(msg(data), self);
    expect(rejectOf({ type: EMBED_DESCRIBE, prompt: '  ' })).toEqual({ kind: 'reject', reason: REJECT_REASONS.prompt });
    expect(rejectOf({ type: EMBED_DESCRIBE })).toEqual({ kind: 'reject', reason: REJECT_REASONS.prompt });
    expect(rejectOf({ type: EMBED_DESCRIBE, prompt: 'x'.repeat(MAX_PROMPT_LENGTH + 1) })).toEqual({ kind: 'reject', reason: REJECT_REASONS.promptLength });
    expect(rejectOf({ type: EMBED_DESCRIBE, prompt: 'x', interpretation: null })).toEqual({ kind: 'reject', reason: REJECT_REASONS.interpretation });
    expect(rejectOf({ type: EMBED_DESCRIBE, prompt: 'x', interpretation: { ...jev, source: 'cloud' } })).toEqual({ kind: 'reject', reason: REJECT_REASONS.source });
    expect(rejectOf({ type: EMBED_DESCRIBE, prompt: 'x', interpretation: { ...jev, request: { op: 'A B', input: {} } } })).toEqual({ kind: 'reject', reason: REJECT_REASONS.op });
    expect(rejectOf({ type: EMBED_DESCRIBE, prompt: 'x', interpretation: { ...jev, request: { op: 'building_generate', input: [] } } })).toEqual({ kind: 'reject', reason: REJECT_REASONS.input });
    expect(rejectOf({ type: EMBED_DESCRIBE, prompt: 'x', interpretation: { ...jev, confidence: { size: 2 } } })).toEqual({ kind: 'reject', reason: REJECT_REASONS.confidence });
    expect(rejectOf({ type: EMBED_DESCRIBE, prompt: 'x', interpretation: { ...jev, model: 7 } })).toEqual({ kind: 'reject', reason: REJECT_REASONS.model });
    expect(rejectOf({ type: EMBED_DESCRIBE, prompt: 'x', interpretation: { ...jev, note: 'n'.repeat(400) } })).toEqual({ kind: 'reject', reason: REJECT_REASONS.note });
    // gültig → accept; keine describe-Nachricht (React DevTools, andere Werkzeuge) → ignore, ohne Antwort
    expect(rejectOf({ type: EMBED_DESCRIBE, prompt: 'Taverne' })).toEqual({ kind: 'accept', command: { prompt: 'Taverne' } });
    expect(rejectOf({ type: 'other' })).toEqual({ kind: 'ignore' });
    expect(rejectOf('nookwright:describe')).toEqual({ kind: 'ignore' });
    // fremder Ursprung oder Absender: nie beantworten, auch bei falscher Form
    const bad = { type: EMBED_DESCRIBE, prompt: '' };
    expect(receiveDescribe(msg(bad, { origin: 'https://evil.example' }), self)).toEqual({ kind: 'ignore' });
    expect(receiveDescribe(msg(bad, { source: {} }), self)).toEqual({ kind: 'ignore' });
  });

  it('R2-05: Gründe sind kurze Sätze in Nutzersprache – ohne Feldnamen des Vertrags, von der Website als Grund lesbar', () => {
    const reasons = Object.values(REJECT_REASONS);
    expect(new Set(reasons).size).toBe(reasons.length);
    for (const r of reasons) {
      expect(r, r).toMatch(/^[A-ZÄÖÜ].*\.$/); // Satz: groß anfangen, mit Punkt enden
      expect(r.length, r).toBeLessThanOrEqual(160); // Grenze der Website (embed-model.js MAX_REASON)
      expect(r, r).toMatch(/\s/); // die Website zeigt nur Gründe mit Leerzeichen (keine Kürzel)
      expect(r, r).not.toMatch(/request|\bop\b|input|source|model\b|note\b|confidence|interpretation|„server“|\w\.\w/);
    }
  });

  it('R1-08: „abgelehnt“ geht nur im iframe an den eigenen Ursprung', () => {
    const { self: framedSelf, posted } = framed();
    expect(announceRejected(framedSelf, REJECT_REASONS.prompt)).toBe(true);
    expect(posted).toEqual([{ message: { type: EMBED_REJECTED, reason: 'Die Beschreibung ist leer.' }, target: ORIGIN }]);
    expect(rejectedMessage('x')).toEqual({ type: 'nookwright:rejected', reason: 'x' });
    const top: { parent: unknown; location: { origin: string } } = { parent: undefined, location: { origin: ORIGIN } };
    top.parent = top;
    expect(announceRejected(top, 'x')).toBe(false);
    const { self: sandboxed, posted: none } = framed('null');
    expect(announceRejected(sandboxed, 'x')).toBe(false);
    expect(none).toEqual([]);
  });

  it('Grenzwerte der Konfidenz 0 und 1 gelten; leere Texte entfallen', () => {
    const it = parseInterpretation({ source: 'local', request: { op: 'building_generate', input: {} }, confidence: { a: 0, b: 1 }, model: ' ', note: '' })!;
    expect(it).toEqual({ source: 'local', request: { op: 'building_generate', input: {} }, confidence: { a: 0, b: 1 } });
  });
});

describe('Übernahme der Website-Erkennung: derselbe Weg wie describeBuilding', () => {
  it('suggestionFor liefert Bautyp und Parameter aus der weitergereichten Anfrage', () => {
    const load = loadBundledCatalog();
    const themeIds = load.themeCatalog!.ids();
    const it = parseInterpretation(jev)!;
    const s = suggestionFor(it.request, load.buildingTypes, themeIds, 'medieval', uc.shellStyle({ roof: uc.DEFAULT_ROOF }))!;
    expect(s.def.id).toBe('tavern');
    expect(s.params).toMatchObject({ size: 'L' });
    expect(s.applied).toEqual(expect.arrayContaining(['groß (L)', '3 Etagen']));
  });
});
