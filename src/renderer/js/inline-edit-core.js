/* ============================================================
 * inline-edit-core.js — the DOM-free half of the in-place editor
 * (inline-edit.js): page source as lines, Markdown line prefixes,
 * splicing an edited unit back, table rows, escaping.
 *
 * Unit ranges are 0-based [start, end) line numbers in the page file.
 * The serializer hands over "raw" Markdown in which every atom (inline
 * math, inline directives, raw HTML, code spans, unchanged links, …) is
 * one private-use character, so escaping never touches an atom, and a
 * hard line break (<br>) is HB followed by "\n".
 * No DOM here: unit-tested in test/inline-edit.test.mjs.
 * ============================================================ */

export const HB = '\uF8FF';
const ATOM0 = 0xE000;
const ATOM_LAST = 0xF8FE;
const ATOM_RE = /[\uE000-\uF8FE]/g;

export function atomChar(i) {
  if (ATOM0 + i > ATOM_LAST) throw new Error('too many inline atoms');
  return String.fromCharCode(ATOM0 + i);
}

export function restoreAtoms(s, atoms = []) {
  return String(s).replace(ATOM_RE, c => atoms[c.charCodeAt(0) - ATOM0] ?? '');
}

/* ─── the page source as lines (line endings and BOM preserved) ─── */

export class SourceDoc {
  constructor(text) {
    let s = String(text ?? '');
    this.bom = s.startsWith('\uFEFF') ? '\uFEFF' : '';
    if (this.bom) s = s.slice(1);
    const parts = s.split(/(\r?\n)/);
    this.lines = [];
    this.seps = [];
    for (let i = 0; i < parts.length; i += 2) {
      this.lines.push(parts[i]);
      this.seps.push(parts[i + 1] ?? '');
    }
    const crlf = (s.match(/\r\n/g) || []).length;
    const lf = (s.match(/\n/g) || []).length - crlf;
    this.eol = crlf > lf ? '\r\n' : '\n';
  }

  get text() {
    let out = this.bom;
    for (let i = 0; i < this.lines.length; i++) out += this.lines[i] + this.seps[i];
    return out;
  }

  get length() { return this.lines.length; }

  line(i) { return this.lines[i] ?? ''; }

  slice(start, end) { return this.lines.slice(start, end); }

  /* Replace lines [start, end) with newLines; returns the line-count delta.
     New lines use the file's dominant line ending; the file keeps whatever
     it had (or did not have) after its last line. */
  replace(start, end, newLines) {
    const n = this.lines.length;
    end = Math.min(Math.max(end, start), n);
    const finalSep = this.seps[n - 1];
    const seps = newLines.map(() => this.eol);
    if (end === n) {
      if (newLines.length) {
        seps[seps.length - 1] = finalSep;
        if (start === n && n > 0) this.seps[n - 1] = this.eol;
      } else if (start > 0) {
        this.seps[start - 1] = finalSep;
      }
    }
    this.lines.splice(start, end - start, ...newLines);
    this.seps.splice(start, end - start, ...seps);
    return newLines.length - (end - start);
  }
}

/* ─── line prefixes ─── */

/* Blockquote markers and indentation (continuation lines). */
const QUOTE_PREFIX = /^(?:[ \t]*>[ \t]?)*[ \t]*/;
/* …plus list markers: the first line of a list item. */
const LEAD_PREFIX = /^(?:[ \t]*(?:>[ \t]?|(?:[-+*]|\d{1,9}[.)])(?=[ \t]|$)[ \t]*))*[ \t]*/;
const TASK_BOX = /^\[[ xX]\][ \t]+(?=\S)/;
const MARKER_G = /(?:[-+*]|\d{1,9}[.)])(?=[ \t]|$)/g;
const SETEXT_LINE = /^(?:=+|-+)[ \t]*$/;

/* The part of a source line that is structure, not text:
   "> - [ ] " / "   " / "1. " / "> ". lead: the line may start a list item
   (list markers count); task: a "[ ] " box follows the marker. */
export function linePrefix(line, { lead = false, task = false } = {}) {
  line = String(line ?? '');
  let p = (lead ? LEAD_PREFIX : QUOTE_PREFIX).exec(line)[0];
  if (lead && task) {
    const t = TASK_BOX.exec(line.slice(p.length));
    if (t) p += t[0];
  }
  return p;
}

