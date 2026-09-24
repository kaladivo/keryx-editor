import type { Change, Draft, Keryx } from './keryx-api';
import { commitChange, type Head, type RepoRef } from './github';
import { formatVersions, waitForDeploy } from './deploy';
import { assertItemFits } from './itemSize';
import { publishWakeup, refreshCompany, type WakeupResult } from './relay';
import { companyIdOf, type Settings } from './settings';

export type Operation =
  | { kind: 'publish'; channel: string; draft: Draft }
  | { kind: 'delete'; channel: string; id: string }
  | { kind: 'refresh' };

export type StepId = 'sign' | 'commit' | 'deploy' | 'wakeup';
export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'warn' | 'error';
export interface StepState {
  status: StepStatus;
  detail?: string;
  note?: string;
}

export const STEP_LABELS: Record<StepId, string> = {
  sign: 'Sign metadata',
  commit: 'Commit to GitHub',
  deploy: 'Wait for the deploy',
  wakeup: 'Wake up subscribers',
};

export interface PublishContext {
  keryx: Keryx;
  settings: Settings;
  repo: RepoRef;
  head: Head;
}

export interface PublishCallbacks {
  onStep: (id: StepId, state: StepState) => void;
  onCommitted: (head: Head) => void;
}

function apply(keryx: Keryx, op: Operation): { change: Change; message: string } {
  switch (op.kind) {
    case 'publish':
      return { change: keryx.publish(op.channel, op.draft), message: `news: ${op.draft.title}` };
    case 'delete':
      return { change: keryx.unpublish(op.channel, op.id), message: `news: delete ${op.id}` };
    case 'refresh':
      return { change: keryx.refreshTimestamp(), message: 'chore: refresh timestamp' };
  }
}

const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;

const repoDirOf = (settings: Settings) => settings.repoDir.replace(/\/+$/, '');

function timestampVersion(change: Change, settings: Settings): number {
  const bytes = change.write[`${repoDirOf(settings)}/timestamp.json`];
  if (!bytes) throw new Error('The change did not re-sign timestamp.json.');
  return (JSON.parse(new TextDecoder().decode(bytes)) as { signed: { version: number } }).signed.version;
}

function wakeupState(result: WakeupResult): StepState {
  if (!result.readable) {
    return {
      status: 'done',
      detail: "Wake-up sent. The relay doesn't allow this site to read its response, so the delivery count is unknown.",
      note: `To see counts, add ${location.origin} to the relay's RELAY_CORS_ORIGINS.`,
    };
  }
  const detail =
    result.sent !== undefined
      ? `Wake-up sent to ${result.sent} device${result.sent === 1 ? '' : 's'} (webpush sent=${result.sent})`
      : `Wake-up accepted (HTTP ${result.status})`;
  return { status: 'done', detail };
}

/**
 * Runs every step, reporting progress; throws the failing step's error after marking it.
 * Resolves `deployed: false` when the commit landed but the deploy did not show up in time.
 */
export async function runPublish(
  ctx: PublishContext,
  op: Operation,
  notify: boolean,
  cb: PublishCallbacks,
): Promise<{ deployed: boolean }> {
  let current: StepId = 'sign';
  const step = (id: StepId, state: StepState) => {
    current = id;
    cb.onStep(id, state);
  };

  try {
    step('sign', { status: 'running' });
    const { change, message } = apply(ctx.keryx, op);
    const files = Object.keys(change.write).length + change.remove.length;
    step('sign', { status: 'done', detail: `${files} file${files === 1 ? '' : 's'} changed` });

    step('commit', { status: 'running', detail: message });
    if (op.kind === 'publish') {
      assertItemFits(change, `${repoDirOf(ctx.settings)}/channels/${op.channel}/${op.draft.id}.json`);
    }
    const head = await commitChange(ctx.repo, ctx.head, change, message);
    cb.onCommitted(head);
    step('commit', { status: 'done', detail: `${message} (${head.commit.slice(0, 7)})` });

    const { settings, keryx } = ctx;
    const channel = op.kind === 'refresh' ? undefined : op.channel;
    const want = channel ? keryx.versions(channel) : { timestamp: timestampVersion(change, settings) };
    const base = keryx.company().repoBase ?? `${settings.siteUrl.replace(/\/+$/, '')}/${settings.repoDir}/`;
    step('deploy', { status: 'running', detail: `want ${formatVersions(want)}` });
    const got = await waitForDeploy(base, want, channel, ({ elapsedMs, got, error }) =>
      step('deploy', {
        status: 'running',
        detail: `${seconds(elapsedMs)} · ${got ? `deployed ${formatVersions(got)}` : error} · want ${formatVersions(want)}`,
      }),
    );
    if (!got) {
      step('deploy', { status: 'warn', detail: `Still pending after 5 minutes · want ${formatVersions(want)}` });
      step('wakeup', { status: 'skipped', detail: notify && channel ? 'Not sent: the deploy has not landed yet' : undefined });
      return { deployed: false };
    }
    step('deploy', { status: 'done', detail: `Deployed: ${formatVersions(got)}` });

    if (!notify || !channel) {
      step('wakeup', { status: 'skipped' });
      return { deployed: true };
    }

    const companyId = companyIdOf(settings.siteUrl);
    step('wakeup', { status: 'running', detail: 'Refreshing the relay' });
    await refreshCompany(settings.relayUrl, companyId);
    const request = keryx.signWakeup(companyId, channel, Math.floor(Date.now() / 1000));
    step('wakeup', { status: 'running', detail: 'Sending the wake-up' });
    const result = await publishWakeup(settings.relayUrl, request, (attempt, reason) =>
      step('wakeup', { status: 'running', detail: `${reason}; retry ${attempt} of 4 in 15 s` }),
    );
    step('wakeup', wakeupState(result));
    return { deployed: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    cb.onStep(current, { status: 'error', detail: message });
    throw e;
  }
}
