/**
 * W11-B: Arbeit erst nach dem nächsten gezeichneten Bild starten. Lange, synchrone Schritte (Übernehmen eines Bautyps:
 * alle Räume einrichten) blockieren den Hauptfaden; ohne diesen Umweg sieht man die Rückmeldung („Wird gebaut …“)
 * erst, wenn alles fertig ist (R6: Erdhaus bis 30 s ohne Anzeige). `requestAnimationFrame` läuft vor dem Zeichnen,
 * der `setTimeout` darin nach dem Zeichnen. Ohne `requestAnimationFrame` (Tests, Hintergrund-Tab) nur `setTimeout`.
 */
export interface FrameScheduler {
  readonly requestAnimationFrame?: ((cb: () => void) => unknown) | undefined;
  readonly setTimeout: (cb: () => void, ms: number) => unknown;
}

export function afterPaint(work: () => void, env: FrameScheduler = globalThis as unknown as FrameScheduler): void {
  const later = (): void => void env.setTimeout(work, 0);
  if (typeof env.requestAnimationFrame === 'function') env.requestAnimationFrame(later);
  else later();
}
