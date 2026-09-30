import { nodeContext } from '@mcda/pipeline/node';
import { createEngine } from '../src/index.js';
import { REPO_CATALOG } from '../src/node/index.js';

export const ctx = nodeContext(REPO_CATALOG);
export const engine = createEngine(ctx);
