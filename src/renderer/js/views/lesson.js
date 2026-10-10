/* ============================================================
 * views/lesson.js — learning a chapter (the Ed "lesson" screen):
 *   lesson bar · page list · reader · notes panel · terminal
 * ============================================================ */

import { h, icon, debounce, storageGet, storageSet, dragResize } from '../core/dom.js';
import { t, tl } from '../core/i18n.js';
import { getCourse, state, saveSettings } from '../core/store.js';
import { go, setGuard } from '../core/router.js';
import { toast, menu, spinner, dialog } from '../core/ui.js';
import { setAppbar } from '../appbar.js';
import { pageKind } from '../kinds.js';
import { renderPage } from '../vitent/render.js';
import { resolveButtons, renderButton } from '../buttons.js';
import { runAction, renderResult } from '../actions.js';
import { resolveAsset, baseName } from '../paths.js';
import { Highlighter } from '../highlight/highlighter.js';
import { storeFor } from '../highlight/store.js';
import { NotesPanel } from '../highlight/notes.js';
import { openAsk, closeAsk } from '../ask-pop.js';
import { TerminalPanel } from '../terminal-panel.js';
import { EditMode } from '../editmode.js';
import { exportCourse, exportForAI } from '../library-actions.js';

class LessonView {
  constructor(host) {
    this.host = host;
    this.rendered = null;
    this.highlighter = null;
    this.notes = null;
    this.terminal = null;
    this.edit = null;
    this.completeTimer = null;
    this.pageTexts = new Map();
    this.saveProgress = debounce(() => window.vla.course.saveProgress(this.courseId, this.progress), 400);

    this.lb = { left: h('div.lb-left'), title: h('div.lb-title'), right: h('div.lb-right') };
    this.lessonbar = h('div.lessonbar', this.lb.left, this.lb.title, this.lb.right);
    this.pageList = h('div.page-list');
    this.sideTitle = h('b');
    this.sideFoot = h('div.sidebar-foot');
    this.sideProgress = h('div.sidebar-progress');
    this.sidebar = h('aside.sidebar', { style: { '--sidebar-w': `${storageGet('vla.sidebarW', 288)}px` } },
      h('div.sidebar-head',
        h('button.icon-btn.icon-btn-sm', { 'data-tip': t('lesson.chapters'), onClick: e => this.chapterMenu(e.currentTarget) }, icon('menu')),
        this.sideTitle),
      this.pageList, this.sideFoot, this.sideProgress);
    const sideHandle = h('div.resize-handle-v');
    let startW = 0;
    sideHandle.addEventListener('pointerdown', () => { startW = this.sidebar.offsetWidth; });
    dragResize(sideHandle, {
      axis: 'x',
      onMove: dx => { const w = Math.max(200, Math.min(520, startW + dx)); this.sidebar.style.setProperty('--sidebar-w', `${w}px`); this.root.style.setProperty('--sidebar-w', `${w}px`); },
      onEnd: () => storageSet('vla.sidebarW', this.sidebar.offsetWidth),
    });
    this.inner = h('div.reader-inner');
    this.reader = h('div.reader', this.inner);
    this.readerWrap = h('div.reader-wrap', { style: { flex: '1', minWidth: '0', position: 'relative', display: 'flex' } }, this.reader);
    this.body = h('div.lesson-body', this.sidebar, sideHandle, this.readerWrap);
    this.root = h('div.lesson', { style: { '--sidebar-w': `${storageGet('vla.sidebarW', 288)}px` } }, this.lessonbar, this.body);
    if (storageGet('vla.sidebarHidden', false)) this.root.classList.add('no-sidebar');
    host.append(this.root);

    this.api = {
      runAction: (spec, extra) => this.runAction(spec, extra),
      ask: (prompt, opts) => this.ask(prompt, opts),
      goto: target => this.goto(target),
      ui: cmd => this.ui(cmd),
      terminal: spec => this.openTerminal().run(spec),
      report: (kind, id, data) => this.report(kind, id, data),
      complete: () => this.markComplete(),
    };
    this.onKey = this.onKey.bind(this);
    document.addEventListener('keydown', this.onKey);
    setGuard(async () => (this.edit ? this.edit.confirmLeave() : true));
  }

