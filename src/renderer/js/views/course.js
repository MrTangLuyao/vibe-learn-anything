/* ============================================================
 * views/course.js — a course: header, requirements, chapter list
 * grouped by unit (the "Week 0 / Week 1" page).
 * ============================================================ */

import { h, icon, fmtDate } from '../core/dom.js';
import { t, tl, getLang } from '../core/i18n.js';
import { getCourse, bus } from '../core/store.js';
import { go } from '../core/router.js';
import { menu, setChildren, spinner, toast } from '../core/ui.js';
import { setAppbar } from '../appbar.js';
import { chapterKind } from '../kinds.js';
import { renderHtml } from '../vitent/markdown.js';
import { exportCourse, exportForAI, removeCourse } from '../library-actions.js';
import { processWithAgent } from '../agent-run.js';
import { openCourseNotes } from '../highlight/notes-dialog.js';
import { setContextProvider } from '../ai-context.js';

export function chapterStatus(ch, progress) {
  const pages = ch.pages.map(p => progress.pages?.[p.src] || {});
  const done = pages.filter(p => p.completed).length;
  if (pages.length && done === pages.length) return 'done';
  if (done || pages.some(p => p.visited)) return 'doing';
  return 'todo';
}

export function resumeTarget(data) {
  const { course, progress } = data;
  const last = progress.last;
  if (last?.chapter) {
    for (const u of course.units) for (const ch of u.chapters) {
      if (ch.id === last.chapter) {
        const idx = ch.pages.findIndex(p => p.src === last.page);
        return `/learn/${data.id}/${ch.id}/${idx >= 0 ? idx + 1 : 1}`;
      }
    }
  }
  for (const u of course.units) for (const ch of u.chapters) {
    const idx = ch.pages.findIndex(p => !progress.pages?.[p.src]?.completed);
    if (idx >= 0) return `/learn/${data.id}/${ch.id}/${idx + 1}`;
  }
  const first = course.units[0]?.chapters[0];
  return first ? `/learn/${data.id}/${first.id}/1` : null;
}

function dueLabel(due) {
  if (!due) return null;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return h('span.due', String(due));
  const soon = d.getTime() - Date.now() < 3 * 86400e3 && d.getTime() > Date.now();
  return h(`span.due${soon ? '.is-soon' : ''}`, icon('calendar-clock', { width: 13, height: 13 }), ' ', `${t('due')} ${fmtDate(due, getLang())}`);
}

async function requirementsBanner(course) {
  const reqs = course.requirements || [];
  if (!reqs.length) return null;
  const names = reqs.map(r => r.check || r.name).filter(Boolean);
  const found = await window.vla.exec.check(names);
  const missing = reqs.filter(r => !found[r.check || r.name]);
  if (!missing.length) return null;
  return h('div.req-banner', icon('triangle-alert'),
    h('div', h('b', t('req.missing')), ' ',
      missing.map((r, i) => [i ? '、' : '', h('code', r.name)]),
      h('div', { style: { marginTop: '6px' } }, missing.map(r => (r.hint ? h('div', { html: renderHtml(tl(r.hint)) }) : null)))));
}

