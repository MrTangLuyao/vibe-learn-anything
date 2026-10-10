/* Inline directives that need behaviour: :btn[] :ask[] :file[] :link[] :icon[] */
import { icon } from '../core/dom.js';
import { lookupAction, actionIcon } from '../actions.js';

function attrsOf(el) {
  try { return JSON.parse(el.dataset.attrs || '{}'); } catch { return {}; }
}

export function hydrateInline(el, rctx) {
  const a = attrsOf(el);
  const lesson = rctx.page.lesson;
  switch (el.dataset.vtInline) {
    case 'icon':
      el.replaceChildren(icon(String(a.name || 'circle')));
      if (a.color) el.style.color = a.color;
      break;
    case 'btn': {
      const action = lookupAction(a.action, { fm: rctx.fm, course: rctx.course });
      el.prepend(icon(a.icon || actionIcon(action)));
      el.setAttribute('data-vh-skip', '');
      el.addEventListener('click', e => { e.preventDefault(); lesson?.runAction(a.action, { anchor: el }); });
      break;
    }
    case 'ask':
      el.prepend(icon('sparkles'));
      el.setAttribute('data-vh-skip', '');
      el.addEventListener('click', e => {
        e.preventDefault();
        lesson?.ask(a.prompt || el.textContent.trim(), { anchor: el, context: a.context });
      });
      break;
    case 'file': {
      el.prepend(icon('paperclip'));
      const rel = a.src ? rctx.rel(a.src) : null;
      el.addEventListener('click', e => { e.preventDefault(); if (rel) window.vla.course.openFile(rctx.courseId, rel); });
      el.addEventListener('contextmenu', e => { e.preventDefault(); if (rel) window.vla.course.saveFileAs(rctx.courseId, rel); });
      break;
    }
    case 'link':
      el.addEventListener('click', e => {
        e.preventDefault();
        if (a.url) window.vla.app.openExternal(a.url);
        else lesson?.goto({ page: a.page ? rctx.rel(a.page) : undefined, chapter: a.chapter });
      });
      break;
    default:
      break;
  }
  return el;
}