  /* ─── loading ─── */

  async load(params) {
    this.courseId = params.id;
    this.data = await getCourse(params.id);
    this.course = this.data.course;
    this.progress = this.data.progress;
    this.progress.pages ||= {};
    this.store = storeFor(this.courseId, this.data.annotations, this.data.state);
    return this.openChapter(params.chapter, params.page);
  }

  findChapter(id) {
    for (const u of this.course.units) for (const ch of u.chapters) if (ch.id === id) return ch;
    return null;
  }

  flatChapters() {
    return this.course.units.flatMap(u => u.chapters.filter(ch => ch.pages.length));
  }

  async openChapter(chapterId, pageParam) {
    const ch = this.findChapter(chapterId);
    if (!ch || !ch.pages.length) { toast(t('lesson.noChapter'), { type: 'err' }); go(`/course/${this.courseId}`, { replace: true }); return; }
    this.chapter = ch;
    this.sideTitle.textContent = tl(ch.title);
    this.sideTitle.title = tl(ch.title);
    this.renderSidebar(-1);
    const idx = Math.max(0, Math.min(ch.pages.length - 1, (Number.parseInt(pageParam, 10) || 1) - 1));
    await this.showPage(idx);
  }

  async update(params) {
    if (params.id !== this.courseId) return false;
    if (params.chapter !== this.chapter?.id) { await this.openChapter(params.chapter, params.page); return true; }
    const idx = Math.max(0, Math.min(this.chapter.pages.length - 1, (Number.parseInt(params.page, 10) || 1) - 1));
    if (idx !== this.index || this.edit) await this.showPage(idx);
    return true;
  }

  pageTitle(src) {
    for (const u of this.course.units) for (const ch of u.chapters) {
      const p = ch.pages.find(x => x.src === src);
      if (p) return tl(p.title) || this.data.metas[src]?.title || baseName(src).replace(/\.vitent$/i, '');
    }
    return baseName(src);
  }

  async pageText(src) {
    if (this.pageTexts.has(src)) return this.pageTexts.get(src);
    const text = await window.vla.course.readText(this.courseId, `${src}/index.md`);
    this.pageTexts.set(src, text);
    return text;
  }

  /* ─── sidebar ─── */

  renderSidebar(current) {
    const items = this.chapter.pages.map((p, i) => {
      const meta = this.data.metas[p.src] || {};
      const kind = pageKind(p.kind || meta.kind);
      const done = !!this.progress.pages[p.src]?.completed;
      return h(`button.page-item${i === current ? '.is-current' : ''}`, {
        onClick: () => go(`/learn/${this.courseId}/${this.chapter.id}/${i + 1}`),
        title: this.pageTitle(p.src),
      },
      h('span.pi-icon', { style: { '--k': kind.color } }, icon(p.icon || meta.icon || kind.icon)),
      h('span.pi-name', this.pageTitle(p.src)),
      h('span.pi-check', done ? icon('check') : null));
    });
    this.pageList.replaceChildren(...items);
    const done = this.chapter.pages.filter(p => this.progress.pages[p.src]?.completed).length;
    this.sideProgress.replaceChildren(
      h('span', t('lesson.chapterProgress', { done, total: this.chapter.pages.length })),
      h('div.progress', h('i', { style: { width: `${(done / this.chapter.pages.length) * 100}%` } })));
    this.pageList.querySelector('.is-current')?.scrollIntoView({ block: 'nearest' });
  }

  chapterMenu(anchor) {
    const items = [];
    for (const u of this.course.units) {
      if (u.title) items.push({ title: tl(u.title) });
      for (const ch of u.chapters) {
        items.push({ label: tl(ch.title), icon: ch.id === this.chapter.id ? 'chevron-right' : 'dot', onClick: () => go(`/learn/${this.courseId}/${ch.id}/1`) });
      }
    }
    items.push('-', { label: t('lesson.toCourse'), icon: 'layout-list', onClick: () => go(`/course/${this.courseId}`) });
    menu(anchor, items);
  }

