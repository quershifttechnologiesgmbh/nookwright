// Optional Clerk accounts. Building and downloading remain available without signing in.
import { parsePublishableKey } from './auth-config.js';

let pending;
let clerk;
let userButtonMounted = false;
const byId = id => document.getElementById(id);

function setStatus(message, error = false) {
  const el = byId('accountStatus');
  if (el) { el.textContent = message; el.classList.toggle('field-error', error); }
}

function loadScript(src, attributes = {}) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(() => { script.remove(); reject(new Error('Clerk script timed out')); }, 15000);
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error('Clerk script unavailable')); };
    document.head.appendChild(script);
  });
}

function renderAccount() {
  const signedIn = Boolean(clerk?.isSignedIn);
  byId('accountSignIn').hidden = signedIn;
  byId('accountSignedIn').hidden = !signedIn;
  byId('accountName').textContent = clerk?.user?.fullName || clerk?.user?.username || 'Dein Konto';
  if (signedIn && !userButtonMounted) {
    clerk.mountUserButton(byId('accountUserButton'));
    userButtonMounted = true;
  } else if (!signedIn && userButtonMounted) {
    clerk.unmountUserButton(byId('accountUserButton'));
    userButtonMounted = false;
  }
  setStatus(signedIn ? 'Du bist angemeldet.' : 'Melde dich an oder erstelle ein kostenloses Konto.');
}

async function initialize() {
  const response = await fetch(new URL('../config/auth.json', import.meta.url), { cache: 'no-store' });
  if (!response.ok) throw new Error('Account configuration unavailable');
  const config = await response.json();
  if (!config.enabled) {
    setStatus('Die Konto-Anmeldung ist hier noch nicht eingerichtet. Du kannst direkt im Editor bauen.');
    byId('accountSignIn').hidden = true;
    return;
  }
  const { domain, publishableKey } = parsePublishableKey(config.publishableKey);
  setStatus('Anmeldung wird geladen …');
  await loadScript(`https://${domain}/npm/@clerk/ui@1/dist/ui.browser.js`);
  await loadScript(`https://${domain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, { 'data-clerk-publishable-key': publishableKey });
  clerk = window.Clerk;
  if (!clerk || !window.__internal_ClerkUICtor) throw new Error('Clerk unavailable');
  await clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor }, telemetry: { disabled: true } });
  clerk.addListener(renderAccount);
  renderAccount();
}

export async function showAccount() {
  if (!pending) pending = initialize().catch(() => {
    pending = undefined;
    setStatus('Die Anmeldung ist gerade nicht erreichbar. Versuche es erneut oder starte direkt im Editor.', true);
    byId('accountRetry').hidden = false;
  });
  await pending;
}

byId('accountSignIn')?.addEventListener('click', () => {
  if (!clerk) return;
  const redirect = `${location.origin}${location.pathname}#konto`;
  clerk.openSignIn({ forceRedirectUrl: redirect, signUpForceRedirectUrl: redirect });
});
byId('accountProfile')?.addEventListener('click', () => clerk?.openUserProfile());
byId('accountSignOut')?.addEventListener('click', async () => {
  try { await clerk?.signOut(); } catch { setStatus('Abmelden ist gerade nicht möglich. Versuche es erneut.', true); }
});
byId('accountRetry')?.addEventListener('click', () => {
  byId('accountRetry').hidden = true;
  showAccount();
});
