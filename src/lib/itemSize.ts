import { byteSize, formatBytes } from './bytes';
import type { Change, Draft } from './keryx-api';

export const MAX_ITEM_BYTES = 1_000_000;

const PLACEHOLDER_SIG = { keyid: 'k'.repeat(64), sig: 's'.repeat(86) };

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/**
 * JSON as the SDK's Go encoder writes it (sdk/feed.Encode: indented, HTML left unescaped, trailing newline).
 * It differs from JSON.stringify in two ways: lone surrogates become U+FFFD, and U+2028/U+2029 are escaped.
 */
const goJson = (value: unknown): string =>
  JSON.stringify(value, (_, v: unknown) => (typeof v === 'string' ? v.replace(LONE_SURROGATE, '\ufffd') : v), 2)
    .replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`) + '\n';

/** The size of the item file once signed. */
export const signedItemSize = (draft: Draft, signatures: number): number =>
  byteSize(goJson({ ...draft, sig: Array(signatures).fill(PLACEHOLDER_SIG) }));

export function assertItemFits(change: Change, path: string): void {
  const bytes = change.write[path]?.length ?? 0;
  if (bytes > MAX_ITEM_BYTES) {
    throw new Error(
      `The signed post is ${formatBytes(bytes)} (${bytes.toLocaleString('en')} bytes), over the ${formatBytes(MAX_ITEM_BYTES)} limit. Shrink or remove images. Nothing was committed.`,
    );
  }
}
