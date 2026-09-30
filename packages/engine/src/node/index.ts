/** Node-Adapter der Engine: Kontext von der Platte, HTTP-Server, NL-Steuerung über OpenRouter, Dateien schreiben. */
// Ladereihenfolge: Engine samt Operations-Registry vor den Adaptern auswerten. `operations/design.ts` und `engine.ts`
// importieren sich gegenseitig; käme `server.js` → `design.js` zuerst, fehlte `designIterate` in `OPERATIONS`.
import '../engine.js';

export { DEFAULT_CORS_ORIGINS, POOLED_OPS, engineServer, type AccessLogEntry, type ServerOptions } from './server.js';
export {
  COMPRESSIBLE, PRECOMPRESSED_EXT, SITE_HEADERS, SITE_TYPES, negotiateEncoding, siteCacheControl, siteHandler, sitePath,
  type SiteCacheStats, type SiteEncoding, type SiteHandler, type SiteOptions,
} from './site.js';
export {
  ClientAbortError, DEFAULT_GENERATE_TIMEOUT_MS, ENGINE_WORKER_URL, GenerateError, defaultPoolSize, generatePool,
  type GenerateJob, type GeneratePool, type GeneratePoolOptions, type PoolStats,
} from './generatePool.js';
export { encodeResult, type WireFile, type WireOutcome, type WireResult } from './wire.js';
export { KEY_PREFIX, apiKeyLine, apiKeysFromEnv, authenticate, generateApiKey, parseApiKeys, type ApiKeyEntry } from './auth.js';
export { rateRuleOf, tokenBuckets, type RateLimiter, type RateRule } from './rateLimit.js';
export { projectStoreFromEnv, sqliteProjectStore } from './sqliteStore.js';
export { NL_TOOL, engineMcpServer, type McpOptions } from './mcp.js';
export {
  DEFAULT_CHAT_MODEL, DEFAULT_MODEL, ModelError, interpret, interpretOptionsFromEnv, llmSchema, systemPrompt,
  type InterpretMode, type InterpretOptions, type Interpretation,
} from './openrouter.js';
export { DECISIONS_OP, DEFAULT_DECISIONS_URL, decisionPlanOf, decisionProviderOf, decisionsRequest, interpretDecisions, isDecisionsModel } from './decisions.js';

export {
  DEFAULT_PUBLIC_NL_DAILY, REPO_CATALOG, catalogDirFromEnv, dailyBudgetFromEnv, envNumber, nodeEngine, publicDailyBudget, type PublicBudget,
} from './config.js';

export { ROOMTYPE_CLASSIFY, executeRoomTypeClassify, usesDecisionModel } from './roomtype.js';
export { jsonlLog, promptLogTarget, type PromptLogEntry } from './log.js';
export { DESIGN_ITERATE, ITERATE_DEFAULT, executeDesignIterate, iterateOptionsFromEnv, iteratesWithModel, type IterateOptions } from './design.js';
