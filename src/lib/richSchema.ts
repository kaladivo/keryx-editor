import Image from '@tiptap/extension-image';
import { generateHTML, generateJSON } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

const StyledImage = Image.extend({
  addAttributes() {
    return { ...this.parent?.(), style: { default: null } };
  },
});

/** The document schema of the rich editor (UI-only extensions such as the placeholder aside). */
export const RICH_EXTENSIONS = [
  StarterKit.configure({ link: { openOnClick: false, defaultProtocol: 'https' } }),
  StyledImage.configure({ allowBase64: true }),
];

const TAG_ALIASES: Record<string, string> = { b: 'strong', i: 'em', strike: 's', del: 's' };
const LINK_ATTRS = new Set(['target', 'rel']);

/** Every element and attribute of the HTML, as `<tag>` and `attr="value" on <tag>` (link target/rel aside). */
function features(html: string): Set<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = new Set<string>();
  for (const el of doc.querySelectorAll('head *, body *')) {
    const raw = el.tagName.toLowerCase();
    const tag = `<${TAG_ALIASES[raw] ?? raw}>`;
    out.add(tag);
    for (const { name, value } of el.attributes) {
      if (raw === 'a' && LINK_ATTRS.has(name)) continue;
      const normalized = name === 'style' && el instanceof HTMLElement ? el.style.cssText : value;
      out.add(`${name}="${normalized}" on ${tag}`);
    }
  }
  return out;
}

const visibleText = (html: string) =>
  (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').replace(/\s+/g, '');

/** What the rich editor would drop from this HTML, e.g. `<table>`, `style on <p>`; empty when nothing. */
export function richModeLosses(html: string): string[] {
  const rich = generateHTML(generateJSON(html, RICH_EXTENSIONS), RICH_EXTENSIONS);
  const kept = features(rich);
  const lost = [...features(html)].filter((f) => !kept.has(f)).map((f) => f.replace(/^([^=]+)=".*" on /s, '$1 on '));
  if (!lost.length && visibleText(rich) !== visibleText(html)) lost.push('some text');
  return [...new Set(lost)];
}
