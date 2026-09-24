import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { forgetSecrets, loadStored, saveSecrets, saveSettings } from '../lib/db';
import type { KeyFile, KeyInfo } from '../lib/keryx-api';
import { connect, type Session } from '../lib/session';
import { companyIdOf, defaultSettings, mergeKeys, parseKeyFiles, type Secrets, type Settings } from '../lib/settings';

interface Props {
  initial?: { settings: Settings; secrets: Secrets; remember: boolean };
  loadedKeys?: KeyInfo[];
  onConnected: (session: Session, secrets: Secrets, remember: boolean) => void;
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

export function Setup({ initial, loadedKeys, onConnected, onCancel }: Props) {
  const [settings, setSettings] = useState<Settings>(initial?.settings ?? defaultSettings);
  const [token, setToken] = useState(initial?.secrets.token ?? '');
  const [keysText, setKeysText] = useState(initial ? JSON.stringify(initial.secrets.keys, null, 2) : '');
  const [fileKeys, setFileKeys] = useState<KeyFile[]>([]);
  const [remember, setRemember] = useState(initial?.remember ?? false);
  const [hasStored, setHasStored] = useState(false);
  const [storageError, setStorageError] = useState<string>();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string>();

  const hasInitial = initial !== undefined;
  useEffect(() => {
    let cancelled = false;
    loadStored().then(
      (stored) => {
        if (cancelled) return;
        setHasStored(stored.secrets !== null);
        if (hasInitial) return;
        setSettings(stored.settings);
        if (stored.secrets) {
          setToken(stored.secrets.token);
          setKeysText(JSON.stringify(stored.secrets.keys, null, 2));
          setRemember(true);
        }
      },
      (e: unknown) => !cancelled && setStorageError(errorText(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [hasInitial]);

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

  async function forget() {
    try {
      await forgetSecrets();
      setHasStored(false);
      setRemember(false);
    } catch (e) {
      setStorageError(errorText(e));
    }
  }

  async function persist(secrets: Secrets) {
    try {
      await saveSettings(settings);
      if (remember) await saveSecrets(secrets);
      else if (hasStored) await forgetSecrets();
    } catch (e) {
      setStorageError(errorText(e));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setConnecting(true);
    const secrets = { token: token.trim(), keys };
    try {
      await persist(secrets);
      onConnected(await connect(settings, secrets), secrets, remember);
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
          <h1>Connect a company</h1>
          <p className="muted">Point the editor at your Keryx repository and load your publishing keys.</p>
        </div>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Back
          </button>
        )}
      </header>

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
                    onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
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
              Remember the token and keys on this device
              <span className="hint block">
                Stored locally in this browser only (never synced). Otherwise they stay in memory until you close the
                tab.
              </span>
            </span>
          </label>
          {hasStored && (
            <button type="button" className="danger-outline" onClick={forget}>
              Forget saved token and keys
            </button>
          )}
          {storageError && <p className="alert alert-warn">Local storage is unavailable: {storageError}</p>}
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
    </main>
  );
}
