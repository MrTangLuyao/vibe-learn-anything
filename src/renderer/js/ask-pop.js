/* ============================================================
 * ask-pop.js — the "Ask AI" popover for :ask[] chips, ::ask
 * blocks and ask-ai actions. The exchange can be kept as an
 * "ask" highlight thread; without an AI it is queued for later.
 * ============================================================ */

import { h, icon, placeNear } from './core/dom.js';
import { t } from './core/i18n.js';
import { toast, spinner } from './core/ui.js';
import { renderHtml } from './vitent/markdown.js';
import { ask as askAI, askMessages } from './ai.js';

let current = null;

export function closeAsk() {
  current?.close();
}

/* ctx: { course, courseId, pageSrc, pageTitle, getPageText(), store, onOpenThread(id) } */
export function openAsk(question, { anchor, context } = {}, ctx) {
  closeAsk();
  const blockEl = anchor?.closest?.('[data-block]');
  const target = blockEl
    ? { type: 'block', block: blockEl.dataset.block, widget: blockEl.dataset.widget, label: (blockEl.textContent || '').trim().slice(0, 80) }
    : { type: 'page' };
  const ta = h('textarea.textarea', { rows: 3, value: question || '' });
  const answerBox = h('div.vt-article', { style: { fontSize: '14px' } });
  const status = h('div.ai-streaming', { hidden: true }, spinner(), h('span', t('ai.thinking')));
  const foot = h('div.ap-foot');
  let job = null;
  let answer = '';
  let saved = false;
  /* The popover grows while the answer streams in; keep it on screen. */
  const clamp = () => {
    const r = pop.getBoundingClientRect();
    const top = Math.max(8, Math.min(r.top, window.innerHeight - r.height - 8));
    if (Math.abs(top - r.top) > 1) pop.style.top = `${Math.round(top)}px`;
  };

  const pop = h('div.ask-pop', { role: 'dialog' },
    h('div.ap-head', icon('sparkles'), h('span.grow', t('ask.title')),
      h('button.icon-btn.icon-btn-xs', { onClick: () => close() }, icon('x'))),
    h('div.ap-body', h('div.field', ta, context ? h('div.field-hint', context) : null), status, answerBox),
    foot);

  const saveThread = (status = 'answered') => {
    if (saved) return;
    saved = true;
    const comments = [{ author: 'learner', text: ta.value.trim() }];
    const hl = ctx.store.add({ kind: 'ask', page: ctx.pageSrc, targets: [target], status: answer ? status : 'open' });
    ctx.store.addComment(hl.id, 'learner', comments[0].text);
    if (answer) ctx.store.addComment(hl.id, 'answer', answer);
    return hl;
  };

  const renderFoot = () => {
    foot.replaceChildren(
      h('span.grow'),
      answer
        ? h('button.btn.btn-sm.btn-tonal', { onClick: () => { const hl = saveThread(); close(); if (hl) ctx.onOpenThread?.(hl.id); toast(t('ask.saved'), { type: 'ok' }); } }, icon('notebook-pen'), h('span', t('ask.keep')))
        : h('button.btn.btn-sm', { onClick: () => { const hl = saveThread('open'); close(); toast(t('ask.queued'), { type: 'ok', actions: [{ label: t('open'), onClick: () => ctx.onOpenThread?.(hl.id) }] }); } }, icon('clock'), h('span', t('ask.later'))),
      h('button.btn.btn-sm.btn-primary', { onClick: run, disabled: !!job }, icon('send'), h('span', answer ? t('ask.again') : t('ask.go'))));
  };

  async function run() {
    const q = ta.value.trim();
    if (!q) return;
    answer = '';
    answerBox.replaceChildren();
    status.hidden = false;
    let acc = '';
    try {
      job = await askAI({
        messages: askMessages({
          course: ctx.course,
          pageTitle: ctx.pageTitle,
          pageText: await ctx.getPageText(),
          highlight: { targets: [target], comments: [] },
          question: context ? `${q}\n\n(${context})` : q,
        }),
        courseId: ctx.courseId,
        onDelta: d => { acc += d; answerBox.innerHTML = renderHtml(acc); clamp(); },
      });
      renderFoot();
      const r = await job.promise;
      answer = (r?.text || acc).trim();
      answerBox.innerHTML = renderHtml(answer);
    } catch (e) {
      if (e.code === 'NO_AI') answerBox.replaceChildren(h('p.muted', t('ai.notConfiguredLong')));
      else answerBox.replaceChildren(h('div.vx-error', e.message));
    } finally {
      job = null;
      status.hidden = true;
      renderFoot();
      clamp();
    }
  }

  function close() {
    job?.abort?.();
    pop.remove();
    document.removeEventListener('keydown', onKey);
    if (current?.pop === pop) current = null;
  }
  const onKey = e => { if (e.key === 'Escape') close(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run(); };
  document.addEventListener('keydown', onKey);
  renderFoot();
  document.body.append(pop);
  if (anchor instanceof Element) placeNear(pop, anchor, { align: 'start' });
  else { pop.style.left = `${Math.max(16, window.innerWidth / 2 - 260)}px`; pop.style.top = '120px'; }
  ta.focus();
  current = { pop, close };
  return current;
}
