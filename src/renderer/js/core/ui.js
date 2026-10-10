/* ============================================================
 * core/ui.js — toasts, dialogs, menus, tooltips.
 * ============================================================ */

import { h, icon, clear, onOutside, placeNear } from './dom.js';
import { t } from './i18n.js';

/* ─── Toast ─── */
export function toast(message, { type = 'info', actions = [], timeout = 4200, iconName } = {}) {
  const host = document.getElementById('toasts');
  const name = iconName || (type === 'ok' ? 'circle-check' : type === 'err' ? 'circle-alert' : 'info');
  const el = h(`div.toast.is-${type}`, icon(name), h('div.t-msg', message));
  const close = () => {
    if (!el.isConnected) return;
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 200);
  };
  if (actions.length) {
    el.append(h('div.t-actions', actions.map(a => h('button.btn.btn-sm.btn-tonal', { onClick: () => { close(); a.onClick?.(); } }, a.label))));
  }
  el.append(h('button.icon-btn.icon-btn-xs', { onClick: close, 'aria-label': t('close') }, icon('x')));
  host.append(el);
  if (timeout) setTimeout(close, actions.length ? timeout * 2 : timeout);
  return close;
}

/* ─── Dialog ─── */
let openDialogs = 0;

export function dialog({ title, sub, iconName, body, actions = [], wide = false, dismissible = true, onOpen }) {
  return new Promise(resolve => {
    let done = false;
    const scrim = h('div.scrim');
    const finish = value => {
      if (done) return;
      done = true;
      scrim.classList.add('is-closing');
      document.removeEventListener('keydown', onKey, true);
      setTimeout(() => { scrim.remove(); openDialogs--; }, 160);
      resolve(value);
    };
    const onKey = e => {
      if (e.key === 'Escape' && dismissible) { e.stopPropagation(); finish(null); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        const primary = actions.find(a => a.primary);
        if (primary) { e.preventDefault(); run(primary); }
      }
    };
    const run = async a => {
      if (a.onClick) {
        const r = await a.onClick();
        if (r === false) return;
        finish(r === undefined ? a.value : r);
      } else finish(a.value);
    };
    const box = h(`div.dialog${wide ? '.dialog-wide' : ''}`, { role: 'dialog', 'aria-modal': 'true' },
      h('div.dialog-head',
        iconName ? h('div.d-icon', icon(iconName)) : null,
        h('div.grow', h('div.dialog-title', title), sub ? h('div.dialog-sub', sub) : null)),
      body ? h('div.dialog-body', body) : null,
      actions.length ? h('div.dialog-foot', actions.map(a => h(`button.btn${a.primary ? '.btn-primary' : a.danger ? '.btn-danger.btn-solid' : '.btn-outline'}`, {
        onClick: () => run(a), disabled: a.disabled,
      }, a.icon ? icon(a.icon) : null, a.label))) : null);
    scrim.append(box);
    if (dismissible) scrim.addEventListener('pointerdown', e => { if (e.target === scrim) finish(null); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(scrim);
    openDialogs++;
    const focusable = box.querySelector('input, textarea, select') || box.querySelector('.btn-primary');
    setTimeout(() => focusable?.focus(), 30);
    onOpen?.(box, finish);
  });
}

export function isDialogOpen() {
  return openDialogs > 0;
}

export function confirm({ title, message, ok = t('ok'), cancel = t('cancel'), danger = false, iconName }) {
  return dialog({
    title,
    iconName: iconName || (danger ? 'triangle-alert' : 'circle-help'),
    body: message ? h('p', message) : null,
    actions: [{ label: cancel, value: false }, { label: ok, value: true, primary: !danger, danger }],
  }).then(v => v === true);
}

export function prompt({ title, label, value = '', placeholder = '', multiline = false, ok = t('ok'), iconName, hint }) {
  const input = multiline
    ? h('textarea.textarea', { rows: 4, placeholder, value })
    : h('input.input', { placeholder, value });
  return dialog({
    title,
    iconName,
    body: h('div.field', label ? h('label', label) : null, input, hint ? h('div.field-hint', hint) : null),
    actions: [{ label: t('cancel'), value: null }, { label: ok, primary: true, onClick: () => input.value }],
    onOpen: (box, finish) => {
      if (!multiline) input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(input.value); });
      input.select?.();
    },
  });
}

/* ─── Menu ─── */
let openMenu = null;

export function closeMenu() {
  openMenu?.close();
}

/* items: [{ label, icon, onClick, danger, disabled, hint } | '-' | { title }] */
export function menu(anchor, items, opts = {}) {
  closeMenu();
  const el = h('div.menu', { role: 'menu' });
  for (const it of items.filter(Boolean)) {
    if (it === '-') { el.append(h('div.menu-sep')); continue; }
    if (it.title) { el.append(h('div.menu-title', it.title)); continue; }
    el.append(h(`button.menu-item${it.danger ? '.is-danger' : ''}`, {
      role: 'menuitem', disabled: it.disabled,
      onClick: () => { close(); it.onClick?.(); },
    }, it.icon ? icon(it.icon) : null, h('span', it.label), it.hint ? h('small', it.hint) : null));
  }
  document.body.append(el);
  placeNear(el, anchor, { align: opts.align || 'start' });
  const off = onOutside(el, () => close());
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  function close() {
    off();
    document.removeEventListener('keydown', onKey);
    el.remove();
    if (openMenu?.el === el) openMenu = null;
  }
  openMenu = { el, close };
  return close;
}

/* ─── Tooltips for anything with data-tip ─── */
export function bindTooltips() {
  let tip = null;
  let timer = null;
  const hide = () => { clearTimeout(timer); tip?.remove(); tip = null; };
  document.addEventListener('pointerover', e => {
    const el = e.target.closest('[data-tip]');
    if (!el) return;
    hide();
    timer = setTimeout(() => {
      if (!el.isConnected) return;
      tip = h('div.tooltip', el.dataset.tip);
      document.body.append(tip);
      placeNear(tip, el, { align: 'center', side: el.dataset.tipSide || 'bottom' });
    }, 380);
  });
  document.addEventListener('pointerout', e => { if (e.target.closest('[data-tip]')) hide(); });
  document.addEventListener('pointerdown', hide, true);
}

export function spinner(large = false) {
  return h(`span.spinner${large ? '.spinner-lg' : ''}`);
}

export function emptyState(iconName, title, text, ...actions) {
  return h('div.empty', icon(iconName), h('h3', title), text ? h('p', text) : null, actions.length ? h('div.row', actions) : null);
}

export function setChildren(el, ...children) {
  clear(el);
  el.append(...children.flat().filter(Boolean));
  return el;
}