  /* ─── neighbours ─── */

  neighbour(delta) {
    const chapters = this.flatChapters();
    const ci = chapters.indexOf(this.chapter);
    const pi = this.index + delta;
    if (pi >= 0 && pi < this.chapter.pages.length) return { ch: this.chapter, i: pi };
    const next = chapters[ci + (delta > 0 ? 1 : -1)];
    if (!next) return null;
    return { ch: next, i: delta > 0 ? 0 : next.pages.length - 1 };
  }

  gotoNeighbour(delta) {
    const n = this.neighbour(delta);
    if (n) go(`/learn/${this.courseId}/${n.ch.id}/${n.i + 1}`);
  }

  /* ─── page ─── */

  async showPage(index) {
    if (this.edit) { this.edit.destroy(); this.edit = null; this.readerWrap.replaceChildren(this.reader); }
    clearTimeout(this.completeTimer);
    closeAsk();
    this.highlighter?.destroy();
    this.highlighter = null;
    this.rendered?.dispose();
    this.rendered = null;
    this.index = index;
    const page = this.chapter.pages[index];
    this.src = page.src;
    this.renderSidebar(index);
    this.lb.title.textContent = this.pageTitle(page.src);
    this.inner.replaceChildren(h('div.reader-loading', spinner(), t('loading')));
    this.reader.scrollTop = 0;

    let text;
    try {
      this.pageTexts.delete(page.src);
      text = await this.pageText(page.src);
    } catch (e) {
      this.inner.replaceChildren(h('div.vx-error', `${t('lesson.pageMissing')}\n${page.src}\n${e.message}`));
      this.renderBars({});
      return;
    }
    if (this.index !== index) return;
    const pp = (this.progress.pages[page.src] ||= {});
    pp.visited ||= new Date().toISOString();
    this.progress.last = { chapter: this.chapter.id, page: page.src, at: new Date().toISOString() };
    this.saveProgress();

    const r = await this.renderFor(text, this.reader, pp);
    if (this.index !== index) { r.dispose(); return; }
    this.rendered = r;
    this.pageEnd = h('div.page-end', { 'data-vh-skip': '' });
    this.inner.replaceChildren(r.el, this.pageEnd);
    this.renderBars(r.fm);
    this.renderPageEnd();

    this.highlighter = new Highlighter({
      article: r.el,
      host: this.readerWrap,
      store: this.store,
      pageSrc: page.src,
      blocks: r.blocks,
      onOpen: (id, opts) => this.openNotes(id, opts),
      onModeChange: () => this.renderBars(this.rendered?.fm || {}),
    });
    this.highlighter.paint();
    this.notes?.setPage(page.src);

    const rule = r.fm.complete || (r.counts.quiz ? 'quiz' : r.counts.tests ? 'tests' : 'view');
    this.rule = rule;
    if (rule === 'view' && !pp.completed) this.completeTimer = setTimeout(() => this.markComplete(), 2500);

    if (state.openNote) {
      const id = state.openNote;
      state.openNote = null;
      setTimeout(() => { this.openNotes(id); this.highlighter?.flash(id); }, 120);
    }
  }

  renderFor(text, scrollRoot, progress, opts = {}) {
    const page = this.chapter.pages[this.index];
    return renderPage({
      courseId: this.courseId,
      course: this.course,
      src: page.src,
      text,
      title: this.pageTitle(page.src),
      kicker: [h('span', tl(this.chapter.title)), h('span.faint', `${this.index + 1} / ${this.chapter.pages.length}`)],
      progress,
      lesson: this.api,
      scrollRoot,
      ...opts,
    });
  }

  /* ─── bars & buttons ─── */

  buttonState(b) {
    switch (b.builtin ? b.id : null) {
      case 'prev': return { disabled: !this.neighbour(-1) };
      case 'next': return { disabled: !this.neighbour(1) };
      case 'highlight': return { active: !!this.highlighter?.mode };
      case 'edit': return { active: !!this.edit };
      case 'focus': return { active: this.root.classList.contains('is-focus') };
      case 'notes': return { active: !!this.notes, dot: this.store.all.some(x => this.store.unseen(x)) };
      case 'terminal': return { active: !!this.terminal };
      case 'sidebar': return { active: !this.root.classList.contains('no-sidebar') };
      default: return {};
    }
  }

