/* ============================================================
 * src/shared/vitent-parse.mjs
 * Vitent Markdown (VMD) parser shared by the app and the CLI.
 *
 *   splitFrontmatter(text)  → { data, body, offset, error }
 *   parseAttrs(src)         → { key: value, id?, class? }
 *   scanDirective(str, pos) → { name, label, attrs, end } | null
 *   parseBlocks(body)       → directive tree (root → md / container / leaf)
 *   parseFenceInfo(info)    → { lang, attrs }
 *   fencesIn(text)          → [{ lang, attrs, code, line }]
 *   walk(tree, fn)          → depth-first visit
 *
 * No DOM, no Node APIs: runs in the renderer bundle and in Node.
 * ============================================================ */

import yaml from 'js-yaml';

const FRONTMATTER_RE = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(text) {
  text = String(text ?? '');
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return { data: {}, body: text.replace(/^﻿/, ''), offset: 0, error: null };
  let data = {};
  let error = null;
  try {
    const loaded = yaml.load(m[1]);
    if (loaded == null) data = {};
    else if (typeof loaded !== 'object' || Array.isArray(loaded)) error = 'frontmatter must be a YAML mapping';
    else data = loaded;
  } catch (e) {
    error = e.message;
  }
  const offset = (m[0].match(/\n/g) || []).length;
  return { data, body: text.slice(m[0].length), offset, error };
}

/* ─── Attributes: {#id .class key="v" key='v' key=v flag} ─── */

