/**
 * Goldene Galerie (P0-A): statische HTML-Seiten (rein): Kontaktbogen eines Laufs und Vergleich zweier Läufe.
 * Ohne externe Bibliotheken, relativ verlinkte Bilder – die Seiten funktionieren direkt von der Platte (file://).
 */

export interface SheetView {
  readonly name: string;
  readonly label: string;
  readonly group: string;
  /** relativ zur Seite */
  readonly image: string;
  readonly thumb: string;
}

export interface SheetRow {
  readonly id: string;
  readonly title: string;
  /** kurze Fakten (Blöcke, Größe, Etagen …) */
  readonly facts: readonly string[];
  readonly views: readonly SheetView[];
}

export interface SheetMeta {
  readonly title: string;
  readonly lines: readonly string[];
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const BASE_CSS = `
:root{color-scheme:dark;--bg:#14161b;--panel:#1d2027;--line:#2c313b;--text:#e6e8ec;--muted:#9aa3b2;--accent:#f0b429;--bad:#ff6b5b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
header{padding:16px 20px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}
h1{margin:0 0 6px;font-size:18px}header p{margin:2px 0;color:var(--muted);font-size:12.5px}
.bar{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.bar button{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit;font-size:12.5px}
.bar button.on{border-color:var(--accent);color:var(--accent)}
.note{margin:12px 20px;color:var(--muted);font-size:12px}
#box{position:fixed;inset:0;background:rgba(8,9,12,.94);display:none;flex-direction:column;align-items:center;justify-content:center;z-index:10}
#box.open{display:flex}#box img{max-width:96vw;max-height:84vh;image-rendering:auto;border:1px solid var(--line)}
#box .cap{margin-top:10px;color:var(--text);font-size:13px;text-align:center}#box .hint{color:var(--muted);font-size:11.5px;margin-top:4px}
`;

/** Kontaktbogen: je Bau eine Zeile mit Miniaturen, Klick → groß (Pfeiltasten blättern, Esc schließt). */
export function contactSheetHtml(meta: SheetMeta, rows: readonly SheetRow[]): string {
  const groups = [...new Set(rows.flatMap((r) => r.views.map((v) => v.group)))];
  const all = rows.flatMap((r) => r.views.map((v) => ({ id: r.id, ...v })));
  const idx = new Map(all.map((v, i) => [`${v.id}/${v.name}`, i]));
  const body = rows.map((r) => `
<section class="row" id="${esc(r.id)}">
  <div class="info"><h2>${esc(r.title)}</h2><div class="id">${esc(r.id)}</div>${r.facts.map((f) => `<div>${esc(f)}</div>`).join('')}</div>
  <div class="strip">${r.views.map((v) => `<figure data-group="${esc(v.group)}" data-i="${idx.get(`${r.id}/${v.name}`)}"><img loading="lazy" src="${esc(v.thumb)}" alt="${esc(`${r.id} ${v.name}`)}"><figcaption>${esc(v.label)}</figcaption></figure>`).join('')}</div>
</section>`).join('');
  const data = JSON.stringify(all.map((v) => ({ src: v.image, cap: `${v.id} · ${v.label} (${v.name})` })));
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.title)}</title><style>${BASE_CSS}
.row{display:flex;gap:14px;padding:14px 20px;border-bottom:1px solid var(--line);align-items:flex-start}
.info{flex:0 0 210px;font-size:12px;color:var(--muted)}.info h2{margin:0 0 2px;font-size:15px;color:var(--text)}.info .id{font-family:ui-monospace,monospace;color:var(--accent);margin-bottom:6px}
.strip{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px}
figure{margin:0;flex:0 0 auto;cursor:zoom-in}figure img{display:block;width:240px;height:150px;object-fit:cover;border:1px solid var(--line);border-radius:4px;background:#000}
figure:hover img{border-color:var(--accent)}figcaption{font-size:11px;color:var(--muted);margin-top:3px;max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
figure.hide{display:none}
</style></head><body>
<header><h1>${esc(meta.title)}</h1>${meta.lines.map((l) => `<p>${esc(l)}</p>`).join('')}
<div class="bar" id="filter"><button class="on" data-g="">alle</button>${groups.map((g) => `<button data-g="${esc(g)}">${esc(g)}</button>`).join('')}</div></header>
<p class="note">Bilder enthalten Mojang-Texturen: nur lokal ansehen, nicht weitergeben oder einchecken. Klick = groß, ←/→ blättern, Esc schließt.</p>
${body}
<div id="box"><img alt=""><div class="cap"></div><div class="hint">←/→ blättern · Esc schließen</div></div>
<script>
const all=${data};let cur=-1;const box=document.getElementById('box'),img=box.querySelector('img'),cap=box.querySelector('.cap');
const vis=()=>[...document.querySelectorAll('figure:not(.hide)')].map(f=>+f.dataset.i);
function show(i){cur=i;img.src=all[i].src;cap.textContent=all[i].cap;box.classList.add('open');}
document.querySelectorAll('figure').forEach(f=>f.addEventListener('click',()=>show(+f.dataset.i)));
box.addEventListener('click',()=>box.classList.remove('open'));
document.addEventListener('keydown',e=>{if(!box.classList.contains('open'))return;const v=vis(),k=v.indexOf(cur);
if(e.key==='Escape')box.classList.remove('open');else if(e.key==='ArrowRight'&&k<v.length-1)show(v[k+1]);else if(e.key==='ArrowLeft'&&k>0)show(v[k-1]);});
document.querySelectorAll('#filter button').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('#filter button').forEach(x=>x.classList.toggle('on',x===b));
const g=b.dataset.g;document.querySelectorAll('figure').forEach(f=>f.classList.toggle('hide',g!==''&&f.dataset.group!==g));}));
</script></body></html>`;
}

// ---------------------------------------------------------------------------------------------- Vergleich

export interface CompareItem {
  /** `<id>/<ansicht>` */
  readonly key: string;
  readonly percent: number;
  readonly a: string;
  readonly b: string;
  readonly aThumb: string;
  readonly bThumb: string;
  readonly diff?: string;
  readonly diffThumb?: string;
  readonly note?: string;
}

export function compareHtml(meta: SheetMeta, items: readonly CompareItem[], onlyA: readonly string[], onlyB: readonly string[], labels: readonly [string, string]): string {
  const sorted = [...items].sort((x, y) => y.percent - x.percent || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  const pct = (p: number): string => `${p < 0.01 && p > 0 ? '<0,01' : p.toFixed(2).replace('.', ',')} %`;
  const rowsHtml = sorted.map((it, i) => `
