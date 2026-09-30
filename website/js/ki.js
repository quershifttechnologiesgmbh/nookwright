// KI-Architekt (#ki) und Beschreibungsfeld der Startseite – Darstellung und Verdrahtung. Die Logik (Zustände, genau
// eine Anfrage, 429-Sperre, Klemmen, Übergabe) liegt rein in ki-model.js.
// Namen: ki/vocabulary.json (scripts/build-vocabulary.ts – Katalog + Optionstexte des Engine-Schemas). Fehlt die Datei,
// zeigt die Karte die IDs.
import { describeInEditor } from './editor.js';
import {
  OP_LABELS, PROMPT_LIMIT, TIMEOUT_MS, createKiController, describeMessage, interpretationOf, invalidText, isObj, loadingTitle,
  percent, planRows, rateLocked, rowConfidence, secondsLeft, showsConfidence, sourceOf, typeDecision, typeName, waitText,
} from './ki-model.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------------------------- Vokabular

let vocab = null;
let vocabPromise;
function loadVocabulary() {
  vocabPromise ??= fetch('ki/vocabulary.json')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((v) => { vocab = isObj(v) ? v : null; render(); });
  return vocabPromise;
}

// ---------------------------------------------------------------------------------------------- Zustand

const ki = createKiController({
  fetch: (url, init) => fetch(url, init),
  clock: () => performance.now(),
  onChange: () => { render(); announce(); },
});
const state = () => ki.state;

/** Übergabe an den Editor: genau diese Antwort (kein zweiter Modellaufruf) bzw. nur der Text. */
function toEditor(withPlan) {
  const st = state();
  if (st.kind === 'loading') ki.cancel();
  describeInEditor(describeMessage(st.prompt, withPlan && st.kind === 'result' ? interpretationOf(st) : undefined));
  location.hash = 'editor';
}

// ---------------------------------------------------------------------------------------------- Darstellung

const secs = (ms) => (ms < 100 ? '< 0,1 s' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);
const SKELETON_ROWS = ['Bautyp', 'Größe', 'Stil', 'Dach', 'Lage'];
const skeleton = (cls = '') => `<dl class="plan-fields ${cls}">${SKELETON_ROWS.map((l) => `<div class="row"><dt>${l}</dt><dd><span class="skel"></span></dd></div>`).join('')}</dl>`;
const quote = (p) => `<blockquote class="plan-prompt">${esc(p)}</blockquote>`;

function confCell(c) {
  if (c === undefined) return '';
  if (c === 'filled') return '<span class="conf filled" title="Vom lokalen Klassifikator erkannt: vom Modell offen gelassen oder überstimmt">ergänzt</span>';
  const pct = percent(c);
  const level = pct >= 85 ? 'hi' : pct >= 60 ? 'mid' : 'lo';
  return `<span class="conf ${level}" role="img" aria-label="Sicherheit ${pct} Prozent" title="Sicherheit laut Modell"><i style="--v:${pct}%"></i><b>${pct} %</b></span>`;
}

function viewIdle(st) {
  return `<div class="ki-card is-idle">
    <div class="plan-head"><div><span class="eyebrow">Dein Plan</span><h2>Noch nichts beschrieben</h2></div></div>
    <p class="muted">Hier erscheint, was der KI-Architekt aus deiner Beschreibung liest: Gebäudeart, Größe, Stil, Dach und Lage.</p>
    ${st.cancelled ? '<p class="note">Abgebrochen. Deine Beschreibung steht noch im Feld.</p>' : ''}
    ${skeleton('is-skel')}
  </div>`;
}

function viewLoading(st) {
  const s = Math.floor((performance.now() - st.t0) / 1000);
  return `<div class="ki-card is-loading">
    <div class="plan-head"><div><span class="eyebrow">Dein Plan</span><h2>${esc(loadingTitle(ki.lastModel))}</h2></div><span class="elapsed" data-elapsed>${s} s</span></div>
    <div class="progress" aria-hidden="true"><i></i></div>
    ${quote(st.prompt)}
    ${skeleton('is-skel is-shimmer')}
    <p class="note slow" data-slow ${s >= 6 ? '' : 'hidden'}>Das dauert länger als sonst. Du kannst abbrechen und es im Editor versuchen.</p>
    <div class="actions"><button type="button" class="btn ghost" data-action="cancel">Abbrechen</button><button type="button" class="btn ghost" data-action="try" data-slow ${s >= 6 ? '' : 'hidden'}>Im Editor versuchen</button></div>
  </div>`;
}

