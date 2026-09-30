/**
 * Goldene Galerie (P0-A), Node: Pfade und Git-Stand.
 *
 * `local/` ist git-ignoriert und liegt im Haupt-Checkout (Mojang-Assets nur dort, HANDOFF §1). In einem Git-Worktree
 * gibt es kein eigenes `local/`: dann gilt das des Haupt-Checkouts (über `git rev-parse --git-common-dir`).
 * `MCDA_LOCAL_DIR` überschreibt beides.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo-Wurzel dieses Checkouts (packages/viewer/golden/node → vier Ebenen hoch). */
export const REPO_ROOT = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));

const git = (args: string[], cwd = REPO_ROOT): string | undefined => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
};

export function localDir(): string {
  const env = process.env['MCDA_LOCAL_DIR'];
  if (env !== undefined && env !== '') return resolve(env);
  const own = join(REPO_ROOT, 'local');
  if (existsSync(join(own, 'mc-assets'))) return own;
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (common !== undefined) {
    const main = join(dirname(common), 'local');
    if (existsSync(main)) return main;
  }
  return own;
}

export interface CommitInfo {
  readonly sha: string | undefined;
  readonly short: string | undefined;
  readonly branch: string | undefined;
  readonly dirty: boolean;
  readonly subject: string | undefined;
}

export function commitInfo(): CommitInfo {
  const sha = git(['rev-parse', 'HEAD']);
  const status = git(['status', '--porcelain', '--untracked-files=no']);
  return {
    sha,
    short: sha?.slice(0, 7),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: status !== undefined && status.length > 0,
    subject: git(['log', '-1', '--format=%s']),
  };
}

/** Lauf-Name: nur Buchstaben, Ziffern, Punkt, Minus, Unterstrich. */
export function checkRunName(name: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith('.')) throw new Error(`Ungültiger Lauf-Name „${name}“ (erlaubt: A–Z a–z 0–9 . _ -)`);
  return name;
}
