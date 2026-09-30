// Website-Rahmen: Hash-Router (#editor, #galerie, #bau-<id>, #ki …), Navigation, Downloads und Seitentitel.
// Routen sind schlichte Hash-Wörter (Buchstaben, Ziffern, - . _ ~), damit Links auch in eingebetteten Vorschauen gehen.
import { hashWord } from './hash.js';

const PAGES = {
  start: { title: 'Nookwright – Du planst. Es baut. Du ziehst ein.', nav: 'start' },
  editor: { title: 'Editor – Nookwright', nav: 'editor' },
  galerie: { title: 'Galerie – Nookwright', nav: 'galerie' },
  bau: { title: 'Galerie – Nookwright', nav: 'galerie' },
  ki: { title: 'KI-Architekt – Nookwright', nav: 'ki' },
  roadmap: { title: 'Roadmap – Nookwright', nav: 'roadmap' },
  konto: { title: 'Dein Konto – Nookwright', nav: 'konto' },
  'ueber-uns': { title: 'Über uns – Nookwright', nav: '' },
  presse: { title: 'Presse – Nookwright', nav: '' },
  kontakt: { title: 'Kontakt – Nookwright', nav: '' },
  impressum: { title: 'Impressum – Nookwright', nav: '' },
  datenschutz: { title: 'Datenschutz – Nookwright', nav: '' },
  nutzungsbedingungen: { title: 'Nutzungsbedingungen – Nookwright', nav: '' },
};

const pages = [...document.querySelectorAll('[data-page]')];
const nav = document.querySelector('.nav');
const menuBtn = document.querySelector('.menu-btn');
let current = '';

function setMenu(open) {
  nav?.classList.toggle('open', open);
  menuBtn?.setAttribute('aria-expanded', String(open));
}

function route() {
  const hash = hashWord(location.hash);
  let page = hash === '' ? 'start' : hash;
  let param = '';
  if (page.startsWith('bau-')) { param = page.slice(4); page = 'bau'; }
  // unbekanntes Wort = Anker auf der Startseite (z. B. #loslegen, #faq)
  const anchor = PAGES[page] ? '' : hash;
  if (!PAGES[page]) page = 'start';

  const prev = current;
  const changed = page !== current;
  current = page;
  for (const el of pages) el.hidden = el.dataset.page !== page;
  // Editor: volle Fläche für das iframe, Navigation und Fuß der Website ausgeblendet (Zustand des Editors bleibt)
  document.body.classList.toggle('editor-mode', page === 'editor');
  document.title = PAGES[page].title;
  for (const a of document.querySelectorAll('.nav-links a')) {
    if (a.dataset.nav === PAGES[page].nav) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  setMenu(false);

  if (page === 'start') {
    import('./home.js').then((m) => m.startHome());
    import('./ki.js').then((m) => m.bindHero());
  }
  if (page === 'galerie') import('./gallery.js').then((m) => m.showGrid());
  if (page === 'bau') import('./gallery.js').then((m) => m.showDetail(param));
  if (page === 'ki') import('./ki.js').then((m) => m.showKi());
  if (page === 'konto') import('./auth.js').then((m) => m.showAccount());
  if (page === 'editor') import('./editor.js').then((m) => m.showEditor());
  else if (prev === 'editor') import('./editor.js').then((m) => m.hideEditor());

  if (anchor) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView());
  // Seitenwechsel: sofort nach oben (weiches Scrollen gilt nur für Sprünge innerhalb einer Seite)
  else if (changed) window.scrollTo({ top: 0, behavior: 'instant' });
}

addEventListener('hashchange', route);
menuBtn?.addEventListener('click', () => setMenu(!nav?.classList.contains('open')));
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && nav?.classList.contains('open')) { setMenu(false); menuBtn?.focus(); }
});
addEventListener('click', (e) => {
  if (nav?.classList.contains('open') && !nav.contains(e.target)) setMenu(false);
});
// Prevent native prompt submissions while preserving Clerk's own form handling.
document.addEventListener('submit', (e) => {
  if (e.target instanceof HTMLFormElement && ['heroForm', 'kiForm'].includes(e.target.id)) e.preventDefault();
}, true);
// Navigation bekommt beim Scrollen einen festen Hintergrund (Text läuft sonst unter Logo und Knöpfen durch)
const onScroll = () => nav?.classList.toggle('scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true });
onScroll();
// „Zum Inhalt springen“: Fokus auf den Inhalt, ohne den Hash (= die Route) zu ändern
document.querySelector('.skip')?.addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('top')?.focus();
});
route();

// ---------------------------------------------------------------------------------------------- Hinweise

export function toast(text, ms = 4200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ---------------------------------------------------------------------------------------------- Downloads

/** Datei speichern (Blob + <a download>). Der Editor lädt seine Exporte im eigenen iframe selbst herunter. */
export function saveFile(name, bytes) {
  const url = URL.createObjectURL(new Blob([bytes]));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
