/* ============================================================
 * views/help.js — the user guide and the AI manual, rendered
 * with the same Vitent renderer the courses use.
 * ============================================================ */

import { h, icon } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { go } from '../core/router.js';
import { spinner } from '../core/ui.js';
import { setAppbar } from '../appbar.js';
import { renderPage } from '../vitent/render.js';
import { generateCourseDialog } from '../library-actions.js';

const DOCS = [
  { id: 'guide', file: 'user-guide.md', icon: 'compass' },
  { id: 'generate', file: 'generate_course.md', icon: 'wand-sparkles' },
  { id: 'm01', file: 'ai_manual/01-vla-format.md', icon: 'package' },
  { id: 'm02', file: 'ai_manual/02-vitent-format.md', icon: 'file-code' },
  { id: 'm03', file: 'ai_manual/03-vitent-blocks.md', icon: 'blocks' },
  { id: 'm04', file: 'ai_manual/04-actions-buttons.md', icon: 'mouse-pointer-click' },
  { id: 'm05', file: 'ai_manual/05-annotations.md', icon: 'highlighter' },
  { id: 'm06', file: 'ai_manual/06-code-and-runtimes.md', icon: 'square-terminal' },
  { id: 'm07', file: 'ai_manual/07-components.md', icon: 'library' },
];

export async function mount(el, params) {
  const nav = h('nav.help-nav', h('div.hn-title', t('help.docs')));
  const inner = h('div.page-narrow');
  const content = h('div.scroll-view', { style: { height: '100%' } }, inner);
  const layout = h('div.help-layout', nav, h('div', { style: { minWidth: 0, height: 'calc(100vh - var(--appbar-h))', overflow: 'hidden', display: 'flex' } }, content));
  el.append(layout);
  let rendered = null;

  async function show(id) {
    const doc = DOCS.find(d => d.id === id) || DOCS[0];
    setAppbar({ crumbs: [{ label: t('help.docs'), href: '/help' }, { label: t(`help.${doc.id}`) }] });
    nav.replaceChildren(h('div.hn-title', t('help.docs')), ...DOCS.map(d => h(`button.page-item${d.id === doc.id ? '.is-current' : ''}`, { onClick: () => go(`/help/${d.id}`) },
      h('span.pi-icon', { style: { '--k': 'var(--accent)' } }, icon(d.icon)), h('span.pi-name', t(`help.${d.id}`)), h('span'))),
    h('div.divider'),
    h('button.page-item', { onClick: generateCourseDialog }, h('span.pi-icon', icon('sparkles')), h('span.pi-name', t('gen.button')), h('span')),
    h('button.page-item', { onClick: () => go('/agent') }, h('span.pi-icon', icon('bot')), h('span.pi-name', t('agent.terminal')), h('span')));
    inner.replaceChildren(h('div.reader-loading', spinner()));
    rendered?.dispose();
    try {
      const res = await fetch(`docs/${doc.file}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const text = await res.text();
      rendered = await renderPage({
        courseId: '_',
        course: { title: 'docs', runners: {}, actions: {}, buttons: [] },
        src: 'docs',
        text,
        noHeader: true,
        scrollRoot: content,
        lesson: null,
        onLink: href => {
          const m = /([\w-]+)\.md(#.*)?$/.exec(href);
          if (!m) return false;
          const target = DOCS.find(d => d.file.endsWith(`${m[1]}.md`));
          if (target) { go(`/help/${target.id}`); return true; }
          return false;
        },
      });
      inner.replaceChildren(rendered.el);
      content.scrollTop = 0;
    } catch (e) {
      inner.replaceChildren(h('div.vx-error', `${doc.file}: ${e.message}`));
    }
  }

  await show(params.doc);
  return {
    update: p => { show(p.doc); return true; },
    unmount: () => rendered?.dispose(),
  };
}
