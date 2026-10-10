/* ============================================================
 * highlight/anchor.js — text-quote anchoring (W3C Web Annotation
 * TextQuoteSelector + position hint). A scope root's text is the
 * concatenation of its text nodes, skipping UI chrome
 * ([data-vh-skip], buttons, editors) and nested [data-vh-scope]s.
 * ============================================================ */

const SKIP = '[data-vh-skip], button, script, style, textarea, input, select, .monaco-editor, .xterm, .vh-dot, .vh-block-tag, .vh-mark-btn, .katex';

export function buildModel(root) {
  const nodes = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (n.nodeType === 1) {
        if (n !== root && (n.matches(SKIP) || n.hasAttribute('data-vh-scope'))) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) {
    const n = walker.currentNode;
    const len = n.nodeValue.length;
    if (!len) continue;
    nodes.push({ node: n, start: text.length, end: text.length + len });
    text += n.nodeValue;
  }
  return { root, nodes, text };
}

function offsetAtStart(model, container, offset) {
  if (container.nodeType === 3) {
    const e = model.nodes.find(x => x.node === container);
    if (e) return e.start + Math.min(offset, e.node.nodeValue.length);
  }
  const r = document.createRange();
  r.setStart(container, offset);
  r.collapse(true);
  for (const e of model.nodes) if (r.comparePoint(e.node, 0) >= 0) return e.start;
  return model.text.length;
}

function offsetAtEnd(model, container, offset) {
  if (container.nodeType === 3) {
    const e = model.nodes.find(x => x.node === container);
    if (e) return e.start + Math.min(offset, e.node.nodeValue.length);
  }
  const r = document.createRange();
  r.setStart(container, offset);
  r.collapse(true);
  for (let i = model.nodes.length - 1; i >= 0; i--) {
    const e = model.nodes[i];
    if (r.comparePoint(e.node, e.node.nodeValue.length) <= 0) return e.end;
  }
  return 0;
}

const CTX = 32;

export function rangeToQuote(model, range) {
  let start = offsetAtStart(model, range.startContainer, range.startOffset);
  let end = offsetAtEnd(model, range.endContainer, range.endOffset);
  if (end <= start) return null;
  while (start < end && /\s/.test(model.text[start])) start++;
  while (end > start && /\s/.test(model.text[end - 1])) end--;
  if (end <= start) return null;
  return {
    exact: model.text.slice(start, end),
    prefix: model.text.slice(Math.max(0, start - CTX), start),
    suffix: model.text.slice(end, end + CTX),
    start,
  };
}

function commonSuffixLen(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLen(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

export function anchorQuote(model, q) {
  if (!q?.exact) return null;
  const hits = [];
  let i = model.text.indexOf(q.exact);
  while (i >= 0) { hits.push(i); i = model.text.indexOf(q.exact, i + 1); }
  if (!hits.length) {
    /* tolerate whitespace differences */
    const norm = q.exact.replace(/\s+/g, ' ').trim();
    const re = new RegExp(norm.split(' ').map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'g');
    let m;
    while ((m = re.exec(model.text))) { hits.push({ at: m.index, len: m[0].length }); if (hits.length > 50) break; }
    if (!hits.length) return null;
  }
  let best = null;
  let bestScore = -Infinity;
  for (const hit of hits) {
    const at = typeof hit === 'number' ? hit : hit.at;
    const len = typeof hit === 'number' ? q.exact.length : hit.len;
    const pre = model.text.slice(Math.max(0, at - CTX), at);
    const suf = model.text.slice(at + len, at + len + CTX);
    let score = commonSuffixLen(pre, q.prefix || '') + commonPrefixLen(suf, q.suffix || '');
    if (q.start != null) score -= Math.min(20, Math.abs(at - q.start) / 200);
    if (score > bestScore) { bestScore = score; best = { start: at, end: at + len }; }
  }
  return best;
}

/* Wrap [start, end) of the model's text in elements made by make(). */
export function wrapRange(model, start, end, make) {
  const marks = [];
  for (const e of model.nodes) {
    if (e.end <= start || e.start >= end) continue;
    let node = e.node;
    const a = Math.max(0, start - e.start);
    const b = Math.min(node.nodeValue.length, end - e.start);
    if (b <= a) continue;
    if (!node.nodeValue.slice(a, b).trim() && b - a < node.nodeValue.length) continue;
    if (a > 0) node = node.splitText(a);
    if (b - a < node.nodeValue.length) node.splitText(b - a);
    const mark = make();
    node.parentNode.insertBefore(mark, node);
    mark.appendChild(node);
    marks.push(mark);
  }
  return marks;
}

export function unwrap(marks) {
  const parents = new Set();
  for (const m of marks) {
    const p = m.parentNode;
    if (!p) continue;
    while (m.firstChild) p.insertBefore(m.firstChild, m);
    p.removeChild(m);
    parents.add(p);
  }
  for (const p of parents) p.normalize();
}

/* Nearest heading before a node — a hint for the AI. */
export function sectionOf(root, node) {
  let section = '';
  for (const hd of root.querySelectorAll('h1, h2, h3, h4')) {
    if (hd.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) section = hd.textContent.trim();
    else break;
  }
  return section;
}
