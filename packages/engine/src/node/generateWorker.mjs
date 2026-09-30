// Einstieg des Generier-Workers (generatePool.ts): tsx im Worker registrieren, dann den TypeScript-Worker laden.
// So läuft der Worker gleich unter `tsx scripts/serve.ts`, `node --import tsx …` (Container) und vitest.
import { register } from 'tsx/esm/api';

register();
await import('./generateWorker.ts');
