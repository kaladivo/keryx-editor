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

const FORBIDDEN = 'script, form, iframe, frame, embed, object, base, link, meta[http-equiv]';

/** Attributes whose value the browser fetches (or pings); only data: URLs may appear in them. */
const RESOURCE_ATTRS = new Set([
  'src', 'srcset', 'poster', 'data', 'background', 'href', 'xlink:href', 'lowsrc', 'dynsrc',
  'ping', 'action', 'formaction', 'codebase', 'archive', 'manifest', 'icon', 'longdesc', 'profile',
]);
const LINK_ELEMENTS = new Set(['a', 'area']);

const isDataUrl = (url: string) => /^\s*data:/i.test(url);
const isLinkUrl = (url: string) => /^\s*(https:\/\/|mailto:)/i.test(url);

/** The URLs of a srcset, per the HTML candidate-list grammar (data URLs keep their commas). */
function srcsetUrls(srcset: string): string[] {
  const urls: string[] = [];
  let rest = srcset;
  while ((rest = rest.replace(/^[\s,]+/, ''))) {
    const url = rest.split(/\s/, 1)[0];
    rest = rest.slice(url.length);
    urls.push(url.replace(/,+$/, ''));
    if (url.endsWith(',')) continue;
    const end = rest.indexOf(',');
    rest = end < 0 ? '' : rest.slice(end + 1);
  }
  return urls;
}

const unescapeCss = (css: string) =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\([0-9a-f]{1,6})\s?|\\(.)/gi, (_, hex: string | undefined, ch: string | undefined) =>
      hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : (ch ?? ''),
    );

const loadsRemoteCss = (css: string) =>
  /@import|image-set\(|\bsrc\(|url\(\s*(?!['"]?\s*data:)/i.test(unescapeCss(css));

function attrLoadsRemote(tag: string, name: string, value: string): boolean {
  if (name === 'style') return loadsRemoteCss(value);
  if (!RESOURCE_ATTRS.has(name) || (LINK_ELEMENTS.has(tag) && name === 'href')) return false;
  const urls = name === 'srcset' ? srcsetUrls(value) : [value];
  return !urls.every(isDataUrl);
}

function remoteResources(doc: Document): string[] {
  const found: string[] = [];
  for (const el of doc.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    for (const { name, value } of el.attributes) {
      if (attrLoadsRemote(tag, name, value)) found.push(`${name} on <${tag}>`);
    }
    if (tag === 'style' && loadsRemoteCss(el.textContent ?? '')) found.push('url() or @import in <style>');
  }
  return [...new Set(found)];
}

const parseHtml = (html: string) => new DOMParser().parseFromString(html, 'text/html');

/** True when rendering the HTML would fetch anything that is not a data URL. */
export const loadsRemote = (html: string): boolean => remoteResources(parseHtml(html)).length > 0;

/** Problems that violate the item rules (spec/feeds.md §1.1). */
export function contentProblems(html: string): string[] {
  const doc = parseHtml(html);
  const problems: string[] = [];
  const forbidden = [...new Set([...doc.querySelectorAll(FORBIDDEN)].map((el) => `<${el.tagName.toLowerCase()}>`))];
  if (forbidden.length) problems.push(`Not allowed in posts: ${forbidden.join(', ')}.`);
  const inlineHandlers = [...doc.querySelectorAll('*')].some((el) =>
    [...el.attributes].some((a) => a.name.startsWith('on')),
  );
  if (inlineHandlers) problems.push('Event handler attributes (on…) are not allowed.');
  const badLinks = [...doc.querySelectorAll('a[href], area[href]')]
    .map((a) => a.getAttribute('href') ?? '')
    .filter((href) => !isLinkUrl(href));
  if (badLinks.length) problems.push(`Links must be absolute https: or mailto: URLs: ${badLinks.slice(0, 3).join(', ')}.`);
  const remote = remoteResources(doc);
  if (remote.length) {
    problems.push(`Media must be embedded as data URLs (use the image button, paste or drop): ${remote.slice(0, 3).join(', ')}.`);
  }
  return problems;
}

/** True when the HTML shows nothing: no text besides whitespace, and no image or other media. */
export function isBlankHtml(html: string): boolean {
  const doc = parseHtml(html);
  const text = (doc.body.textContent ?? '').replace(/[\s\u200b-\u200d\u2060]/g, '');
  return !text && !doc.body.querySelector('img, svg, video, audio, picture');
}
