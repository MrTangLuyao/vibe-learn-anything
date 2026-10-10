/* ============================================================
 * views/dashboard.js — the course library ("课程" / archived).
 * ============================================================ */

import { h, icon } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { bus } from '../core/store.js';
import { go } from '../core/router.js';
import { menu, emptyState, setChildren } from '../core/ui.js';
import { setAppbar } from '../appbar.js';
import { importFiles, exportCourse, exportForAI, removeCourse, generateCourseDialog } from '../library-actions.js';

function courseMenu(anchor, c, refresh) {
  menu(anchor, [
    { label: t('open'), icon: 'arrow-up-right', onClick: () => go(`/course/${c.id}`) },
    '-',
    { label: t('export.vla'), icon: 'package', onClick: () => exportCourse(c.id) },
    { label: t('export.ai'), icon: 'sparkles', onClick: () => exportForAI(c.id) },
    { label: t('showFolder'), icon: 'folder-open', onClick: () => window.vla.library.reveal(c.id) },
    '-',
    c.archived
      ? { label: t('unarchive'), icon: 'archive-restore', onClick: async () => { await window.vla.library.setMeta(c.id, { archived: false }); refresh(); } }
      : { label: t('archive'), icon: 'archive', onClick: async () => { await window.vla.library.setMeta(c.id, { archived: true }); refresh(); } },
    { label: t('remove'), icon: 'trash-2', danger: true, onClick: () => removeCourse(c.id, c.title) },
  ], { align: 'end' });
}

function courseCard(c, refresh) {
  const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
  const card = h('a.card.is-link.course-card', {
    href: `#/course/${c.id}`,
    style: { '--c': c.color, textDecoration: 'none' },
    onContextmenu: e => { e.preventDefault(); courseMenu({ x: e.clientX, y: e.clientY }, c, refresh); },
  },
  h('div.cc-badges',
    c.unseen ? h('span.badge', { 'data-tip': t('dash.newAnswers', { n: c.unseen }) }, icon('sparkles'), String(c.unseen)) : null,
    c.waiting ? h('span.badge.badge-muted', { 'data-tip': t('dash.waiting', { n: c.waiting }) }, icon('hourglass'), String(c.waiting)) : null),
  h('div.cc-code', c.code || c.title),
  h('div.cc-title', c.code ? c.title : (c.subtitle || '')),
  h('div.cc-foot',
    h('div.progress', h('i', { style: { width: `${pct}%` } })),
    h('span', `${c.done}/${c.total}`)),
  h('button.icon-btn.icon-btn-xs.cc-more', {
    'aria-label': t('more'),
    onClick: e => { e.preventDefault(); e.stopPropagation(); courseMenu(e.currentTarget, c, refresh); },
  }, icon('ellipsis')));
  return card;
}

export async function mount(el) {
  setAppbar({ page: 'learn', crumbs: [] });
  const scroll = h('div.scroll-view');
  const inner = h('div.dash');
  scroll.append(inner);
  el.append(scroll);

  const hero = h('section.dash-hero',
    h('h1', 'Learn ', h('span.one', h('span.paint', 'anything')), h('span.dot', '.')),
    h('p', t('dash.lead')),
    h('div.hero-actions',
      h('button.btn.btn-primary.btn-lg', { onClick: generateCourseDialog }, icon('wand-sparkles'), h('span', t('gen.button'))),
      h('button.btn.btn-outline.btn-lg', { onClick: () => importFiles() }, icon('file-down'), h('span', t('import.button'))),
      h('button.btn.btn-lg', { onClick: () => go('/help') }, icon('book-open'), h('span', t('help.docs')))));

  const body = h('div');
  inner.append(hero, body);

  async function render() {
    const list = await window.vla.library.list();
    const active = list.filter(c => !c.archived);
    const archived = list.filter(c => c.archived);
    const parts = [];
    parts.push(h('div.section-head',
      h('h2', t('dash.courses')),
      h('div.sh-actions',
        h('button.btn.btn-accent-outline.btn-sm', { onClick: () => importFiles() }, icon('plus'), h('span', t('import.button'))),
        h('button.icon-btn.icon-btn-sm', { 'data-tip': t('ai.workspace.open'), onClick: () => window.vla.kit.open() }, icon('folder-open')))));
    if (!list.length) {
      parts.push(h('div.card', emptyState('library', t('dash.empty.title'), t('dash.empty.body'),
        h('button.btn.btn-primary', { onClick: generateCourseDialog }, icon('wand-sparkles'), h('span', t('gen.button'))),
        h('button.btn.btn-outline', { onClick: () => importFiles() }, icon('file-down'), h('span', t('import.button'))))));
    } else if (!active.length) {
      parts.push(h('p.muted', t('dash.allArchived')));
    } else {
      parts.push(h('div.course-grid', active.map(c => courseCard(c, render))));
    }
    if (archived.length) {
      parts.push(h('div.section-head', { style: { marginTop: '48px' } },
        h('h2', t('dash.archived'), h('span.sh-help', { 'data-tip': t('dash.archived.tip') }, '?'))));
      const groups = new Map();
      for (const c of archived) {
        const key = c.term || '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
      }
      for (const [term, items] of [...groups].sort((a, b) => b[0].localeCompare(a[0]))) {
        if (term) {
          const m = /^(\d{4})\s*(.*)$/.exec(term);
          parts.push(h('div.semester-head', h('b', m ? m[1] : term), m && m[2] ? h('span', m[2]) : null));
        }
        parts.push(h('div.course-grid', items.map(c => courseCard(c, render))));
      }
    }
    setChildren(body, parts);
  }

  const off = bus.on('library', render);
  await render();
  return { unmount() { off(); } };
}
