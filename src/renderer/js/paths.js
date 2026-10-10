/* Path helpers for course files and vla:// URLs. */

export function normRelPath(p) {
  const out = [];
  for (const seg of String(p || '').replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

/* src inside a page: "@/x" is course-relative, anything else page-relative. */
export function courseRel(pageSrc, src) {
  const s = String(src || '').split(/[?#]/)[0];
  if (s.startsWith('@/')) return normRelPath(s.slice(2));
  return normRelPath(`${pageSrc}/${s}`);
}

export function isExternal(src) {
  return /^(https?:|mailto:|data:|blob:|vla:)/i.test(String(src || ''));
}

export function vlaUrl(courseId, rel) {
  return `vla://${courseId}/${normRelPath(rel).split('/').map(encodeURIComponent).join('/')}`;
}

export function resolveAsset(courseId, pageSrc, src) {
  if (isExternal(src)) return src;
  const hash = String(src).includes('#') ? String(src).slice(String(src).indexOf('#')) : '';
  return vlaUrl(courseId, courseRel(pageSrc, src)) + hash;
}

/* A link to another page: "@/content/x.vitent" or relative to the
   current page folder ("../y.vitent"). Returns the course-relative src. */
export function resolvePageLink(pageSrc, href) {
  const [path, hash] = String(href).split('#');
  return { src: courseRel(pageSrc, path), hash: hash || '' };
}

export function baseName(p) {
  return String(p || '').split(/[\\/]/).pop();
}
