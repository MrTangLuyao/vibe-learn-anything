/* ============================================================
 * vitent/markdown.js — markdown-it configured for Vitent Markdown.
 *   • inline directives  :name[label]{attrs}
 *   • math               $…$  $$…$$
 *   • task lists         - [ ] / - [x]
 *   • fences             become placeholders hydrated by render.js
 *   • headings           get stable slug ids
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
    tok.meta = d;
  }
  state.pos = d.end;
  return true;
}

function attrsJson(attrs) {
  return escapeHtml(JSON.stringify(attrs || {}));
}

function renderInlineDirective(md, d, env) {
  const label = md.renderInline(d.label || '', env);
  const a = d.attrs || {};
  switch (d.name) {
    case 'kbd': return `<kbd>${label}</kbd>`;
    case 'badge': return `<span class="vt-badge" data-color="${escapeHtml(a.color || '')}">${label}</span>`;
    case 'hl': return `<span class="vt-hl" data-color="${escapeHtml(a.color || 'yellow')}">${label}</span>`;
    case 'term': return `<span class="vt-term" data-tip="${escapeHtml(a.tip || '')}">${label}</span>`;
    case 'icon': return `<span class="vt-icon" data-vt-inline="icon" data-attrs="${attrsJson({ name: d.label, ...a })}"></span>`;
    case 'btn': return `<button class="inline-btn" data-vt-inline="btn" data-attrs="${attrsJson(a)}"><span>${label}</span></button>`;
    case 'ask': return `<button class="ask-chip" data-vt-inline="ask" data-attrs="${attrsJson(a)}"><span>${label}</span></button>`;
    case 'file': return `<button class="inline-file" data-vt-inline="file" data-attrs="${attrsJson(a)}"><span>${label}</span></button>`;
    case 'link': return `<a class="vt-link-page" href="#" data-vt-inline="link" data-attrs="${attrsJson(a)}">${label}</a>`;
    default: return label;
  }
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
    box.content = `<input type="checkbox" disabled${m[1] !== ' ' ? ' checked' : ''}> `;
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

  m.renderer.rules.math_inline = (tokens, idx) => `<span class="vt-math" data-vh-skip>${renderMath(tokens[idx].content, false)}</span>`;
  m.renderer.rules.math_block_inline = (tokens, idx) => `<span class="vt-math" data-vh-skip>${renderMath(tokens[idx].content, true)}</span>`;
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
    const text = inline?.children?.filter(c => c.type === 'text' || c.type === 'code_inline').map(c => c.content).join('') || inline?.content || '';
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