function viewResult(st) {
  const src = sourceOf(st);
  const badge = `<span class="source ${src.kind}"${src.title ? ` title="${esc(src.title)}"` : ''}>${esc(src.badge)}</span>`;
  const meta = `<span class="elapsed">erkannt in ${secs(st.ms)}</span>`;
  const decision = typeDecision(st, vocab);
  if (decision.kind === 'notype') {
    const who = src.kind === 'local' ? 'Der Server' : src.kind === 'jev' ? 'JEV' : 'Das Modell';
    const known = Object.values(vocab?.buildingTypes ?? {}).filter((t) => !t.draft).map((t) => t.name);
    const uncertain = decision.reason === 'uncertain';
    const why = uncertain
      ? `${who} hat in deiner Beschreibung keine Gebäudeart sicher erkannt. Einen Plan mit einem geratenen Bautyp zeigen wir dir deshalb nicht.`
      : `${who} hat deine Beschreibung als ${esc(OP_LABELS[st.request?.op] ?? 'eine andere Aufgabe')} verstanden. Daraus kann der Bautyp-Assistent keinen fertigen Plan machen.`;
    return `<div class="ki-card is-notype">
      <div class="plan-head"><div><span class="eyebrow">Dein Plan</span><h2>${uncertain ? 'Kein Bautyp sicher erkannt' : 'Kein Bautyp erkannt'}</h2></div><div class="badges">${badge}${meta}</div></div>
      <p>${why}</p>
      ${known.length > 0 ? `<p class="muted">Nenn am besten eine Gebäudeart, zum Beispiel: ${esc(known.slice(0, 8).join(', '))}${uncertain ? ' – oder wähle sie im Editor selbst' : ''}.</p>` : ''}
      ${quote(st.prompt)}
      <div class="actions"><button type="button" class="btn primary" data-action="edit">Beschreibung ändern</button><button type="button" class="btn ghost" data-action="try-plan">${uncertain ? 'Im Editor Bautyp wählen' : 'Im Editor versuchen'}</button></div>
    </div>`;
  }
  const rows = planRows(decision.input, st, vocab);
  const withConf = showsConfidence(st);
  const def = vocab?.buildingTypes?.[decision.typeId];
  return `<div class="ki-card is-result">
    <div class="plan-head"><div><span class="eyebrow">Dein Plan</span><h2>${esc(typeName(vocab, decision.typeId))}</h2></div><div class="badges">${badge}${meta}</div></div>
    ${src.note ? `<p class="note">${esc(src.note)}</p>` : ''}
    <dl class="plan-fields${withConf ? ' with-conf' : ''}">
      ${rows.map((r) => `<div class="row"><dt>${esc(r.label)}</dt><dd><span class="val">${esc(r.value)}${r.pending ? ' <span class="pending">noch nicht baubar</span>' : ''}</span>${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</dd>${withConf ? `<dd class="c">${confCell(rowConfidence(r, st.confidence))}</dd>` : ''}</div>`).join('')}
    </dl>
    ${withConf ? '<p class="legend">Balken: wie sicher sich das Modell bei jeder Angabe ist. Was die Beschreibung offen lässt, wählt der Generator selbst.</p>' : ''}
    ${quote(st.prompt)}
    <div class="actions"><button type="button" class="btn primary" data-action="build">Im Editor bauen</button><button type="button" class="btn ghost" data-action="edit">Beschreibung ändern</button></div>
    <p class="fine">Der Editor öffnet den Bautyp-Assistenten mit diesem Plan${def?.draft ? ' (Entwurfs-Bautyp)' : ''}. Dort passt du alles an und exportierst.</p>
  </div>`;
}

function viewError(st) {
  if (st.reason === 'rate') {
    const left = secondsLeft(st, Date.now());
    const wait = waitText(left, Date.now());
    if (wait.long) {
      // Tageskontingent o. Ä.: keine Sekunden zählen, sondern Uhrzeit nennen und auf den Editor verweisen (R2-04)
      return `<div class="ki-card is-error">
      <div class="plan-head"><div><span class="eyebrow">Für heute ausgeschöpft</span><h2>Im Editor geht es weiter</h2></div></div>
      <p>Der KI-Architekt nimmt heute keine weiteren Beschreibungen an. Wieder möglich in ${esc(wait.text)}.</p>
      <p class="muted">Bis dahin erkennt der Editor deine Beschreibung selbst, direkt im Browser.</p>
      ${quote(st.prompt)}
      <div class="actions"><button type="button" class="btn primary" data-action="try">Im Editor versuchen</button></div>
    </div>`;
    }
    return `<div class="ki-card is-error">
      <div class="plan-head"><div><span class="eyebrow">Kurz warten</span><h2>Zu viele Anfragen</h2></div></div>
      <p>Der KI-Architekt nimmt gerade keine weiteren Beschreibungen an. ${left > 0 ? `Bitte versuch es in <b data-left>${wait.text}</b> noch einmal.` : 'Du kannst es jetzt noch einmal versuchen.'}</p>
      ${quote(st.prompt)}
      <div class="actions"><button type="button" class="btn primary" data-action="retry" ${left > 0 ? 'disabled' : ''}>Nochmal senden</button><button type="button" class="btn ghost" data-action="try">Im Editor versuchen</button></div>
    </div>`;
  }
  if (st.reason === 'timeout') {
    return `<div class="ki-card is-error">
      <div class="plan-head"><div><span class="eyebrow">Keine Antwort</span><h2>Das hat zu lange gedauert</h2></div></div>
      <p>Der KI-Server hat nicht innerhalb von ${TIMEOUT_MS / 1000} Sekunden geantwortet. Versuch es noch einmal, oder lass den Editor die Beschreibung erkennen.</p>
      ${quote(st.prompt)}
      <div class="actions"><button type="button" class="btn primary" data-action="retry">Nochmal versuchen</button><button type="button" class="btn ghost" data-action="try">Im Editor versuchen</button></div>
    </div>`;
  }
  if (st.reason === 'invalid') {
    return `<div class="ki-card is-error">
      <div class="plan-head"><div><span class="eyebrow">Kein gültiger Plan</span><h2>Daraus wird noch nichts</h2></div></div>
      <p>${esc(invalidText(st.message, vocab))} Formulier deine Beschreibung etwas anders, am besten mit einer Gebäudeart und einem Stil.</p>
      ${quote(st.prompt)}
      <div class="actions"><button type="button" class="btn primary" data-action="edit">Beschreibung ändern</button><button type="button" class="btn ghost" data-action="try">Im Editor versuchen</button></div>
    </div>`;
  }
  if (st.reason === 'unavailable') {
    return `<div class="ki-card is-error">
      <div class="plan-head"><div><span class="eyebrow">Gerade nicht verfügbar</span><h2>Im Editor geht es trotzdem</h2></div></div>
      <p>Der KI-Architekt kann deine Beschreibung gerade nicht auswerten. Der Editor erkennt sie dann selbst.</p>
      ${quote(st.prompt)}
      <div class="actions"><button type="button" class="btn primary" data-action="try">Im Editor versuchen</button><button type="button" class="btn ghost" data-action="retry">Nochmal versuchen</button></div>
    </div>`;
  }
  return `<div class="ki-card is-error">
    <div class="plan-head"><div><span class="eyebrow">Ohne KI-Server</span><h2>Im Editor geht es trotzdem</h2></div></div>
    <p>KI-Server nicht erreichbar – der Editor erkennt deine Beschreibung dann lokal im Browser.</p>
    ${quote(st.prompt)}
    <div class="actions"><button type="button" class="btn primary" data-action="try">Im Editor versuchen</button><button type="button" class="btn ghost" data-action="retry">Nochmal versuchen</button></div>
  </div>`;
}

let tick;
function render() {
  const box = $('kiResult');
  if (!box) return;
  const st = state();
  box.innerHTML = st.kind === 'loading' ? viewLoading(st) : st.kind === 'result' ? viewResult(st) : st.kind === 'error' ? viewError(st) : viewIdle(st);
  box.setAttribute('aria-busy', String(st.kind === 'loading'));
  const locked = rateLocked(st, Date.now());
  for (const b of document.querySelectorAll('[data-submit]')) {
    b.disabled = st.kind === 'loading' || locked;
    if (b.id === 'kiSubmit') b.textContent = st.kind === 'loading' ? 'Wird geplant …' : 'Plan erstellen';
  }
  clearInterval(tick);
  if (st.kind === 'loading' || locked) tick = setInterval(onTick, 1000);
}

/** Sekundenanzeige (Laden) bzw. Rückwärtszähler (429), ohne die Karte neu aufzubauen. */
function onTick() {
  const st = state();
  if (st.kind === 'loading') {
    const s = Math.floor((performance.now() - st.t0) / 1000);
    const el = document.querySelector('#kiResult [data-elapsed]');
    if (el) el.textContent = `${s} s`;
    if (s >= 6) for (const x of document.querySelectorAll('#kiResult [data-slow]')) x.hidden = false;
  } else if (rateLocked(st, Date.now())) {
    const el = document.querySelector('#kiResult [data-left]');
    const w = waitText(secondsLeft(st, Date.now()), Date.now());
    if (el && !w.long) el.textContent = w.text;
  } else render();
}

/** Kurze Ansage für Screenreader (die Karte selbst wird nicht vorgelesen). */
function announce() {
  const el = $('kiStatus');
  if (!el) return;
  const st = state();
  if (st.kind === 'loading') el.textContent = loadingTitle(ki.lastModel);
  else if (st.kind === 'result') {
    const d = typeDecision(st, vocab);
    el.textContent = d.kind === 'plan' ? `Plan erstellt: ${typeName(vocab, d.typeId)}.` : 'Kein Bautyp erkannt.';
  } else if (st.kind === 'error') {
    el.textContent = ({ rate: 'Zu viele Anfragen, bitte kurz warten.', timeout: 'Keine Antwort vom KI-Server.', invalid: 'Kein gültiger Plan.', unavailable: 'Der KI-Architekt ist gerade nicht verfügbar.', offline: 'KI-Server nicht erreichbar.' })[st.reason] ?? '';
  } else el.textContent = st.cancelled ? 'Abgebrochen.' : '';
}

// ---------------------------------------------------------------------------------------------- Eingabe

/**
 * Mehrzeiliges Feld: Enter sendet, Umschalt+Enter macht eine neue Zeile; Zeichenzähler; Leer-Prüfung ohne Anfrage.
 * Der Knopf ist `type="button"` und das Formular wird nie nativ abgeschickt (kein GET mit der Beschreibung in der URL).
 */
function bindComposer(form, onSubmit) {
  const ta = form.querySelector('textarea');
  const count = form.querySelector('.count');
  const err = form.querySelector('.field-error');
  const button = form.querySelector('[data-submit]');
  const clearError = () => { err.hidden = true; ta.removeAttribute('aria-invalid'); };
  // Feld ohne Griff (Startseite) wächst mit dem Text bis zu seiner max-height
  const grow = getComputedStyle(ta).resize === 'none';
  const update = () => {
    if (grow) { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; }
    const n = ta.value.length;
    count.textContent = `${n} / ${PROMPT_LIMIT}`;
    count.classList.toggle('near', n >= PROMPT_LIMIT * 0.9);
    if (n > 0) clearError();
  };
  const submit = () => {
    const text = ta.value.trim();
    if (text === '') {
      err.textContent = 'Beschreib zuerst, was gebaut werden soll – zum Beispiel „Kleine Taverne mit Flachdach“.';
      err.hidden = false;
      ta.setAttribute('aria-invalid', 'true');
      ta.focus();
      return;
    }
    onSubmit(text);
  };
  ta.addEventListener('input', update);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
  });
  button.addEventListener('click', submit);
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  update();
  return {
    set(text) { ta.value = text.slice(0, PROMPT_LIMIT); update(); },
    focus() { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); },
  };
}

