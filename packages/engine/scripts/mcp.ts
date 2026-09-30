/**
 * MCP-Server über stdio. In Claude Code/Desktop per `.mcp.json` im Repo eingebunden; manuell:
 *   npx tsx packages/engine/scripts/mcp.ts
 * Schematics landen in packages/engine/out/ (ENGINE_OUT_DIR). Ausgaben nur auf stderr (stdout gehört dem Protokoll).
 * Optional dauerhafte Projekte: ENGINE_MCP_STORE=1 nutzt den Speicher des HTTP-Servers (ENGINE_STORE_FILE) als Mandant
 * ENGINE_MCP_TENANT (Standard `local` = dieselben Projekte wie der Server im lokalen Modus).
 */
import './env.js';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { persistentSessions } from '../src/index.js';
import { REPO_CATALOG, engineMcpServer, interpretOptionsFromEnv, nodeEngine, projectStoreFromEnv } from '../src/node/index.js';

const outDir = process.env['ENGINE_OUT_DIR'] ?? fileURLToPath(new URL('../out/', import.meta.url));
const store = process.env['ENGINE_MCP_STORE'] === '1' ? projectStoreFromEnv() : undefined;
const sessions = store !== undefined ? persistentSessions(store, process.env['ENGINE_MCP_TENANT'] ?? 'local', { now: Date.now }) : undefined;
const engine = nodeEngine(REPO_CATALOG, { cacheSize: Number(process.env['ENGINE_CACHE_SIZE'] ?? 64), ...(sessions !== undefined ? { sessions } : {}) });
const nl = interpretOptionsFromEnv();
await engineMcpServer(engine, { outDir, interpret: nl }).connect(new StdioServerTransport());
console.error(`MCP-Server bereit: ${engine.operations.length} Tools + nl_prompt (${nl.model}), Schematics nach ${outDir}, Projekte: ${store?.kind ?? 'memory'}`);