function coerce(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

export function parseAttrs(src) {
  const out = {};
  const classes = [];
  const s = String(src || '');
  let i = 0;
  const isSpace = c => c === ' ' || c === '\t' || c === ',' || c === '\n' || c === '\r';
  const readIdent = () => {
    const m = /^[A-Za-z0-9_:\-]+/.exec(s.slice(i));
    if (!m) return '';
    i += m[0].length;
    return m[0];
  };
  while (i < s.length) {
    while (i < s.length && isSpace(s[i])) i++;
    if (i >= s.length) break;
    const c = s[i];
    if (c === '#') { i++; const id = readIdent(); if (id) out.id = id; continue; }
    if (c === '.') { i++; const cl = readIdent(); if (cl) classes.push(cl); continue; }
    const key = readIdent();
    if (!key) { i++; continue; }
    let j = i;
    while (j < s.length && (s[j] === ' ' || s[j] === '\t')) j++;
    if (s[j] !== '=') { out[key] = true; continue; }
    i = j + 1;
    while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
    const q = s[i];
    if (q === '"' || q === "'") {
      i++;
      let v = '';
      while (i < s.length && s[i] !== q) {
        if (s[i] === '\\' && i + 1 < s.length) {
          const n = s[i + 1];
          v += n === 'n' ? '\n' : n === 't' ? '\t' : n;
          i += 2;
          continue;
        }
        v += s[i++];
      }
      i++;
      out[key] = v;
    } else {
      let v = '';
      while (i < s.length && !isSpace(s[i])) v += s[i++];
      out[key] = coerce(v);
    }
  }
  if (classes.length) out.class = classes.join(' ');
  return out;
}

/* Find the index of the bracket that closes the one at `start`. */
function findClose(str, start, open, close) {
  let depth = 0;
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (c === '\\') { i++; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function findCloseBrace(str, start) {
  let quote = null;
  for (let i = start + 1; i < str.length; i++) {
    const c = str[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '}') return i;
  }
  return -1;
}

/* name[label]{attrs} starting at `pos`. Label and attrs are optional. */
export function scanDirective(str, pos = 0) {
  const nm = /^[A-Za-z][\w-]*/.exec(str.slice(pos));
  if (!nm) return null;
  let i = pos + nm[0].length;
  let label = null;
  let attrs = {};
  if (str[i] === '[') {
    const end = findClose(str, i, '[', ']');
    if (end < 0) return null;
    label = str.slice(i + 1, end).replace(/\\([\[\]])/g, '$1');
    i = end + 1;
  }
  let j = i;
  while (str[j] === ' ' || str[j] === '\t') j++;
  if (str[j] === '{') {
    const end = findCloseBrace(str, j);
    if (end < 0) return null;
    attrs = parseAttrs(str.slice(j + 1, end));
    i = end + 1;
  }
  return { name: nm[0].toLowerCase(), label, attrs, end: i };
}

/* ─── Block tree ───
 * Containers:  :::name[label]{attrs}  …  :::      (any colon count ≥ 3;
 *              the closing line must use the same count as its opener)
 * Leaves:      ::name[label]{attrs}               (on its own line)
 * Lines inside ``` / ~~~ fences are never treated as directives. */

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

function closesFence(line, fence) {
  const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  return !!m && m[1][0] === fence.char && m[1].length >= fence.len;
}

export function parseBlocks(body, lineOffset = 0) {
  const lines = String(body ?? '').split(/\r?\n/);
  const root = { type: 'root', children: [] };
  const stack = [{ node: root, fence: 0, start: -1 }];
  const cur = () => stack[stack.length - 1].node;
  let buf = [];
  let bufStart = 0;
  let fence = null;

  const push = (line, idx) => {
    if (!buf.length) bufStart = idx + lineOffset;
    buf.push(line);
  };
  const flush = () => {
    if (!buf.length) return;
    const text = buf.join('\n');
    if (text.trim()) cur().children.push({ type: 'md', text, line: bufStart });
    buf = [];
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (fence) {
      push(line, idx);
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const fm = FENCE_OPEN.exec(line);
    if (fm && !(fm[1][0] === '`' && fm[2].includes('`'))) {
      fence = { char: fm[1][0], len: fm[1].length };
      push(line, idx);
      continue;
    }

    const cm = /^ {0,3}(:{3,})[ \t]*(.*)$/.exec(line);
    if (cm) {
      const colons = cm[1].length;
      const rest = cm[2];
      if (rest.trim() === '') {
        let k = stack.length - 1;
        while (k > 0 && stack[k].fence !== colons) k--;
        if (k > 0) {
          flush();
          while (stack.length > k) {
            const fr = stack.pop();
            fr.node.raw = lines.slice(fr.start + 1, idx).join('\n');
            fr.node.endLine = idx + lineOffset;
          }
          continue;
        }
      } else {
        const d = scanDirective(rest, 0);
        if (d && rest.slice(d.end).trim() === '') {
          flush();
          const node = {
            type: 'container', name: d.name, label: d.label, attrs: d.attrs,
            children: [], raw: '', line: idx + lineOffset,
          };
          cur().children.push(node);
          stack.push({ node, fence: colons, start: idx });
          continue;
        }
      }
    }

    const lm = /^ {0,3}::(?!:)(.*)$/.exec(line);
    if (lm) {
      const d = scanDirective(lm[1], 0);
      if (d && lm[1].slice(d.end).trim() === '') {
        flush();
        cur().children.push({ type: 'leaf', name: d.name, label: d.label, attrs: d.attrs, line: idx + lineOffset });
        continue;
      }
    }
    push(line, idx);
  }
  flush();
  while (stack.length > 1) {
    const fr = stack.pop();
    fr.node.raw = lines.slice(fr.start + 1).join('\n');
    fr.node.unclosed = true;
  }
  return root;
}

export function walk(node, fn, parent = null) {
  if (fn(node, parent) === false) return;
  for (const child of node.children || []) walk(child, fn, node);
}

/* ─── Fenced code ─── */

/* "c {title="x" run}"  |  "js file=main.js"  |  "python run stdin='3'" */
export function parseFenceInfo(info) {
  const s = String(info || '').trim();
  if (!s) return { lang: '', attrs: {} };
  const m = /^([^\s{]+)?\s*(.*)$/.exec(s);
  const lang = (m[1] || '').toLowerCase();
  let rest = (m[2] || '').trim();
  if (rest.startsWith('{') && rest.endsWith('}')) rest = rest.slice(1, -1);
  return { lang, attrs: parseAttrs(rest) };
}

export function fencesIn(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const fm = FENCE_OPEN.exec(lines[i]);
    if (!fm) continue;
    const fence = { char: fm[1][0], len: fm[1].length };
    const indent = /^ */.exec(lines[i])[0].length;
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (closesFence(lines[j], fence)) break;
      body.push(indent ? lines[j].replace(new RegExp('^ {0,' + indent + '}'), '') : lines[j]);
    }
    const { lang, attrs } = parseFenceInfo(fm[2]);
    out.push({ lang, attrs, code: body.join('\n'), line: i });
    i = j;
  }
  return out;
}

/* Raw YAML body helper for directives such as ::: flashcards. */
export function loadYaml(text) {
  return yaml.load(String(text ?? ''));
}

/* Heading slug used for anchors and annotation sections. */
export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'section';
}

/* Body of a YAML directive (tests, flashcards): raw YAML, or the first
   fenced block inside it (```yaml … ```). */
export function yamlBody(raw) {
  const f = fencesIn(raw)[0];
  return yaml.load(f ? f.code : String(raw ?? ''));
}
