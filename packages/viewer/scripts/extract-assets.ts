/**
 * Lokales Asset-Werkzeug (nur auf dem Rechner des Entwicklers): liest das offizielle Client-JAR und
 * schreibt alles für die Vorschau nach `local/mc-assets/<version>/` (git-ignoriert, NIE einchecken oder
 * verteilen – research/08 §5):
 *
 *   blockstates/ models/block/ textures/…   Rohdateien aus dem JAR (Umfang: EXTRACT_SCOPE)
 *   atlas.png + atlas.json                  Texturatlas (erstes Animationsbild) + Pixel-Rechtecke je Textur-ID
 *   blockstates.json, models.json           Bündel für deepslate
 *   block-flags.json                        opaque / semi_transparent / self_culling je Block (Heuristik)
 *   colors.json                             Durchschnittsfarbe je Textur + stellvertretende Farbe je Block
 *   manifest.json                           Version, SHA-1 des JARs, Zähler
 *
 * Aufruf von der Wurzel:  npx tsx packages/viewer/scripts/extract-assets.ts [version] [--jar <pfad>]
 * Standard: Version 1.21.11, JAR aus local/mc-client/<version>/client.jar (SHA-1 gegen source.json geprüft).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateRawSync, inflateSync } from 'node:zlib';
import { BlockColors } from 'deepslate';
import {
  ASSET_ROOT, MISSING_TEXTURE, buildAtlas, buildJsonBundles, computeBlockFlags, faceTexture, firstFrame, inExtractScope,
  representativeTexture, resolveModel, textureIdOf, textureStats, toHex, type TextureStats,
} from '../src/assets/extract.js';
import { decodePng, encodePng, type RgbaImage } from '../src/assets/png.js';
import { ZipArchive } from '../src/assets/zip.js';

const ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const LOCAL = join(ROOT, 'local');

/** Textur-IDs, die deepslates Spezialrenderer für die Möbel des Katalogs sicher brauchen. */
const REQUIRED_TEXTURES = [
  'minecraft:entity/chest/normal', 'minecraft:entity/chest/normal_left', 'minecraft:entity/chest/normal_right',
  'minecraft:entity/bed/red', 'minecraft:entity/signs/oak', 'minecraft:entity/signs/hanging/oak',
  'minecraft:entity/banner/banner_base', 'minecraft:entity/bell/bell_body', 'minecraft:block/water_still', 'minecraft:block/water_flow',
];

function parseArgs(argv: readonly string[]): { version: string; jar: string } {
  let version = '1.21.11';
  let jar: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--jar') jar = argv[++i];
    else if (!a.startsWith('-')) version = a;
    else throw new Error(`Unbekannte Option ${a}`);
  }
  if (!/^[0-9][0-9a-z.\-]*$/i.test(version)) throw new Error(`Ungültige Version ${version}`);
  return { version, jar: resolve(jar ?? join(LOCAL, 'mc-client', version, 'client.jar')) };
}

