import type { Versions } from './keryx-api';

const POLL_MS = 2000;
const TIMEOUT_MS = 5 * 60 * 1000;

export const formatVersions = (v: Versions): string =>
  `timestamp ${v.timestamp} · snapshot ${v.snapshot} · targets ${v.targets} · channel ${v.channel}`;

const atLeast = (got: Versions, want: Versions): boolean =>
  got.timestamp >= want.timestamp &&
  got.snapshot >= want.snapshot &&
  got.targets >= want.targets &&
  got.channel >= want.channel;

async function fetchVersion(url: string): Promise<number> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  const doc = (await res.json()) as { signed?: { version?: number } };
  const version = doc.signed?.version;
  if (!version || version <= 0) throw new Error(`${url}: no version`);
  return version;
}

/** Every URL carries one per-poll nonce so a CDN edge cannot answer from a stale cache. */
export async function fetchVersions(base: string, channel: string): Promise<Versions> {
  const root = base.replace(/\/+$/, '') + '/';
  const nonce = `?t=${Date.now()}`;
  const [timestamp, snapshot, targets, channelVersion] = await Promise.all(
    ['timestamp.json', 'snapshot.json', 'targets.json', `channels.${channel}.json`].map((f) =>
      fetchVersion(root + f + nonce),
    ),
  );
  return { timestamp, snapshot, targets, channel: channelVersion };
}

export interface DeployProgress {
  elapsedMs: number;
  got?: Versions;
  error?: string;
}

/** Polls the deployed repo until every metadata version is at least `want`. */
export async function waitForDeploy(
  base: string,
  channel: string,
  want: Versions,
  onProgress: (p: DeployProgress) => void,
): Promise<Versions> {
  const start = Date.now();
  let last = '';
  for (;;) {
    const elapsedMs = Date.now() - start;
    try {
      const got = await fetchVersions(base, channel);
      if (atLeast(got, want)) return got;
      last = `deployed repo is at ${formatVersions(got)}`;
      onProgress({ elapsedMs, got });
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
      onProgress({ elapsedMs, error: last });
    }
    if (Date.now() - start >= TIMEOUT_MS) {
      throw new Error(`Deploy did not propagate within 5 minutes: ${last}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
