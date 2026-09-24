import { byteSize, formatBytes } from './bytes';
import type { Change, Draft } from './keryx-api';

export const MAX_ITEM_BYTES = 1_000_000;

const PLACEHOLDER_SIG = { keyid: 'k'.repeat(64), sig: 's'.repeat(86) };

/** The size of the item file once signed: the SDK writes it indented, with a trailing newline. */
export const signedItemSize = (draft: Draft, signatures: number): number =>
  byteSize(JSON.stringify({ ...draft, sig: Array(signatures).fill(PLACEHOLDER_SIG) }, null, 2)) + 1;

export function assertItemFits(change: Change, path: string): void {
  const bytes = change.write[path]?.length ?? 0;
  if (bytes > MAX_ITEM_BYTES) {
    throw new Error(
      `The signed post is ${formatBytes(bytes)} (${bytes.toLocaleString('en')} bytes), over the ${formatBytes(MAX_ITEM_BYTES)} limit. Shrink or remove images. Nothing was committed.`,
    );
  }
}