function insideLocal(p: string): boolean {
  const rel = relative(LOCAL, p);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

function writeFile(path: string, data: string | Uint8Array): void {
  if (!insideLocal(path)) throw new Error(`Schreiben außerhalb von local/ verweigert: ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

/** Node-Buffer → Uint8Array-Sicht ohne Kopie */
const u8 = (b: Uint8Array): Uint8Array => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
const json = (v: unknown, pretty = false): string => JSON.stringify(v, null, pretty ? 2 : undefined);
const kib = (n: number): string => `${(n / 1024).toFixed(0)} KiB`;

function main(): void {
  const t0 = performance.now();
  const { version, jar } = parseArgs(process.argv.slice(2));
  const out = join(LOCAL, 'mc-assets', version);
  if (!insideLocal(out)) throw new Error(`Ausgabe muss unter local/ liegen: ${out}`);
  if (!existsSync(jar)) throw new Error(`Client-JAR fehlt: ${jar}\n(Nur das offizielle JAR der eigenen Minecraft-Installation verwenden; es bleibt unter local/.)`);

  const bytes = u8(readFileSync(jar));
  const sha1 = createHash('sha1').update(bytes).digest('hex');
  const sourceFile = join(dirname(jar), 'source.json');
  if (existsSync(sourceFile)) {
    const expected = (JSON.parse(readFileSync(sourceFile, 'utf8')) as { sha1?: string }).sha1;
    if (expected !== undefined && expected !== sha1) throw new Error(`SHA-1 des JARs (${sha1}) passt nicht zu source.json (${expected})`);
  }

  // Alte Ausgabe nur löschen, wenn sie von diesem Werkzeug stammt (manifest.json vorhanden).
  if (existsSync(out)) {
    if (!existsSync(join(out, 'manifest.json'))) throw new Error(`${out} existiert, stammt aber nicht von diesem Werkzeug – bitte selbst prüfen`);
    rmSync(out, { recursive: true });
  }

  const zip = new ZipArchive(bytes, (d) => u8(inflateRawSync(d)));
  const files = new Map<string, Uint8Array>();
  for (const name of zip.names()) {
    if (!name.startsWith(ASSET_ROOT)) continue;
    const rel = name.slice(ASSET_ROOT.length);
    if (!inExtractScope(rel)) continue;
    const data = zip.read(name)!;
    files.set(rel, data);
    writeFile(join(out, rel), data);
  }

  // Bündel für deepslate
  const text = new TextDecoder();
  const jsonFiles = [...files].filter(([rel]) => rel.endsWith('.json')).map(([rel, d]) => [rel, text.decode(d)] as const);
  const { blockstates, models } = buildJsonBundles(jsonFiles);

  // Texturen: erstes Animationsbild + Statistik
  const textures = new Map<string, RgbaImage>();
  const stats = new Map<string, TextureStats>();
  let animated = 0;
  for (const [rel, data] of files) {
    const id = textureIdOf(rel);
    if (id === undefined) continue;
    const metaBytes = files.get(`${rel}.mcmeta`);
    const meta = metaBytes === undefined ? undefined : (JSON.parse(text.decode(metaBytes)) as unknown);
    const full = decodePng(data, (d) => u8(inflateSync(d)));
    const img = firstFrame(full, meta);
    if (img !== full) animated++;
    textures.set(id, img);
    stats.set(id, textureStats(img));
  }

  const { image, index } = buildAtlas(version, textures);
  const atlasPng = encodePng(image, (d) => u8(deflateSync(d, { level: 9 })));
  writeFile(join(out, 'atlas.png'), atlasPng);
  writeFile(join(out, 'atlas.json'), json(index));
  writeFile(join(out, 'blockstates.json'), json(blockstates));
  writeFile(join(out, 'models.json'), json(models));

  const flags = computeBlockFlags(blockstates, models, (id) => stats.get(id));
  writeFile(join(out, 'block-flags.json'), json(flags, true));

  // Farben: je Textur; je Block die stellvertretende Textur, mit festen Vanilla-Tönungen (Gras, Laub, Wasser)
  const blockColors: Record<string, { texture: string; rgb: string }> = {};
  for (const [name, bs] of Object.entries(blockstates)) {
    const tex = representativeTexture(name, bs, models);
    const st = tex === undefined ? undefined : stats.get(tex);
    if (tex === undefined || st === undefined) continue;
    let rgb = st.rgb;
    const tint = BlockColors[name]?.({});
    if (tint !== undefined) {
      const v = parseInt(rgb.slice(1), 16);
      rgb = toHex(((v >> 16) & 255) * tint[0], ((v >> 8) & 255) * tint[1], (v & 255) * tint[2]);
    }
    blockColors[name] = { texture: tex, rgb };
  }
  const textureColors: Record<string, { rgb: string; opacity: number }> = {};
  for (const id of [...stats.keys()].sort()) textureColors[id] = { rgb: stats.get(id)!.rgb, opacity: stats.get(id)!.opacity };
  writeFile(join(out, 'colors.json'), json({ version, textures: textureColors, blocks: blockColors }, true));

  // Prüfungen: fehlende Texturen in Modellen und für die Spezialrenderer
  const missingRefs = new Set<string>();
  for (const id of Object.keys(models)) {
    const m = resolveModel(models, id);
    for (const e of m?.elements ?? []) {
      for (const f of Object.values(e.faces ?? {})) {
        const t = f.texture === undefined ? undefined : faceTexture(m!, f.texture);
        if (t !== undefined && index.textures[t] === undefined) missingRefs.add(`${id} → ${t}`);
      }
    }
  }
  const missingRequired = REQUIRED_TEXTURES.filter((t) => index.textures[t] === undefined);

  const manifest = {
    notice: 'Mojang-Assets aus dem Client-JAR – nur lokal verwenden, nie einchecken oder verteilen (research/08).',
    version,
    jar: { sha1, size: bytes.length },
    files: files.size,
    blockstates: Object.keys(blockstates).length,
    models: Object.keys(models).length,
    textures: textures.size,
    animatedTextures: animated,
    atlas: { size: index.size, bytes: atlasPng.length, missingTexture: MISSING_TEXTURE },
    blockFlags: Object.keys(flags).length,
    missingModelTextures: [...missingRefs].sort(),
  };
  writeFile(join(out, 'manifest.json'), json(manifest, true));
  writeFile(join(out, 'NICHT-VERTEILEN.txt'), 'Mojang-Assets (Minecraft Client-JAR). Nur lokal zur Vorschau. Nicht einchecken, nicht hochladen, nicht weitergeben.\n');

  const ms = (performance.now() - t0).toFixed(0);
  console.log(`Minecraft ${version} → ${relative(ROOT, out)} (${ms} ms)`);
  console.log(`  ${files.size} Dateien, ${manifest.blockstates} Blockstates, ${manifest.models} Modelle, ${textures.size} Texturen (${animated} animiert)`);
  console.log(`  Atlas ${index.size}×${index.size} (${kib(atlasPng.length)}), Block-Flags ${manifest.blockFlags}`);
  if (missingRefs.size > 0) console.log(`  Hinweis: ${missingRefs.size} Modell-Flächen verweisen auf fehlende Texturen, z. B. ${[...missingRefs].slice(0, 3).join('; ')}`);
  if (missingRequired.length > 0) {
    console.error(`  FEHLER: Texturen für Spezialrenderer fehlen: ${missingRequired.join(', ')}`);
    process.exitCode = 1;
  }
}

main();
