import {
  createIdFromString,
  createQueryBuilder,
  id,
  nullOr,
  sqliteFalse,
  sqliteTrue,
  String as EvoluString,
  type Evolu,
  type Query,
  type QueryRows,
  type Row,
} from '@evolu/common';
import { createEvoluBinding } from '@evolu/react';
import { useEffect } from 'react';
import { defaultSettings, parseKeyFiles, type Secrets, type Settings } from './settings';

const SettingsId = id('Settings');
const SecretsId = id('Secrets');
const DraftId = id('Draft');

export const Schema = {
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
  drafts: {
    id: DraftId,
    json: nullOr(EvoluString),
  },
};

export type AppEvolu = Evolu<typeof Schema>;

export const { EvoluContext, useEvolu, useQuery } = createEvoluBinding<typeof Schema>();

const settingsRowId = SettingsId.orThrow(createIdFromString('settings'));
const secretsRowId = SecretsId.orThrow(createIdFromString('secrets'));
const draftRowId = (key: string) => DraftId.orThrow(createIdFromString(`draft:${key}`));

const query = createQueryBuilder(Schema);

const settingsQuery = query((db) => db.selectFrom('settings').selectAll());
const secretsQuery = query((db) => db.selectFrom('secrets').selectAll().where('isDeleted', 'is not', sqliteTrue));
const draftQuery = (key: string) =>
  query((db) =>
    db.selectFrom('drafts').select('json').where('id', '=', draftRowId(key)).where('isDeleted', 'is not', sqliteTrue),
  );

type SettingsRow = typeof settingsQuery.Row;
type SecretsRow = typeof secretsQuery.Row;

const settingsOf = (row?: SettingsRow): Settings => ({
  repo: row?.repo ?? defaultSettings.repo,
  branch: row?.branch ?? defaultSettings.branch,
  siteUrl: row?.siteUrl ?? defaultSettings.siteUrl,
  repoDir: row?.repoDir ?? defaultSettings.repoDir,
  anchorDir: row?.anchorDir ?? defaultSettings.anchorDir,
  relayUrl: row?.relayUrl ?? defaultSettings.relayUrl,
});

function secretsOf(row?: SecretsRow): Secrets | null {
  if (row?.token == null || row.keysJson == null) return null;
  try {
    return { token: row.token, keys: parseKeyFiles(row.keysJson) };
  } catch {
    return null;
  }
}

/**
 * `useQuery`, plus a reload after mount: Evolu skips refreshing a query that is loaded but not yet
 * subscribed (while Suspense commits), so rows synced in right then, as after a restore, would stay
 * invisible. The reload re-queries only when such a refresh was skipped.
 */
function useLiveQuery<R extends Row>(query: Query<typeof Schema, R>): QueryRows<R> {
  const evolu = useEvolu();
  const rows = useQuery(query);
  useEffect(() => {
    void evolu.loadQuery(query);
  }, [evolu, query]);
  return rows;
}

/** The stored settings (defaults for missing values) and the remembered secrets; live, including synced changes. */
export function useStored(): { settings: Settings; secrets: Secrets | null } {
  const settingsRows = useLiveQuery(settingsQuery);
  const secretsRows = useLiveQuery(secretsQuery);
  return { settings: settingsOf(settingsRows[0]), secrets: secretsOf(secretsRows[0]) };
}

/** The saved draft JSON for `key`, or null; live, including synced changes. */
export const useStoredDraft = (key: string): string | null => useLiveQuery(draftQuery(key))[0]?.json ?? null;

export const saveSettings = (evolu: AppEvolu, settings: Settings) =>
  evolu.upsert('settings', { id: settingsRowId, ...settings });

export const saveSecrets = (evolu: AppEvolu, { token, keys }: Secrets) =>
  evolu.upsert('secrets', { id: secretsRowId, token, keysJson: JSON.stringify(keys), isDeleted: sqliteFalse });

export const forgetSecrets = (evolu: AppEvolu) =>
  evolu.upsert('secrets', { id: secretsRowId, token: null, keysJson: null, isDeleted: sqliteTrue });

/** Resolves once the local database stored it; a null json deletes the draft. */
const writeDraft = (evolu: AppEvolu, key: string, json: string | null) =>
  new Promise<void>((resolve) => {
    evolu.upsert(
      'drafts',
      { id: draftRowId(key), json, isDeleted: json === null ? sqliteTrue : sqliteFalse },
      { onComplete: resolve },
    );
  });

export const saveDraft = (evolu: AppEvolu, key: string, json: string) => writeDraft(evolu, key, json);

export const deleteDraft = (evolu: AppEvolu, key: string) => writeDraft(evolu, key, null);
