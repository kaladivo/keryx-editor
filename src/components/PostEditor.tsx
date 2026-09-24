import { useState } from 'react';
import { byteSize } from '../lib/bytes';
import { contentProblems, fromLocalInput, ID_PATTERN, rfc3339Now, slugify, toLocalInput } from '../lib/content';
import type { Draft, Item } from '../lib/keryx-api';
import { PreviewImage } from './PreviewImage';
import { RichEditor } from './RichEditor';
import { SizeMeter, MAX_ITEM_BYTES } from './SizeMeter';

interface Props {
  channel: string;
  channelLabel: string;
  item?: Item;
  existingIds: string[];
  busy: boolean;
  onCancel: () => void;
  onPublish: (draft: Draft, notify: boolean) => void;
}

const withoutUndefined = <T extends object>(obj: T): T =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;

export function PostEditor({ channel, channelLabel, item, existingIds, busy, onCancel, onPublish }: Props) {
  const isNew = !item;
  const [title, setTitle] = useState(item?.title ?? '');
  const [id, setId] = useState(item?.id ?? '');
  const [idTouched, setIdTouched] = useState(false);
  const [published, setPublished] = useState(item?.date_published ?? rfc3339Now());
  const [language, setLanguage] = useState(item?.language ?? 'en');
  const [tags, setTags] = useState(item?.tags?.join(', ') ?? '');
  const [image, setImage] = useState(item?.image);
  const [html, setHtml] = useState(item?.content_html ?? '');
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [notify, setNotify] = useState(isNew);

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
  const size = byteSize(JSON.stringify(draft));
  const problems = [
    ...(title.trim() ? [] : ['Add a title.']),
    ...(ID_PATTERN.test(postId) ? [] : ['The id may only contain a–z, 0–9, "-" and "_".']),
    ...(isNew && existingIds.includes(postId) ? [`A post with the id "${postId}" already exists.`] : []),
    ...(html.replace(/<[^>]*>/g, '').trim() || /<img\s/i.test(html) ? [] : ['Write some content.']),
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
        <button type="button" onClick={onCancel} disabled={busy}>
          Back
        </button>
      </header>

      <form
        className="editor-layout"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problems.length) onPublish(buildDraft(), notify);
        }}
      >
        <div className="card form">
          <label className="field">
            <span className="label">Title</span>
            <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>

          <div className="grid-2">
            <div className="field">
              <label className="field-label">
                <span className="label">Id</span>
                <input
                  className="mono"
                  value={postId}
                  readOnly={!isNew}
                  onChange={(e) => {
                    setIdTouched(true);
                    setId(e.target.value);
                  }}
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
                onChange={(e) => e.target.value && setPublished(fromLocalInput(e.target.value))}
                required
              />
            </label>
            <label className="field">
              <span className="label">Language</span>
              <input value={language} onChange={(e) => setLanguage(e.target.value)} spellCheck={false} />
            </label>
            <label className="field">
              <span className="label">Tags</span>
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="firmware, security" />
            </label>
          </div>

          <PreviewImage image={image} html={html} onChange={setImage} />
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
            <RichEditor value={html} onChange={setHtml} />
          </div>
          {tab === 'preview' && (
            <div className="preview-frame">
              <iframe
                title="Post preview"
                sandbox=""
                srcDoc={`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{font:16px/1.55 system-ui,sans-serif;margin:16px;color:#1f2328;background:#fff}img{max-width:100%;height:auto}h1{font-size:1.4em;line-height:1.25}</style><h1>${escapeHtml(title)}</h1>${html}`}
              />
            </div>
          )}
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
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
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
