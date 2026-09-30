import { useRef, type ReactNode } from 'react';
import { PROJECT_FILE_EXT } from '../projectFile.js';
import { DropMenu, MenuItem, MenuLabel } from './Menu.js';
import { NameField } from './Sidebar.js';
import { shortcutHint } from './shortcuts.js';

/**
 * Kopfleiste (W2-ED U2, Konzept W2UX §3): Marke · Projektname · Neu ▾ · ↶ ↷ · Exportieren · ⋯. Speichern geschieht
 * automatisch (Strg+S bleibt); Laden, Datei, Texturen, Tastenkürzel und Projekt-Info stehen im Menü „⋯“.
 */
export function Header(p: {
  readonly brand: ReactNode;
  readonly name: string;
  readonly onRename: (name: string) => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  /** Assistent (Beschreiben / Bautyp); `false` ohne Bautypen im Katalog. */
  readonly canWizard: boolean;
  readonly onWizard: () => void;
  readonly onNewEmpty: () => void;
  readonly onOpenFile: (file: File) => void;
  /** Grund, warum der Export gesperrt ist. */
  readonly exportBlocked: string | undefined;
  readonly onExport: () => void;
  readonly storeAvailable: boolean;
  /** Was im Browser liegt („Taverne · 26.09.26, 14:02“); `undefined` = nichts. */
  readonly stored: string | undefined;
  readonly onSaveLocal: () => void;
  readonly onLoadLocal: () => void;
  readonly onSaveFile: () => void;
  /** DR5 K4: Link mit Bautyp, Seed und Parametern kopieren. */
  readonly onShareLink?: () => void;
  readonly onHelp: () => void;
  readonly onInfo: () => void;
  /** W7-G (U8): Befehlssuche (Strg+K). */
  readonly onPalette: () => void;
  readonly children?: ReactNode;
}) {
  const file = useRef<HTMLInputElement>(null);
  return (
    <header className="topbar">
      {p.brand}
      <NameField className="name-input" name={p.name} onRename={p.onRename} />
      <div className="topbar-actions">
        <DropMenu label={<>Neu <span className="caret">▾</span></>} title="Neues Projekt: beschreiben, Bautyp wählen, leer beginnen oder Datei öffnen">
          {(close) => (
            <>
              <MenuItem close={close} onSelect={p.onWizard} disabled={!p.canWizard} hint="Taverne, Stadthaus …">
                Beschreiben oder Bautyp …
              </MenuItem>
              <MenuItem close={close} onSelect={p.onNewEmpty} hint="selbst Räume malen">
                Leeres Projekt
              </MenuItem>
              <MenuItem close={close} onSelect={() => file.current?.click()} hint={`*${PROJECT_FILE_EXT}`} title="Projektdatei öffnen (Rückgängig kehrt zurück)">
                Datei öffnen …
              </MenuItem>
            </>
          )}
        </DropMenu>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f !== undefined) p.onOpenFile(f);
          }}
        />
        <button type="button" className="icon-button" onClick={p.onUndo} disabled={!p.canUndo} title={`Rückgängig (${shortcutHint('undo')})`} aria-label="Rückgängig">
          ↶
        </button>
        <button type="button" className="icon-button" onClick={p.onRedo} disabled={!p.canRedo} title={`Wiederholen (${shortcutHint('redo')})`} aria-label="Wiederholen">
          ↷
        </button>
        <span className="tooltip-host" title={p.exportBlocked ?? 'Format und Zielversion wählen, Verstöße prüfen, herunterladen'}>
          <button type="button" className="primary" disabled={p.exportBlocked !== undefined} onClick={p.onExport}>
            Exportieren
          </button>
        </span>
        <DropMenu label="⋯" ariaLabel="Mehr" title="Speichern und Laden, Datei, Texturen, Tastenkürzel, Projekt-Info">
          {(close) => (
            <>
              <MenuLabel>Projekt</MenuLabel>
              <MenuItem close={close} onSelect={p.onSaveLocal} disabled={!p.storeAvailable} hint={shortcutHint('save')} title="Im Browser speichern (ein Speicherplatz; der Editor speichert ohnehin automatisch)">
                Im Browser speichern
              </MenuItem>
              <MenuItem close={close} onSelect={p.onLoadLocal} disabled={p.stored === undefined} title={p.stored === undefined ? 'Nichts gespeichert' : `Laden: ${p.stored} (Rückgängig kehrt zurück)`}>
                Gespeicherten Stand laden
              </MenuItem>
              <MenuItem close={close} onSelect={p.onSaveFile} title={`Projekt als Datei (*${PROJECT_FILE_EXT}) herunterladen`}>
                Als Datei speichern …
              </MenuItem>
              {p.onShareLink !== undefined && (
                <MenuItem close={close} onSelect={p.onShareLink} title="Link kopieren: Bautyp, Seed und Parameter im Link (keine Namen, keine eigenen Änderungen) – wer ihn öffnet, bekommt denselben Bau">
                  Link teilen
                </MenuItem>
              )}
              <MenuLabel>Hilfe</MenuLabel>
              <MenuItem close={close} onSelect={p.onPalette} hint={shortcutHint('palette')} title="Jede Einstellung und jeden Befehl per Suche finden (Tastatur: ↑ ↓ Enter)">
                Befehlssuche
              </MenuItem>
              <MenuItem close={close} onSelect={p.onHelp} hint={shortcutHint('help')}>
                Tastenkürzel
              </MenuItem>
              <MenuItem close={close} onSelect={p.onInfo} title="Seed, Räume und Möbel, Licht, Texturen (eigenes Minecraft-JAR), Katalog">
                Projekt-Info und Texturen …
              </MenuItem>
            </>
          )}
        </DropMenu>
      </div>
      {p.children}
    </header>
  );
}
