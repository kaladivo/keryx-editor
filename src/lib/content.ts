export const ID_PATTERN = /^[a-z0-9_-]+$/;

export const slugify = (title: string): string =>
  title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

export const rfc3339Now = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/** RFC 3339 (UTC) → value for `<input type="datetime-local">` in local time. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export const fromLocalInput = (value: string): string =>
  new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z');

export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const XHTML = 'http://www.w3.org/1999/xhtml';

const ELEMENTS = new Set(
  (
    'p br hr h1 h2 h3 h4 h5 h6 strong b em i u s strike del ins sub sup mark small code pre blockquote ' +
    'ul ol li a img figure figcaption table thead tbody tfoot tr th td caption span div'
  ).split(' '),
);
/** The parser creates these for any input; they are fine as long as they carry no attributes. */
const DOCUMENT_ELEMENTS = new Set(['html', 'head', 'body']);

const GLOBAL_ATTRS = ['title', 'lang', 'dir', 'style', 'class'];
const CELL_ATTRS = ['colspan', 'rowspan', 'align'];
const ELEMENT_ATTRS: Partial<Record<string, string[]>> = {
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height'],
  td: CELL_ATTRS,
  th: CELL_ATTRS,
  ol: ['start', 'type'],
};

const isLinkUrl = (url: string) => /^\s*(https:\/\/|mailto:)/i.test(url);
export const isImageDataUrl = (url: string): boolean => /^\s*data:image\//i.test(url);

const unescapeCss = (css: string) =>
  css.replace(/\\(?:([0-9a-f]{1,6})\s?|\r\n|(.))/gis, (_, hex: string | undefined, ch: string | undefined) =>
    hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : ch && !/[\n\r\f]/.test(ch) ? ch : '',
  );
const stripCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const REMOTE_CSS = /url\(|image-set\(|\bimage\(|\bsrc\(|@import|expression\(|-moz-binding/i;

/** True when the CSS may load a resource. Checked with comments kept too, since a string can hide a comment opener. */
export const loadsRemoteCss = (css: string): boolean =>
  [css, stripCssComments(css)].some((c) => REMOTE_CSS.test(unescapeCss(c)));

type Violation = { kind: 'element' | 'attribute' | 'link' | 'media' | 'style'; detail: string };

function* elementsOf(root: ParentNode): Generator<Element> {
  for (const el of root.children) {
    yield el;
    yield* elementsOf(el);
    if (el instanceof HTMLTemplateElement) yield* elementsOf(el.content);
  }
}

function attributeViolation(tag: string, name: string, value: string): Violation | undefined {
  const where = `${name} on <${tag}>`;
  if (!GLOBAL_ATTRS.includes(name) && !ELEMENT_ATTRS[tag]?.includes(name)) return { kind: 'attribute', detail: where };
  if (name === 'style' && loadsRemoteCss(value)) return { kind: 'style', detail: where };
  if (tag === 'a' && name === 'href' && !isLinkUrl(value)) return { kind: 'link', detail: value };
  if (tag === 'img' && name === 'src' && !isImageDataUrl(value)) return { kind: 'media', detail: where };
  return undefined;
}

function violations(html: string): Violation[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const found: Violation[] = [];
  for (const el of elementsOf(doc)) {
    const tag = el.localName;
    const isHtml = el.namespaceURI === XHTML;
    if (isHtml && DOCUMENT_ELEMENTS.has(tag)) {
      for (const { name } of el.attributes) found.push({ kind: 'attribute', detail: `${name} on <${tag}>` });
    } else if (!isHtml || !ELEMENTS.has(tag)) {
      found.push({ kind: 'element', detail: `<${tag}>` });
    } else {
      for (const { name, value } of el.attributes) {
        const violation = attributeViolation(tag, name, value);
        if (violation) found.push(violation);
      }
    }
  }
  return found;
}

const MESSAGES: Record<Violation['kind'], string> = {
  element: 'Not allowed in posts',
  attribute: 'Attributes not allowed in posts',
  link: 'Links must be absolute https: or mailto: URLs',
  media: 'Images must be embedded as data URLs (use the image button, paste or drop)',
  style: "Styles can't load anything (url(), image-set(), @import…)",
};

const listed = (items: string[]) => items.slice(0, 3).join(', ') + (items.length > 3 ? ', …' : '');

/** True when rendering the HTML might fetch something: it breaks a rule other than the link one. */
export const loadsRemote = (html: string): boolean => violations(html).some((v) => v.kind !== 'link');

/** Problems that violate the item rules (spec/feeds.md §1.1), checked against an allowlist of elements and attributes. */
export function contentProblems(html: string): string[] {
  const byKind = new Map<Violation['kind'], Set<string>>();
  for (const { kind, detail } of violations(html)) byKind.set(kind, (byKind.get(kind) ?? new Set()).add(detail));
  return [...byKind].map(([kind, details]) => `${MESSAGES[kind]}: ${listed([...details])}.`);
}

/** True when the HTML shows nothing: no text besides whitespace, and no image or other media. */
export function isBlankHtml(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const text = (doc.body.textContent ?? '').replace(/[\s​-‍⁠]/g, '');
  return !text && !doc.body.querySelector('img, svg, video, audio, picture');
}
