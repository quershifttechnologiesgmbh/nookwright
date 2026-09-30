/**
 * Node-Adapter für den Port `PlatformData`: lädt die generierten Dateien aus data/ vom Dateisystem.
 * Export: `@mcda/platform/node`. Die synchronen Helfer sind für Tests und Build-Skripte gedacht.
 */
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlatformData, DATA_FILES, type PlatformData, type PlatformIndex } from './port.js';
import { Registry } from './registry.js';
import type { FamilyData, PhysicsData, RegistryData } from './types.js';

/** Verzeichnis der eingecheckten, generierten Daten (packages/platform/data). */
export const DATA_DIR = fileURLToPath(new URL('../data', import.meta.url));

/** `PlatformData` über das Dateisystem (Standard: data/ dieses Pakets). */
export function nodePlatformData(dir: string = DATA_DIR): PlatformData {
  return createPlatformData(async (file) => JSON.parse(await readFile(join(dir, file), 'utf8')) as unknown);
}

// ------------------------------------------------------------ synchrone Helfer

function readJson<T>(dir: string, file: string): T {
  return JSON.parse(readFileSync(join(dir, file), 'utf8')) as T;
}

export function hasPlatformData(version: string, dir: string = DATA_DIR): boolean {
  return existsSync(join(dir, DATA_FILES.registry(version)));
}

export function loadIndex(dir: string = DATA_DIR): PlatformIndex {
  return readJson<PlatformIndex>(dir, DATA_FILES.index);
}

export function loadRegistryData(version: string, dir: string = DATA_DIR): RegistryData {
  return readJson<RegistryData>(dir, DATA_FILES.registry(version));
}

export function loadRegistry(version: string, dir: string = DATA_DIR): Registry {
  return new Registry(loadRegistryData(version, dir));
}

export function loadFamilies(version: string, dir: string = DATA_DIR): FamilyData {
  return readJson<FamilyData>(dir, DATA_FILES.families(version));
}

export function loadPhysics(version: string, dir: string = DATA_DIR): PhysicsData {
  return readJson<PhysicsData>(dir, DATA_FILES.physics(version));
}
