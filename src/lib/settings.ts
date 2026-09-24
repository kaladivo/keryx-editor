import type { KeyFile } from './keryx-api';

export interface Settings {
  repo: string;
  branch: string;
  siteUrl: string;
  repoDir: string;
  anchorDir: string;
  relayUrl: string;
}

export interface Secrets {
  token: string;
  keys: KeyFile[];
}

export const defaultSettings: Settings = {
  repo: 'kaladivo/keryx-demo',
  branch: 'main',
  siteUrl: 'https://keryx.roguedave.codes',
  repoDir: 'keryx',
  anchorDir: '.well-known/keryx',
  relayUrl: 'https://keryx-relay.fly.dev',
};

export const companyIdOf = (siteUrl: string): string => new URL(siteUrl).hostname;

const isKeyFile = (v: unknown): v is KeyFile =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as KeyFile).name === 'string' &&
  typeof (v as KeyFile).role === 'string' &&
  typeof (v as KeyFile).seed_hex === 'string';

/** Accepts one key object, an array, or several objects pasted back to back. */
export function parseKeyFiles(text: string): KeyFile[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const joined = trimmed.startsWith('[') ? trimmed : `[${trimmed.replace(/}\s*,?\s*{/g, '},{')}]`;
  const parsed: unknown = JSON.parse(joined);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const bad = list.find((v) => !isKeyFile(v));
  if (bad !== undefined) throw new Error('Each key needs name, role and seed_hex.');
  return list as KeyFile[];
}

export const mergeKeys = (a: KeyFile[], b: KeyFile[]): KeyFile[] => {
  const byName = new Map(a.map((k) => [k.name, k]));
  for (const k of b) byName.set(k.name, k);
  return [...byName.values()];
};
