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

const FORBIDDEN = 'script, form, iframe, frame, embed, object, base, meta[http-equiv]';

/** Problems that violate the item rules (spec/feeds.md §1.1). */
export function contentProblems(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const problems: string[] = [];
  const forbidden = [...new Set([...doc.querySelectorAll(FORBIDDEN)].map((el) => `<${el.tagName.toLowerCase()}>`))];
  if (forbidden.length) problems.push(`Not allowed in posts: ${forbidden.join(', ')}.`);
  const inlineHandlers = [...doc.querySelectorAll('*')].some((el) =>
    [...el.attributes].some((a) => a.name.startsWith('on')),
  );
  if (inlineHandlers) problems.push('Event handler attributes (on…) are not allowed.');
  const relative = [...doc.querySelectorAll('a[href]')]
    .map((a) => a.getAttribute('href') ?? '')
    .filter((href) => !/^(https?:|mailto:|tel:)/i.test(href));
  if (relative.length) problems.push(`Links must be absolute URLs: ${relative.slice(0, 3).join(', ')}.`);
  const linkedImages = [...doc.images].filter((img) => !(img.getAttribute('src') ?? '').startsWith('data:'));
  if (linkedImages.length) problems.push('Images must be embedded (use the image button, paste or drop).');
  return problems;
}
