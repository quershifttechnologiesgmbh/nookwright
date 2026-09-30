// Route #editor: der echte Editor (packages/app, von scripts/build.mjs nach editor/ gebaut) in einem iframe.
// Das iframe entsteht beim ersten Besuch und wird beim Verlassen nur versteckt – Projekt, Ansicht und Undo bleiben,
// bis die Seite neu geladen wird. Das Protokoll (ready/describe/rejected) steckt rein in embed-model.js.
import { createEmbedBridge } from './embed-model.js';
import { toast } from './site.js';

const SRC = 'editor/index.html?embed=1';

let frame;
const bridge = createEmbedBridge({
  origin: location.origin,
  frameWindow: () => frame?.contentWindow ?? undefined,
  notify: (text) => toast(text, 7000),
});
// Listener vor dem Laden des iframes: `ready` kommt genau einmal je Laden
addEventListener('message', (e) => { bridge.handleMessage(e); });

/**
 * Beschreibung an den Editor übergeben – `message` aus `describeMessage` (ki-model.js): mit `interpretation` übernimmt
 * der Editor den Plan ohne zweiten Modellaufruf, ohne erkennt er die Beschreibung selbst.
 */
export function describeInEditor(message) {
  bridge.describe(message);
}

function focusFrame() {
  if (frame && !frame.hidden) frame.focus();
}

/** Route #editor betreten: iframe beim ersten Mal anlegen, sonst nur wieder zeigen. */
export function showEditor() {
  if (frame !== undefined) { focusFrame(); return; }
  const host = document.getElementById('editorHost');
  const loading = document.getElementById('editorLoading');
  const text = document.getElementById('editorLoadingText');
  frame = document.createElement('iframe');
  frame.className = 'editor-frame';
  frame.title = 'Nookwright-Editor';
  frame.src = SRC;
  frame.addEventListener('load', () => {
    // Build ohne Editor: der Server liefert eine Fehlerseite statt der App (kein #root) – ehrlich sagen
    let app = true;
    try { app = frame.contentDocument?.getElementById('root') != null; } catch { /* anderer Ursprung: nicht prüfbar */ }
    if (!app) {
      text.textContent = 'Der Editor ist in diesem Build nicht enthalten. Bauen mit: npm run web:build';
      loading.classList.add('failed');
      frame.hidden = true;
      return;
    }
    loading.hidden = true;
    bridge.frameLoaded();
    if (!document.querySelector('[data-page="editor"]').hidden) focusFrame();
  });
  host.appendChild(frame);
}

/** Route #editor verlassen: iframe bleibt im Dokument (die Sektion wird nur versteckt). */
export function hideEditor() {
  if (frame && document.activeElement === frame) frame.blur();
}
