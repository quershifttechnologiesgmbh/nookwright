// Fuzz der festen Bautypen (alte App-Vorlagen, research/19 §7.8) – siehe buildingtype-fuzz.ts
import { fuzzType } from './buildingtype-fuzz.js';

for (const id of ['house', 'hall', 'twostory', 'timber']) fuzzType(id);
