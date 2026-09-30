/**
 * Adapter Port `ViewerResources` → deepslate `Resources` (Blockstates, Modelle, Atlas, Flags, Defaults).
 * Rein (kein DOM-Zugriff): läuft auch in Node, dort z. B. mit einem Atlas als Plain-Objekt für Tests.
 */
import { BlockDefinition, BlockModel, BlockState, Cull, Identifier, Mesh, SpecialRenderers, type BlockFlags as DsBlockFlags, type Resources } from 'deepslate';
import { MISSING_TEXTURE, atlasIndexUv } from './assets/extract.js';
import type { UV } from './assets/atlas.js';
import type { ViewerResources } from './port.js';
import { SYNTHETIC_NAMESPACE, syntheticAssets } from './synthetic.js';

export interface DeepslateResources extends Resources {
  /** Gibt es einen Blockstate (Vanilla oder synthetisch) zu dieser ID? */
  hasBlock(id: Identifier): boolean;
}

/**
 * deepslate-Ressourcen aus dem Port. Modelle werden beim ersten Zugriff geparst und mit ihren Eltern
 * aufgelöst (`flatten`), Blockstates ebenso lazily – der Aufbau kostet damit fast nichts.
 * Unbekannte Texturen zeigen die schwarz-magentafarbene Ersatztextur.
 */
export function createDeepslateResources(res: ViewerResources): DeepslateResources {
  const uv = atlasIndexUv(res.atlasIndex);
  const size = res.atlasIndex.size;
  const missing: UV = uv[MISSING_TEXTURE] ?? [0, 0, 16 / size, 16 / size];
  const synth = syntheticAssets();
  const defs = new Map<string, BlockDefinition | null>();
  const models = new Map<string, BlockModel | null>();

  const lookup = (id: Identifier, vanilla: Readonly<Record<string, unknown>>, synthetic: Readonly<Record<string, unknown>>): unknown =>
    id.namespace === 'minecraft' ? vanilla[id.path] : id.namespace === SYNTHETIC_NAMESPACE ? synthetic[id.path] : undefined;

  const provider: DeepslateResources = {
    getBlockDefinition(id) {
      const key = id.toString();
      let def = defs.get(key);
      if (def === undefined) {
        const json = lookup(id, res.blockstates, synth.blockstates);
        def = json === undefined ? null : BlockDefinition.fromJson(json);
        defs.set(key, def);
      }
      return def;
    },
    getBlockModel(id) {
      const key = id.toString();
      let model = models.get(key);
      if (model === undefined) {
        const json = lookup(id, res.models, synth.models);
        model = json === undefined ? null : BlockModel.fromJson(json);
        models.set(key, model); // vor flatten eintragen: Eltern-Aufrufe finden das Modell schon
        model?.flatten(provider);
      }
      return model;
    },
    hasBlock(id) {
      return provider.getBlockDefinition(id) !== null;
    },
    getTextureAtlas() {
      // deepslate erwartet ImageData; der Renderer sorgt im Browser für ein echtes (siehe renderer.ts).
      return res.atlas as unknown as ImageData;
    },
    getTextureUV(id) {
      return uv[id.toString()] ?? missing;
    },
    getPixelSize() {
      return 1 / size;
    },
    getBlockFlags(id): DsBlockFlags | null {
      if (id.namespace !== 'minecraft') return null;
      return res.blockFlags?.[id.path] ?? null;
    },
    getBlockProperties(id) {
      const info = id.namespace === 'minecraft' ? res.blockInfo?.(id.path) : undefined;
      if (info === undefined) return null;
      const out: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(info.properties)) out[k] = [...v];
      return out;
    },
    getDefaultBlockProperties(id) {
      const info = id.namespace === 'minecraft' ? res.blockInfo?.(id.path) : undefined;
      return info === undefined ? null : { ...info.default };
    },
  };
  return provider;
}

/** Modellvarianten eines Blockzustands (zum Prüfen/Debuggen): Modell-ID und Drehung je Teil. */
export function resolveBlockModels(
  resources: DeepslateResources,
  name: string,
  properties: Readonly<Record<string, string>> = {},
): Array<{ model: string; x: number; y: number; uvlock: boolean }> | undefined {
  const id = Identifier.parse(name);
  const def = resources.getBlockDefinition(id);
  if (def === null) return undefined;
  const props = { ...(resources.getDefaultBlockProperties(id) ?? {}), ...properties };
  return def.getModelVariants(props).map((v) => ({ model: v.model, x: v.x ?? 0, y: v.y ?? 0, uvlock: v.uvlock ?? false }));
}

/**
 * Mesh eines einzelnen Blocks wie in deepslates ChunkBuilder (Blockstate-Modelle + Spezialrenderer für
 * Block-Entities), ohne Nachbar-Culling, in Blockeinheiten. Für Tests und Fehlersuche ohne WebGL.
 */
export function blockMesh(resources: DeepslateResources, name: string, properties: Readonly<Record<string, string>> = {}): Mesh {
  const id = Identifier.parse(name);
  const props = { ...(resources.getDefaultBlockProperties(id) ?? {}), ...properties };
  const mesh = new Mesh();
  const def = resources.getBlockDefinition(id);
  if (def !== null) mesh.merge(def.getMesh(id, props, resources, resources, Cull.none()));
  const special = SpecialRenderers.getBlockMesh(new BlockState(id, props), undefined, resources, Cull.none());
  if (!special.isEmpty()) mesh.merge(special);
  return mesh;
}
