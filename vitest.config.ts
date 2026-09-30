import { defineConfig } from 'vitest/config';
import { DEFAULT_TIMEOUT } from './packages/core/test/support/slack.js';

export default defineConfig({
  test: {
    // website/test: reine Module der Website (KI-Architekt, Einbettungs-Protokoll) und Prüfungen der Galerie/Schriften
    include: ['packages/*/test/**/*.test.ts', 'website/test/**/*.test.ts'],
    // Timeouts sind Hänger-Schutz, keine Laufzeitprüfung (Stufen und Begründung: packages/core/test/support/slack.ts).
    // Schwere Tests setzen HEAVY_TIMEOUT; beides skaliert mit MCDA_TIMEOUT_SLACK.
    testTimeout: DEFAULT_TIMEOUT,
    hookTimeout: DEFAULT_TIMEOUT,
  },
});
