// Hash-Route lesen (rein, getestet in website/test/hash.test.ts).

/** Hash → Wort; kaputte Prozent-Kodierung (`#%E0%A4%A`) bricht das Routing nicht, sie führt zur Startseite. */
export function hashWord(raw) {
  const h = String(raw ?? '').replace(/^#/, '');
  try { return decodeURIComponent(h); } catch { return ''; }
}
