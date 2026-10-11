/* ============================================================
 * inline-edit.js — edit a rendered page in place (Typora-style).
 *
 *   const ed = new InlineEditor({ article, text, onSave, onStatus, onExit?, host? })
 *   ed.enable()        text becomes editable; widgets stay locked
 *   await ed.flush()   commit pending edits and save now
 *   await ed.disable() commit, then stop editing
 *   ed.text            the current page source
 *   ed.exit() / ed.confirmLeave() / ed.destroy()   for the lesson view
 *
 * Every paragraph, heading, list-item text and table cell that carries a
 * data-sl source map (vitent/markdown.js) is its own contenteditable
 * "unit". Inline atoms (math, inline directives, raw HTML, images) are
 * contenteditable=false and serialize back to their exact source. An
 * edited unit is serialized to Markdown and spliced into its source lines
 * (inline-edit-core.js) ~700 ms after typing stops and on blur; on blur
 * it is re-rendered from the new Markdown, so "**x**" typed by the
 * learner turns bold. Nothing else on the page is re-rendered.
 * ============================================================ */

import { h, icon } from './core/dom.js';
import { getLang } from './core/i18n.js';
import { toast, dialog } from './core/ui.js';
import {
  SourceDoc, HB, atomChar, restoreAtoms, codeSpan, wrapDelim,
  spliceUnit, spliceRow, insertUnit, paraSpec, listItemSpec, listExitSpec, respawnSpec, lastContentLine,
} from './inline-edit-core.js';

const STRINGS = {
  zh: {
    editing: '正在编辑文字',
    saved: '已保存',
    saving: '正在保存…',
    dirty: '编辑中',
    error: '保存失败',
    done: '完成',
    locked: '控件不能在这里修改（可在设置里打开源码编辑）',
    help: '点击文字直接修改，支持 Markdown（**粗体**、*斜体*、`代码`）· Enter 新段落 · Shift+Enter 换行 · Ctrl+B / Ctrl+I 粗体 / 斜体 · Esc 结束这一段',
    placeholder: '输入文字…',
    nothing: '这一页没有可以直接修改的文字',
    stale: '这段文字和文件内容对不上，已停止编辑这一段',
    saveFailed: '保存失败：{msg}',
    leaveQ: '修改还没有保存成功',
    leaveBody: '保存这一页时出错：{msg}',
    retry: '重试',
    leave: '仍然离开',
    cancel: '取消',
  },
  en: {
    editing: 'Editing text',
    saved: 'Saved',
    saving: 'Saving…',
    dirty: 'Editing',
    error: 'Save failed',
    done: 'Done',
    locked: 'Controls cannot be changed here (turn on the source editor in Settings)',
    help: 'Click any text to change it; Markdown works (**bold**, *italic*, `code`) · Enter new paragraph · Shift+Enter line break · Ctrl+B / Ctrl+I bold / italic · Esc leave the paragraph',
    placeholder: 'Type something…',
    nothing: 'This page has no text that can be edited here',
    stale: 'This text no longer matches the file; editing it was stopped',
    saveFailed: 'Could not save: {msg}',
    leaveQ: 'Your changes are not saved',
    leaveBody: 'Saving this page failed: {msg}',
    retry: 'Retry',
    leave: 'Leave anyway',
    cancel: 'Cancel',
  },
};

function S(key, vars) {
  const s = (STRINGS[getLang()] || STRINGS.zh)[key] ?? STRINGS.zh[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m) : s;
}

const COMMIT_MS = 700;
/* Widgets whose Markdown children are page text. */
const TEXT_WIDGETS = new Set(['callout', 'details', 'reveal', 'tabs', 'columns', 'steps', 'table']);
/* Container chrome that is part of a directive line, not text. */
const CHROME = '.co-title, .vx-details > summary, .tab-btn, .step-title, .steps-ctl, .vx-reveal > .btn';
const LOCKED = `.vx, [data-widget], .vt-code, .vt-math-block, .vt-mermaid, .vt-header, .vt-fm-error, .vt-fence, hr, [data-ie-locked], ${CHROME}`;
/* Never serialized. */
const SKIP = 'input, .vh-dot, .vh-block-tag, .vh-mark-btn, [data-ie-skip], script, style, template';
/* Things that cannot be written back unless they are (inside) an atom. */
const RISKY = '.vt-math, .katex, [data-vt-inline], img, button, svg, iframe, video, audio, canvas, object, textarea, select, kbd, .vt-badge, .vt-hl, .vt-term, .vt-icon, .vt-fence, .vx, [data-widget]';
const FORMAT = { STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', DEL: 'del', S: 'del', STRIKE: 'del' };
const DELIM = { strong: '**', em: '*', del: '~~' };
const BLOCKISH = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'TABLE', 'TR']);
const BLOCKED_INPUT = new Set([
  'formatUnderline', 'formatSuperscript', 'formatSubscript', 'formatJustifyFull', 'formatJustifyCenter', 'formatJustifyRight',
  'formatJustifyLeft', 'formatIndent', 'formatOutdent', 'formatFontColor', 'formatBackColor', 'formatFontName',
  'insertOrderedList', 'insertUnorderedList', 'insertHorizontalRule', 'insertLink', 'formatSetBlockTextDirection',
  'formatSetInlineTextDirection', 'formatRemove',
]);
const HB_G = new RegExp(HB, 'g');

