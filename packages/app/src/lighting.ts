/**
 * Use Case „Licht ergänzen“: der Licht-Pass des Anwendungsdienstes (`lightRooms` aus @mcda/pipeline) für die
 * Sitzung. Rein bis auf den Kontext (Plattform-Daten der Zielversion müssen geladen sein).
 *
 * Ablauf in der App: Jede Aktion (Malen, Neu würfeln, Raumtyp, Theme …) setzt `needsLight`. Danach ergänzt
 * `lightSession` Lichtquellen (`FurnishingSupplemented`), bis jede begehbare Zelle Blocklicht ≥ 1 hat und das
 * Stimmungs-Ziel des Raumtyps erreicht ist. Die Events hängen an der letzten Aktion: Undo nimmt beides zurück.
 * Vorschau und Export lesen denselben Projektzustand – sie enthalten also dieselben Lichter.
 */
import { Project } from '@mcda/blueprint';
import { blockRulesContext, decorRooms, lightRooms, type LightingResult, type PipelineContext, type World } from '@mcda/pipeline';
import { rememberWorld } from './exporting.js';
import { configureEnsemble, errorMessage, exteriorOf, shellOf, shellThemeOf, shellStyle, type LightSummary, type Session } from './usecases.js';

export interface LitSession {
  readonly session: Session;
  /** Blöcke nach dem Pass (gehören zu `session.project.state`); `undefined`, wenn nichts zu tun war oder der Pass fehlschlug. */
  readonly world?: World;
}

export function summarize(r: LightingResult): LightSummary {
  return {
    added: r.rooms.reduce((n, x) => n + x.added, 0),
    darkCells: r.rooms.reduce((n, x) => n + x.darkCells, 0),
    warnings: r.warnings,
    notes: r.notes,
  };
}

/**
 * Licht-Pass für alle Räume (Räume ohne Bedarf bekommen nichts). Keine neue Undo-Stufe: Die Ergänzungen gehören
 * zur Aktion davor. Fehler (z. B. ungültiges Theme) landen in `session.light.error`, die Sitzung bleibt benutzbar.
 * Außen-Deko (C4): Ihre Laternen leuchten durch Fenster und Türen herein und zählen mit (`exterior` des Passes, wie
 * `generate`) – der Pass ergänzt dort keine überflüssige Lampe; seine Welt enthält die Außen-Teile schon und wird für
 * `worldOf` gemerkt, Vorschau „Blöcke“ und Export materialisieren nicht noch einmal.
 */
export function lightSession(s: Session, ctx: PipelineContext): LitSession {
  if (!s.needsLight) return { session: s };
  const next = Project.fromHistory(s.project.history);
  const style = shellStyle(s);
  configureEnsemble(ctx);
  let result: LightingResult;
  try {
    const exterior = exteriorOf(next, ctx.catalog, style)?.placements ?? [];
    // W3-BL: Licht-Pass mit den Block-Regeln (Lichtarten ohne gesperrte Blöcke, Ersatz gleich hell) – wie `generateWith`
    const shell = shellOf(next, style, shellThemeOf(ctx.catalog, next.state.themeId));
    const lightCtx = blockRulesContext(ctx, style.blockRules);
    // feat/int-decor: Innen-Deko vor dem Licht (wie `generateWith`); ohne Stufe kein Eingriff
    if (next.state.interiorDecor !== undefined) decorRooms(next, shell, lightCtx);
    result = lightRooms(next, shell, lightCtx, exterior.length > 0 ? { exterior } : {});
  } catch (e) {
    return { session: { ...s, needsLight: false, light: { added: 0, darkCells: 0, warnings: [], notes: [], error: errorMessage(e) } } };
  }
  const project = next.history.length === s.project.history.length ? s.project : next;
  rememberWorld(project, ctx, style, result.world);
  return { session: { ...s, project, needsLight: false, light: summarize(result) }, world: result.world };
}

/** Kurztext fürs Projekt-Panel (Zeile „Licht“), z. B. „+3 ergänzt · keine dunklen Stellen“. */
export function lightStatus(light: LightSummary | undefined, pending: boolean): string {
  if (pending) return 'wird geprüft …';
  if (light === undefined) return 'noch nicht geprüft';
  if (light.error !== undefined) return `Licht-Pass fehlgeschlagen: ${light.error}`;
  const added = light.added > 0 ? `+${light.added} ergänzt · ` : '';
  const dark = light.darkCells === 0 ? 'keine dunklen Stellen' : `${light.darkCells} dunkle Zelle${light.darkCells === 1 ? '' : 'n'}`;
  return `${added}${dark}`;
}
