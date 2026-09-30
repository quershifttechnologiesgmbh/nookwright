/**
 * `roomtype_classify`: Raumbeschreibung → Raumtyp-ID mit Konfidenz. Rein ausgeführt = lokaler Klassifikator
 * (Katalognamen + Schlüsselwörter, `../intent/roomtype.ts`). Der HTTP-Server und der MCP-Server fragen bei
 * konfiguriertem System-One-Modell (JEV über `@mcda/classify`) zuerst das Modell und fallen bei Fehler hierauf zurück
 * (`src/node/roomtype.ts`); die Antwort hat in beiden Fällen dieselbe Form.
 */
import { z } from 'zod';
import { classifyRoomTypeLocal, type RoomTypeGuess } from '../intent/roomtype.js';
import { defineOperation, type Json } from '../operation.js';
import type { Vocabulary } from '../vocabulary.js';

export const ROOMTYPE_CLASSIFY = 'roomtype_classify';

/** Antwort von `roomtype_classify` (lokal und per Modell gleich). */
export function roomTypeResult(g: RoomTypeGuess, vocab: Vocabulary, model: string, fallback?: string): Json {
  const name = (id: string | null): string | null => (id === null ? null : vocab.roomTypes.find((r) => r.id === id)?.name ?? id);
  return {
    roomTypeId: g.roomTypeId,
    name: name(g.roomTypeId),
    confidence: Math.round(g.confidence * 1000) / 1000,
    ranked: g.ranked.slice(0, 5).map((r) => ({ roomTypeId: r.roomTypeId, name: name(r.roomTypeId), probability: Math.round(r.probability * 1000) / 1000 })),
    model,
    ...(g.matched.length > 0 ? { matched: [...g.matched] } : {}),
    ...(fallback !== undefined ? { fallback } : {}),
  };
}

export const roomtypeClassify = defineOperation({
  id: ROOMTYPE_CLASSIFY,
  summary: 'Ordnet eine Raumbeschreibung („Raum voller Bücher“) einem Raumtyp aus dem Katalog zu (ID, Name, Konfidenz, Kandidaten). Wählen, wenn der Nutzer einen Raum beschreibt und den passenden Raumtyp sucht.',
  cacheable: true,
  input: () => z.object({
    description: z.string().trim().min(1).max(2000).describe('Freitext-Beschreibung eines Raums (Deutsch oder Englisch), z. B. „gemütlicher Raum voller Bücher“'),
  }).strict(),
  run: (i, _ctx, vocab) => ({ data: roomTypeResult(classifyRoomTypeLocal(i.description, vocab), vocab, 'local') }),
});
