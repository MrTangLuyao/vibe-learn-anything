/* ============================================================
 * core/dom.js — tiny DOM helpers, icons, and the global ripple.
 * ============================================================ */

import * as lucide from 'lucide';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* h('button.btn.btn-primary', { onClick, dataset: {x: 1} }, 'Text', child) */
export function h(tag, props, ...children) {
  let name = tag;
  let classes = [];
  let id = null;
  if (typeof tag === 'string') {
    const parts = tag.split(/(?=[.#])/);
    name = parts[0] || 'div';
    for (const p of parts.slice(1)) {
      if (p[0] === '.') classes.push(p.slice(1));
      else if (p[0] === '#') id = p.slice(1);
    }
  }
  const svg = name === 'svg' || name === 'path';
  const el = svg ? document.createElementNS('http://www.w3.org/2000/svg', name) : document.createElement(name);
  if (id) el.id = id;
  if (classes.length) el.classList.add(...classes);
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') { for (const c of String(v).split(/\s+/).filter(Boolean)) el.classList.add(c); }
      else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText += v;
        else for (const [sk, sv] of Object.entries(v)) { if (sv != null) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'ref' && typeof v === 'function') v(el);
      else if (v === true) el.setAttribute(k, '');
      else if (k in el && !svg && k !== 'list' && k !== 'form') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/* Views build children with `cond ? node : null`. Native append() would
   print "null", so the node-inserting methods skip null/undefined/false. */
export function installNullSafeDom() {
  const skip = v => v !== null && v !== undefined && v !== false;
  for (const proto of [Element.prototype, DocumentFragment.prototype, Document.prototype]) {
    for (const name of ['append', 'prepend', 'replaceChildren']) {
      const native = proto[name];
      if (!native || native.__nullSafe) continue;
      const wrapped = function (...nodes) { return native.apply(this, nodes.flat().filter(skip)); };
      wrapped.__nullSafe = true;
      proto[name] = wrapped;
    }
  }
  for (const name of ['after', 'before', 'replaceWith']) {
    const native = Element.prototype[name];
    if (!native || native.__nullSafe) continue;
    const wrapped = function (...nodes) { return native.apply(this, nodes.flat().filter(skip)); };
    wrapped.__nullSafe = true;
    Element.prototype[name] = wrapped;
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

const pascal = name => String(name || '').replace(/(^|[-_ ])(\w)/g, (_, __, c) => c.toUpperCase());

/* Lucide icon by kebab name ("message-circle"). Unknown → circle-help. */
export function icon(name, attrs = {}) {
  const node = lucide[pascal(name)] || lucide.CircleHelp || lucide.Circle;
  const el = lucide.createElement(node, { width: 18, height: 18, 'stroke-width': 2, 'aria-hidden': 'true', ...attrs });
  el.classList.add('i', `i-${name}`);
  return el;
}

/* Course-supplied icon: lucide name, or a path/URL to an image. */
export function anyIcon(spec, resolveUrl) {
  if (!spec) return icon('circle');
  if (/[/.]/.test(spec) && resolveUrl) {
    return h('img', { src: resolveUrl(spec), alt: '', style: { width: '18px', height: '18px', objectFit: 'contain', position: 'relative', zIndex: 1 } });
  }
  return icon(spec);
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function debounce(fn, ms = 300) {
  let t = null;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.flush = (...args) => { clearTimeout(t); fn(...args); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function uid(prefix = 'x') {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function onOutside(el, fn) {
  const handler = e => { if (!el.contains(e.target)) fn(e); };
  setTimeout(() => document.addEventListener('pointerdown', handler, true), 0);
  return () => document.removeEventListener('pointerdown', handler, true);
}

export function placeNear(el, anchor, { gap = 6, align = 'start', side = 'bottom' } = {}) {
  const r = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
  el.style.left = '0px';
  el.style.top = '0px';
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  let x = align === 'end' ? r.right - w : align === 'center' ? r.left + r.width / 2 - w / 2 : r.left;
  let y = side === 'top' ? r.top - hgt - gap : r.bottom + gap;
  if (y + hgt > window.innerHeight - 8) y = Math.max(8, r.top - hgt - gap);
  if (y < 8) y = 8;
  x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
}

/* ─── Ripple: every button, link-card and .rp element ─── */

const RIPPLE_SEL = 'button, .rp, a.card, [role="button"], summary';

function createRipple(el, x, y) {
  if (el.dataset.noRipple != null || el.disabled) return;
  const cs = getComputedStyle(el);
  if (cs.position === 'static') el.style.position = 'relative';
  if (cs.overflow === 'visible') el.style.overflow = 'hidden';
  const rect = el.getBoundingClientRect();
  const d = Math.max(rect.width, rect.height);
  const circle = document.createElement('span');
  circle.className = 'ripple';
  circle.style.width = circle.style.height = `${d}px`;
  circle.style.left = `${x - rect.left - d / 2}px`;
  circle.style.top = `${y - rect.top - d / 2}px`;
  el.querySelector(':scope > .ripple')?.remove();
  el.appendChild(circle);
  circle.addEventListener('animationend', () => circle.remove());
}

export function bindRipples() {
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const el = e.target.closest(RIPPLE_SEL);
    if (!el || el.closest('.monaco-editor, .xterm, .no-ripple')) return;
    createRipple(el, e.clientX, e.clientY);
  }, { passive: true });
}

export function fmtDate(iso, lang = 'zh') {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(lang === 'en' ? 'en-AU' : 'zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function relTime(iso, lang = 'zh') {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lang === 'en' ? 'en' : 'zh', { numeric: 'auto' });
  if (Math.abs(diff) < 60) return rtf.format(-Math.round(diff), 'second');
  if (Math.abs(diff) < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (Math.abs(diff) < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  if (Math.abs(diff) < 86400 * 30) return rtf.format(-Math.round(diff / 86400), 'day');
  return fmtDate(iso, lang);
}

export function dragResize(handle, { axis = 'y', onMove, onEnd }) {
  handle.addEventListener('pointerdown', e => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('is-dragging');
    const start = axis === 'y' ? e.clientY : e.clientX;
    const move = ev => onMove((axis === 'y' ? ev.clientY : ev.clientX) - start, ev);
    const up = () => {
      handle.classList.remove('is-dragging');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      onEnd?.();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

export function storageGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}

export function storageSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
