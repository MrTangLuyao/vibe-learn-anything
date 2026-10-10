/* All notes of a course, from the course page. */
import { h, icon } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { dialog } from '../core/ui.js';
import { getCourse, state } from '../core/store.js';
import { go } from '../core/router.js';
import { storeFor } from './store.js';
import { noteCard } from './notes.js';
import { processWithAgent } from '../agent-run.js';
import { exportForAI } from '../library-actions.js';

export async function openCourseNotes(courseId) {
  const data = await getCourse(courseId);
  const store = storeFor(courseId, data.annotations, data.state);
  const locate = src => {
    for (const u of data.course.units) for (const ch of u.chapters) {
      const i = ch.pages.findIndex(p => p.src === src);
      if (i >= 0) return { ch, i, title: ch.pages[i].title || data.metas[src]?.title || src };
    }
    return null;
  };
  const list = [...store.all].sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  const waiting = list.filter(x => (x.kind === 'ask' || x.kind === 'revise') && x.status === 'open').length;
  const box = h('div.notes-list', { style: { padding: '0' } });
  if (!list.length) box.append(h('div.empty', icon('highlighter'), h('h3', t('notes.empty')), h('p', t('notes.emptyBody'))));
  let close = null;
  for (const hl of list) {
    const loc = locate(hl.page);
    box.append(noteCard(hl, {
      store,
      pageTitle: loc?.title || hl.page,
      onClick: () => {
        if (!loc) return;
        close?.();
        state.openNote = hl.id;
        go(`/learn/${courseId}/${loc.ch.id}/${loc.i + 1}`);
      },
    }));
  }
  await dialog({
    title: t('notes.courseTitle'),
    sub: t('notes.courseSub', { n: list.length, w: waiting }),
    iconName: 'notebook-pen',
    wide: true,
    body: box,
    onOpen: (_box, finish) => { close = () => finish(null); },
    actions: [
      { label: t('export.ai'), icon: 'sparkles', onClick: () => { exportForAI(courseId); } },
      { label: t('agent.process'), icon: 'bot', primary: true, disabled: !waiting, onClick: () => { processWithAgent(courseId); } },
    ],
  });
}