<tr data-i="${i}" class="${it.percent === 0 ? 'same' : ''}"><td class="key">${esc(it.key)}${it.note !== undefined ? `<div class="n">${esc(it.note)}</div>` : ''}</td>
<td class="p"><div class="pb"><span style="width:${Math.min(100, it.percent).toFixed(2)}%"></span></div>${pct(it.percent)}</td>
<td><img loading="lazy" src="${esc(it.aThumb)}" alt="A"></td><td><img loading="lazy" src="${esc(it.bThumb)}" alt="B"></td>
<td>${it.diffThumb !== undefined ? `<img loading="lazy" src="${esc(it.diffThumb)}" alt="Differenz">` : '–'}</td></tr>`).join('');
  const data = JSON.stringify(sorted.map((it) => ({ key: it.key, a: it.a, b: it.b, d: it.diff ?? null, p: pct(it.percent) })));
  const list = (title: string, keys: readonly string[]): string => (keys.length === 0 ? '' : `<details class="only"><summary>${esc(title)} (${keys.length})</summary><p>${keys.map(esc).join(' · ')}</p></details>`);
  const changed = items.filter((i) => i.percent > 0).length;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.title)}</title><style>${BASE_CSS}
table{border-collapse:collapse;margin:0 20px 40px;width:calc(100% - 40px)}td,th{border-bottom:1px solid var(--line);padding:6px 8px;vertical-align:top;text-align:left}
th{color:var(--muted);font-weight:500;font-size:12px;position:sticky;top:0}
td img{width:240px;height:150px;object-fit:cover;border:1px solid var(--line);border-radius:4px;cursor:zoom-in;display:block;background:#000}
td.key{font-family:ui-monospace,monospace;font-size:12px;width:220px}td.key .n{color:var(--bad);font-family:system-ui;font-size:11px;margin-top:4px}
td.p{width:130px;font-variant-numeric:tabular-nums}.pb{height:6px;background:var(--panel);border-radius:3px;margin:4px 0 6px;overflow:hidden}.pb span{display:block;height:100%;background:var(--accent)}
tr.same td{opacity:.55}.only{margin:6px 20px;color:var(--muted);font-size:12px}.only p{font-family:ui-monospace,monospace}
#box .tabs{display:flex;gap:6px;margin-bottom:8px}#box .tabs button{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:4px 12px;cursor:pointer;font:inherit}
#box .tabs button.on{border-color:var(--accent);color:var(--accent)}
</style></head><body>
<header><h1>${esc(meta.title)}</h1>${meta.lines.map((l) => `<p>${esc(l)}</p>`).join('')}
<p>${items.length} Bildpaare, davon ${changed} verändert · nur in A: ${onlyA.length} · nur in B: ${onlyB.length}. Sortiert nach größter Änderung.</p></header>
<p class="note">Klick = groß. Im großen Bild: Leertaste schaltet A ↔ B, 1/2/3 = A/B/Differenz, ←/→ nächstes Paar, Esc schließt. Bilder enthalten Mojang-Texturen: nur lokal.</p>
${list(`nur in A (${labels[0]})`, onlyA)}${list(`nur in B (${labels[1]})`, onlyB)}
<table><thead><tr><th>Bau/Ansicht</th><th>Pixel verändert</th><th>A: ${esc(labels[0])}</th><th>B: ${esc(labels[1])}</th><th>Differenz</th></tr></thead><tbody>${rowsHtml}</tbody></table>
<div id="box"><div class="tabs"><button data-m="a">A</button><button data-m="b">B</button><button data-m="d">Differenz</button></div><img alt=""><div class="cap"></div><div class="hint">Leertaste A↔B · 1/2/3 · ←/→ · Esc</div></div>
<script>
const all=${data},labels=${JSON.stringify(labels)};let cur=-1,mode='a';const box=document.getElementById('box'),img=box.querySelector('img'),cap=box.querySelector('.cap');
function draw(){const it=all[cur];if(mode==='d'&&!it.d)mode='b';img.src=mode==='a'?it.a:mode==='b'?it.b:it.d;
cap.textContent=it.key+' · '+it.p+' · '+(mode==='a'?'A: '+labels[0]:mode==='b'?'B: '+labels[1]:'Differenz');
box.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.m===mode));}
function show(i,m){cur=i;if(m)mode=m;box.classList.add('open');draw();}
document.querySelectorAll('tbody tr').forEach(tr=>tr.querySelectorAll('img').forEach((im,k)=>im.addEventListener('click',()=>show(+tr.dataset.i,['a','b','d'][k]))));
box.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();mode=b.dataset.m;draw();}));
img.addEventListener('click',e=>{e.stopPropagation();mode=mode==='a'?'b':'a';draw();});
box.addEventListener('click',()=>box.classList.remove('open'));
document.addEventListener('keydown',e=>{if(!box.classList.contains('open'))return;
if(e.key==='Escape')box.classList.remove('open');else if(e.key===' '){e.preventDefault();mode=mode==='a'?'b':'a';draw();}
else if(e.key==='1'){mode='a';draw();}else if(e.key==='2'){mode='b';draw();}else if(e.key==='3'){mode='d';draw();}
else if(e.key==='ArrowRight'&&cur<all.length-1)show(cur+1);else if(e.key==='ArrowLeft'&&cur>0)show(cur-1);});
</script></body></html>`;
}
