/* ============================================================
 * vitent/markdown.js — markdown-it configured for Vitent Markdown.
 *   • inline directives  :name[label]{attrs}
 *   • math               $…$  $$…$$
 *   • task lists         - [ ] / - [x]
 *   • fences             become placeholders hydrated by render.js
 *   • headings           get stable slug ids
 *   • source maps        (env.srcMap) for in-place editing, see below
 * ============================================================ */

import MarkdownIt from 'markdown-it';
import katex from 'katex';
import DOMPurify from 'dompurify';
import { scanDirective, parseFenceInfo, slugify } from '../../../shared/vitent-parse.mjs';
import { isKind } from '../../../shared/directives.mjs';
import { escapeHtml } from '../core/dom.js';

/* ─── math ─── */

function renderMath(tex, display) {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html', strict: 'ignore', trust: false });
  } catch (e) {
    return `<span class="katex-error">${escapeHtml(e.message)}</span>`;
  }
}

function mathInline(state, silent) {
  const src = state.src;
  let pos = state.pos;
  if (src[pos] !== '$') return false;
  if (src[pos + 1] === '$') {
    const end = src.indexOf('$$', pos + 2);
    if (end < 0) return false;
    if (!silent) {
      const tok = state.push('math_block_inline', 'math', 0);
      tok.content = src.slice(pos + 2, end);
      tok.meta = { src: src.slice(pos, end + 2) };
    }
    state.pos = end + 2;
    return true;
  }
  const start = pos + 1;
  if (start >= src.length || /\s/.test(src[start])) return false;
  if (pos > 0 && /[\w$]/.test(src[pos - 1]) && src[pos - 1] !== '(') return false;
  let end = start;
  for (;;) {
    end = src.indexOf('$', end);
    if (end < 0) return false;
    if (src[end - 1] === '\\') { end++; continue; }
    break;
  }
  if (end === start || /\s/.test(src[end - 1]) || /\d/.test(src[end + 1] || '')) return false;
  if (!silent) {
    const tok = state.push('math_inline', 'math', 0);
    tok.content = src.slice(start, end);
    tok.meta = { src: src.slice(pos, end + 1) };
  }
  state.pos = end + 1;
  return true;
}

function mathBlock(state, startLine, endLine, silent) {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  if (state.src.slice(start, start + 2) !== '$$') return false;
  const first = state.src.slice(start + 2, max);
  let content;
  let next = startLine;
  const ft = first.trim();
  if (ft.length >= 2 && ft.endsWith('$$')) {
    content = ft.slice(0, -2);
  } else {
    const lines = [first];
    let found = false;
    for (next = startLine + 1; next < endLine; next++) {
      const s = state.bMarks[next] + state.tShift[next];
      const line = state.src.slice(s, state.eMarks[next]);
      if (line.trim().endsWith('$$')) { lines.push(line.trim().slice(0, -2)); found = true; break; }
      lines.push(line);
    }
    if (!found) return false;
    content = lines.join('\n');
  }
  if (silent) return true;
  const tok = state.push('math_block', 'math', 0);
  tok.block = true;
  tok.content = content;
  tok.map = [startLine, next + 1];
  state.line = next + 1;
  return true;
}

/* ─── inline directives ─── */

function inlineDirective(state, silent) {
  const src = state.src;
  const pos = state.pos;
  if (src.charCodeAt(pos) !== 0x3a) return false;
  if (pos > 0 && /[\w\\:/]/.test(src[pos - 1])) return false;
  const d = scanDirective(src, pos + 1);
  if (!d || d.label == null || !isKind(d.name, 'inline')) return false;
  if (!silent) {
    const tok = state.push('vt_inline', 'span', 0);
    tok.meta = { ...d, src: src.slice(pos, d.end) };
  }
  state.pos = d.end;
  return true;
}

function attrsJson(attrs) {
  return escapeHtml(JSON.stringify(attrs || {}));
}

/* ` data-md="…"` — the exact source of an inline atom, only when mapping. */
function mdAttr(env, src) {
  return env?.srcMap && src != null ? ` data-md="${escapeHtml(src)}"` : '';
}