/* Prefix for an extra line of the same block: markers become spaces. */
export function contPrefix(prefix) {
  return String(prefix).replace(/\[[ xX]\]/g, '   ').replace(/[^>\s]/g, ' ');
}

/* Empty, or only blockquote markers. */
export function isBlank(line) {
  return /^(?:[ \t]*>)*[ \t]*$/.test(line ?? '');
}

function lastMarker(prefix) {
  let m;
  let last = null;
  MARKER_G.lastIndex = 0;
  while ((m = MARKER_G.exec(prefix))) last = { index: m.index, marker: m[0] };
  return last;
}

/* ─── escaping ─── */

/* A text line that would otherwise become structure gets one backslash. */
export function escapeLineStart(line) {
  if (!line) return line;
  if (/^(?:#{1,6}(?=[ \t]|$)|>|[-+*](?=[ \t]|$)|:{2,}|`{3,}|~{3,}|\$\$|=+[ \t]*$)/.test(line)) return `\\${line}`;
  if (/^(?:[-*_][ \t]*){3,}$/.test(line)) return `\\${line}`;
  const n = /^(\d{1,9})([.)])(?=[ \t]|$)/.exec(line);
  if (n) return `${n[1]}\\${line.slice(n[1].length)}`;
  if (/^\[[^\]]*\]:/.test(line)) return `\\${line}`;
  if (/^<[A-Za-z/!?]/.test(line)) return `\\${line}`;
  return line;
}

