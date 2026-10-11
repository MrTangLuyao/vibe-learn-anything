/* ============================================================
 * ai-context.js — "where is the learner right now?"
 * The current view registers a provider (course, chapter, page,
 * selected text); a focused code workspace registers its editor.
 * The AI panel reads currentContext(); the main process mirrors it
 * to live.json so the MCP server can answer get_current_context.
 * ============================================================ */

import { bus } from './core/store.js';
import { debounce } from './core/dom.js';

let provider = null;
let code = null;

const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n)}\n…(truncated)` : s || '');

function liveShape(c) {
  return {
    view: c.view,
    courseId: c.courseId,
    courseTitle: c.courseTitle,
    chapterId: c.chapterId,
    chapterTitle: c.chapterTitle,
    page: c.page,
    pageTitle: c.pageTitle,
    pageIndex: c.pageIndex,
    selection: c.selection ? { text: clip(c.selection, 4000), source: 'page' }
      : c.code?.selection ? { text: clip(c.code.selection, 4000), source: 'code' } : null,
    workspace: c.code ? {
      id: c.code.wsId, title: c.code.title, file: c.code.file, language: c.code.language,
      cursorLine: c.code.cursorLine, selection: c.code.selection || null, lines: c.code.lines || null,
      code: clip(c.code.code, 20000),
    } : null,
  };
}

const publish = debounce(() => {
  const c = currentContext();
  bus.emit('ai:context', c);
  try { window.vla.ai.live(liveShape(c)); } catch { /* not in the app */ }
}, 250);

export function contextChanged() {
  publish();
}

/* Write live.json right now — before handing a turn to the AI. */
export async function flushLive() {
  publish.cancel();
  const c = currentContext();
  bus.emit('ai:context', c);
  try { await window.vla.ai.live({ ...liveShape(c), now: true }); } catch { /* not in the app */ }
  return c;
}

export function setContextProvider(fn) {
  provider = fn;
  publish();
  return () => { if (provider === fn) { provider = null; publish(); } };
}

/* c: { owner, courseId, page, snapshot() → { wsId, title, file, language, cursorLine, selection, lines, code } } */
export function setCodeContext(c) {
  code = c;
  publish();
}

export function clearCodeContext(owner) {
  if (code?.owner === owner) { code = null; publish(); }
}

export function currentContext() {
  const base = provider ? provider() : { view: (location.hash.replace(/^#\/?/, '').split('/')[0] || 'dashboard') };
  let snap = null;
  if (code && (!base.courseId || code.courseId === base.courseId) && (!base.page || code.page === base.page)) {
    try { snap = { ...code.snapshot(), page: code.page }; } catch { snap = null; }
  }
  return { ...base, code: snap };
}
