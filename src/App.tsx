import { lazy, Suspense, useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { PublishDialog } from './components/PublishDialog';
import { Setup } from './components/Setup';
import { deleteDraft, useEvolu } from './lib/db';
import { useEvoluError } from './lib/evolu';
import type { Head } from './lib/github';
import type { Company, Item } from './lib/keryx-api';
import type { Operation } from './lib/publish';
import { connect, type Session } from './lib/session';
import { companyIdOf, type Secrets } from './lib/settings';
import { usePublishRun } from './usePublishRun';

const PostEditor = lazy(() => import('./components/PostEditor').then((m) => ({ default: m.PostEditor })));

type View = { kind: 'setup' } | { kind: 'dashboard' } | { kind: 'editor'; channel: string; item?: Item };

const draftKeyOf = (repo: string, channel: string, id?: string) => `${repo}/${channel}/${id ?? ''}`;

/**
 * Signatures on the committed item: the editor signs with the channel key (simple mode) or the loaded
 * author keys up to the threshold (authored), then the SDK adds its own channel-key signature.
 */
const signaturesFor = (company: Company, mode?: 'simple' | 'authored') =>
  1 + (mode === 'authored' ? Math.max(1, company.keys.filter((k) => k.role === 'author').length) : 1);

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [secrets, setSecrets] = useState<Secrets | null>(null);
  const [view, setView] = useState<View>({ kind: 'setup' });
  const evolu = useEvolu();
  const evoluError = useEvoluError();

  function onCommitted(head: Head, op: Operation) {
    if (!session) return;
    const company = session.keryx.company();
    setSession((s) => s && { ...s, head, company });
    if (op.kind !== 'publish' || view.kind !== 'editor') return;
    void deleteDraft(evolu, draftKeyOf(session.repo.repo, op.channel, view.item?.id));
    const item = company.channels.find((c) => c.name === op.channel)?.items.find((i) => i.id === op.draft.id);
    if (!view.item && item) setView({ kind: 'editor', channel: op.channel, item });
  }
  const { run, start, clear } = usePublishRun(onCommitted);
  const busy = run?.state === 'running';

  function publish(op: Operation, notify: boolean) {
    if (session) void start(session, op, notify);
  }

  async function reload() {
    if (!session || !secrets) return;
    setSession(await connect(session.settings, secrets));
  }

  function closeRun() {
    if (run?.state === 'done' && view.kind === 'editor') setView({ kind: 'dashboard' });
    clear();
  }

  let content;
  if (!session || view.kind === 'setup') {
    content = (
      <Setup
        sessionSecrets={secrets ?? undefined}
        loadedKeys={session?.company.keys}
        onCancel={session ? () => setView({ kind: 'dashboard' }) : undefined}
        onConnected={(next, nextSecrets) => {
          setSession(next);
          setSecrets(nextSecrets);
          setView({ kind: 'dashboard' });
        }}
      />
    );
  } else if (view.kind === 'editor') {
    const channel = session.company.channels.find((c) => c.name === view.channel);
    const draftKey = draftKeyOf(session.repo.repo, view.channel, view.item?.id);
    content = (
      <PostEditor
        key={draftKey}
        draftKey={draftKey}
        channel={view.channel}
        channelLabel={channel?.displayName ?? view.channel}
        item={view.item}
        existingIds={channel?.items.map((i) => i.id) ?? []}
        signatures={signaturesFor(session.company, channel?.mode)}
        busy={busy}
        onCancel={() => setView({ kind: 'dashboard' })}
        onPublish={(draft, notify) =>
          publish({ kind: 'publish', channel: view.channel, draft }, notify)
        }
      />
    );
  } else {
    content = (
      <Dashboard
        key={session.settings.repo}
        company={session.company}
        companyId={companyIdOf(session.settings.siteUrl)}
        repo={session.repo.repo}
        branch={session.repo.branch}
        busy={busy}
        onNew={(channel) => setView({ kind: 'editor', channel })}
        onEdit={(channel, item) => setView({ kind: 'editor', channel, item })}
        onDelete={(channel, id, notify) => publish({ kind: 'delete', channel, id }, notify)}
        onRefreshTimestamp={() => publish({ kind: 'refresh' }, false)}
        onSettings={() => setView({ kind: 'setup' })}
      />
    );
  }

  return (
    <>
      <nav className="topbar">
        <span className="brand">
          <img src="/favicon.svg" alt="" width={22} height={22} />
          Keryx Editor
        </span>
      </nav>
      {evoluError && (
        <p className="alert alert-warn page-alert" role="alert">
          Local data error ({evoluError.type}). Settings and drafts may not be saved or synced; see the console.
        </p>
      )}
      <Suspense fallback={<p className="page muted">Loading the editor…</p>}>{content}</Suspense>
      {run && (
        <PublishDialog
          run={run}
          actionsUrl={`https://github.com/${session?.repo.repo}/actions`}
          onClose={closeRun}
          onReload={reload}
        />
      )}
    </>
  );
}
