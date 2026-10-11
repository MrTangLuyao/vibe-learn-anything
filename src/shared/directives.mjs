/* ============================================================
 * src/shared/directives.mjs
 * The Vitent directive registry + text-level validation.
 * Keep in sync with ai_manual/03-vitent-blocks.md.
 * ============================================================ */

import { splitFrontmatter, parseBlocks, walk, fencesIn, yamlBody } from './vitent-parse.mjs';

export const CALLOUT_TYPES = ['note', 'tip', 'info', 'warning', 'danger', 'success', 'question', 'example'];

export const PAGE_KINDS = ['doc', 'code', 'quiz', 'slides', 'pdf', 'video', 'lab', 'survey', 'reading', 'project'];

export const HIGHLIGHT_KINDS = ['yellow', 'green', 'blue', 'pink', 'ask', 'revise'];

export const SLOTS = ['topbar.left', 'topbar.right', 'lessonbar.left', 'lessonbar.right', 'sidebar.bottom', 'page.end'];

export const ACTION_TYPES = ['exec', 'script', 'http', 'open', 'ask-ai', 'ui', 'copy', 'goto', 'sequence'];

export const UI_COMMANDS = [
  'prev', 'next', 'home', 'course', 'toggle-sidebar', 'toggle-notes', 'toggle-terminal',
  'focus', 'theme', 'highlight', 'edit', 'export', 'export-ai', 'settings', 'help', 'complete', 'reload',
  'ai', 'ai-edit',
];

const C = 'container';
const L = 'leaf';
const I = 'inline';

export const DIRECTIVES = {
  callout: { kind: C, attrs: ['type', 'title', 'icon', 'collapsed'] },
  details: { kind: C, attrs: ['open'] },
  reveal: { kind: C, attrs: ['button'] },
  tabs: { kind: C, attrs: [] },
  tab: { kind: C, parent: 'tabs', attrs: [] },
  columns: { kind: C, attrs: ['gap'] },
  column: { kind: C, parent: 'columns', attrs: ['width'] },
  steps: { kind: C, attrs: [] },
  step: { kind: C, parent: 'steps', attrs: [] },
  slides: { kind: C, attrs: ['height', 'aspect'] },
  slide: { kind: C, parent: 'slides', attrs: ['align', 'background'] },
  quiz: { kind: C, attrs: ['type', 'answer', 'match', 'tolerance', 'shuffle', 'reveal', 'points'] },
  explain: { kind: C, parent: ['quiz', 'cloze', 'parsons'], attrs: [] },
  hint: { kind: C, parent: ['quiz', 'cloze', 'parsons', 'workspace'], attrs: [] },
  cloze: { kind: C, attrs: ['match'] },
  parsons: { kind: C, attrs: ['lang'] },
  flashcards: { kind: C, attrs: ['shuffle'], yaml: true },
  workspace: {
    kind: C,
    attrs: ['title', 'runner', 'main', 'build', 'run', 'dir', 'height', 'terminal', 'readonly', 'open', 'tree'],
  },
  tests: { kind: C, parent: 'workspace', attrs: ['build'], yaml: true },
  solution: { kind: C, parent: 'workspace', attrs: [] },
  fullscreen: { kind: C, attrs: [] },

  pdf: { kind: L, attrs: ['src', 'page', 'height', 'title'], src: true },
  video: { kind: L, attrs: ['src', 'poster', 'start', 'height'], src: true },
  audio: { kind: L, attrs: ['src'], src: true },
  image: { kind: L, attrs: ['src', 'width', 'caption', 'alt'], src: true },
  embed: { kind: L, attrs: ['src', 'height'], src: true },
  html: { kind: L, attrs: ['src', 'height'], src: true },
  doc: { kind: L, attrs: ['src'], src: true },
  file: { kind: [L, I], attrs: ['src'], src: true },
  button: { kind: L, attrs: ['action', 'icon', 'variant', 'output'] },
  ask: { kind: [L, I], attrs: ['prompt', 'context'] },
  terminal: { kind: L, attrs: ['cwd', 'height', 'command', 'shell'] },
  include: { kind: L, attrs: ['src'], src: true },
  toc: { kind: L, attrs: ['depth'] },
  divider: { kind: L, attrs: [] },

  kbd: { kind: I, attrs: [] },
  btn: { kind: I, attrs: ['action', 'icon'] },
  term: { kind: I, attrs: ['tip'] },
  badge: { kind: I, attrs: ['color'] },
  hl: { kind: I, attrs: ['color'] },
  icon: { kind: I, attrs: ['color'] },
  link: { kind: I, attrs: ['page', 'chapter', 'url'] },
};
for (const t of CALLOUT_TYPES) DIRECTIVES[t] = { kind: C, alias: 'callout', attrs: ['title', 'icon', 'collapsed'] };

export function isKind(name, kind) {
  const d = DIRECTIVES[name];
  if (!d) return false;
  return Array.isArray(d.kind) ? d.kind.includes(kind) : d.kind === kind;
}

