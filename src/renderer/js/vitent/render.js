/* ============================================================
 * vitent/render.js — Vitent Markdown → DOM.
 *
 *   const r = await renderPage({ courseId, course, src, text, lesson, scrollRoot, preview })
 *   r.el        <article class="vt-article">
 *   r.fm        frontmatter
 *   r.blocks    Map(id → { id, name, el, label })   — markable controls
 *   r.counts    { quiz, tests }                      — for completion rules
 *   r.dispose() release editors, terminals, observers
 *
 * Every directive becomes <div class="vx" data-block="name-N" data-widget="name">.
 * Ids come from {#id} / id="…" or are numbered per directive name.
 * ============================================================ */

import { h, icon } from '../core/dom.js';
import { t, getLang } from '../core/i18n.js';
import { splitFrontmatter, parseBlocks } from '../../../shared/vitent-parse.mjs';
import { DIRECTIVES } from '../../../shared/directives.mjs';
import { md, sanitize, pageEnv } from './markdown.js';
import { resolveAsset, resolvePageLink, courseRel, isExternal } from '../paths.js';
import { WIDGETS } from './widgets/index.js';
import { renderFence } from './widgets/code.js';
import { hydrateInline } from './inline.js';

const INCLUDE_RE = /^ {0,3}::include\{([^}]*)\}\s*$/;

/* ::include{src="part.md"} — textual include, resolved before parsing. */
export async function resolveIncludes(text, { courseId, src }, depth = 0) {
  if (depth > 3 || !/::include\{/.test(text)) return text;
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const m = INCLUDE_RE.exec(line);
    if (!m) { out.push(line); continue; }
    const file = /src\s*=\s*("([^"]*)"|'([^']*)'|(\S+))/.exec(m[1]);
    const rel = file ? courseRel(src, file[2] ?? file[3] ?? file[4]) : null;
    if (!rel) { out.push(line); continue; }
    try {
      const inc = splitFrontmatter(await window.vla.course.readText(courseId, rel)).body;
      out.push(await resolveIncludes(inc, { courseId, src }, depth + 1));
    } catch (e) {
      out.push(`:::danger[include]\n${rel}: ${e.message}\n:::`);
    }
  }
  return out.join('\n');
}

function createContext(page, fm) {
  const rctx = {
    page,
    fm,
    courseId: page.courseId,
    course: page.course,
    src: page.src,
    lang: getLang(),
    env: { references: {} },
    slugs: {},
    counters: {},
    blocks: new Map(),
    disposers: [],
    counts: { quiz: 0, tests: 0 },
    article: null,

    url: s => resolveAsset(page.courseId, page.src, s),
    rel: s => courseRel(page.src, s),

    id(name, attrs = {}) {
      if (attrs.id) return String(attrs.id);
      rctx.counters[name] = (rctx.counters[name] || 0) + 1;
      return `${name}-${rctx.counters[name]}`;
    },

    register(id, el, name, label) {
      el.classList.add('vx');
      el.dataset.block = id;
      el.dataset.widget = name;
      rctx.blocks.set(id, { id, name, el, label: label || '' });
      return el;
    },

    onDispose(fn) { rctx.disposers.push(fn); },

    /* Run fn the first time el scrolls near the viewport. */
    lazy(el, fn) {
      if (!('IntersectionObserver' in window) || page.eager) { queueMicrotask(fn); return; }
      const io = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) { io.disconnect(); fn(); }
      }, { root: page.scrollRoot || null, rootMargin: '600px 0px' });
      io.observe(el);
      rctx.disposers.push(() => io.disconnect());
    },

    inline(text) {
      return sanitize(md().renderInline(String(text ?? ''), { references: rctx.env.references }));
    },

    /* opts.line: where `text` starts in the page file. Page-level text
       (and text inside layout containers) then carries data-sl source
       maps for the in-place editor; widget-owned Markdown never does. */
    md(text, opts = {}) {
      const env = { references: rctx.env.references, slugs: rctx.slugs, fences: [] };
      if (opts.line != null && rctx.srcMap) Object.assign(env, { srcMap: true, line: opts.line, lineLimit: rctx.lineLimit });
      const html = sanitize(md().render(String(text ?? ''), env));
      const tpl = document.createElement('template');
      tpl.innerHTML = html;
      hydrateFragment(tpl.content, env, rctx);
      return tpl.content;
    },

    children(nodes, parent) {
      renderNodes(nodes, parent, rctx);
      return parent;
    },

    saved(kind, id) {
      return page.progress?.[kind]?.[id];
    },

    report(kind, id, data) {
      page.lesson?.report?.(kind, id, data);
    },
  };
  return rctx;
}

