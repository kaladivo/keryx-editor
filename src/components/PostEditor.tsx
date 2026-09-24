import { useEffect, useState } from 'react';
import {
  contentProblems,
  fromLocalInput,
  ID_PATTERN,
  isBlankHtml,
  loadsRemote,
  rfc3339Now,
  slugify,
  toLocalInput,
} from '../lib/content';
import { deleteDraft, useEvolu, useStoredDraft } from '../lib/db';
import { MAX_ITEM_BYTES, signedItemSize } from '../lib/itemSize';
import type { Draft, Item } from '../lib/keryx-api';
import { useDraftAutosave } from '../useDraftAutosave';
import { PreviewImage } from './PreviewImage';
import { RichEditor } from './RichEditor';
import { SizeMeter } from './SizeMeter';

interface Props {
  channel: string;
  channelLabel: string;
  item?: Item;
  existingIds: string[];
  /** Signatures the committed item will carry (see signaturesFor in App). */
  signatures: number;
  /** Where the unsaved draft of this post is kept. */
  draftKey: string;
  busy: boolean;
  onCancel: () => void;
  onPublish: (draft: Draft, notify: boolean) => void;
}

const withoutUndefined = <T extends object>(obj: T): T =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;

interface PostForm {
  title: string;
  id: string;
  idTouched: boolean;
  published: string;
  language: string;
  tags: string;
  image?: string;
  html: string;
  notify: boolean;
}

const formOf = (item?: Item): PostForm => ({
  title: item?.title ?? '',
  id: item?.id ?? '',
  idTouched: false,
  published: item?.date_published ?? rfc3339Now(),
  language: item?.language ?? 'en',
  tags: item?.tags?.join(', ') ?? '',
  image: item?.image,
  html: item?.content_html ?? '',
  notify: !item,
});

const PREVIEW_HEAD =
  '<!doctype html><meta charset="utf-8">' +
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src data:; font-src data:; style-src 'unsafe-inline'">` +
  '<meta name="viewport" content="width=device-width">' +
  '<style>body{font:16px/1.55 system-ui,sans-serif;margin:16px;color:#1f2328;background:#fff}img{max-width:100%;height:auto}h1{font-size:1.4em;line-height:1.25}</style>';

const parseForm = (json: string | null): PostForm | null => {
  try {
    return json ? (JSON.parse(json) as PostForm) : null;
  } catch {
    return null;
  }
};

interface Start {
  form: PostForm;
  restored: boolean;
  /** Bumped to remount the form with a new start. */
  version: number;
}

/** Starts from the post's unsaved draft, if any, and adopts drafts synced from other devices. */
export function PostEditor(props: Props) {
  const { item, draftKey } = props;
  const evolu = useEvolu();
  const storedJson = useStoredDraft(draftKey);
  const [start, setStart] = useState<Start>(() => {
    const draft = parseForm(storedJson);
    return { form: draft ?? formOf(item), restored: draft !== null, version: 0 };
  });
  const restart = (form: PostForm, restored: boolean) => setStart((s) => ({ form, restored, version: s.version + 1 }));

  return (
    <PostEditorForm
      key={start.version}
      {...props}
      initial={start.form}
      restored={start.restored}
      storedJson={storedJson}
      onSyncedDraft={(json) => {
        const draft = parseForm(json);
        if (draft) restart(draft, true);
      }}
      onDiscard={() => void deleteDraft(evolu, draftKey).then(() => restart(formOf(item), false))}
    />
  );
}

interface FormProps extends Props {
  initial: PostForm;
  restored: boolean;
  storedJson: string | null;
  onSyncedDraft: (json: string) => void;
  onDiscard: () => void;
}

