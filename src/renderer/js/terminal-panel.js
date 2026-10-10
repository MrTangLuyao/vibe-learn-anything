/* ============================================================
 * terminal-panel.js — the bottom terminal of the lesson view.
 * Tabs of sessions: shells (cwd = page/course folder) and
 * commands started by actions with output: terminal.
 * ============================================================ */

import { h, icon, dragResize, storageGet, storageSet } from './core/dom.js';
import { t } from './core/i18n.js';
import { menu } from './core/ui.js';
import { TermSession } from './lib/term.js';

export class TerminalPanel {
  constructor({ courseId, getPage, onClose }) {
    this.courseId = courseId;
    this.getPage = getPage;
    this.onClose = onClose;
    this.tabs = [];
    this.active = null;
    this.el = h('section.terminal-panel', { style: { '--term-h': `${storageGet('vla.termH', 280)}px` } });
    const handle = h('div.resize-handle');
    let startH = 0;
    handle.addEventListener('pointerdown', () => { startH = this.el.offsetHeight; });
    dragResize(handle, {
      axis: 'y',
      onMove: dy => { const hh = Math.max(120, Math.min(window.innerHeight - 200, startH - dy)); this.el.style.setProperty('--term-h', `${hh}px`); this.activeTab()?.session.refit(); },
      onEnd: () => storageSet('vla.termH', this.el.offsetHeight),
    });
    this.tabsEl = h('div.tp-tabs');
    this.bodyEl = h('div.tp-body');
    this.el.append(handle, h('div.tp-head',
      icon('square-terminal', { width: 15, height: 15 }), h('b', t('terminal')),
      this.tabsEl,
      h('button.icon-btn.icon-btn-xs', {
        'data-tip': t('term.new'),
        onClick: e => menu(e.currentTarget, [
          { label: t('term.inPage'), icon: 'folder', onClick: () => this.shell('page') },
          { label: t('term.inCourse'), icon: 'folder-root', onClick: () => this.shell('course') },
          { label: t('term.inHome'), icon: 'house', onClick: () => this.shell('home') },
        ], { align: 'end' }),
      }, icon('plus')),
      h('button.icon-btn.icon-btn-xs', { 'data-tip': t('term.kill'), onClick: () => this.closeTab(this.active) }, icon('trash-2')),
      h('button.icon-btn.icon-btn-xs', { 'data-tip': t('close'), onClick: () => this.onClose?.() }, icon('chevron-down'))),
    this.bodyEl);
  }

  activeTab() { return this.tabs.find(x => x.id === this.active); }

  renderTabs() {
    this.tabsEl.replaceChildren(...this.tabs.map(tab => h(`button.chip-btn${tab.id === this.active ? '.is-active' : ''}`, {
      style: { height: '26px', fontSize: '12px' },
      onClick: () => this.select(tab.id),
    }, h('span', tab.title))));
  }

  select(id) {
    this.active = id;
    for (const tab of this.tabs) tab.host.hidden = tab.id !== id;
    this.renderTabs();
    const tab = this.activeTab();
    if (tab) setTimeout(() => { tab.session.refit(); tab.session.focus(); }, 0);
  }

  add(title, spec) {
    const id = `t${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
    const host = h('div.term-host', { style: { position: 'absolute', inset: '0', padding: '6px 0 4px 10px' } });
    this.bodyEl.append(host);
    const session = new TermSession(host, {
      onExit: code => {
        session.term.writeln(`\r\n\x1b[2m${t('ws.exited', { code: code ?? '—' })}\x1b[0m`);
        if (spec.command) session.restartOnKey = () => { session.restartOnKey = null; session.clear(); session.start(spec); };
      },
    });
    const tab = { id, title, host, session, spec };
    this.tabs.push(tab);
    this.select(id);
    session.start(spec);
    return tab;
  }

  shell(cwd = 'page') {
    const page = this.getPage();
    const label = { page: t('term.page'), course: t('term.course'), home: '~' }[cwd] || cwd;
    return this.add(`${label} ${this.tabs.length + 1}`, { courseId: this.courseId, page, cwd });
  }

  run({ command, cwd = 'page', title }) {
    return this.add(title || command.slice(0, 24), { courseId: this.courseId, page: this.getPage(), cwd, command });
  }

  ensureShell() {
    if (!this.tabs.length) this.shell('page');
    else this.select(this.active || this.tabs[0].id);
  }

  closeTab(id) {
    const i = this.tabs.findIndex(x => x.id === id);
    if (i < 0) return;
    const [tab] = this.tabs.splice(i, 1);
    tab.session.dispose();
    tab.host.remove();
    if (this.tabs.length) this.select(this.tabs[Math.max(0, i - 1)].id);
    else { this.active = null; this.renderTabs(); this.onClose?.(); }
  }

  refit() { this.activeTab()?.session.refit(); }

  destroy() {
    for (const tab of this.tabs) tab.session.dispose();
    this.tabs = [];
    this.el.remove();
  }
}
