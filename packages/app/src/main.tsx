import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { browserContext, loadBundledCatalog } from './adapters/browserContext.js';
import { App } from './App.js';
import './styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('#root fehlt in index.html');

// Katalog sofort (gebündelt); Plattform-Daten erst, wenn Licht-Pass, Blöcke oder Export sie brauchen.
const load = loadBundledCatalog();
const pipeline = browserContext(load);

const render = (node: ReactNode) => createRoot(root).render(<StrictMode>{node}</StrictMode>);

// Dev-Galerie (/?galerie): Testszenen des Blockrenderers; im Build entfällt der Zweig samt Chunk.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('galerie')) {
  void import('./dev/Gallery.js').then(({ Gallery }) => render(<Gallery pipeline={pipeline} />));
} else {
  render(<App load={load} pipeline={pipeline} />);
}
