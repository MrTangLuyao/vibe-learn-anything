/* Layout and text widgets: callout, details, reveal, tabs, columns, steps, toc, divider. */
import { h, icon } from '../../core/dom.js';
import { t } from '../../core/i18n.js';

const CALLOUT_ICONS = {
  note: 'notebook', tip: 'lightbulb', info: 'info', warning: 'triangle-alert', danger: 'octagon-alert',
  success: 'circle-check', question: 'circle-help', example: 'flask-conical',
};

export const callout = {
  render(node, rctx) {
    const type = node.name === 'callout' ? (node.attrs.type || 'info') : node.name;
    const title = node.label || node.attrs.title || t(`callout.${type}`);
    const body = h('div.co-body');
    rctx.children(node.children, body);
    const collapsible = node.attrs.collapsed != null;
    const el = h(`div.vx-callout${collapsible ? '.is-collapsible' : ''}${node.attrs.collapsed === true ? '.is-collapsed' : ''}`, { dataset: { type } },
      h('div.co-icon', icon(node.attrs.icon || CALLOUT_ICONS[type] || 'info')),
      h('div.co-main',
        title ? h('div.co-title', { html: rctx.inline(title), onClick: collapsible ? () => el.classList.toggle('is-collapsed') : null }) : null,
        body));
    return el;
  },
};

export const details = {
  render(node, rctx) {
    const body = h('div.dt-body');
    rctx.children(node.children, body);
    return h('details.vx-details', { open: node.attrs.open === true },
      h('summary', icon('chevron-right'), h('span', { html: rctx.inline(node.label || node.attrs.title || t('details')) })),
      body);
  },
};

export const reveal = {
  render(node, rctx, id) {
    const body = h('div.rv-body');
    rctx.children(node.children, body);
    const saved = rctx.saved('widgets', id);
    const el = h('div.vx-reveal');
    const btn = h('button.btn.btn-tonal', { 'data-vh-skip': '' }, icon('eye'), h('span', node.label || node.attrs.button || t('reveal.show')));
    const show = () => { btn.replaceWith(body); rctx.report('widgets', id, { revealed: true }); };
    btn.addEventListener('click', show);
    el.append(saved?.revealed ? body : btn);
    return el;
  },
};

export const tabs = {
  render(node, rctx) {
    const items = node.children.filter(c => c.type === 'container' && c.name === 'tab');
    const bar = h('div.tabs-bar', { 'data-vh-skip': '' });
    const panels = [];
    const el = h('div.vx-tabs', bar);
    items.forEach((tab, i) => {
      const panel = h('div.tab-panel', { hidden: i !== 0 });
      rctx.children(tab.children, panel);
      panels.push(panel);
      const btn = h(`button.tab-btn${i === 0 ? '.is-on' : ''}`, {
        onClick: () => {
          bar.querySelectorAll('.tab-btn').forEach((b, j) => b.classList.toggle('is-on', j === i));
          panels.forEach((p, j) => { p.hidden = j !== i; });
        },
      }, h('span', { html: rctx.inline(tab.label || tab.attrs.title || `Tab ${i + 1}`) }));
      bar.append(btn);
      el.append(panel);
    });
    const loose = node.children.filter(c => !(c.type === 'container' && c.name === 'tab'));
    if (loose.length) rctx.children(loose, el);
    return el;
  },
};

export const columns = {
  render(node, rctx) {
    const cols = node.children.filter(c => c.type === 'container' && c.name === 'column');
    const tmpl = cols.map(c => (c.attrs.width ? (/^\d+$/.test(String(c.attrs.width)) ? `${c.attrs.width}fr` : c.attrs.width) : '1fr')).join(' ');
    const el = h('div.vx-columns', { style: { '--cols': tmpl || '1fr 1fr', '--gap': node.attrs.gap ? `${node.attrs.gap}px` : null } });
    for (const c of cols) el.append(rctx.children(c.children, h('div.vx-column')));
    return el;
  },
};

export const steps = {
  render(node, rctx, id) {
    const items = node.children.filter(c => c.type === 'container' && c.name === 'step');
    const el = h('div.vx-steps');
    const saved = rctx.saved('widgets', id);
    let shown = Math.max(1, Math.min(items.length, saved?.shown || 1));
    const stepEls = items.map((s, i) => {
      const box = h('div.step', { dataset: { n: String(i + 1) } });
      if (s.label || s.attrs.title) box.append(h('div.step-title', { html: rctx.inline(s.label || s.attrs.title) }));
      rctx.children(s.children, box);
      return box;
    });
    const ctl = h('div.steps-ctl', { 'data-vh-skip': '' });
    const render = () => {
      stepEls.forEach((s, i) => { s.hidden = i >= shown; });
      ctl.replaceChildren(
        shown < items.length
          ? h('button.btn.btn-tonal.btn-sm', { onClick: () => { shown++; rctx.report('widgets', id, { shown }); render(); } }, h('span', t('steps.next')), icon('arrow-down'))
          : h('span', icon('check', { width: 14, height: 14 }), ' ', t('steps.done')),
        h('span', `${shown} / ${items.length}`),
        shown > 1 ? h('button.btn.btn-sm', { onClick: () => { shown = 1; rctx.report('widgets', id, { shown }); render(); } }, t('steps.reset')) : null);
    };
    el.append(...stepEls, ctl);
    render();
    return el;
  },
};

export const toc = {
  markable: false,
  render(node, rctx) {
    const box = h('nav.vx-toc', { 'data-vh-skip': '' }, h('div.toc-title', node.label || t('toc')));
    const depth = Number(node.attrs.depth || 3);
    queueMicrotask(() => {
      const heads = rctx.article?.querySelectorAll('h2[id], h3[id], h4[id]') || [];
      for (const hd of heads) {
        const level = Number(hd.tagName[1]);
        if (level > depth) continue;
        box.append(h('a', {
          href: `#${hd.id}`, dataset: { level: String(level) },
          onClick: e => { e.preventDefault(); hd.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
        }, hd.textContent));
      }
    });
    return box;
  },
};

export const divider = {
  markable: false,
  render() { return h('div.vx-divider'); },
};
