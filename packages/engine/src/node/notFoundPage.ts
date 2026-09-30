/**
 * 404-Seite der Website mit Pflicht-Hinweis (HANDOFF §1) – eine Quelle für den Node-Server (`site.ts`, dynamisch) und
 * den Build (`website/scripts/build.mjs` schreibt sie als `dist/404.html`; Vercel liefert sie für unbekannte Pfade).
 */
import { EXPORT_DISCLAIMER } from '@mcda/pipeline';

export const NOT_FOUND_PAGE = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nicht gefunden</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5">
<h1>Seite nicht gefunden</h1>
<p>Diese Adresse gibt es hier nicht. <a href="/">Zur Startseite</a></p>
<p style="font-size:.75rem;color:#666">${EXPORT_DISCLAIMER}</p>
</body></html>
`;
