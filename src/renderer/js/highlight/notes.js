/* ============================================================
 * highlight/notes.js — the notes side panel: list ⇄ thread.
 * A thread shows the highlighted targets and the comments
 * (learner / answer) — add, edit, delete, drag the left grip to
 * reorder; "Ask AI now" streams an answer into the thread.
 * ============================================================ */

import { h, icon, relTime } from '../core/dom.js';
import { t, getLang } from '../core/i18n.js';
import { toast, confirm, menu, spinner } from '../core/ui.js';
import { renderHtml } from '../vitent/markdown.js';
import { loadSortable } from '../lib/lazy.js';
import { KINDS, AI_KINDS, kindColor, kindIcon } from './store.js';
import { ask as askAI, askMessages } from '../ai.js';
import { processWithAgent } from '../agent-run.js';

export function targetText(tg) {
  if (tg.type === 'text') return tg.exact;
  if (tg.type === 'block') return `[${tg.widget || 'block'}] ${tg.label || tg.block}${tg.detail?.file ? ` · ${tg.detail.file}${tg.detail.lines ? `:${tg.detail.lines.join('-')}` : ''}` : ''}${tg.detail?.page ? ` · p.${tg.detail.page}` : ''}`;
  return t('hl.wholePage');
}

export function kindPill(kind) {
  return h('span.kind-pill', { style: { '--kc': kindColor(kind) } }, icon(kindIcon(kind)), t(`hl.kind.${kind}`));
}

export function statusPill(status) {
  return h('span.status-pill', { dataset: { s: status } }, t(`hl.status.${status}`));
}

export function noteCard(hl, { store, pageTitle, detached, onClick }) {
  const first = hl.targets[0];
  const last = hl.comments[hl.comments.length - 1];
  const unseen = store.unseen(hl);
  return h(`button.note-card${detached ? '.is-detached' : ''}`, { style: { '--kc': kindColor(hl.kind) }, onClick },
    h('div.nc-top', kindPill(hl.kind), AI_KINDS.has(hl.kind) ? statusPill(hl.status) : null,
      unseen ? h('span.badge', icon('sparkles'), String(unseen)) : null,
      h('span.grow'), pageTitle ? h('span.ellipsis', { style: { maxWidth: '120px' } }, pageTitle) : null,
      detached ? h('span', { 'data-tip': t('hl.detachedTip') }, icon('unlink', { width: 13, height: 13 })) : null),
    first ? h('div.nc-quote', `“${targetText(first)}”${hl.targets.length > 1 ? ` +${hl.targets.length - 1}` : ''}`) : null,
    last ? h('div.nc-last', h(`b${last.author === 'answer' ? '.is-answer' : ''}`, last.author), last.text.slice(0, 200)) : null);
}

export class NotesPanel {
  /* opts: { courseId, course, store, pageSrc, pageTitle(src), pageText(), onJump(hl), onClose(), highlighter } */
  constructor(opts) {
    Object.assign(this, opts);
    this.el = h('aside.side-panel');
    this.head = h('div.side-panel-head');
    this.body = h('div.side-panel-body');
    this.el.append(this.head, this.body);
    this.view = 'list';
    this.scope = 'page';
    this.current = null;
    this.streaming = null;
    this.off = this.store.on(ch => {
      if (ch.type === 'seen') return;
      if (this.view === 'thread' && this.current && !this.store.get(this.current)) { this.showList(); return; }
      if (!this.editing) this.render();
    });
  }

  destroy() {
    this.off();
    this.sortable?.destroy();
    this.el.remove();
  }

  setPage(src) {
    this.pageSrc = src;
    const hl = this.current ? this.store.get(this.current) : null;
    if (this.view === 'thread' && hl && hl.page !== src) this.showList();
    else this.render();
  }

  showList() {
    this.view = 'list';
    this.current = null;
    this.highlighter?.focus(null);
    this.render();
  }

  open(id, opts = {}) {
    this.view = 'thread';
    this.current = id;
    this.composeFocus = !!opts.compose;
    this.highlighter?.focus(id);
    const hl = this.store.get(id);
    if (hl) this.store.markSeen(hl.comments.filter(c => c.author === 'answer').map(c => c.id));
    this.render();
  }

  render() {
    this.sortable?.destroy();
    this.sortable = null;
    if (this.view === 'thread' && this.current) this.renderThread();
    else this.renderList();
  }

