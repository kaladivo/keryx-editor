import { lazy, Suspense, useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { PublishDialog } from './components/PublishDialog';
import { Setup } from './components/Setup';
import type { Head } from './lib/github';
import type { Item } from './lib/keryx-api';
import type { Operation } from './lib/publish';
import { connect, type Session } from './lib/session';
import { companyIdOf, type Secrets } from './lib/settings';
import { usePublishRun } from './usePublishRun';

const PostEditor = lazy(() => import('./components/PostEditor').then((m) => ({ default: m.PostEditor })));

type View = { kind: 'setup' } | { kind: 'dashboard' } | { kind: 'editor'; channel: string; item?: Item };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [secrets, setSecrets] = useState<{ secrets: Secrets; remember: boolean } | null>(null);
  const [view, setView] = useState<View>({ kind: 'setup' });

  const onCommitted = (head: Head) => setSession((s) => s && { ...s, head, company: s.keryx.company() });
  const { run, start, clear } = usePublishRun(onCommitted);
  const busy = run?.state === 'running';

  function publish(op: Operation, notify: boolean) {
    if (session) void start(session, op, notify);
  }

  async function reload() {
    if (!session || !secrets) return;
    setSession(await connect(session.settings, secrets.secrets));
  }

  function closeRun() {
    if (run?.state === 'done' && view.kind === 'editor') setView({ kind: 'dashboard' });
    clear();
  }

  let content;
  if (!session || view.kind === 'setup') {
    content = (
      <Setup
        initial={session && secrets ? { settings: session.settings, ...secrets } : undefined}
        loadedKeys={session?.company.keys}
        onCancel={session ? () => setView({ kind: 'dashboard' }) : undefined}
        onConnected={(next, nextSecrets, remember) => {
          setSession(next);
          setSecrets({ secrets: nextSecrets, remember });
          setView({ kind: 'dashboard' });
        }}
      />
    );
  } else if (view.kind === 'editor') {
    const channel = session.company.channels.find((c) => c.name === view.channel);
    content = (
      <PostEditor
        key={`${view.channel}/${view.item?.id ?? 'new'}`}
        channel={view.channel}
        channelLabel={channel?.displayName ?? view.channel}
        item={view.item}
        existingIds={channel?.items.map((i) => i.id) ?? []}
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
      <Suspense fallback={<p className="page muted">Loading the editor…</p>}>{content}</Suspense>
      {run && <PublishDialog run={run} onClose={closeRun} onReload={reload} />}
    </>
  );
}