function renderInlineDirective(md, d, env) {
  const label = md.renderInline(d.label || '', env);
  const a = d.attrs || {};
  const m = mdAttr(env, d.src);
  switch (d.name) {
    case 'kbd': return `<kbd${m}>${label}</kbd>`;
    case 'badge': return `<span class="vt-badge" data-color="${escapeHtml(a.color || '')}"${m}>${label}</span>`;
    case 'hl': return `<span class="vt-hl" data-color="${escapeHtml(a.color || 'yellow')}"${m}>${label}</span>`;
    case 'term': return `<span class="vt-term" data-tip="${escapeHtml(a.tip || '')}"${m}>${label}</span>`;
    case 'icon': return `<span class="vt-icon" data-vt-inline="icon" data-attrs="${attrsJson({ name: d.label, ...a })}"${m}></span>`;
    case 'btn': return `<button class="inline-btn" data-vt-inline="btn" data-attrs="${attrsJson(a)}"${m}><span>${label}</span></button>`;
    case 'ask': return `<button class="ask-chip" data-vt-inline="ask" data-attrs="${attrsJson(a)}"${m}><span>${label}</span></button>`;
    case 'file': return `<button class="inline-file" data-vt-inline="file" data-attrs="${attrsJson(a)}"${m}><span>${label}</span></button>`;
    case 'link': return `<a class="vt-link-page" href="#" data-vt-inline="link" data-attrs="${attrsJson(a)}"${m}>${label}</a>`;
    default: return m ? `<span${m}>${label}</span>` : label;
  }
}

/* ─── source maps (env.srcMap) ───
 * Used by the in-place editor (inline-edit.js). Without env.srcMap the
 * output is exactly what it always was.
 *   • env.line (chunk start line in the page file) → data-sl="start-end"
 *     (0-based, end exclusive) on paragraphs, headings, list items, lists,
 *     table rows, blockquotes and rules. Tight-list paragraphs render as
 *     <p class="tight"> so every list item's text is addressable.
 *   • inline atoms (math, inline directives, images, raw HTML) carry their
 *     exact source in data-md; links carry data-md / data-ml (label source)
 *     / data-mt (the part after the label); escapes and entities become
 *     <span class="vt-esc" data-md="\*">*</span>.
 *   • a paragraph whose raw HTML cannot be kept as one atom gets data-ie-lock. */

const SL_TYPES = new Set(['paragraph_open', 'heading_open', 'list_item_open', 'bullet_list_open', 'ordered_list_open', 'tr_open', 'blockquote_open', 'hr']);

function sourceMap(state) {
  const env = state.env;
  if (!env?.srcMap || env.line == null) return;
  const base = Number(env.line);
  const limit = env.lineLimit ?? Infinity;
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok.map || !SL_TYPES.has(tok.type)) continue;
    const s = base + tok.map[0];
    const e = base + tok.map[1];
    if (e > limit) continue;
    tok.attrSet('data-sl', `${s}-${e}`);
    if (tok.type === 'paragraph_open' && tok.hidden && tokens[i + 2]?.type === 'paragraph_close') {
      tok.attrJoin('class', 'tight');
      tok.meta = { ...(tok.meta || {}), tight: true };
      tokens[i + 2].meta = { ...(tokens[i + 2].meta || {}), tight: true };
    }
  }
}

/* Wrap an inline rule so the token it produces learns its source span. */
function tracked(fn, types, onToken) {
  return (state, silent) => {
    if (silent || !state.env?.srcMap) return fn(state, silent);
    const start = state.pos;
    const n = state.tokens.length;
    const ok = fn(state, silent);
    if (ok) {
      for (let i = n; i < state.tokens.length; i++) {
        const tok = state.tokens[i];
        if (types.includes(tok.type)) { onToken(tok, start, state.pos, state); break; }
      }
    }
    return ok;
  };
}

function ruleFn(ruler, name) {
  return ruler.__rules__.find(r => r.name === name)?.fn;
}

