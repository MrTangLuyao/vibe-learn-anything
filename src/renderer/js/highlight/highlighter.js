/* ============================================================
 * highlight/highlighter.js — highlights on a rendered page.
 *
 * Highlight mode (the ✎ button, or a selection bubble):
 *   1. pick a highlighter (4 colours, "Ask AI", "Ask AI to revise")
 *   2. drag over every piece of text you want — each drag adds a target;
 *      every control gets a "mark this control" chip below it
 *   3. press ✓ (top right) — the highlight is saved and its notes open
 * Targets:  { type: "text", exact, prefix, suffix, start, scope, section }
 *           { type: "block", block, widget, label, detail }
 *           { type: "page" }
 * ============================================================ */

import { h, icon, uid, placeNear, onOutside } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { toast } from '../core/ui.js';
import { buildModel, rangeToQuote, anchorQuote, wrapRange, unwrap, sectionOf } from './anchor.js';
import { KINDS, AI_KINDS, kindColor, kindIcon } from './store.js';

const SWATCHES = ['yellow', 'green', 'blue', 'pink'];

export class Highlighter {
  /* opts: { article, host (positioned container for the toolbar), store, pageSrc, blocks, onOpen(id, opts) } */
  constructor(opts) {
    Object.assign(this, opts);
    this.mode = false;
    this.kind = 'yellow';
    this.pending = [];
    this.detached = new Set();
    this.toolbar = null;
    this.bubble = null;
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onClick = this.onClick.bind(this);
    this.onScope = e => this.paintScope(e.detail.scope);
    this.onKey = e => {
      if (!this.mode) return;
      if (e.key === 'Escape') { e.preventDefault(); this.cancel(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.commit(); }
    };
    this.article.addEventListener('mouseup', this.onMouseUp);
    this.article.addEventListener('click', this.onClick);
    this.article.addEventListener('vh:scope', this.onScope);
    document.addEventListener('keydown', this.onKey);
    this.offStore = this.store.on(change => { if (change.type !== 'seen') this.paint(); });
  }

  destroy() {
    this.exit();
    this.hideBubble();
    this.article.removeEventListener('mouseup', this.onMouseUp);
    this.article.removeEventListener('click', this.onClick);
    this.article.removeEventListener('vh:scope', this.onScope);
    document.removeEventListener('keydown', this.onKey);
    this.offStore();
  }

  scopeRoot(scope) {
    if (!scope || scope === 'page') return this.article;
    return this.article.querySelector(`[data-vh-scope="${CSS.escape(scope)}"]`);
  }

  /* ─── painting ─── */

  clearPaint(scope = null) {
    const sel = scope ? `[data-vh-scope="${CSS.escape(scope)}"] mark.vh` : 'mark.vh';
    const marks = [...this.article.querySelectorAll(sel)];
    if (!scope) {
      /* page scope: only marks not inside a nested scope */
      unwrap(marks);
      this.article.querySelectorAll('.vh-dot, .vh-block-tag').forEach(n => n.remove());
      this.article.querySelectorAll('.vh-block').forEach(n => { n.classList.remove('vh-block'); n.style.removeProperty('--vh-c'); });
    } else unwrap(marks);
  }

  paint() {
    if (!this.article.isConnected && !this.article.parentNode) return;
    this.clearPaint();
    this.detached.clear();
    for (const hl of this.store.forPage(this.pageSrc)) this.paintOne(hl);

  }

  paintScope(scope) {
    this.clearPaint(scope);
    for (const hl of this.store.forPage(this.pageSrc)) {
      hl.targets.forEach(tg => { if (tg.type === 'text' && tg.scope === scope) this.paintTarget(hl, tg); });
    }
  }

  paintTarget(hl, tg) {
    const root = this.scopeRoot(tg.scope);
    if (!root) return null;
    const model = buildModel(root);
    const pos = anchorQuote(model, tg);
    if (!pos) { if (!tg.scope || tg.scope === 'page') this.detached.add(hl.id); return null; }
    return wrapRange(model, pos.start, pos.end, () => h('mark.vh', { dataset: { hid: hl.id, kind: hl.kind } }));
  }

  paintOne(hl) {
    let lastMark = null;
    for (const tg of hl.targets) {
      if (tg.type === 'text') {
        const marks = this.paintTarget(hl, tg);
        if (marks?.length) lastMark = marks[marks.length - 1];
      } else if (tg.type === 'block') {
        const el = this.article.querySelector(`[data-block="${CSS.escape(tg.block)}"]`);
        if (!el) { this.detached.add(hl.id); continue; }
        el.classList.add('vh-block');
        el.style.setProperty('--vh-c', kindColor(hl.kind));
        if (!el.querySelector(`:scope > .vh-block-tag[data-hid="${hl.id}"]`)) {
          const tags = el.querySelectorAll(':scope > .vh-block-tag').length;
          el.append(h('button.vh-block-tag', {
            dataset: { hid: hl.id },
            style: { right: `${8 + tags * 46}px` },
            onClick: e => { e.stopPropagation(); this.onOpen(hl.id); },
          }, icon(kindIcon(hl.kind)), String(hl.comments.length || '')));
        }
      }
    }
    if (lastMark && (AI_KINDS.has(hl.kind) || hl.comments.length)) {
      const answered = hl.comments.some(c => c.author === 'answer');
      lastMark.after(h(`span.vh-dot${answered ? '.is-answered' : ''}`, {
        dataset: { hid: hl.id, kind: hl.kind },
        title: t(answered ? 'hl.answered' : 'hl.waiting'),
        onClick: e => { e.stopPropagation(); this.onOpen(hl.id); },
      }, answered ? '✓' : String(hl.comments.length || '•')));
    }
  }

  flash(id) {
    const marks = this.article.querySelectorAll(`mark.vh[data-hid="${CSS.escape(id)}"]`);
    const tag = this.article.querySelector(`.vh-block-tag[data-hid="${CSS.escape(id)}"]`);
    const target = marks[0] || tag?.parentElement;
    if (!target) return false;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    marks.forEach(m => { m.classList.remove('is-flash'); void m.offsetWidth; m.classList.add('is-flash'); });
    if (!marks.length && tag) tag.parentElement.style.animation = 'flash 1.2s ease 2';
    return true;
  }

  focus(id) {
    this.article.querySelectorAll('mark.vh.is-focus').forEach(m => m.classList.remove('is-focus'));
    if (id) this.article.querySelectorAll(`mark.vh[data-hid="${CSS.escape(id)}"]`).forEach(m => m.classList.add('is-focus'));
  }

  /* ─── mouse ─── */

  onClick(e) {
    if (this.mode) {
      const pm = e.target.closest('mark.vh-pending');
      if (pm) { this.removePending(pm.dataset.pid); e.preventDefault(); }
      return;
    }
    const mark = e.target.closest('mark.vh');
    if (mark && !window.getSelection()?.toString()) this.onOpen(mark.dataset.hid);
  }

  currentSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!this.article.contains(range.commonAncestorContainer)) return null;
    const anc = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    if (anc.closest('.monaco-editor, .xterm, input, textarea')) return null;
    const scopeEl = anc.closest('[data-vh-scope]');
    const scope = scopeEl && this.article.contains(scopeEl) ? scopeEl.dataset.vhScope : 'page';
    const root = scope === 'page' ? this.article : scopeEl;
    const model = buildModel(root);
    const q = rangeToQuote(model, range);
    if (!q) return null;
    return { range, scope, quote: q, section: sectionOf(this.article, range.startContainer), model };
  }

  onMouseUp(e) {
    if (e.button !== 0) return;
    setTimeout(() => {
      const s = this.currentSelection();
      if (!s) { if (!this.mode) this.hideBubble(); return; }
      if (this.mode) { this.addPendingText(s); window.getSelection().removeAllRanges(); }
      else this.showBubble(s);
    }, 0);
  }

  /* ─── selection bubble (outside highlight mode) ─── */

  showBubble(s) {
    this.hideBubble();
    const rect = s.range.getBoundingClientRect();
    const quick = kind => {
      this.hideBubble();
      const tg = this.textTarget(s);
      if (AI_KINDS.has(kind)) {
        this.enter(kind);
        this.addPendingText(s, tg);
        window.getSelection().removeAllRanges();
      } else {
        const hl = this.store.add({ kind, page: this.pageSrc, targets: [tg] });
        window.getSelection().removeAllRanges();
        toast(t('hl.saved'), { type: 'ok', timeout: 2200, actions: [{ label: t('hl.addNote'), onClick: () => this.onOpen(hl.id, { compose: true }) }] });
      }
    };
    this.bubble = h('div.sel-pop', { 'data-vh-skip': '' },
      ...SWATCHES.map(k => h('button.hl-swatch', { style: { '--sw': kindColor(k) }, 'data-tip': t(`hl.kind.${k}`), onClick: () => quick(k) })),
      h('span.tb-sep', { style: { width: '1px', height: '20px', background: 'var(--border)', margin: '0 3px' } }),
      h('button.chip-btn', { style: { color: 'var(--violet)' }, onClick: () => quick('ask') }, icon('sparkles'), h('span', t('hl.kind.ask'))),
      h('button.chip-btn', { style: { color: 'var(--hl-revise-solid)' }, onClick: () => quick('revise') }, icon('wand-sparkles'), h('span', t('hl.kind.revise'))),
      h('button.icon-btn.icon-btn-xs', {
        'data-tip': t('copy'),
        onClick: async () => { await window.vla.app.clipboard(s.quote.exact); this.hideBubble(); toast(t('copied'), { type: 'ok', timeout: 1200 }); },
      }, icon('copy')));
    document.body.append(this.bubble);
    placeNear(this.bubble, { x: rect.left + rect.width / 2, y: rect.top }, { side: 'top', align: 'center', gap: 10 });
    this.offBubble = onOutside(this.bubble, () => this.hideBubble());
  }

  hideBubble() {
    this.offBubble?.();
    this.bubble?.remove();
    this.bubble = null;
  }

  /* ─── highlight mode ─── */

  textTarget(s) {
    return { type: 'text', exact: s.quote.exact, prefix: s.quote.prefix, suffix: s.quote.suffix, start: s.quote.start, scope: s.scope, section: s.section || undefined };
  }

  setKindVars() {
    document.body.style.setProperty('--hl-cur', `var(--hl-${this.kind})`);
    document.body.style.setProperty('--hl-cur-solid', kindColor(this.kind));
  }

  enter(kind = this.kind || 'yellow') {
    this.kind = KINDS.includes(kind) ? kind : 'yellow';
    if (!this.mode) {
      this.mode = true;
      this.pending = [];
      document.body.classList.add('hl-mode');
      this.addMarkButtons();
    }
    this.setKindVars();
    this.renderToolbar();
    this.onModeChange?.(true);
  }

  addMarkButtons() {
    for (const el of this.article.querySelectorAll('[data-block]')) {
      if (el.closest('[data-vh-skip]') && el.closest('[data-vh-skip]') !== el) continue;
      const btn = h('button.vh-mark-btn', {
        dataset: { forBlock: el.dataset.block },
        onClick: e => { e.preventDefault(); e.stopPropagation(); this.toggleBlock(el, btn); },
      }, icon('scan'), h('span', t('hl.markControl')));
      if (el.tagName === 'IMG') btn.classList.add('is-inline');
      el.after(btn);
    }
  }

  toggleBlock(el, btn) {
    const id = el.dataset.block;
    const i = this.pending.findIndex(p => p.type === 'block' && p.block === id);
    if (i >= 0) {
      this.pending.splice(i, 1);
      el.classList.remove('vh-block-pending');
      btn.classList.remove('is-on');
    } else {
      const info = this.blocks?.get(id);
      let detail;
      try { detail = el._vhDetail?.(); } catch { detail = undefined; }
      this.pending.push({ pid: uid('p'), type: 'block', block: id, widget: el.dataset.widget, label: (info?.label || '').slice(0, 120) || undefined, detail: detail || undefined });
      el.classList.add('vh-block-pending');
      btn.classList.add('is-on');
    }
    this.renderToolbar();
  }

  addPendingText(s, tg = this.textTarget(s)) {
    const pid = uid('p');
    this.pending.push({ ...tg, pid });
    const marks = wrapRange(s.model, s.quote.start, s.quote.start + s.quote.exact.length, () => h('mark.vh-pending', { dataset: { pid } }));
    if (!marks.length) this.pending.pop();
    this.renderToolbar();
  }

  removePending(pid) {
    unwrap([...this.article.querySelectorAll(`mark.vh-pending[data-pid="${CSS.escape(pid)}"]`)]);
    this.pending = this.pending.filter(p => p.pid !== pid);
    this.renderToolbar();
  }

  renderToolbar() {
    this.toolbar?.remove();
    const n = this.pending.length;
    this.toolbar = h('div.hl-toolbar', { 'data-vh-skip': '' },
      h('span.hl-label', t('hl.mode')),
      ...SWATCHES.map(k => h(`button.hl-swatch${this.kind === k ? '.is-on' : ''}`, { style: { '--sw': kindColor(k) }, 'data-tip': t(`hl.kind.${k}`), onClick: () => this.setKind(k) })),
      h('span.tb-sep'),
      h(`button.hl-special${this.kind === 'ask' ? '.is-on' : ''}`, { style: { '--sc': 'var(--hl-ask-solid)' }, onClick: () => this.setKind('ask') }, icon('sparkles'), h('span', t('hl.kind.ask'))),
      h(`button.hl-special${this.kind === 'revise' ? '.is-on' : ''}`, { style: { '--sc': 'var(--hl-revise-solid)' }, onClick: () => this.setKind('revise') }, icon('wand-sparkles'), h('span', t('hl.kind.revise'))),
      h('span.tb-sep'),
      h('span.hl-count', { 'data-tip': t('hl.pendingTip') }, String(n)),
      h('button.icon-btn.icon-btn-sm', { 'data-tip': t('cancel'), onClick: () => this.cancel() }, icon('x')),
      h('button.icon-btn.icon-btn-sm.hl-done', { 'data-tip': t('hl.done'), onClick: () => this.commit() }, icon('check')));
    this.host.append(this.toolbar);
  }

  setKind(kind) {
    this.kind = kind;
    this.setKindVars();
    this.renderToolbar();
  }

  commit() {
    if (!this.mode) return null;
    const targets = this.pending.map(({ pid, ...rest }) => rest);
    const kind = this.kind;
    this.exit();
    if (!targets.length) return null;
    const hl = this.store.add({ kind, page: this.pageSrc, targets });
    this.onOpen(hl.id, { compose: true, fresh: true });
    return hl;
  }

  cancel() {
    this.exit();
  }

  exit() {
    if (!this.mode) return;
    this.mode = false;
    unwrap([...this.article.querySelectorAll('mark.vh-pending')]);
    this.article.querySelectorAll('.vh-mark-btn').forEach(b => b.remove());
    this.article.querySelectorAll('.vh-block-pending').forEach(b => b.classList.remove('vh-block-pending'));
    document.body.classList.remove('hl-mode');
    this.toolbar?.remove();
    this.toolbar = null;
    this.pending = [];
    this.onModeChange?.(false);
  }
}
