/* ============================================================
 * appbar.js — the window title bar: brand, breadcrumbs, slots and
 * the global buttons (theme, language, settings, help).
 * ============================================================ */

import { h, icon, clear, append } from './core/dom.js';
import { t, getLang } from './core/i18n.js';
import { state, saveSettings, bus } from './core/store.js';
import { go } from './core/router.js';
import { menu } from './core/ui.js';
import { toggleChat, isChatOpen } from './chat.js';

let cfg = { crumbs: [], left: [], right: [], page: 'learn' };

function themeIcon() {
  const pref = state.settings?.theme || 'dark';
  return pref === 'light' ? 'sun' : pref === 'system' ? 'sun-moon' : 'moon';
}

function cycleTheme() {
  const order = ['dark', 'light', 'system'];
  const pref = state.settings?.theme || 'dark';
  return saveSettings({ theme: order[(order.indexOf(pref) + 1) % order.length] });
}

export function renderAppbar() {
  const bar = document.getElementById('appbar');
  clear(bar);
  const brand = h('button.brand', { onClick: () => go('/'), 'data-tip': t('home') },
    h('span', 'vibe'), h('span.b-dot', '.'), h('span.b-page', cfg.page || 'learn'));
  const crumbs = h('nav.ab-crumbs');
  cfg.crumbs.forEach((c, i) => {
    crumbs.append(h('span.sep', '/'));
    if (c.href && i < cfg.crumbs.length - 1) crumbs.append(h('button.crumb', { onClick: () => go(c.href) }, c.label));
    else crumbs.append(h('b.ellipsis', c.label));
  });
  const aiBtn = h(`button.chip-btn.ai-btn${isChatOpen() ? '.is-active' : ''}`, {
    onClick: () => toggleChat(),
    'data-tip': t('chat.tip'),
  }, icon('sparkles'), h('span', 'AI'));
  const themeBtn = h('button.icon-btn.icon-btn-sm', {
    onClick: () => cycleTheme(),
    'data-tip': t('theme.' + (state.settings?.theme || 'dark')),
  }, icon(themeIcon()));
  const langBtn = h('button.chip-btn.lang-btn', {
    onClick: () => saveSettings({ lang: getLang() === 'zh' ? 'en' : 'zh' }).then(() => location.reload()),
    'data-tip': t('lang.switch'),
  }, icon('languages'), h('span', getLang() === 'zh' ? 'EN' : '文'));
  const moreBtn = h('button.icon-btn.icon-btn-sm', {
    'data-tip': t('more'),
    onClick: e => menu(e.currentTarget, [
      { label: t('settings'), icon: 'settings', onClick: () => go('/settings') },
      { label: t('help'), icon: 'book-open', onClick: () => go('/help') },
      { label: t('ai.workspace.open'), icon: 'folder-open', onClick: () => window.vla.kit.open() },
      '-',
      { label: t('fullscreen'), icon: 'maximize', onClick: () => window.vla.app.fullscreen() },
    ], { align: 'end' }),
  }, icon('ellipsis-vertical'));
  append(bar, [
    brand,
    crumbs,
    h('div.ab-slot', cfg.left),
    h('div.ab-spacer'),
    h('div.ab-slot', cfg.right),
    cfg.right?.length ? h('div.ab-divider') : null,
    aiBtn,
    themeBtn,
    langBtn,
    h('button.icon-btn.icon-btn-sm', { onClick: () => go('/settings'), 'data-tip': t('settings') }, icon('settings')),
    moreBtn,
  ]);
}

export function setAppbar(next) {
  cfg = { crumbs: [], left: [], right: [], page: 'learn', ...next };
  renderAppbar();
}

bus.on('settings', () => renderAppbar());
bus.on('chat:toggle', () => renderAppbar());
