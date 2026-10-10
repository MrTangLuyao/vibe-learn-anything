/* ============================================================
 * views/agent.js — the learner's own AI agent, interactive, in a
 * full-height terminal opened in the AI workspace. Used to
 * generate new courses ("interview me, then build a .vla").
 * ============================================================ */

import { h, icon } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { state } from '../core/store.js';
import { toast } from '../core/ui.js';
import { setAppbar } from '../appbar.js';
import { TermSession } from '../lib/term.js';
import { generatePrompt } from '../ai.js';

export async function mount(el) {
  setAppbar({ crumbs: [{ label: t('agent.terminal') }] });
  const launch = state.agentLaunch || { mode: 'kit' };
  state.agentLaunch = null;
  const dir = await window.vla.kit.prepare();
  const prompt = launch.prompt || generatePrompt(dir);
  const s = await window.vla.ai.status();
  const host = h('div.term-host', { style: { flex: '1', minHeight: '0', padding: '10px 0 6px 14px' } });
  const cwdLabel = h('code.faint', dir);
  const head = h('div.ws-head', { style: { background: 'var(--bg)' } },
    icon('bot'),
    h('div.ws-title', t('agent.terminal'), h('small', cwdLabel)),
    h('button.chip-btn', { onClick: async () => { await window.vla.app.clipboard(prompt); toast(t('copied'), { type: 'ok', timeout: 1400 }); } }, icon('copy'), h('span', t('copyPrompt'))),
    h('button.chip-btn', { onClick: () => session.write(`${prompt}`) }, icon('text-cursor-input'), h('span', t('agent.typePrompt'))),
    h('button.icon-btn.icon-btn-sm', { 'data-tip': t('term.restart'), onClick: () => start() }, icon('rotate-ccw')),
    h('button.icon-btn.icon-btn-sm', { 'data-tip': t('ai.workspace.open'), onClick: () => window.vla.kit.open() }, icon('folder-open')));
  const note = h('div.req-banner', { style: { margin: '10px 14px 0' } }, icon('info'),
    h('div', s.interactive ? t('agent.hint') : [t('agent.noCmd'), ' ', h('a', { href: '#/settings' }, t('settings'))]));
  const wrap = h('div', { style: { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column', background: 'var(--bg-deep)' } }, head, note, host);
  el.append(wrap);
  const session = new TermSession(host, {
    fontSize: 14,
    onExit: code => { session.term.writeln(`\r\n\x1b[2m${t('ws.exited', { code: code ?? '—' })}\x1b[0m`); session.restartOnKey = () => { session.restartOnKey = null; start(); }; },
  });
  function start() {
    session.clear();
    if (s.interactive) session.start({ agent: 'kit', prompt });
    else session.start({ cwd: 'kit' });
  }
  start();
  session.focus();
  return { unmount: () => session.dispose() };
}

