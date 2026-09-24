import { useState, type ChangeEvent, type FormEvent } from 'react';
import { forgetSecrets, saveSecrets, saveSettings, useEvolu, useStored } from '../lib/db';
import type { KeyFile, KeyInfo } from '../lib/keryx-api';
import { connect, type Session } from '../lib/session';
import { companyIdOf, mergeKeys, parseKeyFiles, type Secrets, type Settings } from '../lib/settings';
import { SyncPanel } from './SyncPanel';

interface Props {
  /** The secrets of the current session, shown when none are remembered. */
  sessionSecrets?: Secrets;
  loadedKeys?: KeyInfo[];
  onConnected: (session: Session, secrets: Secrets) => void;
  /** Present on the Settings screen of a connected session. */
  onCancel?: () => void;
}

const FIELDS: { key: keyof Settings; label: string; hint?: string }[] = [
  { key: 'repo', label: 'GitHub repository', hint: 'owner/name' },
  { key: 'branch', label: 'Branch' },
  { key: 'siteUrl', label: 'Company site URL', hint: 'The join origin; its hostname is the company id.' },
  { key: 'repoDir', label: 'Repo directory' },
  { key: 'anchorDir', label: 'Anchor directory' },
  { key: 'relayUrl', label: 'Relay URL' },
];

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function keyProblems(keys: KeyFile[]): string[] {
  const roles = new Set(keys.map((k) => k.role));
  return [
    ...(roles.has('channel') ? [] : ['No channel key: posts cannot be signed or announced.']),
    ...(roles.has('ops') ? [] : ['No ops key: snapshot and timestamp cannot be re-signed.']),
  ];
}