function PostEditorForm(props: FormProps) {
  const { channel, channelLabel, item, existingIds, signatures, draftKey, busy, onCancel, onPublish, storedJson, onSyncedDraft } =
    props;
  const isNew = !item;
  const [form, setForm] = useState(props.initial);
  const [blank] = useState(() => formOf(item));
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const set = (patch: Partial<PostForm>) => setForm((f) => ({ ...f, ...patch }));
  const { title, id, idTouched, published, language, tags, image, html, notify } = form;

  const json = JSON.stringify(form);
  const pristine = JSON.stringify(isNew ? { ...blank, published } : blank) === json;
  const autosave = useDraftAutosave(draftKey, json, pristine);

  const syncedDraft = storedJson !== null && storedJson !== json && storedJson !== autosave.savedJson;
  useEffect(() => {
    if (syncedDraft && !autosave.unsaved) onSyncedDraft(storedJson);
  }, [syncedDraft, autosave.unsaved, storedJson, onSyncedDraft]);

  function back() {
    if (autosave.unsaved && autosave.failed && !window.confirm('This draft could not be saved on this device. Discard it?')) return;
    if (autosave.unsaved) void autosave.flush();
    onCancel();
  }

  const postId = isNew && !idTouched ? slugify(title) : id;

  const buildDraft = (): Draft => {
    const { sig: _sig, ...previous } = item ?? ({} as Partial<Item>);
    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
    return withoutUndefined({
      ...previous,
      id: postId,
      title: title.trim(),
      content_html: html,
      date_published: published,
      date_modified: isNew ? undefined : rfc3339Now(),
      language: language.trim() || undefined,
      tags: tagList.length ? tagList : undefined,
      image,
      image_sha256: image && image === item?.image ? item.image_sha256 : undefined,
    });
  };

  const draft = buildDraft();
  const size = signedItemSize(draft, signatures);
  const problems = [
    ...(title.trim() ? [] : ['Add a title.']),
    ...(ID_PATTERN.test(postId) ? [] : ['The id may only contain a–z, 0–9, "-" and "_".']),
    ...(isNew && existingIds.includes(postId) ? [`A post with the id "${postId}" already exists.`] : []),
    ...(isBlankHtml(html) ? ['Write some content.'] : []),
    ...contentProblems(html),
    ...(size > MAX_ITEM_BYTES ? ['The post is larger than 1 MB; shrink or remove images.'] : []),
  ];

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{channelLabel}</p>
          <h1>{isNew ? 'New post' : 'Edit post'}</h1>
        </div>
        <button type="button" onClick={back} disabled={busy}>
          Back
        </button>
      </header>

      <form
        className="editor-layout"
        onSubmit={(e) => {
          e.preventDefault();
          if (problems.length) return;
          void autosave.flush();
          onPublish(buildDraft(), notify);
        }}
      >
        {props.restored && (
          <p className="alert alert-warn">
            Restored unsaved draft ·{' '}
            <button type="button" className="link-button" onClick={props.onDiscard}>
              Discard
            </button>
          </p>
        )}
        <div className="card form">
          <label className="field">
            <span className="label">Title</span>
            <input className="title-input" value={title} onChange={(e) => set({ title: e.target.value })} required />
          </label>

          <div className="grid-2">
            <div className="field">
              <label className="field-label">
                <span className="label">Id</span>
                <input
                  className="mono"
                  value={postId}
                  readOnly={!isNew}
                  onChange={(e) => set({ idTouched: true, id: e.target.value })}
                  spellCheck={false}
                  autoCapitalize="off"
                  aria-describedby="id-hint"
                />
              </label>
              <span id="id-hint" className="hint">
                {isNew ? `channels/${channel}/${postId || '…'}.json` : 'The id cannot change after publishing.'}
              </span>
            </div>
            <label className="field">
              <span className="label">Published</span>
              <input
                type="datetime-local"
                value={toLocalInput(published)}
                onChange={(e) => e.target.value && set({ published: fromLocalInput(e.target.value) })}
                required
              />
            </label>
            <label className="field">
              <span className="label">Language</span>
              <input value={language} onChange={(e) => set({ language: e.target.value })} spellCheck={false} />
            </label>
            <label className="field">
              <span className="label">Tags</span>
              <input value={tags} onChange={(e) => set({ tags: e.target.value })} placeholder="firmware, security" />
            </label>
          </div>

          <PreviewImage image={image} html={html} onChange={(next) => set({ image: next })} />
        </div>

        <div className="card">
          <div className="tabs" role="tablist" aria-label="Content view">
            {(['write', 'preview'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                className="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
              >
                {t === 'write' ? 'Write' : 'Preview'}
              </button>
            ))}
          </div>
          <div hidden={tab !== 'write'}>
            <RichEditor value={html} onChange={(next) => set({ html: next })} />
          </div>
          {tab === 'preview' &&
            (loadsRemote(html) ? (
              <p className="alert alert-warn">No preview while the post links remote media.</p>
            ) : (
              <div className="preview-frame">
                <iframe title="Post preview" sandbox="" srcDoc={`${PREVIEW_HEAD}<h1>${escapeHtml(title)}</h1>${html}`} />
              </div>
            ))}
        </div>

        <div className="card publish-bar">
          <SizeMeter bytes={size} />
          {problems.length > 0 && (
            <ul className="problems">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <div className="publish-actions">
            <label className="check">
              <input type="checkbox" checked={notify} onChange={(e) => set({ notify: e.target.checked })} />
              <span>Notify subscribers</span>
            </label>
            <button type="submit" className="primary" disabled={busy || problems.length > 0}>
              {isNew ? 'Publish' : 'Publish changes'}
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
