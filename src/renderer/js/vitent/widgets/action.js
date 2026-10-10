/* Behaviour widgets: ::button, ::ask, ::terminal */
import { h, icon } from '../../core/dom.js';
import { t } from '../../core/i18n.js';
import { lookupAction, actionIcon, renderResult } from '../../actions.js';
import { TermSession } from '../../lib/term.js';

export const button = {
  label: node => node.label || node.attrs.action,
  render(node, rctx) {
    const a = node.attrs;
    const action = lookupAction(a.action, { fm: rctx.fm, course: rctx.course });
    const variant = a.variant === 'outline' ? '.btn-outline' : a.variant === 'text' ? '' : a.variant === 'primary' ? '.btn-primary' : '.btn-tonal';
    let out = null;
    const el = h('div.vx-button');
    const btn = h(`button.btn${variant}`, { 'data-vh-skip': '' }, icon(a.icon || actionIcon(action)), h('span', { html: rctx.inline(node.label || action?.label || a.action || t('run')) }));
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const spin = h('span.spinner');
      btn.append(spin);
      try {
        const r = await rctx.page.lesson?.runAction(a.action, { anchor: btn, inline: true });
        if (r && a.output !== 'none') {
          const fresh = renderResult(r);
          if (out) out.replaceWith(fresh); else el.append(fresh);
          out = fresh;
        }
      } finally {
        spin.remove();
        btn.disabled = false;
      }
    });
    el.append(btn);
    return el;
  },
};

export const ask = {
  label: node => node.label || node.attrs.prompt,
  render(node, rctx) {
    const a = node.attrs;
    const btn = h('button.ask-chip', { 'data-vh-skip': '' }, icon('sparkles'), h('span', node.label || t('ask.button')));
    btn.addEventListener('click', () => rctx.page.lesson?.ask(a.prompt || node.label || '', { anchor: btn, context: a.context }));
    return h('div.vx-ask', btn);
  },
};

export const terminal = {
  label: node => node.label || node.attrs.command || 'terminal',
  render(node, rctx) {
    const a = node.attrs;
    const host = h('div.term-host', { style: { '--term-h': a.height ? `${a.height}px` : null } });
    let session = null;
    const startBtn = h('button.btn.btn-tonal', icon('square-terminal'), h('span', a.command ? t('term.run', { cmd: a.command }) : t('term.open')));
    const stage = h('div.term-start', { style: { '--term-h': a.height ? `${a.height}px` : null } }, startBtn);
    const restart = h('button.icon-btn.icon-btn-xs', { 'data-tip': t('term.restart'), hidden: true }, icon('rotate-ccw'));
    const el = h('div.vx-terminal',
      h('div.term-head', { 'data-vh-skip': '' }, icon('square-terminal', { width: 15, height: 15 }), h('span.grow', node.label || a.command || t('terminal')), restart),
      stage);
    const spec = { courseId: rctx.courseId, page: rctx.src, cwd: a.cwd || 'page', command: a.command || undefined };
    const start = () => {
      stage.replaceWith(host);
      session = new TermSession(host, {
        onExit: code => { session.term.writeln(`\r\n\x1b[2m${t('ws.exited', { code: code ?? '—' })}\x1b[0m`); },
      });
      session.start(spec);
      restart.hidden = false;
    };
    startBtn.addEventListener('click', start);
    restart.addEventListener('click', () => { session?.clear(); session?.start(spec); });
    rctx.onDispose(() => session?.dispose());
    return el;
  },
};