/** Form values fall back to the stored ones until edited, so synced changes show up live. */
export function Setup({ sessionSecrets, loadedKeys, onConnected, onCancel }: Props) {
  const evolu = useEvolu();
  const stored = useStored();
  const [settingsEdits, setSettingsEdits] = useState<Partial<Settings>>({});
  const [tokenEdit, setToken] = useState<string>();
  const [keysEdit, setKeysText] = useState<string>();
  const [rememberEdit, setRemember] = useState<boolean>();
  const [fileKeys, setFileKeys] = useState<KeyFile[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string>();

  const settings = { ...stored.settings, ...settingsEdits };
  const knownSecrets = stored.secrets ?? sessionSecrets;
  const token = tokenEdit ?? knownSecrets?.token ?? '';
  const keysText = keysEdit ?? (knownSecrets ? JSON.stringify(knownSecrets.keys, null, 2) : '');
  const hasStored = stored.secrets !== null;
  const remember = rememberEdit ?? hasStored;

  let pastedKeys: KeyFile[] = [];
  let keysError: string | undefined;
  try {
    pastedKeys = parseKeyFiles(keysText);
  } catch (e) {
    keysError = `Could not read the pasted keys: ${errorText(e)}`;
  }
  const keys = mergeKeys(pastedKeys, fileKeys);
  const problems = keys.length ? keyProblems(keys) : [];
  const keyidOf = (name: string) => loadedKeys?.find((k) => k.name === name)?.keyid;

  let siteError: string | undefined;
  try {
    companyIdOf(settings.siteUrl);
  } catch {
    siteError = 'Enter a full URL, e.g. https://example.com';
  }

  async function pickFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    try {
      const parsed = await Promise.all(files.map(async (f) => parseKeyFiles(await f.text())));
      setFileKeys((prev) => mergeKeys(prev, parsed.flat()));
    } catch (err) {
      setError(`Could not read the key files: ${errorText(err)}`);
    }
    e.target.value = '';
  }

  function forget() {
    forgetSecrets(evolu);
    setRemember(false);
  }

  function persist(secrets: Secrets) {
    saveSettings(evolu, settings);
    if (remember) saveSecrets(evolu, secrets);
    else if (hasStored) forgetSecrets(evolu);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setConnecting(true);
    const secrets = { token: token.trim(), keys };
    try {
      persist(secrets);
      onConnected(await connect(settings, secrets), secrets);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setConnecting(false);
    }
  }

  const canSubmit = !connecting && !keysError && !siteError && keys.length > 0 && token.trim() !== '';

  return (
    <main className="page narrow">
      <header className="page-header">
        <div>
          <h1>{onCancel ? 'Settings' : 'Connect a company'}</h1>
          <p className="muted">Point the editor at your Keryx repository and load your publishing keys.</p>
        </div>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Back
          </button>
        )}
      </header>

      {!onCancel && <SyncPanel firstRun />}

      <form className="card form" onSubmit={submit}>
        <section className="form-section">
          <h2>Repository</h2>
          <div className="grid-2">
            {FIELDS.map(({ key, label, hint }) => (
              <div key={key} className="field">
                <label className="field-label">
                  <span className="label">{label}</span>
                  <input
                    value={settings[key]}
                    onChange={(e) => setSettingsEdits({ ...settingsEdits, [key]: e.target.value })}
                    required
                    spellCheck={false}
                    autoCapitalize="off"
                    aria-invalid={key === 'siteUrl' && siteError ? true : undefined}
                  />
                </label>
                {key === 'siteUrl' && siteError ? (
                  <span className="field-error">{siteError}</span>
                ) : (
                  hint && <span className="hint">{hint}</span>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="form-section">
          <h2>GitHub token</h2>
          <div className="field">
            <label className="field-label">
              <span className="label">Personal access token</span>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                required
              />
            </label>
            <span className="hint">
              A fine-grained token with <strong>Contents: read and write</strong> on this repository.{' '}
              <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
                Create one
              </a>
              .
            </span>
          </div>
        </section>

        <section className="form-section">
          <h2>Keys</h2>
          <div className="field">
            <label className="field-label">
              <span className="label">Keystore JSON</span>
              <textarea
                className="mono"
                rows={6}
                value={keysText}
                onChange={(e) => setKeysText(e.target.value)}
                placeholder='{"name": "news", "role": "channel", "seed_hex": "…"}'
                spellCheck={false}
              />
            </label>
            <span className="hint">Paste one or more <code>pub</code> keystore files, as objects or an array.</span>
          </div>
          <label className="file-button">
            <input type="file" accept=".json,application/json" multiple onChange={pickFiles} />
            <span>Choose key files…</span>
          </label>
          {keysError && <p className="field-error">{keysError}</p>}

          {keys.length > 0 && (
            <ul className="key-list" aria-label="Loaded keys">
              {keys.map((k) => (
                <li key={k.name}>
                  <strong>{k.name}</strong>
                  <span className="badge">{k.role}</span>
                  {keyidOf(k.name) && <code className="muted">{keyidOf(k.name)?.slice(0, 12)}…</code>}
                  {fileKeys.includes(k) && (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setFileKeys(fileKeys.filter((f) => f !== k))}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {problems.map((p) => (
            <p key={p} className="alert alert-warn">
              {p}
            </p>
          ))}
        </section>

        <section className="form-section">
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>
              Remember the token and keys
              <span className="hint block">
                Stored in this browser and synced end-to-end encrypted to your other devices that use the same recovery
                phrase; the sync relay can't read them. Otherwise they stay in memory until you close the tab.
              </span>
            </span>
          </label>
          {hasStored && (
            <button type="button" className="danger-outline" onClick={forget}>
              Forget saved token and keys
            </button>
          )}
        </section>

        {error && (
          <div className="alert alert-error" role="alert">
            <pre className="error-text">{error}</pre>
          </div>
        )}

        <div className="form-actions">
          <button type="submit" className="primary" disabled={!canSubmit}>
            {connecting ? 'Loading repository…' : 'Connect'}
          </button>
        </div>
      </form>

      {onCancel && <SyncPanel firstRun={false} />}
    </main>
  );
}