function trackInline(m) {
  const wrap = (name, types, onToken) => {
    const fn = ruleFn(m.inline.ruler, name);
    if (fn) m.inline.ruler.at(name, tracked(fn, types, onToken));
  };
  wrap('image', ['image'], (tok, s, e, state) => tok.attrSet('data-md', state.src.slice(s, e)));
  wrap('html_inline', ['html_inline'], (tok, s, e) => { tok.meta = { ...(tok.meta || {}), pos: [s, e] }; });
  wrap('autolink', ['link_open'], (tok, s, e, state) => {
    tok.attrSet('data-md', state.src.slice(s, e));
    tok.attrSet('data-ml', state.src.slice(s + 1, e - 1));
  });
  wrap('link', ['link_open'], (tok, s, e, state) => {
    const src = state.src;
    tok.attrSet('data-md', src.slice(s, e));
    const keep = state.pos;
    let labelEnd = -1;
    try { labelEnd = state.md.helpers.parseLinkLabel(state, s, true); } catch { labelEnd = -1; }
    state.pos = keep;
    if (labelEnd > s) {
      tok.attrSet('data-ml', src.slice(s + 1, labelEnd));
      tok.attrSet('data-mt', src.slice(labelEnd + 1, e));
    }
  });
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const OPEN_TAG = /^<([A-Za-z][\w-]*)/;
const CLOSE_TAG = /^<\/([A-Za-z][\w-]*)/;

/* Group <tag>…</tag> raw HTML into one atom; escapes/entities keep their source. */
function inlineAtoms(state) {
  if (!state.env?.srcMap) return;
  const blocks = state.tokens;
  for (let b = 0; b < blocks.length; b++) {
    const inline = blocks[b];
    if (inline.type !== 'inline' || !inline.children) continue;
    const ch = inline.children;
    let lock = false;
    for (let i = 0; i < ch.length; i++) {
      const tok = ch[i];
      if (tok.type === 'text_special') {
        const v = new state.Token('vt_verbatim', '', 0);
        v.content = tok.content;
        v.markup = tok.markup;
        ch[i] = v;
        continue;
      }
      if (tok.type === 'link_open' && tok.markup === 'linkify') { tok.attrSet('data-mb', ''); continue; }
      if (tok.type !== 'html_inline' || !tok.meta?.pos) continue;
      const c = tok.content;
      const open = OPEN_TAG.exec(c);
      let j = i;
      if (open && !/\/\s*>$/.test(c) && !VOID_TAGS.has(open[1].toLowerCase())) {
        const name = open[1].toLowerCase();
        let depth = 0;
        j = -1;
        for (let k = i; k < ch.length; k++) {
          const u = ch[k];
          if (u.type !== 'html_inline') continue;
          const o = OPEN_TAG.exec(u.content);
          const cl = CLOSE_TAG.exec(u.content);
          if (o && o[1].toLowerCase() === name && !/\/\s*>$/.test(u.content)) depth++;
          else if (cl && cl[1].toLowerCase() === name && --depth === 0) { j = k; break; }
        }
      } else if (CLOSE_TAG.test(c)) j = -1;
      if (j < 0 || !ch[j].meta?.pos) { lock = true; continue; }
      let level = 0;
      let balanced = true;
      for (let k = i; k <= j; k++) {
        level += ch[k].nesting;
        if (level < 0) balanced = false;
      }
      if (!balanced || level !== 0) { lock = true; continue; }
      const atom = new state.Token('vt_html', 'span', 0);
      atom.content = inline.content.slice(tok.meta.pos[0], ch[j].meta.pos[1]);
      atom.children = ch.slice(i, j + 1);
      ch.splice(i, j - i + 1, atom);
    }
    if (lock && blocks[b - 1]) blocks[b - 1].attrSet('data-ie-lock', '');
  }
}

function slugText(children) {
  let s = '';
  for (const c of children || []) {
    if (c.type === 'text' || c.type === 'code_inline' || c.type === 'vt_verbatim' || c.type === 'text_special') s += c.content;
    else if (c.type === 'vt_html') s += slugText(c.children);
  }
  return s;
}

/* ─── task lists ─── */

function taskLists(state) {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue;
    const m = /^\[([ xX])\]\s+/.exec(tok.content);
    if (!m || !tok.children?.length) continue;
    const first = tok.children[0];
    if (first.type !== 'text' || !first.content.startsWith(m[0].slice(0, 3))) continue;
    first.content = first.content.replace(/^\[[ xX]\]\s*/, '');
    const box = new state.Token('html_inline', '', 0);
    box.content = `<input class="task-box" type="checkbox" disabled${m[1] !== ' ' ? ' checked' : ''}> `;
    tok.children.unshift(box);
    tokens[i - 2].attrJoin('class', 'task-list-item');
    for (let j = i - 3; j >= 0; j--) {
      if (tokens[j].type === 'bullet_list_open' || tokens[j].type === 'ordered_list_open') { tokens[j].attrJoin('class', 'contains-task-list'); break; }
    }
  }
}

/* ─── the instance ─── */

let instance = null;

