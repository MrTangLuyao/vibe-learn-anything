/* ============================================================
 * src/main/watch.js — live reload. The open course folder is watched;
 * when something outside the app (an AI agent, the MCP server, an
 * editor) changes a file, the page gets "course:changed" with the
 * course-relative paths. Writes the app makes itself are skipped.
 * ============================================================ */

import fs from 'node:fs';
import path from 'node:path';

const watchers = new Map();
const selfFiles = new Map();
const selfDirs = new Map();
const SELF_MS = 2500;

const key = p => path.resolve(p).toLowerCase();

/* The app is about to write this file (or everything under this folder). */
export function markSelf(abs, { dir = false } = {}) {
  (dir ? selfDirs : selfFiles).set(key(abs), Date.now());
}

function isSelf(abs) {
  const k = key(abs);
  const now = Date.now();
  const t = selfFiles.get(k);
  if (t && now - t < SELF_MS) return true;
  for (const [d, at] of selfDirs) {
    if (now - at > SELF_MS) { selfDirs.delete(d); continue; }
    if (k === d || k.startsWith(d + path.sep)) return true;
  }
  return false;
}

function ignored(rel) {
  if (!rel || rel.startsWith('.git/') || rel.includes('/node_modules/')) return true;
  /* Learner records change all the time; only workspace code is interesting. */
  return rel.startsWith('learner/') && !rel.startsWith('learner/workspaces/');
}

export function unwatch(wc) {
  const w = watchers.get(wc.id);
  if (!w) return;
  clearTimeout(w.timer);
  try { w.watcher.close(); } catch { /* closed */ }
  watchers.delete(wc.id);
}

export function watchCourse(wc, id, dir) {
  unwatch(wc);
  if (!id || !dir || !fs.existsSync(dir)) return false;
  const state = { id, dir, paths: new Set(), timer: null, watcher: null };
  const flush = () => {
    state.timer = null;
    const paths = [...state.paths];
    state.paths.clear();
    if (paths.length && !wc.isDestroyed()) wc.send('course:changed', { id, paths });
  };
  try {
    state.watcher = fs.watch(dir, { recursive: true }, (_event, name) => {
      if (!name) return;
      const rel = String(name).replace(/\\/g, '/');
      if (ignored(rel) || isSelf(path.join(dir, name))) return;
      state.paths.add(rel);
      clearTimeout(state.timer);
      state.timer = setTimeout(flush, 300);
    });
    state.watcher.on('error', () => unwatch(wc));
  } catch {
    return false;
  }
  watchers.set(wc.id, state);
  wc.once('destroyed', () => unwatch(wc));
  return true;
}
