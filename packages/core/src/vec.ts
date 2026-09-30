/** Ganzzahlige Blockkoordinate. x = Ost (+), y = oben (+), z = Süd (+) – wie in Minecraft. */
export type Vec3 = readonly [x: number, y: number, z: number];

export const vec3 = (x: number, y: number, z: number): Vec3 => [x, y, z];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export const eq = (a: Vec3, b: Vec3): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Stabiler Schlüssel für Maps/Sets. */
export const key3 = (v: Vec3): string => `${v[0]},${v[1]},${v[2]}`;