export function md() {
  if (instance) return instance;
  const m = new MarkdownIt({ html: true, linkify: true, typographer: false });
  m.inline.ruler.before('escape', 'math_inline', mathInline);
  m.block.ruler.before('fence', 'math_block', mathBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  m.inline.ruler.before('emphasis', 'vt_inline', inlineDirective);
  m.core.ruler.after('inline', 'task_lists', taskLists);
  m.core.ruler.after('block', 'vt_source_map', sourceMap);
  m.core.ruler.before('text_join', 'vt_inline_atoms', inlineAtoms);
  trackInline(m);

  m.renderer.rules.math_inline = (tokens, idx, _o, env) => `<span class="vt-math" data-vh-skip${mdAttr(env, tokens[idx].meta?.src)}>${renderMath(tokens[idx].content, false)}</span>`;
  m.renderer.rules.math_block_inline = (tokens, idx, _o, env) => `<span class="vt-math" data-vh-skip${mdAttr(env, tokens[idx].meta?.src)}>${renderMath(tokens[idx].content, true)}</span>`;
  m.renderer.rules.vt_verbatim = (tokens, idx) => `<span class="vt-esc" data-md="${escapeHtml(tokens[idx].markup)}">${escapeHtml(tokens[idx].content)}</span>`;
  m.renderer.rules.vt_html = (tokens, idx, opts, env, self) => `<span class="vt-raw" data-md="${escapeHtml(tokens[idx].content)}">${self.renderInline(tokens[idx].children, opts, env)}</span>`;
  m.renderer.rules.paragraph_open = (tokens, idx, opts, _env, self) => (tokens[idx].meta?.tight ? `<p${self.renderAttrs(tokens[idx])}>` : self.renderToken(tokens, idx, opts));
  m.renderer.rules.paragraph_close = (tokens, idx, opts, _env, self) => (tokens[idx].meta?.tight ? '</p>' : self.renderToken(tokens, idx, opts));
  m.renderer.rules.math_block = (tokens, idx) => `<div class="vt-math-block" data-vh-skip>${renderMath(tokens[idx].content, true)}</div>\n`;
  m.renderer.rules.vt_inline = (tokens, idx, _opts, env) => renderInlineDirective(m, tokens[idx].meta, env);

  m.renderer.rules.fence = (tokens, idx, _opts, env) => {
    const tok = tokens[idx];
    env.fences = env.fences || [];
    const { lang, attrs } = parseFenceInfo(tok.info);
    env.fences.push({ lang, attrs, code: tok.content.replace(/\n$/, '') });
    return `<div class="vt-fence" data-fence="${env.fences.length - 1}"></div>\n`;
  };
  m.renderer.rules.code_block = (tokens, idx, _opts, env) => {
    env.fences = env.fences || [];
    env.fences.push({ lang: '', attrs: {}, code: tokens[idx].content.replace(/\n$/, '') });
    return `<div class="vt-fence" data-fence="${env.fences.length - 1}"></div>\n`;
  };
  m.renderer.rules.heading_open = (tokens, idx, opts, env, self) => {
    const inline = tokens[idx + 1];
    const text = slugText(inline?.children) || inline?.content || '';
    env.slugs = env.slugs || {};
    let slug = slugify(text);
    if (env.slugs[slug] != null) slug = `${slug}-${++env.slugs[slug]}`;
    else env.slugs[slug] = 0;
    tokens[idx].attrSet('id', slug);
    return self.renderToken(tokens, idx, opts);
  };
  m.renderer.rules.table_open = () => '<div class="vt-table-wrap"><table>\n';
  m.renderer.rules.table_close = () => '</table></div>\n';
  instance = m;
  return m;
}

const PURIFY = {
  ADD_ATTR: ['target', 'data-fence', 'data-vt-inline', 'data-attrs', 'data-tip', 'data-color', 'data-vh-skip', 'checked', 'disabled'],
  FORBID_TAGS: ['style', 'form'],
  FORBID_ATTR: ['style'],
};
const PURIFY_STYLED = { ...PURIFY, FORBID_ATTR: [] };

export function sanitize(html, { allowStyle = true } = {}) {
  return DOMPurify.sanitize(html, allowStyle ? PURIFY_STYLED : PURIFY);
}

export function renderHtml(text, env = {}) {
  return sanitize(md().render(String(text ?? ''), env));
}

export function renderInlineHtml(text, env = {}) {
  return sanitize(md().renderInline(String(text ?? ''), env));
}

/* Collect reference-style link definitions for the whole page once,
   so chunks split by directives still resolve [text][ref]. */
export function pageEnv(fullText) {
  const env = {};
  try { md().parse(String(fullText ?? ''), env); } catch { /* ignore */ }
  return { references: env.references || {} };
}
