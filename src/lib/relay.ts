import type { WakeupRequest } from './keryx-api';

const RETRIES = 4;
const RETRY_MS = 15_000;

export type WakeupResult =
  | { readable: true; status: number; sent?: number; body: string }
  | { readable: false };

/**
 * The relay only sends CORS headers to its allow-listed PWA origins. A JSON
 * POST from elsewhere fails its preflight before reaching the relay, so it is
 * resent as a no-cors simple request: delivered, but the response is opaque.
 * A bodyless POST is already a simple request that reached the relay.
 */
async function post(url: string, body?: string): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body,
    });
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
    if (!body) return null;
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body,
    });
    return null;
  }
}

const trim = (url: string) => url.replace(/\/+$/, '');

export async function refreshCompany(relayUrl: string, companyId: string): Promise<void> {
  const res = await post(`${trim(relayUrl)}/v1/companies/${encodeURIComponent(companyId)}/refresh`);
  if (res && !res.ok) throw new Error(`Relay refresh: HTTP ${res.status}: ${(await res.text()).trim()}`);
}

const notSynchronizedYet = (status: number, body: string) =>
  (status === 404 && body.includes('synchronize first')) || (status === 503 && body.includes('refresh pending'));

export async function publishWakeup(
  relayUrl: string,
  request: WakeupRequest,
  onRetry: (attempt: number, reason: string) => void,
): Promise<WakeupResult> {
  const body = JSON.stringify(request);
  for (let attempt = 0; ; attempt++) {
    const res = await post(`${trim(relayUrl)}/v1/publish`, body);
    if (!res) return { readable: false };
    const text = await res.text();
    if (res.ok) {
      const json = JSON.parse(text) as { providers?: { webpush?: { sent?: number } } };
      return { readable: true, status: res.status, sent: json.providers?.webpush?.sent, body: text };
    }
    if (attempt >= RETRIES || !notSynchronizedYet(res.status, text)) {
      throw new Error(`Relay publish: HTTP ${res.status}: ${text.trim()}`);
    }
    onRetry(attempt + 1, text.trim());
    await new Promise((r) => setTimeout(r, RETRY_MS));
  }
}
