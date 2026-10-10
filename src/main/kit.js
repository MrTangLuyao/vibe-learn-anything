/* ============================================================
 * src/main/kit.js — the AI workspace (default: Documents/VibeLearn).
 * Holds a copy of the AI manual, generate_course.md and tools/vla.mjs
 * so any AI agent opened there can interview the learner and build
 * .vla files.  out/ is watched: a new .vla there is offered for import.
 *
 *   VibeLearn/
 *     AGENTS.md  generate_course.md  ai_manual/  tools/vla.mjs
 *     courses/   ← course sources the AI writes
 *     inbox/     ← .vla exported from the app for the AI to process
 *     out/       ← finished .vla files (the app offers to import them)
 * ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { P } from './paths.js';
import * as settings from './settings.js';

let watcher = null;
const timers = new Map();

export function workDir() {
  return settings.get('workDir') || P.defaultWorkDir;
}

function copyInto(src, dest) {
  if (!fs.existsSync(src)) return;
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) copyInto(path.join(src, name), path.join(dest, name));
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

export function prepare() {
  const dir = workDir();
  for (const sub of ['courses', 'inbox', 'out']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  if (fs.existsSync(P.kit)) {
    for (const name of fs.readdirSync(P.kit)) copyInto(path.join(P.kit, name), path.join(dir, name));
  }
  return dir;
}

export function isPrepared() {
  return fs.existsSync(path.join(workDir(), 'generate_course.md'));
}

export function watch(wc) {
  stop();
  const out = path.join(workDir(), 'out');
  if (!fs.existsSync(out)) return;
  try {
    watcher = fs.watch(out, (event, name) => {
      if (!name || !name.toLowerCase().endsWith('.vla')) return;
      const file = path.join(out, name);
      clearTimeout(timers.get(file));
      timers.set(file, setTimeout(() => {
        timers.delete(file);
        let size = -1;
        try { size = fs.statSync(file).size; } catch { return; }
        setTimeout(() => {
          try { if (fs.statSync(file).size !== size) return; } catch { return; }
          if (!wc.isDestroyed()) wc.send('kit:vla', { file, name });
        }, 600);
      }, 500));
    });
  } catch { watcher = null; }
}

export function stop() {
  if (watcher) { watcher.close(); watcher = null; }
}