  slot(bySlot, name) {
    const page = this.chapter.pages[this.index];
    return (bySlot[name] || []).map(b => renderButton(b, {
      state: this.buttonState(b),
      resolveUrl: s => resolveAsset(this.courseId, page.src, b.source === 'page' || String(s).startsWith('@/') ? s : `@/${s}`),
      onRun: (btn, e) => this.runAction(btn.action, { anchor: e.currentTarget, button: btn }),
    }));
  }

  renderBars(fm) {
    const bySlot = resolveButtons(this.course, fm);
    this.bySlot = bySlot;
    this.lb.left.replaceChildren(...this.slot(bySlot, 'lessonbar.left'));
    this.lb.right.replaceChildren(...this.slot(bySlot, 'lessonbar.right'));
    this.sideFoot.replaceChildren(...this.slot(bySlot, 'sidebar.bottom'));
    setAppbar({
      crumbs: [{ label: this.course.code || tl(this.course.title), href: `/course/${this.courseId}` }, { label: tl(this.chapter.title) }],
      left: this.slot(bySlot, 'topbar.left'),
      right: this.slot(bySlot, 'topbar.right'),
    });
    if (this.pageEnd) this.renderPageEnd();
  }

  renderPageEnd() {
    const page = this.chapter.pages[this.index];
    const pp = this.progress.pages[page.src] || {};
    const prev = this.neighbour(-1);
    const next = this.neighbour(1);
    const done = !!pp.completed;
    this.pageEnd.replaceChildren(
      done
        ? h('span.badge.badge-ok', { style: { height: '30px', padding: '0 14px', fontSize: '12.5px' } }, icon('circle-check'), t('lesson.completed'))
        : h('button.btn.btn-outline', { onClick: () => this.markComplete() }, icon('check'), h('span', t('lesson.markComplete'))),
      ...this.slot(this.bySlot || {}, 'page.end'),
      h('div.pe-nav',
        prev ? h('button.btn', { onClick: () => this.gotoNeighbour(-1) }, icon('arrow-left'), h('span', t('lb.prev'))) : null,
        next ? h('button.btn.btn-primary.pe-next', { onClick: () => this.gotoNeighbour(1) },
          h('span', next.ch === this.chapter ? this.pageTitle(next.ch.pages[next.i].src) : `${t('lesson.nextChapter')} · ${tl(next.ch.title)}`), icon('arrow-right'))
          : h('button.btn.btn-tonal', { onClick: () => go(`/course/${this.courseId}`) }, icon('flag'), h('span', t('lesson.finished')))));
  }

  /* ─── progress ─── */

  report(kind, id, data) {
    const page = this.chapter.pages[this.index];
    const pp = (this.progress.pages[page.src] ||= {});
    pp[kind] ||= {};
    pp[kind][id] = { ...(pp[kind][id] || {}), ...data };
    this.saveProgress();
    if (pp.completed) return;
    const counts = this.rendered?.counts || {};
    const okQuiz = Object.values(pp.quiz || {}).filter(q => q.correct).length >= (counts.quiz || 0);
    const okTests = Object.values(pp.tests || {}).filter(x => x.total && x.passed === x.total).length >= (counts.tests || 0);
    if ((this.rule === 'quiz' && okQuiz) || (this.rule === 'tests' && okTests) || (this.rule === 'all' && okQuiz && okTests)) this.markComplete();
  }

  markComplete() {
    const page = this.chapter.pages[this.index];
    const pp = (this.progress.pages[page.src] ||= {});
    if (pp.completed) return;
    pp.completed = new Date().toISOString();
    this.saveProgress();
    this.renderSidebar(this.index);
    if (this.pageEnd) this.renderPageEnd();
  }

  /* ─── actions / AI / navigation ─── */

