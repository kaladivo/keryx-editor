import { useState, type FormEvent } from 'react';
import { useEvolu } from '../lib/db';
import { resetOwner, restoreOwner, SYNC_RELAY_URL, useCurrentEvolu } from '../lib/evolu';
import { parseMnemonic } from '../lib/owner';

const relayHost = new URL(SYNC_RELAY_URL).host;

export function RecoveryPhrase() {
  const { appOwner } = useEvolu();
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => navigator.clipboard.writeText(appOwner.mnemonic).then(() => setCopied(true), () => setCopied(false));

  return (
    <div className="field">
      <span className="label">Recovery phrase</span>
      {shown ? (
        <>
          <textarea className="mono" rows={3} readOnly value={appOwner.mnemonic} aria-label="Recovery phrase" />
          <div className="button-row">
            <button type="button" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" onClick={() => setShown(false)}>
              Hide
            </button>
          </div>
        </>
      ) : (
        <div className="button-row">
          <button type="button" onClick={() => setShown(true)}>
            Show recovery phrase
          </button>
        </div>
      )}
      <span className="hint">
        Anyone with this phrase can read your synced settings, drafts, and remembered token and keys. Keep it private.
      </span>
    </div>
  );
}

export function RestoreFromPhrase() {
  const { appOwner } = useEvolu();
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();

  function submit(e: FormEvent) {
    e.preventDefault();
    const mnemonic = parseMnemonic(text);
    if (!mnemonic.ok) {
      setError('That is not a valid recovery phrase. Check the words, their spelling and their order.');
      return;
    }
    if (mnemonic.value === appOwner.mnemonic) {
      setError('This device already uses this recovery phrase.');
      return;
    }
    const replace = window.confirm(
      "Restore from this recovery phrase? This device switches to that phrase's synced data and stops showing its current data. Back up the current recovery phrase first if you still need it.",
    );
    if (replace) void restoreOwner(mnemonic.value);
  }

  return (
    <form className="field" onSubmit={submit}>
      <label className="field-label">
        <span className="label">Recovery phrase to restore</span>
        <textarea
          className="mono"
          rows={2}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(undefined);
          }}
          placeholder="twelve or twenty-four words…"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-invalid={error ? true : undefined}
        />
      </label>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <button type="submit" disabled={!text.trim()}>
          Restore
        </button>
      </div>
    </form>
  );
}

export function ResetDevice() {
  function reset() {
    const confirmed = window.confirm(
      'Reset this device? It gets a new, empty recovery phrase. Data under the current phrase stays on the sync relay and comes back only by restoring that phrase.',
    );
    if (confirmed) void resetOwner();
  }

  return (
    <div className="field">
      <div className="button-row">
        <button type="button" className="danger-outline" onClick={reset}>
          Reset this device
        </button>
      </div>
      <span className="hint">Starts over on this device with a new recovery phrase and no data.</span>
    </div>
  );
}

function SwitchNotice() {
  const { origin } = useCurrentEvolu();
  if (origin === 'restored')
    return <p className="alert alert-ok">Restored. Your settings, token, keys and drafts sync in from the relay.</p>;
  if (origin === 'reset') return <p className="alert alert-ok">This device was reset and has a new recovery phrase.</p>;
  return null;
}

/** On the first screen: a compact restore, with the phrase and reset folded away. On Settings: everything. */
export function SyncPanel({ firstRun }: { firstRun: boolean }) {
  if (firstRun)
    return (
      <section className="card form sync-panel" aria-labelledby="restore-title">
        <SwitchNotice />
        <h2 id="restore-title">Already use Keryx Editor elsewhere? Restore from your recovery phrase</h2>
        <RestoreFromPhrase />
        <details>
          <summary>This device's recovery phrase and reset</summary>
          <div className="form">
            <RecoveryPhrase />
            <ResetDevice />
          </div>
        </details>
      </section>
    );

  return (
    <section className="card form sync-panel" aria-labelledby="sync-title">
      <div>
        <h2 id="sync-title">Sync</h2>
        <p className="hint">
          Settings, drafts and remembered token and keys sync end-to-end encrypted through {relayHost} to every device
          that uses your recovery phrase.
        </p>
      </div>
      <RecoveryPhrase />
      <div className="form-section">
        <h3>Restore from recovery phrase</h3>
        <RestoreFromPhrase />
      </div>
      <div className="form-section">
        <ResetDevice />
      </div>
    </section>
  );
}