const parseSL = el => {
  const m = /^(\d+)-(\d+)$/.exec(el?.dataset?.sl || '');
  return m ? [Number(m[1]), Number(m[2])] : null;
};

/* An element that stands for a piece of Markdown source as a whole. */
function isAtom(el) {
  if (el.dataset.md == null || el.classList.contains('vt-esc')) return false;
  return el.tagName !== 'A' || el.dataset.vtInline != null;
}

function verbatimText(md) {
  if (/^\\[!-/:-@[-`{-~]$/.test(md)) return md[1];
  if (md.startsWith('&')) {
    const ta = document.createElement('textarea');
    ta.innerHTML = md;
    return ta.value;
  }
  return md;
}

function hasContent(frag) {
  return !!(frag.textContent.replace(/[\s\u200B]/g, '') || frag.querySelector?.('[data-md], img'));
}

export class InlineEditor {
  constructor({ article, text, onSave, onStatus, onExit, host } = {}) {
    this.article = article;
    this.doc = new SourceDoc(text);
    this.onSave = onSave;
    this.onStatus = onStatus;
    this.onExit = onExit;
    this.host = host || article.closest('.reader-wrap') || article.parentElement;
    this.log = [];
    this.units = new Set();
    this.dirty = new Set();
    this.timer = null;
    this.chain = Promise.resolve();
    this.savedText = this.doc.text;
    this.saveError = null;
    this.status = 'saved';
    this.enabled = false;
    this.exiting = false;
    this.hintEl = null;
    this.hintFor = null;
    this.hintTimer = null;

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onInput = this.onInput.bind(this);
    this.onBeforeInput = this.onBeforeInput.bind(this);
    this.onFocusOut = this.onFocusOut.bind(this);
    this.onPaste = this.onPaste.bind(this);
    this.onDrop = this.onDrop.bind(this);
    this.onClickCapture = this.onClickCapture.bind(this);
    this.onMouseDownCapture = this.onMouseDownCapture.bind(this);
    this.onPointerOver = this.onPointerOver.bind(this);
    this.hideHint = this.hideHint.bind(this);
    this.onDragStart = e => { if (this.unitOf(e.target)) e.preventDefault(); };
    this.onComposition = e => { this.composing = e.type === 'compositionstart'; };
    this.mo = new MutationObserver(list => this.onMutations(list));
  }

  get text() {
    return this.doc.text;
  }

  /* ─── lifecycle ─── */

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    const a = this.article;
    a.classList.add('is-inline-editing');
    try { document.execCommand('styleWithCSS', false, false); } catch { /* not supported */ }
    for (const el of a.querySelectorAll('[data-sl]')) this.attachEl(el);
    a.addEventListener('keydown', this.onKeyDown);
    a.addEventListener('input', this.onInput);
    a.addEventListener('beforeinput', this.onBeforeInput);
    a.addEventListener('focusout', this.onFocusOut);
    a.addEventListener('paste', this.onPaste);
    a.addEventListener('drop', this.onDrop);
    a.addEventListener('click', this.onClickCapture, true);
    a.addEventListener('mousedown', this.onMouseDownCapture, true);
    a.addEventListener('pointermove', this.onPointerOver);
    a.addEventListener('pointerleave', this.hideHint);
    a.addEventListener('pointerdown', this.hideHint);
    a.addEventListener('dragstart', this.onDragStart);
    a.addEventListener('compositionstart', this.onComposition);
    a.addEventListener('compositionend', this.onComposition);
    this.scroller = a.closest('.reader, .es-preview') || window;
    this.scroller.addEventListener('scroll', this.hideHint, { passive: true });
    this.mo.observe(a, { childList: true, subtree: true });
    this.bar = this.renderBar();
    this.host?.append(this.bar);
    this.setStatus(this.status);
    if (!this.units.size) toast(S('nothing'), { timeout: 3000 });
  }

  async disable() {
    if (!this.enabled) return;
    await this.flush();
    this.teardown();
  }

  async flush() {
    clearTimeout(this.timer);
    this.commitDirty();
    await this.save();
  }

  async exit() {
    if (this.exiting) return;
    this.exiting = true;
    try {
      if (!(await this.confirmLeave())) return;
      this.teardown();
      this.onExit?.(this.text);
    } finally {
      this.exiting = false;
    }
  }

  async confirmLeave() {
    if (!this.enabled) return true;
    await this.flush();
    if (!this.saveError) return true;
    const msg = this.saveError.message || String(this.saveError);
    const r = await dialog({
      title: S('leaveQ'),
      iconName: 'triangle-alert',
      body: h('p', S('leaveBody', { msg })),
      actions: [{ label: S('cancel'), value: 'cancel' }, { label: S('leave'), value: 'leave', danger: true }, { label: S('retry'), value: 'retry', primary: true }],
    });
    if (r === 'retry') return this.confirmLeave();
    return r === 'leave';
  }

  destroy() {
    if (this.enabled) {
      clearTimeout(this.timer);
      this.commitDirty();
      this.save();
      this.teardown();
    }
    this.mo.disconnect();
  }

  teardown() {
    if (!this.enabled) return;
    this.enabled = false;
    clearTimeout(this.timer);
    const a = this.article;
    a.removeEventListener('keydown', this.onKeyDown);
    a.removeEventListener('input', this.onInput);
    a.removeEventListener('beforeinput', this.onBeforeInput);
    a.removeEventListener('focusout', this.onFocusOut);
    a.removeEventListener('paste', this.onPaste);
    a.removeEventListener('drop', this.onDrop);
    a.removeEventListener('click', this.onClickCapture, true);
    a.removeEventListener('mousedown', this.onMouseDownCapture, true);
    a.removeEventListener('pointermove', this.onPointerOver);
    a.removeEventListener('pointerleave', this.hideHint);
    a.removeEventListener('pointerdown', this.hideHint);
    a.removeEventListener('dragstart', this.onDragStart);
    a.removeEventListener('compositionstart', this.onComposition);
    a.removeEventListener('compositionend', this.onComposition);
    this.scroller?.removeEventListener('scroll', this.hideHint);
    this.mo.disconnect();
    this.hideHint();
    for (const u of this.units) {
      u.removeAttribute('contenteditable');
      u.removeAttribute('data-ie-unit');
      u.removeAttribute('data-ph');
      u.classList.remove('is-empty');
      u.removeAttribute('spellcheck');
    }
    for (const el of a.querySelectorAll('[data-ie-atom]')) { el.removeAttribute('contenteditable'); el.removeAttribute('data-ie-atom'); }
    for (const el of a.querySelectorAll('[data-ie-locked]')) el.removeAttribute('data-ie-locked');
    a.classList.remove('is-inline-editing');
    if (document.activeElement && a.contains(document.activeElement)) document.activeElement.blur();
    this.bar?.remove();
    this.bar = null;
  }

  /* ─── status bar ─── */

  renderBar() {
    this.stateEl = h('span.ie-state');
    return h('div.ie-bar', { 'data-vh-skip': '' },
      h('span.ie-badge', icon('type', { width: 14, height: 14 })),
      h('span.ie-label', S('editing')),
      h('span.ie-sep'),
      this.stateEl,
      h('button.icon-btn.icon-btn-sm.ie-help', { 'data-tip': S('help'), tabIndex: -1, 'aria-label': S('help') }, icon('circle-help')),
      h('button.btn.btn-sm.btn-primary.ie-done', { onClick: () => this.done() }, icon('check'), h('span', S('done'))));
  }

  setStatus(status, msg) {
    const prev = this.status;
    this.status = status;
    if (this.bar) {
      this.bar.dataset.state = status;
      const ic = { saved: 'check', saving: 'loader-circle', dirty: 'pencil', error: 'circle-alert' }[status] || 'check';
      this.stateEl.replaceChildren(icon(ic, { width: 13, height: 13 }), h('span', S(status)));
      this.stateEl.title = status === 'error' ? msg || '' : '';
    }
    if (status !== 'dirty' && (status !== prev || status === 'error')) this.onStatus?.(status, msg);
  }

  done() {
    if (this.onExit) this.exit();
    else this.disable();
  }

  /* ─── units ─── */

  attachEl(el) {
    if (el.tagName === 'TR') {
      for (const cell of el.children) if (cell.tagName === 'TD' || cell.tagName === 'TH') this.attach(cell, 'cell');
    } else if (el.tagName === 'P') this.attach(el, 'block');
    else if (/^H[1-6]$/.test(el.tagName)) this.attach(el, 'heading');
  }

  inTextFlow(el) {
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (p === this.article) return true;
      if (p.dataset.widget && !TEXT_WIDGETS.has(p.dataset.widget)) return false;
      if (p.matches('.vt-header, .vx-unknown, [contenteditable="false"], [data-ie-unit]')) return false;
    }
    return false;
  }

  /* Everything risky inside must be (inside) an atom we can write back. */
  safe(unit) {
    for (const n of unit.querySelectorAll(RISKY)) {
      if (isAtom(n)) continue;
      const host = n.parentElement?.closest('[data-md]');
      if (host && unit.contains(host) && isAtom(host)) continue;
      return false;
    }
    return true;
  }

  prepare(unit) {
    for (const el of unit.querySelectorAll('[data-md]')) {
      if (!isAtom(el)) continue;
      const outer = el.parentElement?.closest('[data-ie-atom]');
      if (outer && unit.contains(outer)) continue;
      el.setAttribute('contenteditable', 'false');
      el.dataset.ieAtom = '';
      if (el.tagName === 'IMG') el.draggable = false;
    }
  }

  setup(el, kind, pending = null) {
    el._ie = { kind, base: '', md: null, needsRender: false, pending };
    el.setAttribute('contenteditable', 'true');
    el.spellcheck = false;
    el.dataset.ieUnit = kind;
    el.dataset.ph = S('placeholder');
    el._ie.base = pending ? '' : this.serialize(el).key;
    this.units.add(el);
    this.updateEmpty(el);
  }

  attach(el, kind) {
    if (el._ie || !this.inTextFlow(el)) return;
    if ((kind === 'cell' ? el.parentElement : el).hasAttribute('data-ie-lock') || el.hasAttribute('data-ie-lock') || !this.safe(el)) {
      el.dataset.ieLocked = '';
      return;
    }
    this.prepare(el);
    this.setup(el, kind);
  }

  unitOf(node) {
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    const u = el?.closest?.('[data-ie-unit]');
    return u && this.article.contains(u) && u._ie ? u : null;
  }

  isEmpty(unit) {
    return !hasContent(unit);
  }

  updateEmpty(unit) {
    unit.classList.toggle('is-empty', this.isEmpty(unit));
  }

  visibleUnits() {
    return [...this.article.querySelectorAll('[data-ie-unit]')].filter(u => u._ie && u.getClientRects().length);
  }

  neighbour(unit, dir) {
    const list = this.visibleUnits();
    const i = list.indexOf(unit);
    return i < 0 ? null : list[i + dir] || null;
  }

  /* ─── source ranges (data-sl) and the shift log ─── */

  setSL(el, start, end) {
    el.dataset.sl = `${start}-${end}`;
    el._slv = this.log.length;
  }

  /* Range of an element, catching it up with shifts it missed while it
     was detached (e.g. the body of a :::reveal not opened yet). */
  range(el) {
    let r = parseSL(el);
    if (!r) return null;
    const v = el._slv ?? 0;
    if (v < this.log.length) {
      for (let i = v; i < this.log.length; i++) {
        const { at, delta } = this.log[i];
        if (r[0] >= at) r = [r[0] + delta, r[1] + delta];
      }
      this.setSL(el, r[0], r[1]);
    }
    return r;
  }

  /* Lines from `at` on moved by `delta`; containers of `owner` grow. */
  shift(at, delta, owner) {
    if (!delta) return;
    for (const el of this.article.querySelectorAll('[data-sl]')) this.range(el);
    this.log.push({ at, delta });
    for (const el of this.article.querySelectorAll('[data-sl]')) {
      if (el === owner) { el._slv = this.log.length; continue; }
      const r = parseSL(el);
      if (!r) continue;
      if (el.contains(owner)) this.setSL(el, r[0], Math.max(r[0], r[1] + delta));
      else if (r[0] >= at) this.setSL(el, r[0] + delta, r[1] + delta);
      else el._slv = this.log.length;
    }
  }

  shape(unit) {
    const el = unit._ie.kind === 'cell' ? unit.closest('tr') : unit;
    const r = this.range(el);
    if (!r) return null;
    let lead = false;
    for (let p = el.parentElement; p && p !== this.article; p = p.parentElement) {
      if (p.tagName !== 'LI') continue;
      const lr = this.range(p);
      if (lr && lr[0] === r[0]) lead = true;
      break;
    }
    const task = lead && !!unit.querySelector(':scope > input.task-box');
    return { kind: unit._ie.kind, start: r[0], end: r[1], lead, task };
  }

  /* ─── DOM → Markdown ─── */

  serialize(unit) {
    const atoms = [];
    const atom = md => { atoms.push(md); return atomChar(atoms.length - 1); };
    const kids = (parent, ctx) => {
      const segs = [];
      for (const n of parent.childNodes) {
        const f = n.nodeType === 1 && !isAtom(n) ? FORMAT[n.tagName] : null;
        if (f && !ctx[f]) {
          const inner = kids(n, { ...ctx, [f]: true });
          const last = segs[segs.length - 1];
          if (last?.f === f) last.inner += inner;
          else segs.push({ f, inner });
        } else segs.push({ s: node(n, ctx) });
      }
      return segs.map(x => (x.f ? wrapDelim(DELIM[x.f], x.inner) : x.s)).join('');
    };
    const verbatim = el => {
      const md = el.dataset.md;
      const orig = verbatimText(md);
      const t = el.textContent;
      if (t === orig) return atom(md);
      if (orig && t.startsWith(orig)) return atom(md) + t.slice(orig.length);
      if (orig && t.endsWith(orig)) return t.slice(0, t.length - orig.length) + atom(md);
      return t;
    };
    const link = (a, ctx) => {
      const label = kids(a, { ...ctx, link: true });
      const { md, ml, mt } = a.dataset;
      if (md != null && ml != null && restoreAtoms(label, atoms) === ml) return atom(md);
      if (a.dataset.mb != null) return label;
      if (!label.trim()) return label;
      if (ml != null && mt && /^(\(|\[[^\]])/.test(mt)) return `[${label}]${mt}`;
      const href = a.getAttribute('href') || '';
      return `[${label}](${/[\s()<>]/.test(href) ? `<${href}>` : href})`;
    };
    const node = (n, ctx) => {
      /* private-use characters are placeholders below; real ones ride along as atoms */
      if (n.nodeType === 3) return n.nodeValue.replace(/[\uE000-\uF8FF]/g, c => atom(c));
      if (n.nodeType !== 1) return '';
      if (n.matches(SKIP)) return '';
      if (isAtom(n)) return atom(n.dataset.md);
      const tag = n.tagName;
      if (tag === 'BR') return `${HB}\n`;
      if (tag === 'CODE') { const c = codeSpan(n.textContent); return c ? atom(c) : ''; }
      if (tag === 'A') return link(n, ctx);
      if (n.classList.contains('vt-esc') && n.dataset.md != null) return verbatim(n);
      const inner = kids(n, ctx);
      return BLOCKISH.has(tag) ? `${HB}\n${inner}` : inner;
    };
    const raw = kids(unit, {});
    return { raw, atoms, key: restoreAtoms(raw, atoms) };
  }

  /* ─── committing ─── */

  commitDirty() {
    for (const u of [...this.dirty]) this.commit(u);
    this.dirty.clear();
  }

  commit(unit) {
    const st = unit?._ie;
    if (!st || !unit.isConnected) return false;
    try {
      if (st.kind === 'cell') return this.commitRow(unit.closest('tr'));
      const ser = this.serialize(unit);
      if (st.pending) return this.commitNew(unit, ser);
      if (ser.key === st.base) return false;
      const shape = this.shape(unit);
      if (!shape) return false;
      const empty = !ser.key.replace(HB_G, '').trim();
      const li = shape.lead && unit.parentElement?.tagName === 'LI' ? unit.parentElement : null;
      const whole = !!li && [...li.children].every(c => c === unit);
      let target = shape;
      if (empty && whole) {
        const lr = this.range(li);
        if (lr) target = { ...shape, start: lr[0], end: lr[1] };
      }
      const spec = empty ? respawnSpec(this.doc, shape, Number(unit.tagName[1]) || 0) : null;
      const res = spliceUnit(this.doc, { ...target, keepEmpty: !!li && !whole }, ser.raw, ser.atoms);
      if (!res) { this.stale(unit); return false; }
      this.shift(res.at, res.delta, unit);
      if (res.removed) {
        this.setSL(unit, res.start, res.start);
        if (li) { this.setSL(li, res.start, res.start); li.dataset.ieNew = ''; }
        Object.assign(st, { pending: spec, base: '', md: '', needsRender: false });
      } else {
        this.setSL(unit, res.start, res.end);
        Object.assign(st, { base: ser.key, md: res.md, needsRender: true });
      }
      this.changed();
      return true;
    } catch (e) {
      console.error(e);
      this.stale(unit);
      return false;
    }
  }

  commitNew(unit, ser) {
    const st = unit._ie;
    if (!ser.key.replace(HB_G, '').trim()) return false;
    const r = this.range(unit);
    if (!r) return false;
    const res = insertUnit(this.doc, r[0], st.pending, ser.raw, ser.atoms);
    if (!res) return false;
    this.shift(res.at, res.delta, unit);
    this.setSL(unit, res.start, res.end);
    const li = unit.parentElement?.tagName === 'LI' && unit.parentElement.hasAttribute('data-ie-new') ? unit.parentElement : null;
    if (li) { this.setSL(li, res.start, res.end); li.removeAttribute('data-ie-new'); }
    unit.removeAttribute('data-ie-new');
    Object.assign(st, { pending: null, base: ser.key, md: res.md, needsRender: true });
    this.changed();
    return true;
  }

  commitRow(tr) {
    const cells = [...tr.children].filter(c => c._ie);
    if (!cells.length) return false;
    const sers = cells.map(c => this.serialize(c));
    if (sers.every((s, i) => s.key === cells[i]._ie.base)) return false;
    const shape = this.shape(cells[0]);
    if (!shape) return false;
    const all = [...tr.children];
    const input = all.map(c => {
      const i = cells.indexOf(c);
      return i >= 0 && sers[i].key !== c._ie.base ? { raw: sers[i].raw, atoms: sers[i].atoms } : null;
    });
    const res = spliceRow(this.doc, shape.start, input, { lead: shape.lead });
    if (!res) { cells.forEach(c => this.stale(c)); return false; }
    all.forEach((c, i) => {
      if (input[i] == null || !c._ie) return;
      Object.assign(c._ie, { base: sers[cells.indexOf(c)].key, md: res.mds[i] ?? '', needsRender: true });
    });
    this.changed();
    return true;
  }

  /* The source no longer looks like this unit: stop editing it. */
  stale(unit) {
    if (!unit._ie) return;
    this.units.delete(unit);
    this.dirty.delete(unit);
    unit._ie = null;
    unit.removeAttribute('contenteditable');
    unit.removeAttribute('data-ie-unit');
    unit.dataset.ieLocked = '';
    toast(S('stale'), { type: 'err' });
  }

  changed() {
    this.save();
  }

  save() {
    if (this.doc.text === this.savedText && !this.saveError) {
      if (!this.dirty.size && this.status !== 'saved') this.setStatus('saved');
      return this.chain;
    }
    this.setStatus('saving');
    this.chain = this.chain.then(async () => {
      const text = this.doc.text;
      if (text === this.savedText && !this.saveError) return;
      try {
        await this.onSave?.(text);
        this.savedText = text;
        this.saveError = null;
        if (this.doc.text === this.savedText) this.setStatus(this.dirty.size ? 'dirty' : 'saved');
      } catch (e) {
        this.saveError = e;
        this.setStatus('error', e?.message || String(e));
        toast(S('saveFailed', { msg: e?.message || String(e) }), { type: 'err' });
      }
    });
    return this.chain;
  }

  /* Re-render one unit's inline content from its new Markdown. */
  rerender(unit) {
    const st = unit._ie;
    if (!st?.needsRender || typeof this.article.vtRenderInline !== 'function') return;
    st.needsRender = false;
    let frag;
    try { frag = this.article.vtRenderInline(st.md ?? ''); } catch (e) { console.error(e); return; }
    const box = unit.querySelector(':scope > input.task-box');
    unit.replaceChildren(...(box ? [box, ' '] : []), frag);
    this.prepare(unit);
    if (!this.safe(unit)) { this.stale(unit); return; }
    st.base = this.serialize(unit).key;
    this.updateEmpty(unit);
  }

  /* ─── new units ─── */

  spawn({ where, ref, spec, at, li = false, tight = false, task = false, content = null }) {
    const p = h('p');
    if (tight) p.className = 'tight';
    if (task) p.append(h('input.task-box', { type: 'checkbox', disabled: true }), ' ');
    if (content) p.append(content);
    if (!hasContent(p)) p.append(h('br'));
    let el = p;
    if (li) {
      el = h('li', p);
      if (task) el.className = 'task-list-item';
      this.setSL(el, at, at);
    }
    el.dataset.ieNew = '';
    if (where === 'after') ref.after(el);
    else ref.before(el);
    this.setSL(p, at, at);
    this.prepare(p);
    this.setup(p, 'block', spec);
    p._ie.needsRender = !!content;
    return p;
  }

  spawnNear(unit, where, content = null) {
    const li = unit.parentElement?.tagName === 'LI' ? unit.parentElement : null;
    if (li) {
      const lr = this.range(li);
      if (!lr) return null;
      const task = !!unit.querySelector(':scope > input.task-box');
      const spec = listItemSpec(this.doc, lr[0], { task, next: where === 'after' });
      if (!spec) return null;
      const at = where === 'after' ? lastContentLine(this.doc, lr[0], lr[1]) + 1 : lr[0];
      return this.spawn({ where, ref: li, spec, at, li: true, tight: unit.classList.contains('tight'), task, content });
    }
    const shape = this.shape(unit);
    if (!shape || (where === 'before' && shape.lead)) return null;
    const spec = paraSpec(this.doc, shape);
    return this.spawn({ where, ref: unit, spec, at: where === 'after' ? shape.end : shape.start, content });
  }

  discard(unit) {
    const parent = unit.parentElement;
    const li = parent?.tagName === 'LI' && parent.hasAttribute('data-ie-new') && [...parent.children].every(c => c === unit) ? parent : null;
    this.units.delete(unit);
    this.dirty.delete(unit);
    (li || unit).remove();
  }

  /* ─── keys ─── */

  caret(unit) {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!unit.contains(range.startContainer) || !unit.contains(range.endContainer)) return null;
    const before = document.createRange();
    before.setStart(unit, 0);
    before.setEnd(range.startContainer, range.startOffset);
    const after = document.createRange();
    after.setStart(range.endContainer, range.endOffset);
    after.setEnd(unit, unit.childNodes.length);
    return { sel, range, after, atStart: !hasContent(before.cloneContents()), atEnd: !hasContent(after.cloneContents()) };
  }

  focusAt(el, end) {
    if (!el) return;
    el.focus({ preventScroll: true });
    const r = document.createRange();
    r.selectNodeContents(el);
    const box = el.querySelector(':scope > input.task-box');
    if (!end && box) {
      const nx = box.nextSibling;
      if (nx?.nodeType === 3) r.setStart(nx, Math.min(1, nx.length));
      else r.setStartAfter(box);
    }
    r.collapse(!end);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    el.scrollIntoView?.({ block: 'nearest' });
  }

  enter(unit) {
    const st = unit._ie;
    if (st.kind === 'cell') {
      this.commitRow(unit.closest('tr'));
      this.focusCellBelow(unit);
      return;
    }
    const inLi = unit.parentElement?.tagName === 'LI';
    if (this.isEmpty(unit)) {
      if (inLi) this.exitList(unit);
      return;
    }
    let c = this.caret(unit);
    if (!c) return;
    if (!c.range.collapsed) {
      document.execCommand('delete');
      c = this.caret(unit);
      if (!c) return;
    }
    if (c.atStart && !c.atEnd) {
      this.commit(unit);
      const fresh = this.spawnNear(unit, 'before');
      if (fresh) this.focusAt(fresh, false);
      return;
    }
    let tail = null;
    if (!c.atEnd) {
      tail = c.after.cloneContents();
      c.sel.removeAllRanges();
      c.sel.addRange(c.after);
      if (!document.execCommand('delete')) c.after.deleteContents();
    }
    this.commit(unit);
    const fresh = this.spawnNear(unit, 'after', tail);
    if (!fresh) return;
    this.focusAt(fresh, false);
    if (tail && !this.isEmpty(fresh)) this.commit(fresh);
  }

  /* Backspace at the start of a paragraph joins it to the one before. */
  mergeBackward(unit) {
    const prev = this.neighbour(unit, -1);
    if (!prev?._ie || prev._ie.kind !== 'block' || unit._ie.kind !== 'block' || prev._ie.pending) return false;
    if (prev.parentElement !== unit.parentElement || unit.parentElement.tagName === 'LI') return false;
    this.commit(unit);
    if (!unit._ie) return true;
    if (prev.lastChild?.nodeName === 'BR' && !prev.lastChild.previousSibling) prev.lastChild.remove();
    const join = document.createTextNode('');
    prev.append(join);
    while (unit.firstChild) prev.append(unit.firstChild);
    if (!unit._ie.pending) this.commit(unit);
    if (!unit._ie?.pending) {
      while (join.nextSibling) unit.append(join.nextSibling);
      join.remove();
      return true;
    }
    this.discard(unit);
    this.commit(prev);
    prev.focus({ preventScroll: true });
    const r = document.createRange();
    r.setStart(join, 0);
    r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    this.updateEmpty(prev);
    this.save();
    return true;
  }

  exitList(unit) {
    const li = unit.parentElement;
    const list = li?.parentElement;
    if (!list || !/^(UL|OL)$/.test(list.tagName)) return;
    if (!unit._ie.pending) {
      if (![...li.children].every(c => c === unit)) return;
      this.commit(unit);
      if (!unit._ie?.pending) return;
    }
    const lr = this.range(list);
    if (!lr) return;
    this.discard(unit);
    const spec = listExitSpec(this.doc, lr[0]);
    const at = lr[1] > lr[0] ? lastContentLine(this.doc, lr[0], lr[1]) + 1 : lr[0];
    const fresh = this.spawn({ where: 'after', ref: list, spec, at });
    if (!list.children.length) list.remove();
    this.focusAt(fresh, false);
    this.save();
  }

  backspaceEmpty(unit) {
    const prev = this.neighbour(unit, -1);
    if (!unit._ie.pending) {
      const li = unit.parentElement?.tagName === 'LI' ? unit.parentElement : null;
      if (li && ![...li.children].every(c => c === unit)) return;
      this.commit(unit);
      if (!unit._ie?.pending) return;
    }
    this.discard(unit);
    if (prev) this.focusAt(prev, true);
    this.save();
  }

  focusCellBelow(cell) {
    const tr = cell.closest('tr');
    const idx = [...tr.children].indexOf(cell);
    let next = tr.nextElementSibling;
    if (!next) next = tr.parentElement?.nextElementSibling?.querySelector('tr');
    const target = next?.children[idx];
    if (target?._ie) this.focusAt(target, true);
  }

  format(unit, cmd) {
    if (unit._ie.kind === 'heading' || unit.tagName === 'TH') return;
    document.execCommand(cmd);
  }

  lineBreak(unit) {
    if (unit._ie.kind !== 'block') return;
    document.execCommand('insertLineBreak');
  }

  insertPlain(unit, text) {
    text = String(text || '').replace(/\r\n?/g, '\n');
    if (!text) return;
    if (unit._ie.kind !== 'block') {
      document.execCommand('insertText', false, text.replace(/\s*\n\s*/g, ' '));
      return;
    }
    text.split(/\n+/).forEach((line, i) => {
      if (i) document.execCommand('insertLineBreak');
      if (line) document.execCommand('insertText', false, line);
    });
  }

  /* Arrow keys cross from one unit to the next, as in one document. */
  arrow(unit, e) {
    if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false;
    const c = this.caret(unit);
    if (!c || !c.range.collapsed) return false;
    const down = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    let edge = down ? c.atEnd : c.atStart;
    if (!edge && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const rect = c.range.getClientRects()[0];
      const box = unit.getBoundingClientRect();
      const lh = Number.parseFloat(getComputedStyle(unit).lineHeight) || 24;
      if (rect) edge = down ? rect.bottom > box.bottom - lh * 0.75 : rect.top < box.top + lh * 0.75;
    }
    if (!edge) return false;
    const n = this.neighbour(unit, down ? 1 : -1);
    if (!n) return false;
    this.focusAt(n, !down);
    return true;
  }

  onKeyDown(e) {
    if (e.isComposing || e.keyCode === 229) return;
    const unit = this.unitOf(e.target);
    if (!unit || e.target !== unit) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Enter' && !mod && !e.altKey) {
      e.preventDefault();
      if (e.shiftKey) this.lineBreak(unit);
      else this.enter(unit);
      return;
    }
    if (e.key === 'Backspace' && !mod && unit._ie.kind !== 'cell') {
      if (this.isEmpty(unit)) {
        e.preventDefault();
        this.backspaceEmpty(unit);
        return;
      }
      const c = this.caret(unit);
      if (c?.range.collapsed && c.atStart && this.mergeBackward(unit)) e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      unit.blur();
      return;
    }
    if (e.key === 'Tab' && !mod && !e.altKey) {
      const n = this.neighbour(unit, e.shiftKey ? -1 : 1);
      e.preventDefault();
      if (n) this.focusAt(n, true);
      return;
    }
    if (/^Arrow(Up|Down|Left|Right)$/.test(e.key)) {
      if (this.arrow(unit, e)) e.preventDefault();
      return;
    }
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b' || k === 'i') { e.preventDefault(); this.format(unit, k === 'b' ? 'bold' : 'italic'); }
      else if (k === 'u') e.preventDefault();
      else if (k === 's') { e.preventDefault(); this.flush(); }
      else if (k === 'e' && !e.shiftKey) { e.preventDefault(); this.done(); }
    }
  }

  onBeforeInput(e) {
    const unit = this.unitOf(e.target);
    if (!unit) return;
    if (BLOCKED_INPUT.has(e.inputType)) { e.preventDefault(); return; }
    if (e.inputType === 'insertParagraph') { e.preventDefault(); this.enter(unit); }
  }

  onInput(e) {
    const unit = this.unitOf(e.target);
    if (!unit) return;
    this.dirty.add(unit);
    this.updateEmpty(unit);
    if (this.status !== 'saving') this.setStatus('dirty');
    this.schedule();
  }

  /* Commit ~700 ms after typing stops (never in the middle of an IME composition). */
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.composing) { this.schedule(); return; }
      this.timer = null;
      this.commitDirty();
      this.save();
    }, COMMIT_MS);
  }

  onFocusOut(e) {
    const unit = this.unitOf(e.target);
    if (!unit || e.target !== unit) return;
    setTimeout(() => {
      if (!this.enabled || !unit.isConnected || !unit._ie) return;
      this.dirty.delete(unit);
      this.commit(unit);
      if (!unit._ie || document.activeElement === unit) return;
      if (unit._ie.pending) {
        if (this.isEmpty(unit)) this.discard(unit);
      } else this.rerender(unit);
      if (unit.tagName === 'TD' || unit.tagName === 'TH') {
        for (const c of unit.closest('tr')?.children || []) if (c !== unit && c._ie && document.activeElement !== c) this.rerender(c);
      }
      this.save();
    }, 0);
  }

  onPaste(e) {
    const unit = this.unitOf(e.target);
    if (!unit) return;
    e.preventDefault();
    this.insertPlain(unit, e.clipboardData?.getData('text/plain'));
  }

  onDrop(e) {
    const unit = this.unitOf(e.target);
    if (!unit) return;
    e.preventDefault();
    const text = e.dataTransfer?.getData('text/plain');
    if (!text) return;
    const r = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (r && unit.contains(r.startContainer)) {
      unit.focus({ preventScroll: true });
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
    this.insertPlain(unit, text);
  }

  /* Links and inline buttons inside text do nothing while editing
     (Ctrl/Cmd+click still follows them). */
  onClickCapture(e) {
    const unit = this.unitOf(e.target);
    if (!unit || e.ctrlKey || e.metaKey) return;
    const hit = e.target.closest('a, button, [data-vt-inline], img');
    if (hit && unit.contains(hit)) { e.preventDefault(); e.stopPropagation(); }
  }

  onMouseDownCapture(e) {
    const unit = this.unitOf(e.target);
    if (!unit || e.ctrlKey || e.metaKey) return;
    const hit = e.target.closest('button, [data-ie-atom]');
    if (!hit || !unit.contains(hit) || hit === unit) return;
    e.preventDefault();
    unit.focus({ preventScroll: true });
    const r = document.createRange();
    r.setStartAfter(hit);
    r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  /* ─── locked hint ─── */

  lockedAt(target) {
    if (!target?.closest) return null;
    const atom = target.closest('[data-ie-atom]');
    if (atom && this.article.contains(atom)) return { el: atom, inline: true };
    if (this.unitOf(target)) return null;
    const el = target.closest(LOCKED);
    if (!el || !this.article.contains(el)) return null;
    if (el.dataset.widget && TEXT_WIDGETS.has(el.dataset.widget) && !el.matches(CHROME)) return null;
    return { el, inline: false };
  }

  /* pointermove: the hint appears next to the pointer, like a tooltip. */
  onPointerOver(e) {
    this.pointer = { x: e.clientX, y: e.clientY };
    const hit = this.lockedAt(e.target);
    if (!hit) { this.hideHint(); return; }
    if (hit.el === this.hintFor) {
      if (!this.hintEl) { clearTimeout(this.hintTimer); this.hintTimer = setTimeout(() => this.showHint(hit), 260); }
      return;
    }
    this.hideHint();
    this.hintFor = hit.el;
    hit.el.classList.add('ie-locked-hover');
    this.hintTimer = setTimeout(() => this.showHint(hit), 260);
  }

  showHint({ el }) {
    if (!el.isConnected || this.hintFor !== el || this.hintEl) return;
    const tip = h('div.ie-lock-hint', { role: 'tooltip' }, icon('lock', { width: 12, height: 12 }), h('span', S('locked')));
    document.body.append(tip);
    this.hintEl = tip;
    const { x, y } = this.pointer || { x: 0, y: 0 };
    const w = tip.offsetWidth;
    const hh = tip.offsetHeight;
    let top = y + 20;
    if (top + hh > window.innerHeight - 6) top = y - hh - 12;
    const left = Math.max(6, Math.min(x + 4, window.innerWidth - w - 6));
    tip.style.top = `${Math.round(top)}px`;
    tip.style.left = `${Math.round(left)}px`;
  }

  hideHint() {
    clearTimeout(this.hintTimer);
    this.hintFor?.classList.remove('ie-locked-hover');
    this.hintFor = null;
    this.hintEl?.remove();
    this.hintEl = null;
  }

  /* Text that appears later (an opened :::reveal) becomes editable too. */
  onMutations(list) {
    if (!this.enabled) return;
    for (const m of list) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || this.unitOf(n)) continue;
        const found = n.matches('[data-sl]') ? [n] : [];
        found.push(...n.querySelectorAll('[data-sl]'));
        for (const el of found) {
          this.range(el);
          this.attachEl(el);
        }
      }
    }
  }
}
