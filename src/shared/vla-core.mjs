/* ============================================================
 * src/shared/vla-core.mjs
 * .vla / .vitent packaging + course model. Node only (used by the
 * Electron main process and by tools/vla.mjs).
 *
 * A .vla is a zip:  course.json, content/…/*.vitent (nested zips or
 * folders), assets/, annotations.json, learner/…
 * A .vitent is a zip (or a folder named *.vitent): index.md + any files.
 * ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { zipSync, unzipSync, strFromU8 } from 'fflate';
import { splitFrontmatter } from './vitent-parse.mjs';
import {
  validateVitentText, collectRefs, PAGE_KINDS, SLOTS, ACTION_TYPES, UI_COMMANDS, HIGHLIGHT_KINDS,
} from './directives.mjs';

export const FORMAT_VERSION = 1;

const JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\.git|node_modules|__MACOSX|\.vla-tmp[^/]*)(\/|$)/i;
const STORED = new Set([
  '.mp4', '.webm', '.mov', '.mkv', '.m4v', '.mp3', '.m4a', '.ogg', '.oga', '.wav', '.flac',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.zip', '.vitent', '.vla', '.gz', '.7z',
  '.woff', '.woff2', '.docx', '.pptx', '.xlsx',
]);
const LEARNER_BINARIES = new Set(['.exe', '.o', '.obj', '.out', '.pdb', '.ilk', '.class', '.pyc']);

export function normRel(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
}

export function safeJoin(base, rel) {
  const b = path.resolve(base);
  const target = path.resolve(b, normRel(rel));
  if (target !== b && !target.startsWith(b + path.sep)) throw new Error(`path escapes its folder: ${rel}`);
  return target;
}

export function isZip(u8) {
  return u8 && u8.length > 3 && u8[0] === 0x50 && u8[1] === 0x4b && (u8[2] === 3 || u8[2] === 5);
}

export function sanitizeId(id) {
  return String(id || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 64);
}

/* ─── zip ↔ folder ─── */

export function unzipToDir(u8, dest) {
  const entries = unzipSync(u8 instanceof Uint8Array ? u8 : new Uint8Array(u8));
  fs.mkdirSync(dest, { recursive: true });
  for (const [name, data] of Object.entries(entries)) {
    const rel = normRel(name);
    if (!rel || JUNK.test(rel)) continue;
    if (rel.endsWith('/')) { fs.mkdirSync(safeJoin(dest, rel), { recursive: true }); continue; }
    const out = safeJoin(dest, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, data);
  }
}

/* Every *.vitent zip file under `dir` becomes a *.vitent folder. */
export function expandVitents(dir) {
  let count = 0;
  const visit = abs => {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const a = path.join(abs, ent.name);
      if (ent.isDirectory()) { if (!JUNK.test(ent.name)) visit(a); continue; }
      if (!ent.isFile() || !ent.name.toLowerCase().endsWith('.vitent')) continue;
      const data = fs.readFileSync(a);
      if (!isZip(data)) continue;
      const tmp = a + '.vla-tmp';
      fs.rmSync(tmp, { recursive: true, force: true });
      unzipToDir(data, tmp);
      fs.rmSync(a, { force: true });
      fs.renameSync(tmp, a);
      count++;
    }
  };
  visit(dir);
  return count;
}

export function extractVla(file, dest) {
  const data = fs.readFileSync(file);
  if (!isZip(data)) throw new Error('not a .vla file (expected a zip archive)');
  unzipToDir(data, dest);
  expandVitents(dest);
  return dest;
}

/* Zip a folder. Folders named *.vitent become nested .vitent zips. */
export function zipDir(dir, { nestVitents = true, skipLearnerBinaries = true } = {}) {
  const files = {};
  const visit = (abs, rel) => {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (JUNK.test(r)) continue;
      const a = path.join(abs, ent.name);
      if (ent.isDirectory()) {
        if (nestVitents && ent.name.toLowerCase().endsWith('.vitent')) {
          files[r] = [zipDir(a, { nestVitents: false, skipLearnerBinaries }), { level: 0 }];
        } else {
          visit(a, r);
        }
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (skipLearnerBinaries && r.startsWith('learner/') && LEARNER_BINARIES.has(ext)) continue;
        files[r] = [new Uint8Array(fs.readFileSync(a)), { level: STORED.has(ext) ? 0 : 6 }];
      }
    }
  };
  visit(dir, '');
  return zipSync(files);
}

