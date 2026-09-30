/**
 * Befehlstabelle des Aggregats `Site` (Gelände). Jede Befehlsmethode von `Site` steht hier – erzwungen durch
 * `CommandTable<Site, SiteEvent>` (siehe `../commands.ts`).
 */
import { z } from 'zod';
import { CellSet } from '@mcda/core';
import { buildingOf, shellFor, themeFor } from '@mcda/pipeline';
import type { Site, SiteDecorLevel, SiteEvent, SiteLighting, ZoneEdge, ZoneKind } from '@mcda/terrain';
import { command, type CommandTable } from '../commands.js';
import { enumOf } from '../operation.js';
import { SITE_TEMPLATE_IDS, idsOf } from '../vocabulary.js';
import { rectCells, rectSchema } from './project.js';

const Int = z.number().int();
export const ZONE_KIND_IDS = enumOf<ZoneKind>()(['meadow', 'garden', 'field', 'yard', 'pond', 'plaza', 'orchard', 'paddock', 'path']);
export const ZONE_EDGE_IDS = enumOf<ZoneEdge>()(['none', 'fence', 'hedge']);
/** Stufen der Grundstücks-Deko (Feature-Schalter `siteDecor`, Standard aus). */
export const SITE_DECOR_IDS = enumOf<SiteDecorLevel>()(['off', 'some', 'rich']);
export const SITE_LIGHTING_IDS = enumOf<SiteLighting>()(['none', 'paths', 'spawnproof']);

const zoneId = z.string().min(1).describe('Zonen-ID (siehe project_get)');
const factor = z.number().min(0).max(2);

export const plotSchema = z
  .object({
    minX: Int.min(-512).max(512).describe('West'), minZ: Int.min(-512).max(512).describe('Nord'),
    maxX: Int.min(-512).max(512).describe('Ost'), maxZ: Int.min(-512).max(512).describe('Süd'),
  })
  .strict();

export const SITE_COMMANDS: CommandTable<Site, SiteEvent> = {
  resizePlot: command({
    summary: 'Grundstück neu begrenzen.',
    input: () => z.object({ plot: plotSchema.describe('Grundstück in Weltblöcken') }),
    apply: (s: Site, i) => s.resizePlot(i.plot),
  }),
  setStyle: command({
    summary: 'Geländestil wechseln (Wiese, Wald, Hügel …).',
    input: (v) => z.object({ terrainStyleId: z.enum(idsOf(v.terrainStyles)).describe('Geländestil') }),
    apply: (s: Site, i) => s.setStyle(i.terrainStyleId),
  }),
  reroll: command({
    summary: 'Gelände neu würfeln (Vegetation, Höhen).',
    input: () => z.object({}),
    apply: (s: Site) => s.reroll(),
  }),
  paintZone: command({
    summary: 'Zone malen: Garten, Feld, Hof, Teich, Platz, Obstgarten, Koppel, Weg oder Wiese.',
    input: () => z.object({ kind: z.enum(ZONE_KIND_IDS).describe('Zonenart'), rect: rectSchema }),
    apply: (s: Site, i) => s.paintZone(i.kind, rectCells(i.rect)),
  }),
  eraseZones: command({
    summary: 'Zonen in einer Fläche entfernen.',
    input: () => z.object({ rect: rectSchema }),
    apply: (s: Site, i) => s.eraseZones(rectCells(i.rect)),
  }),
  setZoneKind: command({
    summary: 'Art einer Zone ändern.',
    input: () => z.object({ zoneId, kind: z.enum(ZONE_KIND_IDS).describe('neue Zonenart') }),
    apply: (s: Site, i) => s.setZoneKind(i.zoneId, i.kind),
  }),
  sculpt: command({
    summary: 'Gelände anheben oder absenken.',
    input: () => z.object({
      op: z.enum(['raise', 'lower']).describe('anheben oder absenken'), rect: rectSchema,
      amount: Int.min(1).max(16).default(1).describe('Blöcke'),
    }),
    apply: (s: Site, i) => s.sculpt(i.op, rectCells(i.rect), i.amount),
  }),
  flatten: command({
    summary: 'Fläche auf eine Höhe planieren.',
    input: () => z.object({ rect: rectSchema, level: Int.min(-32).max(64).describe('Zielhöhe (y des obersten Blocks)') }),
    apply: (s: Site, i) => s.flatten(rectCells(i.rect), i.level),
  }),
  resetTerrain: command({
    summary: 'Handarbeit am Gelände in einer Fläche zurücksetzen.',
    input: () => z.object({ rect: rectSchema }),
    apply: (s: Site, i) => s.resetTerrain(rectCells(i.rect)),
  }),
  setZoneEdge: command({
    summary: 'Rand einer Zone: Zaun, Hecke oder offen.',
    input: () => z.object({ zoneId, edge: z.enum(ZONE_EDGE_IDS).describe('Rand') }),
    apply: (s: Site, i) => s.setZoneEdge(i.zoneId, i.edge),
  }),
  setLighting: command({
    summary: 'Außenbeleuchtung: keine, an Wegen oder spawnsicher.',
    input: () => z.object({ lighting: z.enum(SITE_LIGHTING_IDS).describe('Beleuchtung') }),
    apply: (s: Site, i) => s.setLighting(i.lighting),
  }),
  setVegetation: command({
    summary: 'Vegetationsdichte (Faktor 0–2 je Ebene, 1 = wie der Stil).',
    input: () => z.object({
      trees: factor.describe('Bäume'), bushes: factor.describe('Büsche'), ground: factor.describe('Bodenbewuchs'),
    }),
    apply: (s: Site, i) => s.setVegetation(i),
  }),
  smooth: command({
    summary: 'Gelände in einer Fläche glätten.',
    input: () => z.object({ rect: rectSchema }),
    apply: (s: Site, i) => s.smooth(rectCells(i.rect)),
  }),
  applyTemplate: command({
    summary: 'Geländevorlage ums Haus anwenden (homestead: Hof, Garten an der Küche, Feld, Koppel, Obstgarten).',
    input: () => z.object({
      template: z.enum(SITE_TEMPLATE_IDS).describe('Vorlage'),
      lighting: z.enum(SITE_LIGHTING_IDS).optional().describe('Beleuchtung (Standard paths)'),
      keepStyle: z.boolean().default(true).describe('bisherigen Geländestil behalten'),
    }),
    apply: (s: Site, i, env) => {
      const p = env.session.project;
      const building = buildingOf(shellFor(p, env.session.build, themeFor(p, env.ctx)));
      const kitchen = p.state.rooms.filter((r) => r.floorIndex === 0 && r.roomTypeId === 'kitchen').reduce((a, r) => a.union(r.cells), CellSet.empty());
      return s.applyTemplate(i.template, building, {
        ...(kitchen.isEmpty ? {} : { kitchen }),
        ...(i.lighting !== undefined ? { lighting: i.lighting } : {}),
        ...(i.keepStyle ? { styleId: s.state.styleId } : {}),
      });
    },
  }),
};
