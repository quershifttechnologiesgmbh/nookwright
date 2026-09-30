/**
 * `ProjectStore` in SQLite über `node:sqlite` (in Node enthalten, keine native Build-Abhängigkeit). Eine Datei,
 * WAL-Modus, jede Änderung eine atomare Anweisung; mehrere Prozesse (HTTP-Server, MCP) dürfen dieselbe Datei nutzen
 * (optimistische Sperre über `rev`: gleichzeitige Änderung → Konflikt statt Lost Update).
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { memoryProjectStore, type ProjectStore, type StoredProject } from '../store.js';

export function sqliteProjectStore(file: string): ProjectStore {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS projects (
      tenant TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, rev INTEGER NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, accessed_at INTEGER NOT NULL,
      PRIMARY KEY (tenant, id)
    );
    CREATE INDEX IF NOT EXISTS projects_accessed ON projects (accessed_at);
    CREATE TABLE IF NOT EXISTS seqs (tenant TEXT PRIMARY KEY, seq INTEGER NOT NULL);
  `);
  const q = {
    get: db.prepare('SELECT data, rev, updated_at AS updatedAt, accessed_at AS accessedAt FROM projects WHERE tenant = ? AND id = ?'),
    rev: db.prepare('SELECT rev FROM projects WHERE tenant = ? AND id = ?'),
    // Optimistische Sperre: anlegen nur, wenn noch nicht vorhanden; ersetzen nur bei erwarteter Revision
    insert: db.prepare(`INSERT INTO projects (tenant, id, data, rev, created_at, updated_at, accessed_at) VALUES (?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT (tenant, id) DO NOTHING RETURNING rev`),
    update: db.prepare(`UPDATE projects SET data = ?, rev = rev + 1, updated_at = ?, accessed_at = ?
      WHERE tenant = ? AND id = ? AND rev = ? RETURNING rev`),
    touch: db.prepare('UPDATE projects SET accessed_at = ? WHERE tenant = ? AND id = ?'),
    delete: db.prepare('DELETE FROM projects WHERE tenant = ? AND id = ?'),
    ids: db.prepare('SELECT id FROM projects WHERE tenant = ? ORDER BY created_at, rowid'),
    seq: db.prepare('INSERT INTO seqs (tenant, seq) VALUES (?, 1) ON CONFLICT (tenant) DO UPDATE SET seq = seq + 1 RETURNING seq'),
    sweep: db.prepare('DELETE FROM projects WHERE accessed_at < ?'),
  };
  return {
    kind: 'sqlite',
    get: (tenant, id) => q.get.get(tenant, id) as StoredProject | undefined,
    rev: (tenant, id) => (q.rev.get(tenant, id) as { rev: number } | undefined)?.rev,
    put(tenant, id, data, now, expectedRev) {
      const row = (expectedRev === 0 ? q.insert.get(tenant, id, data, now, now, now) : q.update.get(data, now, now, tenant, id, expectedRev)) as { rev: number } | undefined;
      return row === undefined ? undefined : Number(row.rev);
    },
    touch: (tenant, id, now) => void q.touch.run(now, tenant, id),
    delete: (tenant, id) => Number(q.delete.run(tenant, id).changes) > 0,
    ids: (tenant) => (q.ids.all(tenant) as { id: string }[]).map((r) => r.id),
    nextSeq: (tenant) => Number((q.seq.get(tenant) as { seq: number }).seq),
    sweep: (before) => Number(q.sweep.run(before).changes),
    close: () => db.close(),
  };
}

/** `ENGINE_STORE_FILE` gesetzt → SQLite-Datei, sonst im Speicher (Projekte gehen beim Neustart verloren). */
export const projectStoreFromEnv = (env: NodeJS.ProcessEnv = process.env): ProjectStore => {
  const file = env['ENGINE_STORE_FILE'];
  return file !== undefined && file !== '' ? sqliteProjectStore(file) : memoryProjectStore();
};
