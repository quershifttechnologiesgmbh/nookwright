/**
 * DataVersions und versionsabhängige Formatmerkmale.
 * Schwellen sind Release-DataVersions; Snapshots dazwischen werden nicht unterstützt.
 */
export const DV = {
  MC_1_20_1: 3465,
  /** 1.20.5: Items als {id, count, components} statt {id, Count:byte, tag} */
  MC_1_20_5: 3837,
  MC_1_21_1: 3955,
  MC_1_21_4: 4189,
  /** 1.21.5: Text als NBT statt JSON-String, `equipment`, `block_pos` statt TileX/Y/Z */
  MC_1_21_5: 4325,
  /** 1.21.9: `chain` → `iron_chain`, Regale, Kupferlaterne */
  MC_1_21_9: 4554,
  MC_1_21_11: 4671,
  /** 26.1: Default-`rotation` von Bannern/Schildern 8 statt 0; neue Weltordner */
  MC_26_1: 4786,
  MC_26_2: 4903,
  MC_26_3: 5023,
} as const;

export const VERSION_LABEL: Readonly<Record<number, string>> = {
  [DV.MC_1_20_1]: '1.20.1',
  [DV.MC_1_21_1]: '1.21.1',
  [DV.MC_1_21_11]: '1.21.11',
  [DV.MC_26_3]: '26.3',
};

export interface FormatFeatures {
  /** Item-Stacks mit Data Components (1.20.5+) */
  itemComponents: boolean;
  /** Textkomponenten (Schild, Buch, CustomName) als NBT statt JSON-String (1.21.5+) */
  textAsNbt: boolean;
  /** Mob-/Rüstungsständer-Ausrüstung als `equipment{head,...}` statt ArmorItems/HandItems (1.21.5+) */
  equipmentCompound: boolean;
  /** Rahmen/Gemälde/Leinenknoten: `block_pos` (int[3]) statt TileX/TileY/TileZ (1.21.5+) */
  attachedBlockPos: boolean;
  /** `minecraft:chain` heißt ab 1.21.9 `minecraft:iron_chain` */
  ironChain: boolean;
  /** Litematica: Version 7 ab 1.20.5 (Items mit Components), sonst 6 */
  litematicVersion: 6 | 7;
  /** Bett hat seit 26.2 keine Block-Entity mehr (Registry 26.3 ohne `bed`) */
  bedBlockEntity: boolean;
}

export function features(dataVersion: number): FormatFeatures {
  return {
    itemComponents: dataVersion >= DV.MC_1_20_5,
    textAsNbt: dataVersion >= DV.MC_1_21_5,
    equipmentCompound: dataVersion >= DV.MC_1_21_5,
    attachedBlockPos: dataVersion >= DV.MC_1_21_5,
    ironChain: dataVersion >= DV.MC_1_21_9,
    litematicVersion: dataVersion >= DV.MC_1_20_5 ? 7 : 6,
    bedBlockEntity: dataVersion < DV.MC_26_2,
  };
}
