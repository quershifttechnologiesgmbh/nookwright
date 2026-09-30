/**
 * `roomtype_classify` mit Entscheidungsmodell: Ist die NL-Steuerung auf ein System-One-Modell (JEV) eingestellt, fragt
 * der Adapter (HTTP-Server, MCP, `npm run roomtype`) das Modell über `@mcda/classify` – eine `choice`-Frage über alle
 * Raumtypen des Katalogs – und fällt bei Fehler auf die reine Operation (lokaler Klassifikator) zurück. Ohne Modell
 * ist das Ergebnis genau `engine.execute({ op: 'roomtype_classify', … })`.
 */
import { classify } from '@mcda/classify';
import type { Engine, ExecuteResult } from '../engine.js';
import { classifyRoomTypeLocal, roomTypeTask } from '../intent/roomtype.js';
import { ROOMTYPE_CLASSIFY, roomTypeResult } from '../operations/roomtype.js';
import { decisionProviderOf, isDecisionsModel } from './decisions.js';
import type { InterpretOptions } from './openrouter.js';

export { ROOMTYPE_CLASSIFY };

/** Nutzt die Konfiguration ein Entscheidungsmodell (sonst bleibt `roomtype_classify` lokal)? */
export const usesDecisionModel = (opts: InterpretOptions | undefined): opts is InterpretOptions =>
  opts !== undefined && (opts.mode === 'decisions' || (opts.mode === undefined && isDecisionsModel(opts.model)));

/**
 * `roomtype_classify` ausführen: mit Entscheidungsmodell (falls konfiguriert), sonst bzw. bei Fehler lokal
 * (`fallback` nennt den Grund; `opts.fallback === false` → Fehler statt Rückfall). Ungültige Eingabe → wie `execute`.
 */
export async function executeRoomTypeClassify(engine: Engine, input: unknown, opts?: InterpretOptions): Promise<ExecuteResult> {
  const request = { op: ROOMTYPE_CLASSIFY, input } as const;
  if (!usesDecisionModel(opts) || engine.validate(request).length > 0) return engine.execute(request);
  const description = (input as { description: string }).description.trim();
  const vocab = engine.vocabulary;
  try {
    const c = await classify(decisionProviderOf(opts), description, roomTypeTask(vocab), opts.signal !== undefined ? { signal: opts.signal } : {});
    const guess = { roomTypeId: c.label, confidence: c.confidence, ranked: c.ranked.map((r) => ({ roomTypeId: r.label, probability: r.probability })), matched: [] };
    return { ok: true, op: ROOMTYPE_CLASSIFY, data: roomTypeResult(guess, vocab, c.model) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (opts.fallback === false) return { ok: false, op: ROOMTYPE_CLASSIFY, errors: [reason] };
    return { ok: true, op: ROOMTYPE_CLASSIFY, data: roomTypeResult(classifyRoomTypeLocal(description, vocab), vocab, 'local', reason) };
  }
}
