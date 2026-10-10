/* :::slides with ::::slide[Title] children — an in-page slide deck. */
import { h, icon } from '../../core/dom.js';
import { t } from '../../core/i18n.js';

export const slides = {
  render(node, rctx, id) {
    const items = node.children.filter(c => c.type === 'container' && c.name === 'slide');
    const saved = rctx.saved('widgets', id) || {};
    let i = Math.min(items.length - 1, Math.max(0, saved.at || 0));
    const stage = h('div.slides-stage', { tabindex: '0' });
    const dots = h('div.slides-dots');
    const count = h('span.slides-count');
    const el = h('div.vx-slides', { style: { '--aspect': node.attrs.aspect ? String(node.attrs.aspect).replace(':', ' / ') : null } });
    const slideEls = items.map(s => {
      const box = h('div.slide', { style: { '--align': s.attrs.align === 'top' ? 'flex-start' : 'center', background: s.attrs.background || null } });
      if (s.label) box.append(h('div.slide-title', { html: rctx.inline(s.label) }));
      rctx.children(s.children, box);
      return box;
    });
    const go = n => {
      i = Math.max(0, Math.min(items.length - 1, n));
      stage.replaceChildren(slideEls[i] || h('div.slide', t('slides.empty')));
      dots.querySelectorAll('button').forEach((d, j) => d.classList.toggle('is-on', j === i));
      count.textContent = `${i + 1} / ${items.length}`;
      rctx.report('widgets', id, { at: i, seen: Math.max(saved.seen || 0, i + 1) });
    };
    items.forEach((_, j) => dots.append(h('button', { onClick: () => go(j), 'aria-label': `${j + 1}` })));
    stage.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { go(i + 1); e.preventDefault(); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { go(i - 1); e.preventDefault(); }
    });
    el.append(stage, h('div.slides-bar', { 'data-vh-skip': '' },
      h('button.icon-btn.icon-btn-sm', { onClick: () => go(i - 1), 'aria-label': t('lb.prev') }, icon('chevron-left')),
      count,
      h('button.icon-btn.icon-btn-sm', { onClick: () => go(i + 1), 'aria-label': t('lb.next') }, icon('chevron-right')),
      dots,
      h('button.icon-btn.icon-btn-sm', {
        'data-tip': t('fullscreen'),
        onClick: () => (document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen()),
      }, icon('maximize'))));
    go(i);
    return el;
  },
};
