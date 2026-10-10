/* ============================================================
 * core/router.js — hash routes.
 *   #/                         dashboard
 *   #/course/<id>              chapter selection
 *   #/learn/<id>/<chapter>/<n> a page of a chapter (n = 1-based)
 *   #/settings                 settings
 *   #/help/<doc>               help & manual
 * A view module exports mount(el, params) → { update?(params) → bool, unmount?() }.
 * ============================================================ */

import { clear } from './dom.js';
import { bus } from './store.js';

const routes = [];
let current = null;
let guard = null;

export function route(pattern, load) {
  const keys = [];
  let src = '^';
  for (const seg of pattern.split('/').filter(Boolean)) {
    const m = /^:(\w+)(\?)?$/.exec(seg);
    if (m) { keys.push(m[1]); src += m[2] ? '(?:/([^/]+))?' : '/([^/]+)'; }
    else src += '/' + seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  routes.push({ pattern, re: new RegExp(`${src}/?$`), keys, load });
}

export function go(path, { replace = false } = {}) {
  const hash = '#' + (path.startsWith('/') ? path : '/' + path);
  if (location.hash === hash) { resolve(); return; }
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
  if (replace) resolve();
}

export function currentPath() {
  return decodeURI(location.hash.replace(/^#/, '') || '/');
}

/* A view may veto navigation (unsaved edits). */
export function setGuard(fn) {
  guard = fn;
}

let lastPath = null;

async function resolve() {
  const path = currentPath();
  if (guard && lastPath !== null && path !== lastPath) {
    const ok = await guard(path);
    if (!ok) { history.replaceState(null, '', '#' + lastPath); return; }
  }
  lastPath = path;
  for (const r of routes) {
    const m = r.re.exec(path);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = m[i + 1] ? decodeURIComponent(m[i + 1]) : undefined; });
    const host = document.getElementById('view');
    if (current && current.pattern === r.pattern && current.instance?.update) {
      const handled = await current.instance.update(params);
      if (handled !== false) { bus.emit('route', { path, params }); return; }
    }
    current?.instance?.unmount?.();
    guard = null;
    clear(host);
    host.className = '';
    const mod = await r.load();
    const instance = await mod.mount(host, params);
    current = { pattern: r.pattern, instance };
    bus.emit('route', { path, params });
    return;
  }
  go('/', { replace: true });
}

export function startRouter() {
  window.addEventListener('hashchange', resolve);
  resolve();
}
