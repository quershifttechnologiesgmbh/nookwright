/**
 * Bekannte Block-Umbenennungen (Minecraft Wiki). Heuristisch nicht immer eindeutig erkennbar,
 * deshalb gepflegt. Genutzt von `Registry.migrateBlockName` (feste Katalog-IDs über Versionen hinweg)
 * und vom Versions-Diff (Build).
 */
export interface BlockRename {
  readonly from: string;
  readonly to: string;
  /** Version, ab der der neue Name gilt */
  readonly since: string;
}

export const BLOCK_RENAMES: readonly BlockRename[] = [
  { from: 'grass', to: 'short_grass', since: '1.20.3' },
  { from: 'chain', to: 'iron_chain', since: '1.21.9' },
];
