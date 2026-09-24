import type { Versions } from './keryx-api';

const POLL_MS = 2000;
const TIMEOUT_MS = 5 * 60 * 1000;

type Role = keyof Versions;

const rolesOf = (v: Partial<Versions>) => Object.keys(v) as Role[];

export const formatVersions = (v: Partial<Versions>): string => rolesOf(v).map((r) => `${r} ${v[r]}`).join(' · ');

const atLeast = (got: Partial<Versions>, want: Partial<Versions>): boolean =>
  rolesOf(want).every((r) => (got[r] ?? 0) >= (want[r] ?? 0));

const fileOf = (role: Role, channel?: string) => (role === 'channel' ? `channels.${channel}.json` : `${role}.json`);

async function fetchVersion(url: string): Promise<number> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  const doc = (await res.json()) as { signed?: { version?: number } };
  const version = doc.signed?.version;
  if (!version || version <= 0) throw new Error(`${url}: no version`);
  return version;
}

/** Every URL carries one per-poll nonce so a CDN edge cannot answer from a stale cache. */
export async function fetchVersions(base: string, roles: Role[], channel?: string): Promise<Partial<Versions>> {
  const root = base.replace(/\/+$/, '') + '/';
  const nonce = `?t=${Date.now()}`;
  const versions = await Promise.all(roles.map((r) => fetchVersion(root + fileOf(r, channel) + nonce)));
  return Object.fromEntries(roles.map((r, i) => [r, versions[i]]));
}

export interface DeployProgress {
  elapsedMs: number;
  got?: Partial<Versions>;
  error?: string;
}

/** Polls the deployed repo until every version in `want` is reached; null when it times out. */
export async function waitForDeploy(
  base: string,
  want: Partial<Versions>,
  channel: string | undefined,
  onProgress: (p: DeployProgress) => void,
): Promise<Partial<Versions> | null> {
  const start = Date.now();
  for (;;) {
    const elapsedMs = Date.now() - start;
    try {
      const got = await fetchVersions(base, rolesOf(want), channel);
      if (atLeast(got, want)) return got;
      onProgress({ elapsedMs, got });
    } catch (e) {
      onProgress({ elapsedMs, error: e instanceof Error ? e.message : String(e) });
    }
    if (Date.now() - start >= TIMEOUT_MS) return null;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