  renderList() {
    this.head.replaceChildren(icon('notebook-pen'), h('b', t('notes')),
      h('button.icon-btn.icon-btn-sm', { 'data-tip': t('hl.startMode'), onClick: () => this.highlighter?.enter() }, icon('highlighter')),
      h('button.icon-btn.icon-btn-sm', { 'data-tip': t('close'), onClick: () => this.onClose?.() }, icon('x')));
    const list = this.scope === 'page' ? this.store.forPage(this.pageSrc) : this.store.all;
    const waiting = this.store.all.filter(x => AI_KINDS.has(x.kind) && x.status === 'open');
    const tools = h('div.notes-tools',
      h('div.segmented',
        h(`button${this.scope === 'page' ? '.is-on' : ''}`, { onClick: () => { this.scope = 'page'; this.render(); } }, t('notes.thisPage')),
        h(`button${this.scope === 'all' ? '.is-on' : ''}`, { onClick: () => { this.scope = 'all'; this.render(); } }, t('notes.allPages'))),
      h('span.grow'),
      waiting.length ? h('button.btn.btn-sm.btn-tonal', { onClick: () => processWithAgent(this.courseId) }, icon('bot'), h('span', t('notes.toAgent', { n: waiting.length }))) : null);
    const items = [...list].sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
    const box = h('div.notes-list');
    if (!items.length) {
      box.append(h('div.empty', icon('highlighter'), h('h3', t('notes.empty')), h('p', t('notes.emptyBody'))));
    }
    for (const hl of items) {
      box.append(noteCard(hl, {
        store: this.store,
        pageTitle: this.scope === 'all' ? this.pageTitle?.(hl.page) : null,
        detached: hl.page === this.pageSrc && this.highlighter?.detached.has(hl.id),
        onClick: () => {
          if (hl.page !== this.pageSrc) { this.onJump?.(hl); return; }
          this.open(hl.id);
          this.highlighter?.flash(hl.id);
        },
      }));
    }
    this.body.replaceChildren(tools, box);
  }