function hydrateFragment(frag, env, rctx) {
  for (const ph of frag.querySelectorAll('.vt-fence[data-fence]')) {
    const f = env.fences[Number(ph.dataset.fence)];
    if (!f) { ph.remove(); continue; }
    let el;
    try { el = renderFence(f, rctx); } catch (e) { el = h('div.vx-error', `${e.message}`); }
    ph.replaceWith(el);
  }
  for (const el of frag.querySelectorAll('[data-vt-inline]')) hydrateInline(el, rctx);

  for (const a of frag.querySelectorAll('a[href]')) {
    if (a.dataset.vtInline) continue;
    const href = a.getAttribute('href');
    if (!href) continue;
    if (rctx.page.onLink && /\.md(#.*)?$/i.test(href)) {
      a.addEventListener('click', e => { e.preventDefault(); rctx.page.onLink(href); });
    } else if (href.startsWith('#')) {
      a.addEventListener('click', e => {
        e.preventDefault();
        rctx.article?.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } else if (/^(https?:|mailto:)/i.test(href)) {
      a.title = href;
      a.addEventListener('click', e => { e.preventDefault(); window.vla.app.openExternal(href); });
    } else if (/\.vitent(#.*)?$/i.test(href)) {
      a.addEventListener('click', e => {
        e.preventDefault();
        const { src, hash } = resolvePageLink(rctx.src, href);
        rctx.page.lesson?.goto({ page: src, hash });
      });
    } else if (!isExternal(href)) {
      a.addEventListener('click', e => {
        e.preventDefault();
        window.vla.course.openFile(rctx.courseId, rctx.rel(href));
      });
    }
  }
  for (const el of frag.querySelectorAll('img[src], video[src], audio[src], source[src]')) {
    const src = el.getAttribute('src');
    if (src && !isExternal(src)) el.setAttribute('src', rctx.url(src));
    if (el.tagName === 'IMG') {
      el.loading = 'lazy';
      const id = rctx.id('img');
      rctx.register(id, el, 'image', el.getAttribute('alt') || '');
      el.classList.remove('vx');
      el.addEventListener('click', () => {
        if (document.body.classList.contains('hl-mode')) return;
        const box = h('div.lightbox', { onClick: () => box.remove() }, h('img', { src: el.src, alt: el.alt }));
        document.body.append(box);
      });
    }
  }
  for (const wrap of frag.querySelectorAll('.vt-table-wrap')) {
    const id = rctx.id('table');
    rctx.register(id, wrap, 'table', wrap.querySelector('th')?.textContent || '');
    wrap.classList.remove('vx');
  }
}

/* Directives whose Markdown children are plain page text (editable in place). */
const TEXT_CONTAINERS = new Set(['callout', 'details', 'reveal', 'tabs', 'columns', 'steps']);

export function renderNodes(nodes, parent, rctx) {
  for (const node of nodes) {
    if (node.type === 'md') { parent.append(rctx.md(node.text, { line: node.line })); continue; }
    const def = DIRECTIVES[node.name];
    const key = WIDGETS[node.name] ? node.name : def?.alias;
    const widget = key ? WIDGETS[key] : null;
    const id = rctx.id(key || node.name, node.attrs);
    const mapped = rctx.srcMap;
    if (!TEXT_CONTAINERS.has(key)) rctx.srcMap = false;
    let el;
    try {
      el = widget ? widget.render(node, rctx, id) : unknownBox(node, rctx);
    } catch (e) {
      console.error(e);
      el = h('div.vx-error', `:::${node.name} — ${e.message}`);
    } finally {
      rctx.srcMap = mapped;
    }
    if (!el) continue;
    if (widget?.markable === false) {
      el.dataset.widget = key;
    } else {
      rctx.register(id, el, key || node.name, node.label || node.attrs.title || widget?.label?.(node) || '');
    }
    parent.append(el);
  }
}

function unknownBox(node, rctx) {
  const box = h('div.vx-unknown', h('div', icon('puzzle', { width: 14, height: 14 }), ' ', t('vx.unknown'), ' ', h('code', `${node.type === 'leaf' ? '::' : ':::'}${node.name}`)));
  if (node.children?.length) rctx.children(node.children, box);
  return box;
}

/* Inline Markdown → hydrated fragment, for re-rendering one edited unit. */
function renderInlineFragment(text, rctx) {
  const env = { references: rctx.env.references, fences: [], srcMap: true };
  const tpl = document.createElement('template');
  tpl.innerHTML = sanitize(md().renderInline(String(text ?? ''), env));
  hydrateFragment(tpl.content, env, rctx);
  return tpl.content;
}

/* Lines after the first ::include no longer match the file. */
function includeLimit(text) {
  const i = String(text ?? '').split(/\r?\n/).findIndex(l => INCLUDE_RE.test(l));
  return i < 0 ? Infinity : i;
}

export async function renderPage(page) {
  const text = await resolveIncludes(String(page.text ?? ''), page);
  const { data: fm, body, offset, error } = splitFrontmatter(text);
  const rctx = createContext(page, fm);
  rctx.srcMap = true;
  rctx.lineLimit = text === String(page.text ?? '') ? Infinity : includeLimit(page.text);
  rctx.env.references = pageEnv(body).references;
  const article = h('article.vt-article');
  rctx.article = article;
  if (error) article.append(h('div.vt-fm-error', `frontmatter: ${error}`));
  const tree = parseBlocks(body, offset);
  const firstMd = tree.children.find(n => n.type === 'md');
  const hasH1 = firstMd && /^\s*#\s/.test(firstMd.text) && tree.children[0] === firstMd;
  if (!page.noHeader && (fm.title || page.title) && !hasH1) {
    article.append(h('header.vt-header',
      page.kicker ? h('div.vt-kicker', page.kicker) : null,
      h('h1', fm.title || page.title)));
  }
  renderNodes(tree.children, article, rctx);
  rctx.srcMap = false;
  article.vtRenderInline = src => renderInlineFragment(src, rctx);
  return {
    el: article,
    fm,
    body,
    tree,
    blocks: rctx.blocks,
    counts: rctx.counts,
    rctx,
    dispose() {
      for (const fn of rctx.disposers.splice(0)) { try { fn(); } catch { /* already gone */ } }
    },
  };
}