export function packVla(dir, outFile) {
  const buf = zipDir(dir, { nestVitents: true });
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(outFile, buf);
  return { file: outFile, bytes: buf.length };
}

/* ─── JSON helpers ─── */

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    if (fallback !== null || e.code === 'ENOENT') return fallback;
    throw e;
  }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

/* ─── Course model ─── */

function toPageRef(p) {
  if (typeof p === 'string') return { src: normRel(p) };
  if (p && typeof p === 'object') return { ...p, src: normRel(p.src || p.path || '') };
  return { src: '' };
}

export function normalizeCourse(raw) {
  const c = raw && typeof raw === 'object' ? { ...raw } : {};
  c.vla = c.vla ?? FORMAT_VERSION;
  c.title = String(c.title || c.id || 'Untitled course');
  c.id = sanitizeId(c.id || c.title) || 'course';
  c.version = String(c.version || '1.0.0');
  c.color = typeof c.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.color) ? c.color : '#d97757';
  let units = Array.isArray(c.units) ? c.units : [];
  if (!units.length && Array.isArray(c.chapters)) units = [{ id: 'main', title: '', chapters: c.chapters }];
  c.units = units.map((u, ui) => {
    const uid = String(u.id || `unit-${ui + 1}`);
    return {
      ...u,
      id: uid,
      title: String(u.title ?? `Unit ${ui + 1}`),
      chapters: (Array.isArray(u.chapters) ? u.chapters : []).map((ch, ci) => ({
        ...ch,
        id: String(ch.id || `${uid}-${ci + 1}`),
        title: String(ch.title || `Chapter ${ci + 1}`),
        pages: (Array.isArray(ch.pages) ? ch.pages : []).map(toPageRef).filter(p => p.src),
      })),
    };
  });
  delete c.chapters;
  c.actions = c.actions && typeof c.actions === 'object' ? c.actions : {};
  c.buttons = Array.isArray(c.buttons) ? c.buttons : [];
  c.runners = c.runners && typeof c.runners === 'object' ? c.runners : {};
  c.requirements = Array.isArray(c.requirements) ? c.requirements : [];
  return c;
}

export function allPages(course) {
  const out = [];
  for (const u of course.units) for (const ch of u.chapters) for (const p of ch.pages) out.push({ unit: u, chapter: ch, page: p });
  return out;
}

/* "content/w1/intro.vitent" → "content__w1__intro" (folder-safe key). */
export function pageKey(src) {
  return normRel(src).replace(/\.vitent$/i, '').replace(/[\/]+/g, '__').replace(/[^\w.-]+/g, '-');
}

/* Read index.md of a page whether it is a folder or a zipped .vitent. */
export function readPageText(courseDir, src) {
  const abs = safeJoin(courseDir, src);
  const st = fs.statSync(abs);
  if (st.isDirectory()) return fs.readFileSync(path.join(abs, 'index.md'), 'utf8');
  const entries = unzipSync(new Uint8Array(fs.readFileSync(abs)), { filter: f => normRel(f.name) === 'index.md' });
  if (!entries['index.md']) throw new Error('index.md missing');
  return strFromU8(entries['index.md']);
}

export function pageMeta(courseDir, src) {
  try {
    const { data } = splitFrontmatter(readPageText(courseDir, src));
    return { title: data.title, kind: data.kind, icon: data.icon, estimate: data.estimate };
  } catch {
    return { missing: true };
  }
}

/* ─── Annotations ─── */

export function emptyAnnotations() {
  return { vla_annotations: 1, highlights: [] };
}

export function normalizeAnnotations(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const highlights = (Array.isArray(a.highlights) ? a.highlights : []).filter(h => h && h.id).map(h => ({
    ...h,
    kind: HIGHLIGHT_KINDS.includes(h.kind) ? h.kind : 'yellow',
    targets: Array.isArray(h.targets) ? h.targets : [],
    comments: (Array.isArray(h.comments) ? h.comments : []).filter(c => c && c.id).map(c => ({
      ...c, author: c.author === 'answer' ? 'answer' : 'learner', text: String(c.text ?? ''),
    })),
    status: h.status || 'open',
  }));
  return { vla_annotations: 1, highlights };
}