function revealResult(focus) {
  const box = $('kiResult');
  if (!box) return;
  box.scrollIntoView({ block: 'nearest' });
  if (focus) box.focus({ preventScroll: true });
}

let composer;
function bindKi() {
  if (composer) return composer;
  composer = bindComposer($('kiForm'), (text) => { ki.interpret(text); revealResult(false); });
  for (const b of document.querySelectorAll('.ki-examples .example')) {
    b.addEventListener('click', () => { const t = b.textContent.trim(); composer.set(t); ki.interpret(t); revealResult(false); });
  }
  $('kiResult').addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'cancel') ki.cancel();
    else if (action === 'retry') ki.interpret(state().prompt ?? '');
    else if (action === 'edit') composer.focus();
    else if (action === 'build' || action === 'try-plan') toEditor(true);
    else if (action === 'try') toEditor(false);
  });
  loadVocabulary();
  render();
  return composer;
}

let revealOnShow = false;
/** Route #ki betreten. */
export function showKi() {
  bindKi();
  render();
  if (revealOnShow) {
    revealOnShow = false;
    requestAnimationFrame(() => revealResult(true));
  }
}

let heroBound = false;
/** Beschreibungsfeld der Startseite: derselbe Ablauf wie #ki (dieselbe Steuerung, eine Anfrage), Ergebnis auf #ki. */
export function bindHero() {
  if (heroBound) return;
  heroBound = true;
  const start = (text) => {
    bindKi().set(text);
    revealOnShow = true;
    ki.interpret(text);
    location.hash = 'ki';
  };
  const form = $('heroForm');
  const hero = bindComposer(form, start);
  for (const b of form.querySelectorAll('.example')) {
    b.addEventListener('click', () => { const t = b.textContent.trim(); hero.set(t); start(t); });
  }
  loadVocabulary();
}
