/* ============================================================
 * src/main/library.js — the course library.
 * Each imported course lives unpacked in <profile>/library/<id>/
 * (pages as *.vitent folders). Exporting packs it back into a .vla.
 * ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { shell } from 'electron';
import { P } from './paths.js';
import {
  extractVla, expandVitents, packVla, readJson, writeJson, normalizeCourse, allPages, pageMeta,
  normalizeAnnotations, mergeAnnotations, emptyAnnotations, safeJoin, sanitizeId, normRel, pageKey,
  validateCourseDir,
} from '../shared/vla-core.mjs';

const pending = new Map();

function courseDir(id) {
  const clean = sanitizeId(id);
  if (!clean || clean !== id) throw new Error(`bad course id: ${id}`);
  return path.join(P.library, clean);
}

function loadIndex() {
  return readJson(P.index, { courses: {} });
}

function saveIndex(idx) {
  writeJson(P.index, idx);
}

function touchIndex(id, patch) {
  const idx = loadIndex();
  idx.courses[id] = { ...(idx.courses[id] || { id, importedAt: new Date().toISOString() }), ...patch };
  saveIndex(idx);
}

export function stateFile(id) {
  return path.join(P.state, `${id}.json`);
}

export function getState(id) {
  return readJson(stateFile(id), { seen: [] });
}

export function saveState(id, state) {
  writeJson(stateFile(id), state);
}

function loadCourseRaw(dir) {
  return normalizeCourse(readJson(path.join(dir, 'course.json')));
}

function progressOf(dir) {
  return readJson(path.join(dir, 'learner', 'progress.json'), { vla_progress: 1, pages: {} });
}

function annotationsOf(dir) {
  return normalizeAnnotations(readJson(path.join(dir, 'annotations.json'), emptyAnnotations()));
}

/* ─── listing ─── */

