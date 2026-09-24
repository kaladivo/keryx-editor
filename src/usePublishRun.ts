import { useState } from 'react';
import { RepoChangedError, type Head } from './lib/github';
import { runPublish, type Operation, type PublishContext, type StepId, type StepState } from './lib/publish';

type Steps = Record<StepId, StepState>;

export interface PublishRun {
  op: Operation;
  steps: Steps;
  state: 'running' | 'done' | 'error';
  committed: boolean;
  error?: string;
  repoChanged?: boolean;
}

const initialSteps = (): Steps => ({
  sign: { status: 'pending' },
  commit: { status: 'pending' },
  deploy: { status: 'pending' },
  wakeup: { status: 'pending' },
});

export function usePublishRun(onCommitted: (head: Head) => void) {
  const [run, setRun] = useState<PublishRun | null>(null);

  async function start(ctx: PublishContext, op: Operation, notify: boolean) {
    setRun({ op, steps: initialSteps(), state: 'running', committed: false });
    const update = (patch: (r: PublishRun) => Partial<PublishRun>) =>
      setRun((r) => (r ? { ...r, ...patch(r) } : r));
    try {
      await runPublish(ctx, op, notify, {
        onStep: (id, state) => update((r) => ({ steps: { ...r.steps, [id]: state } })),
        onCommitted: (head) => {
          update(() => ({ committed: true }));
          onCommitted(head);
        },
      });
      update(() => ({ state: 'done' }));
    } catch (e) {
      update(() => ({
        state: 'error',
        error: e instanceof Error ? e.message : String(e),
        repoChanged: e instanceof RepoChangedError,
      }));
    }
  }

  return { run, start, clear: () => setRun(null) };
}
