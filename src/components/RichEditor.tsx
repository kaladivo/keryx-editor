import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Selection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useRef, useState, type ReactNode } from 'react';
import { imageToDataUrl } from '../lib/images';
import { Icon } from './icons';

const MAX_IMAGE_SIZE = 1200;

const StyledImage = Image.extend({
  addAttributes() {
    return { ...this.parent?.(), style: { default: null } };
  },
});

const imageFiles = (files?: FileList | null) => [...(files ?? [])].filter((f) => f.type.startsWith('image/'));

async function insertImages(view: EditorView, files: File[], onError: (message: string) => void) {
  const nodes: ProseMirrorNode[] = [];
  for (const file of files) {
    try {
      const src = await imageToDataUrl(file, MAX_IMAGE_SIZE);
      nodes.push(view.state.schema.nodes.image.create({ src, alt: file.name.replace(/\.[^.]+$/, '') }));
    } catch (e) {
      onError(`Could not add ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (nodes.length) view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.from(nodes), 0, 0)).scrollIntoView());
}

interface Props {
  value: string;
  onChange: (html: string) => void;
}

export function RichEditor({ value, onChange }: Props) {
  const [mode, setMode] = useState<'rich' | 'html'>('rich');
  const [error, setError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, defaultProtocol: 'https' } }),
      StyledImage.configure({ allowBase64: true }),
      Placeholder.configure({ placeholder: 'Write your post…' }),
    ],
    content: value,
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: { class: 'prose', 'aria-label': 'Post content', 'aria-multiline': 'true', role: 'textbox' },
      handlePaste: (view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        if (!files.length) return false;
        void insertImages(view, files, setError);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = moved ? [] : imageFiles(event.dataTransfer?.files);
        if (!files.length) return false;
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (pos) view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(pos.pos))));
        void insertImages(view, files, setError);
        return true;
      },
    },
  });

  function switchMode(next: 'rich' | 'html') {
    if (next === 'rich') editor.commands.setContent(value, { emitUpdate: false });
    setMode(next);
  }

  return (
    <div className="rich-editor">
      <Toolbar
        editor={editor}
        mode={mode}
        onMode={switchMode}
        onImage={() => fileInput.current?.click()}
      />
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void insertImages(editor.view, imageFiles(e.target.files), setError);
          e.target.value = '';
        }}
      />
      {mode === 'rich' ? (
        <EditorContent editor={editor} className="editor-surface" />
      ) : (
        <textarea
          className="editor-surface html-source mono"
          aria-label="Post HTML"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}{' '}
          <button type="button" className="link-button" onClick={() => setError(undefined)}>
            Dismiss
          </button>
        </p>
      )}
    </div>
  );
}

interface ToolbarProps {
  editor: Editor;
  mode: 'rich' | 'html';
  onMode: (mode: 'rich' | 'html') => void;
  onImage: () => void;
}

function Toolbar({ editor, mode, onMode, onImage }: ToolbarProps) {
  const rich = mode === 'rich';
  const chain = () => editor.chain().focus();

  const button = (label: string, text: ReactNode, run: () => void, active?: boolean, disabled?: boolean) => (
    <button
      key={label}
      type="button"
      className="tool"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={!rich || disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {text}
    </button>
  );

  function setLink() {
    const current = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL (absolute, e.g. https://example.com)', current ?? 'https://');
    if (url === null) return;
    if (url.trim() === '' || url.trim() === 'https://') {
      chain().extendMarkRange('link').unsetLink().run();
      return;
    }
    chain().extendMarkRange('link').setLink({ href: url.trim() }).run();
  }

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <div className="tool-group">
        {button('Heading 2', 'H2', () => chain().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }))}
        {button('Heading 3', 'H3', () => chain().toggleHeading({ level: 3 }).run(), editor.isActive('heading', { level: 3 }))}
      </div>
      <div className="tool-group">
        {button('Bold', 'B', () => chain().toggleBold().run(), editor.isActive('bold'))}
        {button('Italic', 'I', () => chain().toggleItalic().run(), editor.isActive('italic'))}
        {button('Underline', 'U', () => chain().toggleUnderline().run(), editor.isActive('underline'))}
        {button('Strikethrough', 'S', () => chain().toggleStrike().run(), editor.isActive('strike'))}
        {button('Inline code', '</>', () => chain().toggleCode().run(), editor.isActive('code'))}
      </div>
      <div className="tool-group">
        {button('Bullet list', <Icon name="bulletList" />, () => chain().toggleBulletList().run(), editor.isActive('bulletList'))}
        {button('Numbered list', <Icon name="orderedList" />, () => chain().toggleOrderedList().run(), editor.isActive('orderedList'))}
        {button('Quote', <Icon name="quote" />, () => chain().toggleBlockquote().run(), editor.isActive('blockquote'))}
        {button('Code block', '{ }', () => chain().toggleCodeBlock().run(), editor.isActive('codeBlock'))}
        {button('Divider', '—', () => chain().setHorizontalRule().run())}
      </div>
      <div className="tool-group">
        {button('Link', 'Link', setLink, editor.isActive('link'))}
        {button('Image', 'Image', onImage)}
      </div>
      <div className="tool-group">
        {button('Undo', <Icon name="undo" />, () => chain().undo().run(), undefined, !editor.can().undo())}
        {button('Redo', <Icon name="redo" />, () => chain().redo().run(), undefined, !editor.can().redo())}
      </div>
      <button
        type="button"
        className="tool tool-html"
        aria-pressed={!rich}
        onClick={() => onMode(rich ? 'html' : 'rich')}
      >
        HTML
      </button>
    </div>
  );
}
