/* ============================================================
 * agent-run.js — hand the open highlights of a course to the
 * learner's AI agent, which edits the unpacked course in place.
 * ============================================================ */

import { h, icon } from './core/dom.js';
import { t } from './core/i18n.js';
import { dialog, toast, spinner } from './core/ui.js';
import { getCourse, bus } from './core/store.js';
import { runAgent, agentPrompt } from './ai.js';

export async function processWithAgent(courseId, ids = null) {
  const s = await window.vla.ai.status();
  if (!s.agent) {
    toast(t('ai.agentMissing'), { type: 'err', actions: [{ label: t('settings'), onClick: () => { location.hash = '#/settings'; } }] });
    return false;
  }
  const data = await getCourse(courseId, { force: true });
  const workDir = await window.vla.kit.prepare();
  const prompt = agentPrompt({ workDir, ids, course: data.course });
  const log = h('pre.vx-output', { style: { maxHeight: '46vh', minHeight: '180px', margin: 0 } });
  const statusLine = h('div.ai-streaming', spinner(), h('span', t('agent.working')));
  let job = null;
  let finished = false;
  const result = dialog({
    title: t('agent.title'),
    sub: t('agent.sub'),
    iconName: 'bot',
    wide: true,
    dismissible: false,
    body: h('div.stack', statusLine, log),
    actions: [{ label: t('agent.stop'), onClick: () => { if (!finished) { job?.abort(); return false; } return true; } }],
    onOpen: async (box, finish) => {
      const btn = box.querySelector('.dialog-foot .btn');
      job = runAgent({
        prompt,
        courseId,
        onDelta: d => { log.textContent += d; log.scrollTop = log.scrollHeight; },
        onLog: d => { log.append(h('span.o-meta', d)); log.scrollTop = log.scrollHeight; },
      });
      try {
        await job.promise;
        statusLine.replaceChildren(icon('circle-check'), h('span', t('agent.done')));
        statusLine.style.color = 'var(--ok)';
      } catch (e) {
        statusLine.replaceChildren(icon('circle-alert'), h('span', e.message));
        statusLine.style.color = 'var(--err)';
      }
      finished = true;
      btn.textContent = t('close');
      await window.vla.library.refresh(courseId);
      await getCourse(courseId, { force: true });
      bus.emit('course:changed', { id: courseId });
      void finish;
    },
  });
  await result;
  return true;
}