/* Merge two annotation sets (local working copy + incoming .vla). */
export function mergeAnnotations(local, incoming) {
  const a = normalizeAnnotations(local);
  const b = normalizeAnnotations(incoming);
  const byId = new Map(a.highlights.map(h => [h.id, h]));
  for (const h of b.highlights) {
    const mine = byId.get(h.id);
    if (!mine) { byId.set(h.id, h); continue; }
    const newer = String(h.updated || '') >= String(mine.updated || '') ? h : mine;
    const older = newer === h ? mine : h;
    const comments = [...newer.comments];
    const seen = new Set(comments.map(c => c.id));
    for (const c of older.comments) if (!seen.has(c.id)) comments.push(c);
    byId.set(h.id, { ...older, ...newer, comments });
  }
  return { vla_annotations: 1, highlights: [...byId.values()] };
}

/* ─── Validation ─── */

function resolveRef(courseDir, pageDir, src) {
  const clean = normRel(String(src).split(/[?#]/)[0]);
  if (String(src).startsWith('@/')) return safeJoin(courseDir, clean.slice(2));
  return safeJoin(pageDir, clean);
}

function checkAction(id, a, where, add, actionIds) {
  if (typeof a === 'string') {
    if (!actionIds.has(a)) add('error', where, `action "${a}" is not defined in actions`);
    return;
  }
  if (!a || typeof a !== 'object') { add('error', where, `action ${id} must be an object or an action id`); return; }
  if (!ACTION_TYPES.includes(a.type)) add('error', where, `action ${id}: unknown type "${a.type}" (use ${ACTION_TYPES.join(', ')})`);
  if (a.type === 'exec' && !a.command) add('error', where, `action ${id}: exec needs command`);
  if (a.type === 'script' && !a.file) add('error', where, `action ${id}: script needs file`);
  if (a.type === 'http' && !a.url) add('error', where, `action ${id}: http needs url`);
  if (a.type === 'open' && !a.url && !a.path) add('error', where, `action ${id}: open needs url or path`);
  if (a.type === 'ui' && !UI_COMMANDS.includes(a.command)) add('error', where, `action ${id}: unknown ui command "${a.command}"`);
  if (a.type === 'goto' && !a.page && !a.chapter) add('error', where, `action ${id}: goto needs page or chapter`);
  if (a.type === 'sequence') for (const s of a.steps || []) checkAction(`${id}.step`, s, where, add, actionIds);
}

const BUILTIN_BUTTONS = new Set(['back', 'focus', 'prev', 'next', 'ai', 'highlight', 'edit', 'sidebar', 'notes', 'terminal']);

/* Buttons that override an existing id (built-in or course-level) may set only the fields they change. */
function checkButtons(buttons, where, add, actionIds, known = new Set()) {
  if (!Array.isArray(buttons)) { add('error', where, 'buttons must be a list'); return; }
  buttons.forEach((b, i) => {
    const w = `${where} buttons[${i}]`;
    if (!b.id) add('error', w, 'button needs id');
    if (b.hidden) return;
    if (BUILTIN_BUTTONS.has(b.id) || known.has(b.id)) {
      if (b.slot && !SLOTS.includes(b.slot)) add('error', w, `unknown slot "${b.slot}"`);
      if (b.action) checkAction(b.id, b.action, w, add, actionIds);
      return;
    }
    if (!SLOTS.includes(b.slot)) add('error', w, `unknown slot "${b.slot}" (use ${SLOTS.join(', ')})`);
    if (!b.action) add('error', w, 'button needs action');
    else checkAction(b.id, b.action, w, add, actionIds);
    if (!b.icon && !b.label) add('warn', w, 'button has neither icon nor label');
  });
}

export function validateCourseDir(dir) {
  const issues = [];
  const add = (level, where, msg) => issues.push({ level, where, msg });
  const file = path.join(dir, 'course.json');
  if (!fs.existsSync(file)) { add('error', 'course.json', 'missing course.json at the archive root'); return issues; }
  let raw;
  try { raw = readJson(file); } catch (e) { add('error', 'course.json', `invalid JSON: ${e.message}`); return issues; }
  if (!raw.id) add('error', 'course.json', 'missing "id"');
  else if (sanitizeId(raw.id) !== raw.id) add('warn', 'course.json', `id "${raw.id}" will be normalised to "${sanitizeId(raw.id)}" (use a-z 0-9 - _ .)`);
  if (!raw.title) add('error', 'course.json', 'missing "title"');
  const course = normalizeCourse(raw);
  const pages = allPages(course);
  if (!pages.length) add('error', 'course.json', 'no pages: units[].chapters[].pages[] is empty');
  const chapterIds = new Set();
  for (const u of course.units) for (const ch of u.chapters) {
    if (chapterIds.has(ch.id)) add('error', 'course.json', `duplicate chapter id "${ch.id}"`);
    chapterIds.add(ch.id);
    if (!ch.pages.length) add('warn', 'course.json', `chapter "${ch.id}" has no pages`);
  }
  const actionIds = new Set(Object.keys(course.actions));
  for (const [id, a] of Object.entries(course.actions)) checkAction(id, a, 'course.json actions', add, actionIds);
  checkButtons(course.buttons, 'course.json', add, actionIds);
  if (course.overview) pages.push({ page: { src: normRel(course.overview) }, chapter: { id: '(overview)' } });

  const seen = new Set();
  for (const { page } of pages) {
    const where = page.src;
    if (seen.has(page.src)) { continue; }
    seen.add(page.src);
    if (!/\.vitent$/i.test(page.src)) add('warn', where, 'page paths should end with .vitent');
    let abs;
    try { abs = safeJoin(dir, page.src); } catch (e) { add('error', where, e.message); continue; }
    if (!fs.existsSync(abs)) { add('error', where, 'page not found'); continue; }
    let text;
    let entries = null;
    const isDir = fs.statSync(abs).isDirectory();
    try {
      if (isDir) text = fs.readFileSync(path.join(abs, 'index.md'), 'utf8');
      else {
        entries = unzipSync(new Uint8Array(fs.readFileSync(abs)));
        if (!entries['index.md']) throw new Error('index.md missing');
        text = strFromU8(entries['index.md']);
      }
    } catch (e) { add('error', where, `cannot read index.md: ${e.message}`); continue; }
    for (const it of validateVitentText(text)) add(it.level, `${where}/index.md:${it.line}`, it.msg);
    const { data } = splitFrontmatter(text);
    if (data.kind && !PAGE_KINDS.includes(data.kind)) add('warn', where, `kind "${data.kind}" unknown`);
    const localActions = new Set([...actionIds, ...Object.keys(data.actions || {})]);
    for (const [id, a] of Object.entries(data.actions || {})) checkAction(id, a, `${where} actions`, add, localActions);
    if (data.buttons) checkButtons(data.buttons, where, add, localActions, new Set(course.buttons.map(b => b.id)));
    for (const ref of collectRefs(text)) {
      if (ref.via === 'markdown' && /\.vitent(#.*)?$/i.test(ref.src)) continue;
      if (isDir || String(ref.src).startsWith('@/')) {
        let target;
        try { target = isDir ? resolveRef(dir, abs, ref.src) : resolveRef(dir, dir, ref.src.slice(2)); } catch (e) { add('error', `${where}/index.md:${ref.line}`, e.message); continue; }
        if (!fs.existsSync(target)) add('error', `${where}/index.md:${ref.line}`, `${ref.via}: "${ref.src}" not found`);
      } else if (entries) {
        const key = normRel(String(ref.src).split(/[?#]/)[0]);
        const found = ref.dir ? Object.keys(entries).some(k => normRel(k).startsWith(key.replace(/\/?$/, '/'))) : !!entries[key];
        if (!found) add('error', `${where}/index.md:${ref.line}`, `${ref.via}: "${ref.src}" not found inside the .vitent`);
      }
    }
  }
  const ann = path.join(dir, 'annotations.json');
  if (fs.existsSync(ann)) {
    try {
      const a = readJson(ann);
      if (!Array.isArray(a.highlights)) add('error', 'annotations.json', '"highlights" must be a list');
      for (const h of a.highlights || []) {
        if (!h.id) add('error', 'annotations.json', 'highlight without id');
        if (h.page && !seen.has(normRel(h.page))) add('warn', 'annotations.json', `highlight ${h.id} points at unknown page ${h.page}`);
        for (const c of h.comments || []) if (c.author !== 'learner' && c.author !== 'answer') add('error', 'annotations.json', `comment ${c.id} author must be "learner" or "answer"`);
      }
    } catch (e) { add('error', 'annotations.json', `invalid JSON: ${e.message}`); }
  }
  return issues;
}
