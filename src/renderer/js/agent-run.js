/* ============================================================
 * agent-run.js — hand the open highlights of a course to the
 * learner's AI (Claude Code, or another command-line agent), which
 * edits the unpacked course in place. Pages refresh live.
 * ============================================================ */

import { h, icon } from './core/dom.js';
import { t } from './core/i18n.js';
import { dialog, toast, spinner } from './core/ui.js';
import { getCourse, bus } from './core/store.js';
import { runAgent, agentPrompt, status, pickProvider } from './ai.js';

const MCP = 'mcp__vibe-learn__';

function stepText(e) {
  const name = e.name || '';
  const n = name.startsWith(MCP) ? name.slice(MCP.length) : name;
  const label = t(`tool.${n}`) !== `tool.${n}` ? t(`tool.${n}`) : n;
  const detail = e.input?.file_path || e.input?.path || e.input?.page || e.input?.highlight_id || e.input?.pattern || '';
  return `▸ ${label}${detail ? `  ${String(detail).split(/[\\/]/).slice(-2).join('/')}` : ''}\n`;
}

export async function processWithAgent(courseId, ids = null) {
  const s = await status();
  const provider = pickProvider(s);
  if (provider !== 'claude' && !s.agent) {
    toast(t('ai.agentMissing'), { type: 'err', actions: [{ label: t('settings'), onClick: () => { location.hash = '#/settings'; } }] });
    return false;
  }
  const data = await getCourse(courseId, { force: true });
  const workDir = await window.vla.kit.prepare();
  const prompt = agentPrompt({ workDir, ids, course: data.course, mcp: provider === 'claude' });
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
      const add = text => { log.append(text); log.scrollTop = log.scrollHeight; };
      try {
        job = await runAgent({
          prompt,
          courseId,
          onDelta: d => add(d),
          onLog: d => { log.append(h('span.o-meta', d)); log.scrollTop = log.scrollHeight; },
          onEvent: e => {
            if (e.kind === 'tool') add(h('span.o-meta', stepText(e)));
            if (e.kind === 'text-start' && log.textContent && !log.textContent.endsWith('\n')) add('\n');
          },
        });
        const r = await job.promise;
        if (r?.text && !log.textContent.includes(r.text.slice(0, 40))) add(`\n${r.text}`);
        statusLine.replaceChildren(icon('circle-check'), h('span', t('agent.done')));
        statusLine.style.color = 'var(--ok)';
      } catch (e) {
        statusLine.replaceChildren(icon('circle-alert'), h('span', e.code === 'NO_LOGIN' ? t('chat.loginNeeded') : e.message));
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
