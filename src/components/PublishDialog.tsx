import { useState } from 'react';
import { STEP_LABELS, type Operation, type StepId, type StepState } from '../lib/publish';
import type { PublishRun } from '../usePublishRun';
import { Modal } from './Modal';

const TITLES: Record<Operation['kind'], string> = {
  publish: 'Publishing',
  delete: 'Deleting',
  refresh: 'Refreshing the timestamp',
};

const MARKS: Record<StepState['status'], string> = {
  pending: '',
  running: '',
  done: '✓',
  skipped: '–',
  warn: '!',
  error: '!',
};

interface Props {
  run: PublishRun;
  actionsUrl: string;
  onClose: () => void;
  onReload: () => Promise<void>;
}

export function PublishDialog({ run, actionsUrl, onClose, onReload }: Props) {
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState<string>();
  const needsReload = run.state === 'error' && !run.committed && run.steps.sign.status === 'done';

  async function reload() {
    setReloading(true);
    setReloadError(undefined);
    try {
      await onReload();
      onClose();
    } catch (e) {
      setReloadError(e instanceof Error ? e.message : String(e));
    } finally {
      setReloading(false);
    }
  }

  return (
    <Modal
      title={TITLES[run.op.kind]}
      onClose={run.state === 'running' ? undefined : onClose}
      footer={
        <>
          {needsReload && (
            <button type="button" onClick={reload} disabled={reloading}>
              {reloading ? 'Reloading…' : 'Reload'}
            </button>
          )}
          <button type="button" className="primary" onClick={onClose} disabled={run.state === 'running'}>
            {run.state === 'running' ? 'Working…' : 'Close'}
          </button>
        </>
      }
    >
      <ol className="steps" aria-live="polite">
        {(Object.keys(STEP_LABELS) as StepId[]).map((id) => {
          const step = run.steps[id];
          return (
            <li key={id} className={`step step-${step.status}`}>
              <span className="step-mark" aria-hidden="true">
                {MARKS[step.status]}
              </span>
              <div>
                <div className="step-label">
                  {STEP_LABELS[id]}
                  <span className="visually-hidden"> ({step.status})</span>
                </div>
                {step.detail && <div className="step-detail">{step.detail}</div>}
                {step.note && <div className="step-detail step-note">{step.note}</div>}
              </div>
            </li>
          );
        })}
      </ol>
      {run.repoChanged && (
        <p className="alert alert-error" role="alert">
          The repo changed since you loaded it; reload and retry.
        </p>
      )}
      {needsReload && !run.repoChanged && (
        <p className="alert alert-warn">Nothing was committed. Reload to discard the unsaved signing before retrying.</p>
      )}
      {reloadError && (
        <div className="alert alert-error" role="alert">
          <pre className="error-text">{reloadError}</pre>
        </div>
      )}
      {run.state === 'done' &&
        (run.deployPending ? (
          <p className="alert alert-warn">
            Committed, deploy still pending.{' '}
            <a href={actionsUrl} target="_blank" rel="noreferrer">
              Check GitHub Actions
            </a>
          </p>
        ) : (
          <p className="hint">All done.</p>
        ))}
    </Modal>
  );
}
