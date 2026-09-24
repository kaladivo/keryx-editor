import { useState } from 'react';
import { byteSize, formatBytes } from '../lib/bytes';
import { formatDate } from '../lib/content';
import type { Company, Item } from '../lib/keryx-api';
import { CompanyHeader } from './CompanyHeader';
import { Expiries } from './Expiries';
import { Modal } from './Modal';

interface Props {
  company: Company;
  companyId: string;
  repo: string;
  branch: string;
  busy: boolean;
  onNew: (channel: string) => void;
  onEdit: (channel: string, item: Item) => void;
  onDelete: (channel: string, id: string, notify: boolean) => void;
  onRefreshTimestamp: () => void;
  onSettings: () => void;
}

const newestFirst = (a: Item, b: Item) => Date.parse(b.date_published) - Date.parse(a.date_published);

export function Dashboard(props: Props) {
  const { company, busy } = props;
  const [active, setActive] = useState(company.channels[0]?.name);
  const [toDelete, setToDelete] = useState<Item>();
  const [notifyDelete, setNotifyDelete] = useState(false);
  const channel = company.channels.find((c) => c.name === active) ?? company.channels[0];
  const roles = new Set(company.keys.map((k) => k.role));

  return (
    <main className="page">
      <header className="page-header">
        <CompanyHeader company={company} companyId={props.companyId} repo={props.repo} branch={props.branch} />
        <button type="button" onClick={props.onSettings}>
          Settings
        </button>
      </header>

      <div className="overview">
        <Expiries expires={company.expires} onRefresh={props.onRefreshTimestamp} busy={busy} />
        <section className="card" aria-labelledby="keys-title">
          <div className="card-header">
            <h2 id="keys-title">Keys</h2>
          </div>
          <ul className="key-list">
            {company.keys.map((k) => (
              <li key={k.keyid}>
                <strong>{k.name}</strong>
                <span className="badge">{k.role}</span>
                <code className="muted" title={k.keyid}>
                  {k.keyid.slice(0, 12)}…
                </code>
              </li>
            ))}
          </ul>
          {!roles.has('channel') && <p className="alert alert-warn">No channel key loaded.</p>}
          {!roles.has('ops') && <p className="alert alert-warn">No ops key loaded.</p>}
        </section>
      </div>

      <section className="card" aria-label="Posts">
        {company.channels.length === 0 ? (
          <p className="muted">This company has no channels.</p>
        ) : (
          <>
            <div className="card-header wrap">
              <div className="tabs" role="tablist" aria-label="Channels">
                {company.channels.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    role="tab"
                    id={`tab-${c.name}`}
                    aria-selected={c.name === channel?.name}
                    aria-controls="channel-panel"
                    className="tab"
                    onClick={() => setActive(c.name)}
                  >
                    {c.displayName ?? c.name}
                    <span className="count">{c.items.length}</span>
                  </button>
                ))}
              </div>
              {channel && (
                <button type="button" className="primary" onClick={() => props.onNew(channel.name)} disabled={busy}>
                  New post
                </button>
              )}
            </div>

            {channel && (
              <div id="channel-panel" role="tabpanel" aria-labelledby={`tab-${channel.name}`}>
                {channel.description && <p className="muted channel-description">{channel.description}</p>}
                {channel.items.length === 0 ? (
                  <p className="empty">No posts yet.</p>
                ) : (
                  <ul className="posts">
                    {[...channel.items].sort(newestFirst).map((item) => (
                      <li key={item.id} className="post">
                        <div className="post-main">
                          <div className="post-title">{item.title}</div>
                          <div className="post-meta muted">
                            <span>{formatDate(item.date_published)}</span>
                            <code>{item.id}</code>
                            <span>{formatBytes(byteSize(JSON.stringify(item)))}</span>
                          </div>
                        </div>
                        <div className="post-actions">
                          <button type="button" onClick={() => props.onEdit(channel.name, item)} disabled={busy}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className="danger-outline"
                            onClick={() => {
                              setNotifyDelete(false);
                              setToDelete(item);
                            }}
                            disabled={busy}
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {toDelete && channel && (
        <Modal
          title="Delete this post?"
          onClose={() => setToDelete(undefined)}
          footer={
            <>
              <button type="button" onClick={() => setToDelete(undefined)}>
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setToDelete(undefined);
                  props.onDelete(channel.name, toDelete.id, notifyDelete);
                }}
              >
                Delete
              </button>
            </>
          }
        >
          <p>
            <strong>{toDelete.title}</strong> will be unpublished from {channel.displayName ?? channel.name}.
            Subscribers' apps drop it on their next sync.
          </p>
          <label className="check">
            <input type="checkbox" checked={notifyDelete} onChange={(e) => setNotifyDelete(e.target.checked)} />
            <span>Notify subscribers now</span>
          </label>
        </Modal>
      )}
    </main>
  );
}
