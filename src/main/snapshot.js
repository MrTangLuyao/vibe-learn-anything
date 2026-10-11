/* ============================================================
 * src/main/snapshot.js — "undo what the AI just did".
 * Before an AI turn that may edit a course, the course's text files
 * are copied aside; afterwards diff() lists what changed and
 * restore() puts everything back (new files are removed).
 * Big or binary files are only fingerprinted, never copied.
 * ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { P } from './paths.js';

const snaps = new Map();
const MAX_COPY = 2_000_000;
const BINARY = /\.(pdf|png|jpe?g|gif|webp|bmp|ico|svgz|mp4|webm|mov|mkv|mp3|wav|ogg|flac|zip|vla|docx?|pptx?|xlsx?|woff2?|ttf|otf|exe|dll|so|dylib|o|obj|class|jar|pyc|wasm)$/i;

function skip(rel) {
  if (rel.startsWith('.git/') || rel.includes('node_modules/')) return true;
  return rel.startsWith('learner/') && !rel.startsWith('learner/workspaces/');
}

function listFiles(dir) {
  const out = [];
  const visit = (abs, rel) => {
    let ents = [];
    try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (skip(e.isDirectory() ? `${r}/` : r)) continue;
      if (e.isDirectory()) visit(path.join(abs, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  visit(dir, '');
  return out;
}

export function take(dir) {
  const id = crypto.randomBytes(6).toString('hex');
  const root = path.join(P.temp, 'snapshots', id);
  const files = {};
  for (const rel of listFiles(dir)) {
    const abs = path.join(dir, rel);
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    const big = st.size > MAX_COPY || BINARY.test(rel);
    files[rel] = { size: st.size, mtime: st.mtimeMs, big };
    if (!big) {
      const dest = path.join(root, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(abs, dest);
    }
  }
  snaps.set(id, { dir, root, files, at: Date.now() });
  /* Keep the last few; older snapshots are deleted. */
  const old = [...snaps.entries()].sort((a, b) => b[1].at - a[1].at).slice(12);
  for (const [oid, s] of old) { snaps.delete(oid); fs.rm(s.root, { recursive: true, force: true }, () => {}); }
  return id;
}

function same(a, b) {
  try {
    const x = fs.readFileSync(a);
    const y = fs.readFileSync(b);
    return x.equals(y);
  } catch { return false; }
}

export function diff(id) {
  const s = snaps.get(id);
  if (!s) return null;
  const changed = [];
  const added = [];
  const removed = [];
  const now = new Set(listFiles(s.dir));
  for (const rel of now) {
    const before = s.files[rel];
    if (!before) { added.push(rel); continue; }
    let st;
    try { st = fs.statSync(path.join(s.dir, rel)); } catch { continue; }
    if (st.size === before.size && st.mtimeMs === before.mtime) continue;
    if (before.big || !same(path.join(s.dir, rel), path.join(s.root, rel))) changed.push(rel);
  }
  for (const rel of Object.keys(s.files)) if (!now.has(rel)) removed.push(rel);
  return { changed, added, removed };
}

export function restore(id) {
  const s = snaps.get(id);
  if (!s) throw new Error('this change can no longer be undone');
  const d = diff(id);
  for (const rel of [...d.changed, ...d.removed]) {
    if (s.files[rel]?.big) continue;
    const dest = path.join(s.dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(s.root, rel), dest);
  }
  for (const rel of d.added) {
    fs.rmSync(path.join(s.dir, rel), { force: true });
    /* Drop folders that only existed for the new files. */
    for (let p = path.dirname(path.join(s.dir, rel)); p.length > s.dir.length; p = path.dirname(p)) {
      try { fs.rmdirSync(p); } catch { break; }
    }
  }
  return d;
}
