import {
  createAppOwner,
  createOwnerSecret,
  createRandomBytes,
  Mnemonic,
  mnemonicToOwnerSecret,
  type AppOwner,
} from '@evolu/common';

const STORAGE_KEY = 'keryx-editor:owner-mnemonic';

export const ownerFromMnemonic = (mnemonic: Mnemonic): AppOwner => createAppOwner(mnemonicToOwnerSecret(mnemonic));

export const createRandomOwner = (): AppOwner => createAppOwner(createOwnerSecret({ randomBytes: createRandomBytes() }));

/** Accepts any spacing and letter case, as people paste phrases from notes. */
export const parseMnemonic = (text: string) => Mnemonic.fromUnknown(text.trim().toLowerCase().split(/\s+/).join(' '));

function readStoredOwner(): AppOwner | null {
  try {
    const parsed = parseMnemonic(localStorage.getItem(STORAGE_KEY) ?? '');
    return parsed.ok ? ownerFromMnemonic(parsed.value) : null;
  } catch {
    return null;
  }
}

export function storeOwner(owner: AppOwner): void {
  try {
    localStorage.setItem(STORAGE_KEY, owner.mnemonic);
  } catch {
    // Without storage the owner lives only as long as this page.
  }
}

export function loadOrCreateOwner(): AppOwner {
  const owner = readStoredOwner() ?? createRandomOwner();
  storeOwner(owner);
  return owner;
}

export const isOwnerStorageKey = (key: string | null) => key === STORAGE_KEY;
