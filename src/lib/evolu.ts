import { installPolyfills } from '@evolu/common/polyfills';
import { AppName, createEvolu, createOwnerWebSocketTransport, type AppOwner, type Mnemonic } from '@evolu/common';
import { createEvoluDeps } from '@evolu/react-web';
import { createRun } from '@evolu/web';
import { useSyncExternalStore } from 'react';
import { Schema, type AppEvolu } from './db';
import { createRandomOwner, isOwnerStorageKey, loadOrCreateOwner, ownerFromMnemonic, storeOwner } from './owner';

export const SYNC_RELAY_URL = 'wss://evolu.davenov.com';

installPolyfills();

const run = createRun(createEvoluDeps());

export interface CurrentEvolu {
  owner: AppOwner;
  evolu: Promise<AppEvolu>;
  /** How this owner came to be used in this tab. */
  origin: 'loaded' | 'restored' | 'reset';
}

const open = (owner: AppOwner, origin: CurrentEvolu['origin']): CurrentEvolu => ({
  owner,
  origin,
  evolu: run.ok(
    createEvolu(Schema, {
      appName: AppName.orThrow('keryx-editor'),
      appOwner: owner,
      transports: [createOwnerWebSocketTransport({ url: SYNC_RELAY_URL, ownerId: owner.id })],
    }),
  ),
});

let current = open(loadOrCreateOwner(), 'loaded');
const listeners = new Set<() => void>();

/**
 * Evolu 8 has no restore/reset API yet: its local database is named after the owner, so using another
 * owner means a new Evolu instance with its own database, filled by sync from the relay.
 */
async function switchOwner(owner: AppOwner, origin: CurrentEvolu['origin']): Promise<void> {
  if (owner.id === current.owner.id) return;
  const previous = current.evolu;
  storeOwner(owner);
  current = open(owner, origin);
  for (const listener of listeners) listener();
  await (await previous)[Symbol.asyncDispose]();
}

export const restoreOwner = (mnemonic: Mnemonic) => switchOwner(ownerFromMnemonic(mnemonic), 'restored');

export const resetOwner = () => switchOwner(createRandomOwner(), 'reset');

addEventListener('storage', (e) => {
  if (isOwnerStorageKey(e.key)) void switchOwner(loadOrCreateOwner(), 'loaded');
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useCurrentEvolu = (): CurrentEvolu => useSyncExternalStore(subscribe, () => current);

const { evoluError } = run.deps;

export const useEvoluError = () => useSyncExternalStore(evoluError.subscribe, evoluError.get);