  async runAction(spec, extra = {}) {
    const page = this.chapter.pages[this.index];
    const sel = window.getSelection()?.toString() || '';
    const ctx = {
      courseId: this.courseId,
      course: this.course,
      fm: this.rendered?.fm || {},
      pageSrc: page.src,
      vars: { page: { title: this.pageTitle(page.src), src: page.src }, course: { title: tl(this.course.title), id: this.courseId }, chapter: { title: tl(this.chapter.title), id: this.chapter.id }, selection: sel },
      lesson: this.api,
    };
    const r = await runAction(spec, ctx, extra);
    if (r && !extra.inline && !extra.quiet) {
      dialog({ title: extra.button ? tl(extra.button.label) || t('result') : t('result'), iconName: r.ok ? 'circle-check' : 'circle-alert', wide: true, body: renderResult(r), actions: [{ label: t('close'), value: null, primary: true }] });
    }
    return r;
  }

  ask(prompt, opts = {}) {
    const page = this.chapter.pages[this.index];
    openAsk(prompt, opts, {
      course: this.course,
      courseId: this.courseId,
      pageSrc: page.src,
      pageTitle: this.pageTitle(page.src),
      getPageText: () => this.pageText(page.src),
      store: this.store,
      onOpenThread: id => this.openNotes(id),
    });
  }