export async function mount(el, params) {
  const scroll = h('div.scroll-view');
  const inner = h('div.course-page', h('div.reader-loading', spinner(true)));
  scroll.append(inner);
  el.append(scroll);

  async function render(force) {
    let data;
    try {
      data = await getCourse(params.id, { force });
    } catch (e) {
      setChildren(inner, h('div.vx-error', e.message));
      return;
    }
    const { course, progress, annotations } = data;
    setAppbar({ crumbs: [{ label: course.code || course.title }] });
    const all = course.units.flatMap(u => u.chapters.flatMap(ch => ch.pages));
    const done = all.filter(p => progress.pages?.[p.src]?.completed).length;
    const pct = all.length ? Math.round((done / all.length) * 100) : 0;
    const resume = resumeTarget(data);
    const waiting = annotations.highlights.filter(x => (x.kind === 'ask' || x.kind === 'revise') && x.status === 'open').length;
    const lastChapter = progress.last?.chapter;

    const head = h('div.course-head', { style: { '--c': course.color } },
      h('div.course-mark', icon(course.icon || 'graduation-cap')),
      h('div.grow',
        course.code ? h('div.course-code', course.code) : null,
        h('h1.course-title', tl(course.title)),
        course.subtitle ? h('div.course-sub', tl(course.subtitle)) : null,
        h('div.course-stats',
          h('div.progress', h('i', { style: { width: `${pct}%` } })),
          h('span', t('course.progress', { done, total: all.length, pct })),
          course.version ? h('span.faint', `v${course.version}`) : null),
        h('div.course-actions',
          resume ? h('button.btn.btn-primary', { onClick: () => go(resume) }, icon(done ? 'play' : 'arrow-right'), h('span', done ? t('course.continue') : t('course.start'))) : null,
          h('button.btn.btn-outline', { onClick: () => openCourseNotes(params.id) }, icon('notebook-pen'), h('span', t('notes')),
            annotations.highlights.length ? h('span.badge.badge-soft', String(annotations.highlights.length)) : null),
          h('button.btn.btn-tonal', {
            onClick: e => menu(e.currentTarget, [
              { title: t('ai.menu') },
              { label: t('agent.process'), icon: 'bot', hint: waiting ? String(waiting) : '', onClick: () => processWithAgent(params.id) },
              { label: t('export.ai'), icon: 'sparkles', onClick: () => exportForAI(params.id) },
              '-',
              { label: t('export.vla'), icon: 'package', onClick: () => exportCourse(params.id) },
              { label: t('showFolder'), icon: 'folder-open', onClick: () => window.vla.library.reveal(params.id) },
              { label: t('reload'), icon: 'refresh-cw', onClick: async () => { await window.vla.library.refresh(params.id); await render(true); toast(t('reloaded'), { type: 'ok', timeout: 1500 }); } },
              '-',
              { label: t('remove'), icon: 'trash-2', danger: true, onClick: async () => { if (await removeCourse(params.id, course.title)) go('/'); } },
            ]),
          }, icon('sparkles'), h('span', 'AI'), waiting ? h('span.badge', String(waiting)) : null, icon('chevron-down')))));

    const parts = [head];
    const banner = await requirementsBanner(course);
    if (banner) parts.push(banner);
    if (course.description) parts.push(h('div.course-desc.vt-article', { html: renderHtml(tl(course.description)) }));

    for (const u of course.units) {
      const unit = h('section.unit');
      if (u.title) unit.append(h('h2.unit-title', tl(u.title)));
      if (u.description) unit.append(h('div.unit-desc', tl(u.description)));
      for (const ch of u.chapters) {
        const kind = chapterKind(ch);
        const status = chapterStatus(ch, progress);
        const donePages = ch.pages.filter(p => progress.pages?.[p.src]?.completed).length;
        unit.append(h(`button.chapter-row${ch.id === lastChapter ? '.is-last' : ''}`, {
          onClick: () => {
            const idx = ch.pages.findIndex(p => !progress.pages?.[p.src]?.completed);
            go(`/learn/${params.id}/${ch.id}/${idx >= 0 ? idx + 1 : 1}`);
          },
        },
        h('span.kind-tile', { style: { '--k': ch.color || kind.color } }, icon(ch.icon || kind.icon)),
        h(`span.status-mark.is-${status}`, status === 'done' ? icon('check') : null),
        h('span.chapter-name', tl(ch.title), ch.description ? h('small', tl(ch.description)) : null),
        h('span.chapter-meta', dueLabel(ch.due), h('span', `${donePages}/${ch.pages.length}`))));
      }
      parts.push(unit);
    }
    setChildren(inner, parts);
  }

  const off = bus.on('course:changed', ({ id }) => { if (id === params.id) render(true); });
  await render(true);
  /* The AI panel knows which course is open (and keeps one conversation per course). */
  const course = (await getCourse(params.id)).course;
  const offCtx = setContextProvider(() => ({ view: 'course', courseId: params.id, courseTitle: tl(course.title), courseCode: course.code || '' }));
  return { unmount() { off(); offCtx(); } };
}