/* "Title #" would lose its "#" as an ATX closing sequence. */
export function escapeHeadingEnd(s) {
  return String(s).replace(/(^|[ \t])(#+)[ \t]*$/, (_m, sp, hashes) => `${sp}\\${hashes}`);
}

export function codeSpan(code) {
  code = String(code ?? '').replace(/\u00A0/g, ' ').replace(/\u200B/g, '').replace(/\r?\n/g, ' ');
  if (!code) return '';
  let longest = 0;
  for (const m of code.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  const fence = '`'.repeat(longest + 1);
  const pad = /^`|`$/.test(code) || (/^ /.test(code) && / $/.test(code) && /[^ ]/.test(code)) ? ' ' : '';
  return fence + pad + code + pad + fence;
}

/* **x** around inner text; edge whitespace stays outside the delimiters. */
export function wrapDelim(delim, inner) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(String(inner));
  if (!m[2]) return inner;
  return m[1] + delim + m[2] + delim + m[3];
}

function clean(raw) {
  return String(raw ?? '').replace(/\u00A0/g, ' ').replace(/\u200B|\uFEFF/g, '').replace(/\r\n?/g, '\n');
}

/* Paragraph / list-item text → Markdown lines (joined with "\n"). */
export function finalizeBlock(raw, atoms = []) {
  let lines = clean(raw).split('\n').map(l => l.replace(/^[ \t]+|[ \t]+$/g, ''));
  lines = lines.filter(l => l !== '');
  while (lines.length) {
    const last = lines[lines.length - 1].replace(new RegExp(`[${HB}\\s]+$`), '');
    if (last) { lines[lines.length - 1] = last; break; }
    lines.pop();
  }
  while (lines.length && lines[0].replace(new RegExp(`[${HB}\\s]`, 'g'), '') === '') lines.shift();
  lines = lines.map((l, i) => {
    let s = l;
    if (i < lines.length - 1 && !s.endsWith(HB) && /(^|[^\\])(\\\\)*\\$/.test(s)) s += '\\';
    s = escapeLineStart(s);
    return s.replace(new RegExp(HB, 'g'), '\\');
  });
  return restoreAtoms(lines.join('\n'), atoms);
}

/* Heading text → one line. */
export function finalizeHeading(raw, atoms = [], { setext = false } = {}) {
  let s = clean(raw).replace(new RegExp(HB, 'g'), ' ').replace(/[ \t]*\n[ \t]*/g, ' ').trim();
  s = setext ? escapeLineStart(s) : escapeHeadingEnd(s);
  return restoreAtoms(s, atoms);
}

/* Table cell text → one line; "|" is escaped when the row is built. */
export function finalizeCell(raw, atoms = []) {
  const s = clean(raw).replace(new RegExp(HB, 'g'), ' ').replace(/[ \t]*\n[ \t]*/g, ' ').trim();
  return restoreAtoms(s, atoms);
}

/* ─── splicing a unit ─── */

function removeUnit(doc, start, end) {
  let s = start;
  let e = end;
  const n = doc.length;
  const blankBefore = s === 0 || isBlank(doc.line(s - 1));
  if (blankBefore && e < n && isBlank(doc.line(e))) e++;
  else if (e >= n && s > 0 && isBlank(doc.line(s - 1))) s--;
  const delta = doc.replace(s, e, []);
  return { removed: true, md: '', start: s, end: s, at: e, delta };
}

/* Replace a paragraph / list-item text / heading with new content.
 *   unit: { kind: 'block'|'heading', start, end, lead, task, keepEmpty }
 * → { md, start, end, at, delta, removed? } — at: old end line (later
 *   lines move by delta) — or null when the source does not look like
 *   the unit (stale map). Empty content removes the unit's lines (and one
 *   blank neighbour) unless keepEmpty. */
export function spliceUnit(doc, unit, raw, atoms = []) {
  const { start, end } = unit;
  if (!(start >= 0 && end > start && end <= doc.length)) return null;
  const lines = doc.slice(start, end);
  const lead = !!unit.lead;
  const task = !!unit.task;

  if (unit.kind === 'heading') {
    const underline = lines.length >= 2 ? lines[lines.length - 1] : null;
    const setext = underline != null && SETEXT_LINE.test(underline.slice(linePrefix(underline).length));
    const md = finalizeHeading(raw, atoms, { setext });
    if (!md) return removeUnit(doc, start, end);
    let out;
    if (setext) {
      out = [linePrefix(lines[0], { lead }) + md, underline];
    } else {
      const p = linePrefix(lines[0], { lead });
      const rest = lines[0].slice(p.length);
      const hm = /^#{1,6}(?:[ \t]+|$)/.exec(rest);
      if (!hm) return null;
      const body = rest.slice(hm[0].length);
      const closing = /(?:^|[ \t]+)#+[ \t]*$/.exec(body);
      const suffix = closing && closing.index > 0 ? body.slice(closing.index) : '';
      const marks = /[ \t]$/.test(hm[0]) ? hm[0] : `${hm[0]} `;
      out = [p + marks + md + suffix];
    }
    const delta = doc.replace(start, end, out);
    return { md, start, end: start + out.length, at: end, delta };
  }

  const md = finalizeBlock(raw, atoms);
  const prefixes = lines.map((l, i) => linePrefix(l, { lead: lead && i === 0, task: task && i === 0 }));
  if (!md) {
    if (!unit.keepEmpty) return removeUnit(doc, start, end);
    const out = [prefixes[0].replace(/[ \t]+$/, '')];
    const delta = doc.replace(start, end, out);
    return { md, start, end: start + 1, at: end, delta };
  }
  const cont = prefixes.length > 1 ? prefixes[prefixes.length - 1] : contPrefix(prefixes[0]);
  const out = md.split('\n').map((l, i) => (i < prefixes.length ? prefixes[i] : cont) + l);
  const delta = doc.replace(start, end, out);
  return { md, start, end: start + out.length, at: end, delta };
}

/* ─── inserting a new unit ─── */

/* Spec for a paragraph after (or before) a unit: same container. */
export function paraSpec(doc, unit) {
  return { kind: 'para', prefix: contPrefix(linePrefix(doc.line(unit.start), { lead: !!unit.lead, task: !!unit.task })) };
}

/* Spec for a sibling list item of the item starting at liStart. */
export function listItemSpec(doc, liStart, { task = false, next = true } = {}) {
  const p = linePrefix(doc.line(liStart), { lead: true });
  const mk = lastMarker(p);
  if (!mk) return null;
  const before = p.slice(0, mk.index).replace(/[^>\s]/g, ' ');
  let spacing = /^[ \t]*/.exec(p.slice(mk.index + mk.marker.length))[0];
  if (!spacing || spacing.length > 4) spacing = ' ';
  let marker = mk.marker;
  if (next && /^\d/.test(marker)) marker = `${Number.parseInt(marker, 10) + 1}${marker.slice(-1)}`;
  return {
    kind: 'li',
    marker: before + marker + spacing + (task ? '[ ] ' : ''),
    cont: contPrefix(before + marker + spacing),
  };
}

/* Spec for a paragraph after a list (leaving it). */
export function listExitSpec(doc, listStart) {
  const p = linePrefix(doc.line(listStart), { lead: true });
  const mk = lastMarker(p);
  return { kind: 'para', prefix: (mk ? p.slice(0, mk.index) : p).replace(/[^>\s]/g, ' ') };
}

/* Spec that puts a removed unit back exactly where it was. */
export function respawnSpec(doc, unit, level = 0) {
  const first = doc.line(unit.start);
  if (unit.kind === 'heading') {
    const p = linePrefix(first, { lead: !!unit.lead });
    const n = /^#{1,6}/.exec(first.slice(p.length))?.[0].length || level || 2;
    return { kind: 'heading', prefix: contPrefix(p), marks: `${'#'.repeat(n)} ` };
  }
  if (unit.lead) {
    const p = linePrefix(first, { lead: true, task: !!unit.task });
    return { kind: 'li', marker: p, cont: contPrefix(p) };
  }
  return paraSpec(doc, unit);
}

/* Last non-blank line in [start, end) — new list items go after it. */
export function lastContentLine(doc, start, end) {
  for (let i = Math.min(end, doc.length) - 1; i >= start; i--) if (!isBlank(doc.line(i))) return i;
  return start;
}

/* Insert a new unit at line `at` (paragraphs get blank-line separation).
 * → { md, start, end, at, delta } or null when there is no text. */
export function insertUnit(doc, at, spec, raw, atoms = []) {
  const md = spec.kind === 'heading' ? finalizeHeading(raw, atoms) : finalizeBlock(raw, atoms);
  if (!md) return null;
  const content = md.split('\n');
  let body;
  if (spec.kind === 'li') body = content.map((l, i) => (i ? spec.cont : spec.marker) + l);
  else if (spec.kind === 'heading') body = [spec.prefix + spec.marks + md];
  else body = content.map(l => spec.prefix + l);
  const separate = spec.kind !== 'li';
  const blank = (spec.prefix ?? '').replace(/[ \t]+$/, '');
  const before = separate && at > 0 && !isBlank(doc.line(at - 1));
  const after = separate && at < doc.length && !isBlank(doc.line(at));
  const out = [...(before ? [blank] : []), ...body, ...(after ? [blank] : [])];
  const delta = doc.replace(at, at, out);
  const start = at + (before ? 1 : 0);
  return { md, start, end: start + body.length, at, delta };
}

/* ─── table rows ─── */

function splitCells(s) {
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { cur += c + s[i + 1]; i++; continue; }
    if (c === '|') { cells.push(cur); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur);
  return cells;
}

export function parseRow(line, { lead = false } = {}) {
  const prefix = linePrefix(line, { lead });
  const rest = String(line).slice(prefix.length);
  const cells = splitCells(rest);
  const leadPipe = rest.startsWith('|');
  if (leadPipe) cells.shift();
  let trailPipe = false;
  let tail = '';
  if (cells.length > 1 && /^[ \t]*$/.test(cells[cells.length - 1])) {
    trailPipe = true;
    tail = cells.pop();
  }
  return { prefix, leadPipe, trailPipe, tail, cells };
}

export function buildRow(row) {
  return row.prefix + (row.leadPipe ? '|' : '') + row.cells.join('|') + (row.trailPipe ? `|${row.tail}` : '');
}

/* Rebuild one table row. cells[i]: null (unchanged) or { raw, atoms }.
   Unchanged cells keep their source text; edited ones keep their padding.
   → { mds, start, end, at, delta } (mds[i]: the cell's new Markdown,
   pipes unescaped — what to render). */
export function spliceRow(doc, lineNo, cells, { lead = false } = {}) {
  if (!(lineNo >= 0 && lineNo < doc.length)) return null;
  const row = parseRow(doc.line(lineNo), { lead });
  const mds = [];
  cells.forEach((c, i) => {
    if (c == null) return;
    const md = finalizeCell(c.raw, c.atoms);
    mds[i] = md;
    for (let k = row.cells.length; k < i; k++) row.cells[k] = ' ';
    const old = row.cells[i];
    const blank = old == null || !old.trim();
    const l = blank ? ' ' : /^[ \t]*/.exec(old)[0];
    const r = blank ? ' ' : /[ \t]*$/.exec(old)[0];
    row.cells[i] = md ? l + md.replace(/\|/g, '\\|') + r : (blank ? old || ' ' : ' ');
  });
  doc.replace(lineNo, lineNo + 1, [buildRow(row)]);
  return { mds, start: lineNo, end: lineNo + 1, at: lineNo + 1, delta: 0 };
}