  goto({ page, chapter, index, hash } = {}) {
    if (page) page = String(page).replace(/^@\//, '');
    if (page) {
      const chapters = [this.chapter, ...this.flatChapters().filter(c => c !== this.chapter)];
      for (const ch of chapters) {
        const i = ch.pages.findIndex(p => p.src === page);
        if (i >= 0) {
          go(`/learn/${this.courseId}/${ch.id}/${i + 1}`);
          if (hash) setTimeout(() => this.rendered?.el.querySelector(`[id="${CSS.escape(hash)}"]`)?.scrollIntoView({ behavior: 'smooth' }), 400);
          return;
        }
      }
      toast(t('lesson.linkMissing', { page }), { type: 'err' });
      return;
    }
    if (chapter) {
      if (this.findChapter(chapter)) go(`/learn/${this.courseId}/${chapter}/${(index || 0) + 1}`);
      else toast(t('lesson.linkMissing', { page: chapter }), { type: 'err' });
    }
  }

  ui(cmd) {
    switch (cmd) {
      case 'prev': this.gotoNeighbour(-1); break;
      case 'next': this.gotoNeighbour(1); break;
      case 'home': go('/'); break;
      case 'course': go(`/course/${this.courseId}`); break;
      case 'toggle-sidebar':
        this.root.classList.toggle('no-sidebar');
        storageSet('vla.sidebarHidden', this.root.classList.contains('no-sidebar'));
        this.renderBars(this.rendered?.fm || {});
        break;
      case 'toggle-notes': this.toggleNotes(); break;
      case 'toggle-terminal': this.toggleTerminal(); break;
      case 'focus': this.toggleFocus(); break;
      case 'theme': saveSettings({ theme: state.settings.theme === 'light' ? 'dark' : 'light' }); break;
      case 'highlight':
        if (this.edit) break;
        if (this.highlighter?.mode) this.highlighter.commit();
        else this.highlighter?.enter();
        this.renderBars(this.rendered?.fm || {});
        break;
      case 'edit': this.toggleEdit(); break;
      case 'export': exportCourse(this.courseId); break;
      case 'export-ai': exportForAI(this.courseId); break;
      case 'settings': go('/settings'); break;
      case 'help': go('/help'); break;
      case 'complete': this.markComplete(); break;
      case 'reload': this.reload(); break;
      default: toast(t('action.badUi', { cmd }), { type: 'err' });
    }
  }

  async reload() {
    await window.vla.library.refresh(this.courseId);
    this.data = await getCourse(this.courseId, { force: true });
    this.course = this.data.course;
    this.progress = this.data.progress;
    this.progress.pages ||= {};
    this.store = storeFor(this.courseId, this.data.annotations, this.data.state);
    this.pageTexts.clear();
    const ch = this.findChapter(this.chapter.id) || this.flatChapters()[0];
    this.chapter = ch;
    await this.showPage(Math.min(this.index, ch.pages.length - 1));
  }

  toggleFocus() {
    const on = !this.root.classList.contains('is-focus');
    this.root.classList.toggle('is-focus', on);
    document.documentElement.classList.toggle('is-focus', on);
    this.renderBars(this.rendered?.fm || {});
    this.terminal?.refit();
  }

  toggleNotes(force) {
    const open = force ?? !this.notes;
    if (!open) { this.notes?.destroy(); this.notes = null; this.renderBars(this.rendered?.fm || {}); return null; }
    if (!this.notes) {
      this.notes = new NotesPanel({
        courseId: this.courseId,
        course: this.course,
        store: this.store,
        pageSrc: this.src,
        pageTitle: src => this.pageTitle(src),
        pageText: src => this.pageText(src),
        highlighter: this.highlighter,
        onClose: () => this.toggleNotes(false),
        onJump: hl => { state.openNote = hl.id; this.goto({ page: hl.page }); },
      });
      this.body.append(this.notes.el);
      this.notes.render();
    }
    this.renderBars(this.rendered?.fm || {});
    return this.notes;
  }

  openNotes(id, opts = {}) {
    const panel = this.toggleNotes(true);
    panel.highlighter = this.highlighter;
    panel.open(id, opts);
  }

  openTerminal() {
    if (!this.terminal) {
      this.terminal = new TerminalPanel({ courseId: this.courseId, getPage: () => this.src, onClose: () => this.toggleTerminal(false) });
      this.root.append(this.terminal.el);
      this.renderBars(this.rendered?.fm || {});
    }
    return this.terminal;
  }

  toggleTerminal(force) {
    const open = force ?? !this.terminal;
    if (!open) { this.terminal?.destroy(); this.terminal = null; this.renderBars(this.rendered?.fm || {}); return; }
    this.openTerminal().ensureShell();
  }

  async toggleEdit() {
    if (this.edit) { await this.edit.exit(); return; }
    this.highlighter?.exit();
    const page = this.chapter.pages[this.index];
    const text = await this.pageText(page.src);
    this.edit = new EditMode({
      courseId: this.courseId,
      src: page.src,
      text,
      renderPreview: (txt, scrollRoot) => this.renderFor(txt, scrollRoot, {}, { eager: true }),
      onSaved: txt => { this.pageTexts.set(page.src, txt); },
      onExit: () => { const ed = this.edit; this.edit = null; ed.destroy(); this.readerWrap.replaceChildren(this.reader); this.showPage(this.index); },
    });
    this.readerWrap.replaceChildren(this.edit.el);
    this.renderBars(this.rendered?.fm || {});
    await this.edit.mount();
  }

  onKey(e) {
    if (e.defaultPrevented) return;
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable || e.target.closest?.('.monaco-editor, .xterm');
    if (e.altKey && e.key === 'ArrowLeft' && !typing) { e.preventDefault(); this.gotoNeighbour(-1); }
    else if (e.altKey && e.key === 'ArrowRight' && !typing) { e.preventDefault(); this.gotoNeighbour(1); }
    else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'h') { e.preventDefault(); this.ui('highlight'); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e' && !typing) { e.preventDefault(); this.toggleEdit(); }
    else if ((e.ctrlKey || e.metaKey) && e.key === '`') { e.preventDefault(); this.toggleTerminal(); }
    else if (e.key === 'Escape' && this.root.classList.contains('is-focus') && !this.highlighter?.mode && !typing) this.toggleFocus();
  }

  destroy() {
    document.removeEventListener('keydown', this.onKey);
    clearTimeout(this.completeTimer);
    closeAsk();
    this.saveProgress.flush?.();
    this.highlighter?.destroy();
    this.rendered?.dispose();
    this.notes?.destroy();
    this.terminal?.destroy();
    this.edit?.destroy();
    document.documentElement.classList.remove('is-focus');
    document.body.classList.remove('hl-mode');
  }
}

export async function mount(el, params) {
  const view = new LessonView(el);
  await view.load(params);
  return { update: p => view.update(p), unmount: () => view.destroy() };
}