export function list() {
  fs.mkdirSync(P.library, { recursive: true });
  const idx = loadIndex();
  const out = [];
  for (const ent of fs.readdirSync(P.library, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(P.library, ent.name);
    let course;
    try { course = loadCourseRaw(dir); } catch { continue; }
    const meta = idx.courses[ent.name] || {};
    const pages = allPages(course);
    const prog = progressOf(dir);
    const done = pages.filter(p => prog.pages?.[p.page.src]?.completed).length;
    const ann = annotationsOf(dir);
    const seen = new Set(getState(ent.name).seen || []);
    let unseen = 0;
    let waiting = 0;
    for (const h of ann.highlights) {
      if ((h.kind === 'ask' || h.kind === 'revise') && h.status === 'open') waiting++;
      for (const c of h.comments) if (c.author === 'answer' && !seen.has(c.id)) unseen++;
    }
    out.push({
      id: ent.name,
      title: course.title,
      code: course.code || '',
      subtitle: course.subtitle || '',
      color: course.color,
      icon: course.icon || '',
      term: course.term || '',
      version: course.version,
      archived: !!meta.archived,
      importedAt: meta.importedAt || '',
      lastOpened: meta.lastOpened || '',
      order: meta.order ?? 0,
      total: pages.length,
      done,
      unseen,
      waiting,
    });
  }
  out.sort((a, b) => (a.order - b.order) || String(b.lastOpened || b.importedAt).localeCompare(String(a.lastOpened || a.importedAt)));
  return out;
}

/* ─── import / update ─── */

function freshTemp(prefix) {
  const dir = path.join(P.temp, `${prefix}-${crypto.randomBytes(5).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function importVla(file) {
  const tmp = freshTemp('import');
  try {
    extractVla(file, tmp);
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error(`无法读取课程文件 / cannot read the course file: ${e.message}`);
  }
  if (!fs.existsSync(path.join(tmp, 'course.json'))) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error('course.json missing — this is not a .vla course');
  }
  const course = loadCourseRaw(tmp);
  const issues = validateCourseDir(tmp).filter(i => i.level === 'error');
  const id = course.id;
  if (fs.existsSync(courseDir(id))) {
    const token = crypto.randomBytes(8).toString('hex');
    pending.set(token, { tmp, id });
    const existing = loadCourseRaw(courseDir(id));
    return {
      conflict: true, token, id, title: course.title,
      existingVersion: existing.version, incomingVersion: course.version, errors: issues.length,
    };
  }
  install(tmp, id);
  return { id, title: course.title, action: 'imported', errors: issues.length };
}

function install(tmp, id) {
  fs.mkdirSync(P.library, { recursive: true });
  const dest = courseDir(id);
  fs.renameSync(tmp, dest);
  touchIndex(id, { importedAt: new Date().toISOString(), archived: false });
}

function mergeProgress(local, incoming) {
  const out = { vla_progress: 1, pages: { ...(incoming.pages || {}) }, last: local.last || incoming.last };
  for (const [src, p] of Object.entries(local.pages || {})) {
    const inc = out.pages[src] || {};
    out.pages[src] = {
      ...inc,
      ...p,
      completed: p.completed || inc.completed || null,
      quiz: { ...(inc.quiz || {}), ...(p.quiz || {}) },
      tests: { ...(inc.tests || {}), ...(p.tests || {}) },
      widgets: { ...(inc.widgets || {}), ...(p.widgets || {}) },
    };
  }
  return out;
}

function copyMissing(src, dest) {
  if (!fs.existsSync(src)) return;
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyMissing(s, d); }
    else if (!fs.existsSync(d)) { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); }
  }
}

/* Replace content with the incoming version; keep the learner's own data. */
function updateInPlace(tmp, id) {
  const dest = courseDir(id);
  const localAnn = annotationsOf(dest);
  const localProg = progressOf(dest);
  const incomingAnn = annotationsOf(tmp);
  const incomingProg = progressOf(tmp);
  for (const ent of fs.readdirSync(dest)) {
    if (ent === 'learner' || ent === 'annotations.json') continue;
    fs.rmSync(path.join(dest, ent), { recursive: true, force: true });
  }
  for (const ent of fs.readdirSync(tmp)) {
    if (ent === 'learner' || ent === 'annotations.json') continue;
    fs.renameSync(path.join(tmp, ent), path.join(dest, ent));
  }
  copyMissing(path.join(tmp, 'learner'), path.join(dest, 'learner'));
  writeJson(path.join(dest, 'annotations.json'), mergeAnnotations(localAnn, incomingAnn));
  writeJson(path.join(dest, 'learner', 'progress.json'), mergeProgress(localProg, incomingProg));
  fs.rmSync(tmp, { recursive: true, force: true });
  touchIndex(id, { updatedAt: new Date().toISOString() });
}

export function resolveImport(token, mode) {
  const job = pending.get(token);
  if (!job) throw new Error('import expired');
  pending.delete(token);
  if (mode === 'cancel') { fs.rmSync(job.tmp, { recursive: true, force: true }); return { action: 'cancelled' }; }
  if (mode === 'update') { updateInPlace(job.tmp, job.id); return { id: job.id, action: 'updated' }; }
  let n = 2;
  while (fs.existsSync(courseDir(`${job.id}-${n}`))) n++;
  const id = `${job.id}-${n}`;
  const cj = readJson(path.join(job.tmp, 'course.json'));
  cj.id = id;
  cj.title = `${cj.title} (${n})`;
  writeJson(path.join(job.tmp, 'course.json'), cj);
  install(job.tmp, id);
  return { id, action: 'imported' };
}

/* Re-read a course after something outside the app (an AI agent) edited it. */
export function refresh(id) {
  expandVitents(courseDir(id));
  return true;
}

export function exportVla(id, outFile) {
  return packVla(courseDir(id), outFile);
}

export async function remove(id) {
  const dir = courseDir(id);
  try { await shell.trashItem(dir); } catch { fs.rmSync(dir, { recursive: true, force: true }); }
  const idx = loadIndex();
  delete idx.courses[id];
  saveIndex(idx);
  fs.rmSync(stateFile(id), { force: true });
}

export function setMeta(id, patch) {
  courseDir(id);
  const allowed = {};
  for (const k of ['archived', 'order', 'lastOpened']) if (k in patch) allowed[k] = patch[k];
  touchIndex(id, allowed);
}

export function dirOf(id) {
  return courseDir(id);
}

/* ─── one course ─── */

export function getCourse(id) {
  const dir = courseDir(id);
  if (!fs.existsSync(dir)) throw new Error(`course ${id} not found`);
  const course = loadCourseRaw(dir);
  for (const { page } of allPages(course)) {
    try { if (fs.statSync(safeJoin(dir, page.src)).isFile()) { expandVitents(dir); break; } } catch { /* reported below */ }
  }
  const metas = {};
  for (const { page } of allPages(course)) metas[page.src] = pageMeta(dir, page.src);
  if (course.overview) metas[normRel(course.overview)] = pageMeta(dir, normRel(course.overview));
  touchIndex(id, { lastOpened: new Date().toISOString() });
  return {
    id,
    dir,
    course,
    metas,
    progress: progressOf(dir),
    annotations: annotationsOf(dir),
    state: getState(id),
  };
}

export function readText(id, rel) {
  return fs.readFileSync(safeJoin(courseDir(id), rel), 'utf8');
}

export function readBinary(id, rel) {
  return fs.readFileSync(safeJoin(courseDir(id), rel));
}

export function exists(id, rel) {
  try { return fs.existsSync(safeJoin(courseDir(id), rel)); } catch { return false; }
}

export function absPath(id, rel) {
  return safeJoin(courseDir(id), rel || '.');
}

export function savePage(id, src, text) {
  const file = safeJoin(courseDir(id), path.posix.join(normRel(src), 'index.md'));
  fs.writeFileSync(file, text);
  return true;
}

export function saveAnnotations(id, data) {
  writeJson(path.join(courseDir(id), 'annotations.json'), normalizeAnnotations(data));
  return true;
}

export function saveProgress(id, data) {
  writeJson(path.join(courseDir(id), 'learner', 'progress.json'), { vla_progress: 1, ...data });
  return true;
}

/* ─── code workspaces: learner/workspaces/<pageKey>/<wsId>/ ─── */

function wsRoot(id, pageSrc, wsId) {
  const safeWs = String(wsId).replace(/[^\w.-]+/g, '-');
  return path.join(courseDir(id), 'learner', 'workspaces', pageKey(pageSrc), safeWs);
}

function listTree(root) {
  const out = [];
  const visit = (abs, rel) => {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) { out.push({ path: r, dir: true }); visit(path.join(abs, ent.name), r); }
      else out.push({ path: r, dir: false, size: fs.statSync(path.join(abs, ent.name)).size });
    }
  };
  if (fs.existsSync(root)) visit(root, '');
  return out;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function writeStarter(root, id, pageSrc, starter) {
  fs.mkdirSync(root, { recursive: true });
  if (starter.dir) {
    const src = safeJoin(safeJoin(courseDir(id), pageSrc), starter.dir);
    if (fs.existsSync(src)) copyDir(src, root);
  }
  for (const f of starter.files || []) {
    const target = safeJoin(root, f.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.content ?? '');
  }
}

export function wsInit(id, pageSrc, wsId, starter = {}) {
  const root = wsRoot(id, pageSrc, wsId);
  if (!fs.existsSync(root) || !fs.readdirSync(root).length) writeStarter(root, id, pageSrc, starter);
  return { root, tree: listTree(root) };
}

export function wsReset(id, pageSrc, wsId, starter = {}) {
  const root = wsRoot(id, pageSrc, wsId);
  fs.rmSync(root, { recursive: true, force: true });
  writeStarter(root, id, pageSrc, starter);
  return { root, tree: listTree(root) };
}

export function wsList(id, pageSrc, wsId) {
  return listTree(wsRoot(id, pageSrc, wsId));
}

export function wsRead(id, pageSrc, wsId, rel) {
  return fs.readFileSync(safeJoin(wsRoot(id, pageSrc, wsId), rel), 'utf8');
}

export function wsWrite(id, pageSrc, wsId, rel, content) {
  const f = safeJoin(wsRoot(id, pageSrc, wsId), rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content ?? '');
  return true;
}

export function wsDelete(id, pageSrc, wsId, rel) {
  fs.rmSync(safeJoin(wsRoot(id, pageSrc, wsId), rel), { recursive: true, force: true });
  return true;
}

export function wsRename(id, pageSrc, wsId, from, to) {
  const root = wsRoot(id, pageSrc, wsId);
  const dest = safeJoin(root, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(safeJoin(root, from), dest);
  return true;
}

export function wsPath(id, pageSrc, wsId) {
  return wsRoot(id, pageSrc, wsId);
}

/* First launch: import the bundled example courses. */
export function seedExamples() {
  fs.mkdirSync(P.library, { recursive: true });
  if (fs.readdirSync(P.library).length || !fs.existsSync(P.examples)) return [];
  const done = [];
  for (const f of fs.readdirSync(P.examples)) {
    if (!f.endsWith('.vla')) continue;
    try { const r = importVla(path.join(P.examples, f)); if (r.conflict) resolveImport(r.token, 'cancel'); else done.push(r.id); } catch { /* skip broken example */ }
  }
  return done;
}