/* Returns every relative resource the page points at (for asset checks). */
export function collectRefs(text) {
  const { body } = splitFrontmatter(text);
  const refs = [];
  const tree = parseBlocks(body);
  walk(tree, node => {
    if ((node.type === 'leaf' || node.type === 'container') && DIRECTIVES[node.name]?.src && node.attrs.src) {
      refs.push({ src: String(node.attrs.src), line: node.line + 1, via: node.name });
    }
    if (node.type === 'container' && node.name === 'workspace' && node.attrs.dir) {
      refs.push({ src: String(node.attrs.dir), line: node.line + 1, via: 'workspace.dir', dir: true });
    }
  });
  const re = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
  const lines = body.split(/\r?\n/);
  lines.forEach((line, i) => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line))) refs.push({ src: m[1], line: i + 1, via: 'markdown' });
  });
  const inl = /(^|[^\w\\]):(file|ask|btn|link)\[[^\]]*\]\{([^}]*)\}/g;
  lines.forEach((line, i) => {
    let m;
    inl.lastIndex = 0;
    while ((m = inl.exec(line))) {
      const src = /src=("([^"]*)"|'([^']*)'|(\S+))/.exec(m[3]);
      if (m[2] === 'file' && src) refs.push({ src: src[2] ?? src[3] ?? src[4], line: i + 1, via: ':file' });
    }
  });
  return refs.filter(r => r.src && !/^(https?:|mailto:|data:|#|vla:)/i.test(r.src));
}

/* How many elements a list of parsed nodes holds: each directive is one,
   and Markdown counts one per block (blank-line separated, fences whole). */
export function countElements(nodes) {
  let n = 0;
  for (const node of nodes || []) {
    if (node.type === 'container' || node.type === 'leaf') { n++; continue; }
    if (node.type !== 'md') continue;
    let fence = null;
    let inBlock = false;
    for (const line of String(node.text || '').split(/\r?\n/)) {
      const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; continue; }
      if (f) { fence = f[1]; if (!inBlock) n++; inBlock = true; continue; }
      if (!line.trim()) { inBlock = false; continue; }
      if (!inBlock) { n++; inBlock = true; }
    }
  }
  return n;
}

/* A page that is only a :::fullscreen block fills the whole reading area. */
export function isFillPage(tree) {
  const top = (tree?.children || []).filter(c => c.type !== 'md' || String(c.text || '').trim());
  return top.length === 1 && top[0].type === 'container' && top[0].name === 'fullscreen';
}

/* Text-level checks. Returns [{ level: 'error'|'warn', line, msg }]. */
export function validateVitentText(text) {
  const issues = [];
  const add = (level, line, msg) => issues.push({ level, line, msg });
  const fm = splitFrontmatter(text);
  if (fm.error) add('error', 1, `frontmatter: ${fm.error}`);
  if (!fm.data.title) add('warn', 1, 'frontmatter has no `title`');
  if (fm.data.kind && !PAGE_KINDS.includes(fm.data.kind)) add('warn', 1, `unknown page kind "${fm.data.kind}"`);
  const tree = parseBlocks(fm.body, fm.offset);
  const ids = new Map();
  walk(tree, (node, parent) => {
    if (node.type !== 'container' && node.type !== 'leaf') return;
    const line = node.line + 1;
    const def = DIRECTIVES[node.name];
    if (!def) { add('warn', line, `unknown directive "${node.name}" (rendered as plain text box)`); return; }
    if (node.type === 'container' && !isKind(node.name, C)) add('error', line, `"${node.name}" is not a container directive; use ::${node.name}`);
    if (node.type === 'leaf' && !isKind(node.name, L)) add('error', line, `"${node.name}" is not a leaf directive; use :::${node.name} … :::`);
    if (node.unclosed) add('error', line, `container ":::${node.name}" is never closed`);
    if (def.parent) {
      const allowed = [].concat(def.parent);
      if (!parent || !allowed.includes(parent.name)) add('error', line, `"${node.name}" must be inside ${allowed.map(p => ':::' + p).join(' / ')}`);
    }
    for (const k of Object.keys(node.attrs)) {
      if (k === 'id' || k === 'class') continue;
      if (def.attrs && !def.attrs.includes(k)) add('warn', line, `"${node.name}" does not use attribute "${k}"`);
    }
    if (def.src && !node.attrs.src && node.name !== 'file') add('error', line, `"${node.name}" needs src="…"`);
    if (node.attrs.id) {
      if (ids.has(node.attrs.id)) add('error', line, `duplicate id "${node.attrs.id}" (also on line ${ids.get(node.attrs.id)})`);
      else ids.set(node.attrs.id, line);
    }
    if (def.yaml && node.raw.trim()) {
      try { yamlBody(node.raw); } catch (e) { add('error', line, `${node.name}: YAML body does not parse: ${e.message.split('\n')[0]}`); }
    }
    if (node.name === 'quiz') {
      const opts = (node.raw.match(/^\s*[-*] \[[ xX]\]/gm) || []).length;
      const right = (node.raw.match(/^\s*[-*] \[[xX]\]/gm) || []).length;
      const survey = node.attrs.type === 'survey' || node.attrs.type === 'poll';
      if (!opts && node.attrs.answer == null && !survey && node.attrs.type !== 'open') add('error', line, 'quiz needs options (- [ ] / - [x]) or answer="…"');
      if (opts && !right && !survey) add('error', line, 'quiz has options but none is marked correct with - [x]');
    }
    if (node.name === 'fullscreen') {
      if (parent && parent.type !== 'root') add('error', line, '"fullscreen" must be at the top level of the page, not inside another directive');
      const n = countElements(node.children);
      if (n !== 1) add('error', line, `fullscreen must contain exactly one element (found ${n})`);
    }
    if (node.name === 'cloze' && !/\[\[[^\]]+\]\]/.test(node.raw)) add('error', line, 'cloze needs at least one [[blank]]');
    if (node.name === 'parsons' && !fencesIn(node.raw).length) add('error', line, 'parsons needs a fenced code block with the lines in the correct order');
    if (node.name === 'workspace') {
      const files = node.children.filter(c => c.type === 'md').flatMap(c => fencesIn(c.text)).filter(f => f.attrs.file);
      if (!files.length && !node.attrs.dir) add('warn', line, 'workspace has no ```lang file=… blocks and no dir="…"; it starts empty');
      if (!node.attrs.runner && !node.attrs.run) add('warn', line, 'workspace has neither runner= nor run=; the Run button is hidden');
    }
  });
  return issues;
}