  renderThread() {
    const hl = this.store.get(this.current);
    if (!hl) { this.showList(); return; }
    const isAI = AI_KINDS.has(hl.kind);
    this.head.replaceChildren(
      h('button.icon-btn.icon-btn-sm', { 'data-tip': t('back'), onClick: () => this.showList() }, icon('arrow-left')),
      h('b', t('notes.thread')),
      h('button.icon-btn.icon-btn-sm', {
        'data-tip': t('more'),
        onClick: e => menu(e.currentTarget, [
          { title: t('hl.changeKind') },
          ...KINDS.map(k => ({ label: t(`hl.kind.${k}`), icon: kindIcon(k), onClick: () => this.store.update(hl.id, { kind: k }) })),
          '-',
          { label: t('hl.delete'), icon: 'trash-2', danger: true, onClick: async () => { if (await confirm({ title: t('hl.deleteQ'), danger: true, ok: t('delete') })) { this.store.remove(hl.id); this.showList(); } } },
        ], { align: 'end' }),
      }, icon('ellipsis-vertical')),
      h('button.icon-btn.icon-btn-sm', { 'data-tip': t('close'), onClick: () => this.onClose?.() }, icon('x')));

    const statusRow = h('div.th-row', kindPill(hl.kind));
    if (isAI) {
      statusRow.append(h('button.chip-btn', {
        style: { height: '24px', padding: '0 6px' },
        onClick: e => menu(e.currentTarget, ['open', 'answered', 'applied', 'resolved'].map(s => ({ label: t(`hl.status.${s}`), onClick: () => this.store.update(hl.id, { status: s }) }))),
      }, statusPill(hl.status), icon('chevron-down', { width: 12, height: 12 })));
    }
    statusRow.append(h('span.grow'), h('span.faint', { style: { fontSize: '11.5px' } }, relTime(hl.created, getLang())));
    const targets = h('div.thread-targets', hl.targets.map((tg, i) => h(`div.thread-target${tg.type === 'text' && this.highlighter?.detached.has(hl.id) && hl.page === this.pageSrc ? '.is-detached' : ''}`, { style: { '--kc': kindColor(hl.kind) } },
      icon(tg.type === 'text' ? 'quote' : tg.type === 'block' ? 'scan' : 'file'),
      h('div.tt-text', { onClick: () => (hl.page === this.pageSrc ? this.highlighter?.flash(hl.id) : this.onJump?.(hl)) }, targetText(tg)),
      hl.targets.length > 1 ? h('button.icon-btn.icon-btn-xs', {
        'data-tip': t('hl.removeTarget'),
        onClick: () => this.store.update(hl.id, x => { x.targets.splice(i, 1); }),
      }, icon('x')) : null)));

    const comments = h('div.comments');
    hl.comments.forEach(c => comments.append(this.commentEl(hl, c)));
    if (this.streaming?.id === hl.id) comments.append(this.streaming.el);
    if (!hl.comments.length && !this.streaming) comments.append(h('div.faint', { style: { fontSize: '12.5px', padding: '4px 6px' } }, t(isAI ? `hl.empty.${hl.kind}` : 'hl.empty.note')));

    const input = h('textarea.textarea', { rows: 3, placeholder: t(`hl.compose.${isAI ? hl.kind : 'note'}`) });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); } });
    const add = () => {
      const v = input.value.trim();
      if (!v) return false;
      this.store.addComment(hl.id, 'learner', v);
      input.value = '';
      return true;
    };
    const actions = h('div.cn-row',
      h('span.grow', t('hl.asLearner')),
      hl.kind === 'ask' ? h('button.btn.btn-sm.btn-tonal', { onClick: () => { add(); this.askNow(hl.id); } }, icon('sparkles'), h('span', t('hl.askNow'))) : null,
      hl.kind === 'revise' ? h('button.btn.btn-sm.btn-tonal', { onClick: async () => { add(); await processWithAgent(this.courseId, [hl.id]); } }, icon('bot'), h('span', t('hl.reviseNow'))) : null,
      h('button.btn.btn-sm.btn-primary', { onClick: add }, icon('plus'), h('span', t('add'))));
    const composer = h('div.comment-new', input, actions);

    this.body.replaceChildren(h('div.thread',
      h('div.thread-head', statusRow, targets),
      comments,
      composer));
    if (this.composeFocus) { this.composeFocus = false; setTimeout(() => input.focus(), 50); }

    loadSortable().then(Sortable => {
      if (!comments.isConnected) return;
      this.sortable = Sortable.create(comments, {
        handle: '.c-grip',
        draggable: '.comment',
        animation: 160,
        onEnd: () => {
          const order = [...comments.querySelectorAll('.comment')].map(el => el.dataset.cid);
          this.store.update(hl.id, x => { x.comments.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)); });
        },
      });
    });
  }

  commentEl(hl, c) {
    const isAnswer = c.author === 'answer';
    const body = h(`div.c-body${isAnswer ? '.vt-article' : '.is-plain'}`);
    if (isAnswer) body.innerHTML = renderHtml(c.text);
    else body.textContent = c.text;
    const el = h(`div.comment${isAnswer ? '.is-answer' : ''}`, { dataset: { cid: c.id } },
      h('div.c-grip', { 'data-tip': t('hl.dragToSort') }, icon('grip-vertical')),
      h('div',
        h('div.c-head',
          h('span.who', c.author),
          h('span', relTime(c.updated || c.created, getLang())),
          h('span.grow'),
          h('span.c-tools',
            h('button.icon-btn.icon-btn-xs', { 'data-tip': t('edit'), onClick: () => this.editComment(hl, c, el, body) }, icon('pencil')),
            h('button.icon-btn.icon-btn-xs', {
              'data-tip': t('delete'),
              onClick: () => this.store.update(hl.id, x => { x.comments = x.comments.filter(y => y.id !== c.id); }),
            }, icon('trash-2')))),
        body));
    return el;
  }

  editComment(hl, c, el, body) {
    this.editing = true;
    const ta = h('textarea.textarea', { rows: Math.min(12, c.text.split('\n').length + 1), value: c.text });
    const done = save => {
      this.editing = false;
      if (save && ta.value.trim() !== c.text) this.store.update(hl.id, x => { const y = x.comments.find(z => z.id === c.id); if (y) { y.text = ta.value.trim(); y.updated = new Date().toISOString(); } });
      else this.render();
    };
    ta.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); done(false); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) done(true);
    });
    body.replaceWith(h('div.c-edit', ta, h('div.row', { style: { justifyContent: 'flex-end' } },
      h('button.btn.btn-sm', { onClick: () => done(false) }, t('cancel')),
      h('button.btn.btn-sm.btn-primary', { onClick: () => done(true) }, t('save')))));
    ta.focus();
  }

  async askNow(id) {
    const hl = this.store.get(id);
    if (!hl || this.streaming) return;
    const question = [...hl.comments].reverse().find(c => c.author === 'learner')?.text || t('hl.defaultQuestion');
    const text = h('div.c-body.vt-article');
    const el = h('div.comment.is-answer',
      h('div.c-grip', icon('sparkles')),
      h('div', h('div.c-head', h('span.who', 'answer'), h('span.ai-streaming', spinner(), t('ai.thinking'))), text));
    this.streaming = { id, el };
    this.render();
    let acc = '';
    try {
      const job = await askAI({
        messages: askMessages({ course: this.course, pageTitle: this.pageTitle?.(hl.page) || hl.page, pageText: await this.pageText?.(hl.page), highlight: hl, question }),
        courseId: this.courseId,
        onDelta: d => { acc += d; text.innerHTML = renderHtml(acc); el.scrollIntoView({ block: 'nearest' }); },
      });
      const r = await job.promise;
      const final = (r?.text || acc).trim();
      this.streaming = null;
      if (final) {
        this.store.addComment(id, 'answer', final);
        if (hl.status === 'open') this.store.update(id, { status: 'answered' });
      } else this.render();
    } catch (e) {
      this.streaming = null;
      this.render();
      toast(e.code === 'NO_AI' ? t('ai.notConfiguredLong') : `${t('ai.failed')}: ${e.message}`, {
        type: 'err', timeout: 8000,
        actions: e.code === 'NO_AI' ? [{ label: t('settings'), onClick: () => { location.hash = '#/settings'; } }] : [],
      });
    }
  }
}
