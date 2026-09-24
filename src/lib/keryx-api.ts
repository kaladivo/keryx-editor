// Contract between the UI and the Go SDK compiled to WebAssembly (wasm/).
// Paths are relative to the git repo root, e.g. "keryx/targets.json" or
// ".well-known/keryx/root.json".

export type RepoFiles = Record<string, Uint8Array>;

/** One file of a `pub` keystore, e.g. the contents of `news.json`. */
export interface KeyFile {
  name: string;
  role: string;
  seed_hex: string;
}

export interface KeyInfo {
  name: string;
  role: string;
  keyid: string;
}

export interface Attachment {
  name?: string;
  url: string;
  mime_type?: string;
  size_in_bytes?: number;
  sha256?: string;
}

/** A published item (spec/feeds.md §1.1). */
export interface Item {
  id: string;
  title: string;
  content_html: string;
  image?: string;
  image_sha256?: string;
  date_published: string;
  date_modified?: string;
  tags?: string[];
  language?: string;
  attachments?: Attachment[];
  sig?: { keyid: string; sig: string }[];
}

export type Draft = Omit<Item, 'sig'>;

export interface Channel {
  name: string;
  displayName?: string;
  description?: string;
  mode: 'simple' | 'authored';
  version: number;
  expires: string;
  items: Item[];
}

export interface Company {
  name: string;
  logo?: string;
  logoSHA256?: string;
  repoBase?: string;
  channels: Channel[];
  keys: KeyInfo[];
  expires: { root: string; targets: string; snapshot: string; timestamp: string };
}

/** Files an operation changed; commit them as-is. */
export interface Change {
  write: RepoFiles;
  remove: string[];
}

/** Local metadata versions a deploy must reach before devices are woken. */
export interface Versions {
  timestamp: number;
  snapshot: number;
  targets: number;
  channel: number;
}

/** The relay §5.1 wake-up request body (POST {relay}/v1/publish). */
export type WakeupRequest = Record<string, unknown>;

export interface LoadOptions {
  files: RepoFiles;
  /** Repo base directory, e.g. "keryx". */
  repoDir: string;
  /** Well-known anchor directory, e.g. ".well-known/keryx". */
  anchorDir: string;
  keys: KeyFile[];
}

/** Every method throws an Error with the SDK's message on failure. */
export interface Keryx {
  /** Load (or reload) the repo and keys into memory. */
  load(opts: LoadOptions): Company;
  company(): Company;
  /** Create or update an item: signs it, publishes it, re-signs role/snapshot/timestamp. */
  publish(channel: string, draft: Draft): Change;
  unpublish(channel: string, id: string): Change;
  refreshTimestamp(): Change;
  /** Full chain check; returns the SDK's OK line. */
  validate(): string;
  versions(channel: string): Versions;
  signWakeup(companyId: string, channel: string, seq: number): WakeupRequest;
}
