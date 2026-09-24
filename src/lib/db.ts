import {
  AppName,
  createAppOwner,
  createEvolu,
  createIdFromString,
  createQueryBuilder,
  id,
  nullOr,
  OwnerSecret,
  sqliteFalse,
  sqliteTrue,
  String as EvoluString,
} from '@evolu/common';
import { createEvoluDeps, createRun } from '@evolu/web';
import type { KeyFile } from './keryx-api';
import { defaultSettings, type Secrets, type Settings } from './settings';

const SettingsId = id('Settings');
const SecretsId = id('Secrets');

const Schema = {
  settings: {
    id: SettingsId,
    repo: nullOr(EvoluString),
    branch: nullOr(EvoluString),
    siteUrl: nullOr(EvoluString),
    repoDir: nullOr(EvoluString),
    anchorDir: nullOr(EvoluString),
    relayUrl: nullOr(EvoluString),
  },
  secrets: {
    id: SecretsId,
    token: nullOr(EvoluString),
    keysJson: nullOr(EvoluString),
  },
};

const settingsRowId = SettingsId.orThrow(createIdFromString('settings'));
const secretsRowId = SecretsId.orThrow(createIdFromString('secrets'));

const query = createQueryBuilder(Schema);
const settingsQuery = query((db) => db.selectFrom('settings').selectAll());
const secretsQuery = query((db) =>
  db.selectFrom('secrets').selectAll().where('isDeleted', 'is not', sqliteTrue),
);

// Local-only, so there is nowhere safer to keep a random owner secret than next
// to the database itself; a fixed one keeps the database readable across loads.
const appOwner = createAppOwner(OwnerSecret.orThrow(new Uint8Array(32)));

let evoluPromise: ReturnType<typeof openEvolu> | undefined;

function openEvolu() {
  const run = createRun(createEvoluDeps());
  return run.ok(
    createEvolu(Schema, {
      appName: AppName.orThrow('keryx-editor'),
      appOwner,
      transports: [],
    }),
  );
}

const evolu = () => (evoluPromise ??= openEvolu());

export interface Stored {
  settings: Settings;
  secrets: Secrets | null;
}

export async function loadStored(): Promise<Stored> {
  const db = await evolu();
  const [settingsRows, secretsRows] = await Promise.all([
    db.loadQuery(settingsQuery),
    db.loadQuery(secretsQuery),
  ]);
  const s = settingsRows[0];
  const settings: Settings = {
    repo: s?.repo ?? defaultSettings.repo,
    branch: s?.branch ?? defaultSettings.branch,
    siteUrl: s?.siteUrl ?? defaultSettings.siteUrl,
    repoDir: s?.repoDir ?? defaultSettings.repoDir,
    anchorDir: s?.anchorDir ?? defaultSettings.anchorDir,
    relayUrl: s?.relayUrl ?? defaultSettings.relayUrl,
  };
  const sec = secretsRows[0];
  const secrets =
    sec?.token != null && sec.keysJson != null
      ? { token: sec.token, keys: JSON.parse(sec.keysJson) as KeyFile[] }
      : null;
  return { settings, secrets };
}

export async function saveSettings(settings: Settings): Promise<void> {
  (await evolu()).upsert('settings', { id: settingsRowId, ...settings });
}

export async function saveSecrets({ token, keys }: Secrets): Promise<void> {
  (await evolu()).upsert('secrets', {
    id: secretsRowId,
    token,
    keysJson: JSON.stringify(keys),
    isDeleted: sqliteFalse,
  });
}

export async function forgetSecrets(): Promise<void> {
  (await evolu()).upsert('secrets', {
    id: secretsRowId,
    token: null,
    keysJson: null,
    isDeleted: sqliteTrue,
  });
}
