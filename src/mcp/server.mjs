/* ============================================================
 * src/mcp/server.mjs — stdio MCP (Model Context Protocol) server.
 *
 * Lets any MCP client (an AI agent) read and live-edit the learner's
 * course library:
 *
 *   <data>/library/<courseId>/   unpacked courses (course.json, *.vitent
 *                                folders, annotations.json, learner/)
 *   <data>/live.json             what the learner is looking at right now
 *                                (written by the app)
 *
 * Transport: JSON-RPC 2.0, one JSON message per line on stdin/stdout.
 * Only protocol messages go to stdout; logging goes to stderr.
 * No dependencies beyond the shared course model, so tools/vla.mjs can
 * be bundled into one file with this server inside.
 *
 *   startMcpServer({ dataDir, input, output, version })  → { done, close }
 *   createMcpHandler({ dataDir, version })               → { handleLine, handleMessage, tools }
 * ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import {
  readJson, normalizeCourse, allPages, pageMeta, normalizeAnnotations, emptyAnnotations,
  validateCourseDir, safeJoin, normRel, sanitizeId, expandVitents, pageKey, readPageText,
} from '../shared/vla-core.mjs';
import { validateVitentText, collectRefs, HIGHLIGHT_KINDS } from '../shared/directives.mjs';
import { splitFrontmatter } from '../shared/vitent-parse.mjs';

export const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

const MAX_TEXT = 60000;
const MAX_SELECTION = 10000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_LIST = 500;
const STATUSES = ['open', 'answered', 'applied', 'resolved'];
const SKIP_NAMES = new Set(['node_modules', '.git', '.DS_Store', 'Thumbs.db', 'desktop.ini', '__MACOSX']);
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp', '.tif', '.tiff',
  '.pdf', '.docx', '.pptx', '.xlsx', '.doc', '.ppt', '.xls', '.zip', '.vla', '.gz', '.7z', '.rar', '.tar',
  '.mp3', '.mp4', '.m4a', '.m4v', '.mov', '.mkv', '.webm', '.wav', '.ogg', '.oga', '.flac',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.exe', '.dll', '.so', '.dylib', '.o', '.obj', '.class', '.pyc', '.wasm',
]);

const INSTRUCTIONS = [
  "This server exposes the learner's Vibe Learn Anything course library: every imported course, unpacked, with its pages, highlights and the learner's progress and code.",
  'Start with get_current_context to see what the learner is looking at right now (course, page, selected text, code in the editor), then use the other tools to read or change the course.',
  'Pages are `.vitent` folders whose index.md is Vitent Markdown (Markdown plus :::directives) — follow the Vitent manual (ai_manual/02-vitent-format.md and 03-vitent-blocks.md) and keep component ids stable.',
  'Edits are picked up by the app immediately, so keep every page valid: prefer edit_page for small changes and run validate_course after larger ones.',
  'Answer "ask" / "revise" highlights with reply_annotation. Never delete or rewrite learner comments, and never write to learner/ (it is read-only).',
].join('\n');

class ToolError extends Error {}
const fail = msg => { throw new ToolError(msg); };

/* ─── small helpers ─── */

function clip(text, max = MAX_TEXT) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n… (truncated: showing ${max} of ${s.length} characters)`;
}

const toJson = v => JSON.stringify(v, null, 2);

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function usesCrlf(s) {
  const crlf = (String(s).match(/\r\n/g) || []).length;
  const lf = (String(s).match(/\n/g) || []).length - crlf;
  return crlf > lf;
}

/* New text in the line-ending style (and BOM) of the file it replaces. */
function inStyleOf(text, existing) {
  let out = String(text ?? '');
  if (existing == null) return out;
  out = out.replace(/\r\n/g, '\n');
  if (usesCrlf(existing)) out = out.replace(/\n/g, '\r\n');
  if (existing.startsWith('﻿') && !out.startsWith('﻿')) out = `﻿${out}`;
  return out;
}

function readTextOrNull(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

function countOccurrences(hay, needle) {
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

function looksBinary(rel, buf) {
  if (BINARY_EXT.has(path.extname(rel).toLowerCase())) return true;
  return buf.subarray(0, 8000).includes(0);
}

/* Recursive listing, sorted, capped. Paths are relative to `root`, with "/". */
function listTree(root, cap = MAX_LIST) {
  const entries = [];
  let truncated = false;
  const visit = (abs, rel) => {
    let ents;
    try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    ents.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of ents) {
      if (SKIP_NAMES.has(ent.name) || /\.vla-tmp/.test(ent.name)) continue;
      if (entries.length >= cap) { truncated = true; return; }
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      const a = path.join(abs, ent.name);
      if (ent.isDirectory()) {
        entries.push({ path: r, dir: true });
        visit(a, r);
      } else if (ent.isFile()) {
        let size = 0;
        try { size = fs.statSync(a).size; } catch { /* vanished */ }
        entries.push({ path: r, dir: false, size });
      }
    }
  };
  if (fs.existsSync(root)) visit(root, '');
  return { entries, truncated };
}

function formatIssues(issues) {
  return issues.map(i => `  ${i.level === 'error' ? 'error' : 'warning'}${i.line ? ` line ${i.line}` : ''}${i.where ? ` ${i.where}` : ''}: ${i.msg}`).join('\n');
}

function issueSummary(title, issues) {
  return issues.length ? `\n\n${title}:\n${formatIssues(issues)}` : '';
}

/* Errors in `after` that were not already in `before` (compared by message). */
function introducedErrors(before, after) {
  const pool = new Map();
  for (const i of before) pool.set(i.msg, (pool.get(i.msg) || 0) + 1);
  return after.filter(i => {
    const n = pool.get(i.msg) || 0;
    if (n > 0) { pool.set(i.msg, n - 1); return false; }
    return true;
  });
}

/* "content/w1/x.vitent/index.md" | "/content/w1/x.vitent/" | "@/content/w1/x.vitent" → "content/w1/x.vitent" */
function normPage(p) {
  return normRel(String(p ?? '').trim().replace(/^@\//, '')).replace(/\/index\.md$/i, '').replace(/\/+$/, '');
}

function pageSrcOf(page, field = 'page') {
  const src = normPage(page);
  if (!src) fail(`${field} is required`);
  if (!/\.vitent$/i.test(src)) fail(`${field} must be a page path ending in .vitent, e.g. "content/w1/intro.vitent" (got "${page}")`);
  return src;
}

/* safeJoin, but a path that escapes is the caller's mistake, not a crash. */
function inside(base, rel) {
  try { return safeJoin(base, rel); } catch { return fail(`path "${rel}" points outside the course folder`); }
}

function refSrc(p) {
  return normRel(typeof p === 'string' ? p : (p && (p.src || p.path)) || '');
}

function frontmatterAddTitle(text, title) {
  const line = `title: ${JSON.stringify(String(title))}`;
  if (splitFrontmatter(text).offset > 0) return text.replace(/^(﻿?---[ \t]*\r?\n)/, m => `${m}${line}\n`);
  return `---\n${line}\n---\n\n${text}`;
}

/* ─── argument checking against each tool's inputSchema ─── */

function checkArgs(schema, args) {
  const out = {};
  const props = schema.properties || {};
  for (const key of schema.required || []) {
    if (args[key] === undefined || args[key] === null) fail(`missing required argument "${key}"`);
  }
  for (const [key, def] of Object.entries(props)) {
    let v = args[key];
    if (v === undefined || v === null) continue;
    if (def.type === 'boolean' && typeof v === 'string' && /^(true|false)$/i.test(v)) v = v.toLowerCase() === 'true';
    if (def.type === 'string' && (typeof v === 'number' || typeof v === 'boolean')) v = String(v);
    if (def.type && typeof v !== def.type) fail(`argument "${key}" must be a ${def.type}`);
    if (def.enum && !def.enum.includes(v)) fail(`argument "${key}" must be one of: ${def.enum.join(', ')}`);
    out[key] = v;
  }
  return out;
}

/* ─── the tools ─── */

function createTools(dataDir) {
  const library = path.join(dataDir, 'library');
  const liveFile = path.join(dataDir, 'live.json');

  function courseIds() {
    let ents = [];
    try { ents = fs.readdirSync(library, { withFileTypes: true }); } catch { return []; }
    return ents
      .filter(e => e.isDirectory() && fs.existsSync(path.join(library, e.name, 'course.json')))
      .map(e => e.name)
      .sort();
  }

  function openCourse(courseId) {
    const raw = String(courseId ?? '').trim();
    const id = sanitizeId(raw);
    if (!id) fail('course_id is required');
    const dir = safeJoin(library, id);
    if (!fs.existsSync(path.join(dir, 'course.json'))) {
      const known = courseIds();
      fail(`course "${raw}" is not in the library${known.length ? ` (available: ${known.join(', ')})` : ` (the library at ${library} is empty)`}`);
    }
    return { id, dir };
  }

  function loadCourse(dir) {
    try { return normalizeCourse(readJson(path.join(dir, 'course.json'))); } catch (e) { fail(`course.json cannot be read: ${e.message}`); }
    return null;
  }

  function loadAnnotations(dir) {
    try { return normalizeAnnotations(readJson(path.join(dir, 'annotations.json'), emptyAnnotations())); } catch (e) { fail(`annotations.json cannot be read: ${e.message}`); }
    return null;
  }

  function locatePage(course, src) {
    return allPages(course).find(p => p.page.src === src) || null;
  }

  /* Read a page (folder or still-zipped .vitent). */
  function readPage(dir, page) {
    const src = pageSrcOf(page);
    const abs = inside(dir, src);
    if (!fs.existsSync(abs)) fail(`page "${src}" does not exist in this course (get_course lists the pages; create_page adds one)`);
    if (fs.statSync(abs).isFile()) return { src, abs, text: readPageText(dir, src), files: [], zipped: true };
    const index = path.join(abs, 'index.md');
    if (!fs.existsSync(index)) fail(`page "${src}" has no index.md`);
    const files = listTree(abs).entries.filter(e => !e.dir && e.path !== 'index.md');
    return { src, abs, text: fs.readFileSync(index, 'utf8'), files, zipped: false };
  }

  /* A page folder that can be written (expands a zipped .vitent first). */
  function writablePage(dir, page) {
    const src = pageSrcOf(page);
    const abs = inside(dir, src);
    if (!fs.existsSync(abs)) fail(`page "${src}" does not exist in this course; use create_page to add a new page`);
    if (fs.statSync(abs).isFile()) expandVitents(dir);
    const index = path.join(abs, 'index.md');
    if (!fs.statSync(abs).isDirectory() || !fs.existsSync(index)) fail(`page "${src}" has no index.md`);
    return { src, abs, index };
  }

  /* Files referenced by a page that do not exist (reported as warnings). */
  function missingRefs(dir, pageAbs, text) {
    const out = [];
    const offset = splitFrontmatter(text).offset;
    for (const ref of collectRefs(text)) {
      if (ref.via === 'markdown' && /\.vitent(#.*)?$/i.test(ref.src)) continue;
      const clean = normRel(String(ref.src).split(/[?#]/)[0]);
      const line = ref.line + offset;
      let target;
      try {
        target = String(ref.src).startsWith('@/') ? safeJoin(dir, clean.slice(2)) : safeJoin(pageAbs, clean);
      } catch (e) { out.push({ level: 'warn', line, msg: `${ref.via}: ${e.message}` }); continue; }
      if (!fs.existsSync(target)) out.push({ level: 'warn', line, msg: `${ref.via}: "${ref.src}" not found — add it with write_file (validate_course reports it as an error until then)` });
    }
    return out;
  }

  function pageBlock(src, text) {
    return `\n\n===== ${src}/index.md =====\n${clip(text)}\n===== end of ${src}/index.md =====`;
  }

  /* Validate full page text; throw with the error list when it has errors. */
  function requireValidPage(src, text, verb = 'Not written') {
    const issues = validateVitentText(text);
    const errors = issues.filter(i => i.level === 'error');
    if (errors.length) {
      fail(`${verb}: ${src}/index.md would have ${errors.length} Vitent error(s):\n${formatIssues(errors)}${issueSummary('Warnings', issues.filter(i => i.level !== 'error'))}`);
    }
    return issues;
  }

  const S = {
    courseId: { type: 'string', description: 'Course id (folder name under the library), e.g. "vla-tour". list_courses shows them.' },
    page: { type: 'string', description: 'Page path relative to the course root, ending in .vitent, e.g. "content/w1/workspace.vitent".' },
  };
  const READ_ONLY = { readOnlyHint: true, openWorldHint: false };
  const writes = destructive => ({ readOnlyHint: false, destructiveHint: destructive, openWorldHint: false });

  return [
    {
      name: 'get_current_context',
      title: 'What the learner is looking at',
      description: 'Returns what the learner is looking at in the app right now (from live.json): view, course, chapter, page, selected text, and the code workspace (file, cursor line, editor contents). For an open lesson page it adds the page\'s index.md, its open highlights with comments, and the learner\'s workspace files for that page. Start here.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READ_ONLY,
      run() {
        let live;
        /* The app rewrites live.json in place; a read can catch it half-written. */
        for (let attempt = 0; ; attempt++) {
          try { live = readJson(liveFile); break; } catch (e) {
            if (attempt >= 3) fail(`live.json cannot be read: ${e.message}`);
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40);
          }
        }
        if (!live || typeof live !== 'object') {
          return `The app has no page open right now (no live.json in ${dataDir}). Vibe Learn Anything may not be running. Use list_courses and get_course to browse the library.`;
        }
        const out = { ...live };
        const notes = [];
        if (live.updatedAt) {
          const age = Math.round((Date.now() - Date.parse(live.updatedAt)) / 1000);
          if (Number.isFinite(age)) {
            out.ageSeconds = age;
            if (age > 6 * 3600) notes.push('live.json is several hours old; the app may have been closed since.');
          }
        }
        if (out.selection && typeof out.selection === 'object' && out.selection.text) out.selection = { ...out.selection, text: clip(out.selection.text, MAX_SELECTION) };
        if (out.workspace && typeof out.workspace === 'object' && typeof out.workspace.code === 'string') out.workspace = { ...out.workspace, code: clip(out.workspace.code) };
        let page = null;
        if (live.courseId) {
          try {
            const { id, dir } = openCourse(live.courseId);
            const course = loadCourse(dir);
            if (course.ai?.context) out.courseAiContext = course.ai.context;
            if (live.page) {
              page = readPage(dir, live.page);
              const loc = locatePage(course, page.src);
              if (!loc) notes.push(`page ${page.src} is not listed in course.json`);
              else if (!out.chapterId) out.chapterId = loc.chapter.id;
              out.openHighlights = loadAnnotations(dir).highlights.filter(h => normPage(h.page) === page.src && h.status === 'open');
              const wsDir = `learner/workspaces/${pageKey(page.src)}`;
              const tree = listTree(safeJoin(dir, wsDir), 200);
              out.workspaceDir = wsDir;
              out.workspaceFiles = tree.entries.filter(e => !e.dir).map(e => `${e.path} (${fmtSize(e.size)})`);
              if (tree.truncated) notes.push('workspace file list truncated');
              out.pageFiles = page.files.map(f => f.path);
              notes.push(`read learner code with read_file("${wsDir}/<workspace id>/<file>"); edit the page with edit_page / write_page (course_id "${id}", page "${page.src}")`);
            } else {
              notes.push(`no lesson page is open (view: ${live.view || 'unknown'}); get_course shows the outline`);
            }
          } catch (e) {
            notes.push(e.message);
          }
        } else {
          notes.push(`no course is open (view: ${live.view || 'unknown'})`);
        }
        if (notes.length) out.notes = notes;
        return toJson(out) + (page ? pageBlock(page.src, page.text) : '');
      },
    },

    {
      name: 'list_courses',
      title: 'List courses',
      description: 'Lists every course in the learner\'s library: id, title, code, version, number of pages, and how many "ask" / "revise" highlights are open (waiting for the AI).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READ_ONLY,
      run() {
        const ids = courseIds();
        if (!ids.length) return `The library is empty (${library}).`;
        const courses = ids.map(id => {
          const dir = path.join(library, id);
          try {
            const course = normalizeCourse(readJson(path.join(dir, 'course.json')));
            const ann = normalizeAnnotations(readJson(path.join(dir, 'annotations.json'), emptyAnnotations()));
            const open = ann.highlights.filter(h => (h.kind === 'ask' || h.kind === 'revise') && h.status === 'open').length;
            return { id, title: course.title, code: course.code || '', version: course.version, pages: allPages(course).length, openAskRevise: open };
          } catch (e) {
            return { id, error: e.message };
          }
        });
        return toJson({ library, courses });
      },
    },

    {
      name: 'get_course',
      title: 'Course outline',
      description: 'Outline of one course: units → chapters (id, title, kind) → pages (src, title, kind). Titles come from course.json or the page\'s frontmatter. Also returns the course\'s ai.context (the learner profile).',
      inputSchema: { type: 'object', properties: { course_id: S.courseId }, required: ['course_id'], additionalProperties: false },
      annotations: READ_ONLY,
      run({ course_id }) {
        const { id, dir } = openCourse(course_id);
        const course = loadCourse(dir);
        const pageOut = p => {
          const m = pageMeta(dir, p.src);
          const o = { src: p.src, title: p.title || m.title || '', kind: p.kind || m.kind || '' };
          if (m.missing) o.missing = true;
          return o;
        };
        const out = {
          id,
          title: course.title,
          code: course.code || '',
          subtitle: course.subtitle || '',
          version: course.version,
          language: course.language || '',
          aiContext: course.ai?.context || '',
        };
        if (course.overview) out.overview = normRel(course.overview);
        out.units = course.units.map(u => ({
          id: u.id,
          title: u.title,
          chapters: u.chapters.map(ch => ({ id: ch.id, title: ch.title, kind: ch.kind || '', pages: ch.pages.map(pageOut) })),
        }));
        return toJson(out);
      },
    },

    {
      name: 'read_page',
      title: 'Read a page',
      description: 'Returns a page\'s index.md (Vitent Markdown) exactly as stored, plus its chapter, title and the other files inside the page folder (assets, code, widgets…).',
      inputSchema: { type: 'object', properties: { course_id: S.courseId, page: S.page }, required: ['course_id', 'page'], additionalProperties: false },
      annotations: READ_ONLY,
      run({ course_id, page }) {
        const { id, dir } = openCourse(course_id);
        const course = loadCourse(dir);
        const p = readPage(dir, page);
        const loc = locatePage(course, p.src);
        const fm = splitFrontmatter(p.text);
        const open = loadAnnotations(dir).highlights.filter(h => normPage(h.page) === p.src && h.status === 'open').length;
        const meta = {
          course: id,
          page: p.src,
          chapter: loc ? loc.chapter.id : null,
          title: (loc && loc.page.title) || fm.data.title || '',
          kind: (loc && loc.page.kind) || fm.data.kind || '',
          files: p.files.map(f => `${f.path} (${fmtSize(f.size)})`),
          openHighlights: open,
        };
        if (!loc) meta.note = 'this page is not listed in course.json';
        if (p.zipped) meta.note = 'this page is still a zipped .vitent; it is expanded into a folder on the first write';
        return toJson(meta) + pageBlock(p.src, p.text);
      },
    },

    {
      name: 'write_page',
      title: 'Replace a page',
      description: 'Replaces the whole index.md of an existing page. The text is validated as Vitent Markdown first: if it has errors nothing is written and the errors are returned. Warnings are returned after a successful write. Use edit_page for small changes and create_page for new pages. Keep component ids stable.',
      inputSchema: {
        type: 'object',
        properties: { course_id: S.courseId, page: S.page, text: { type: 'string', description: 'Complete new index.md content, including the --- frontmatter ---.' } },
        required: ['course_id', 'page', 'text'],
        additionalProperties: false,
      },
      annotations: writes(true),
      run({ course_id, page, text }) {
        const { dir } = openCourse(course_id);
        const p = writablePage(dir, page);
        const issues = requireValidPage(p.src, text);
        const old = fs.readFileSync(p.index, 'utf8');
        const next = inStyleOf(text, old);
        if (next === old) return `No change: ${p.src}/index.md already has this content.`;
        fs.writeFileSync(p.index, next);
        const warns = [...issues.filter(i => i.level !== 'error'), ...missingRefs(dir, p.abs, text)];
        return `Saved ${p.src}/index.md (${next.length} characters). The app reloads it automatically.${issueSummary('Warnings', warns)}`;
      },
    },

    {
      name: 'edit_page',
      title: 'Edit part of a page',
      description: 'Exact string replacement inside a page\'s index.md: old_text must appear exactly once (copy it from read_page, including whitespace) unless replace_all is true. Line endings are matched automatically. The result is validated as Vitent Markdown; an edit that introduces errors is not written.',
      inputSchema: {
        type: 'object',
        properties: {
          course_id: S.courseId,
          page: S.page,
          old_text: { type: 'string', description: 'Exact text to replace (must be unique unless replace_all is true).' },
          new_text: { type: 'string', description: 'Replacement text (may be empty to delete old_text).' },
          replace_all: { type: 'boolean', description: 'Replace every occurrence of old_text. Default false.' },
        },
        required: ['course_id', 'page', 'old_text', 'new_text'],
        additionalProperties: false,
      },
      annotations: writes(true),
      run({ course_id, page, old_text, new_text, replace_all = false }) {
        const { dir } = openCourse(course_id);
        const p = writablePage(dir, page);
        const raw = fs.readFileSync(p.index, 'utf8');
        const crlf = usesCrlf(raw);
        const cur = raw.replace(/\r\n/g, '\n');
        const oldT = String(old_text).replace(/\r\n/g, '\n');
        const newT = String(new_text).replace(/\r\n/g, '\n');
        if (!oldT) fail('old_text must not be empty');
        const count = countOccurrences(cur, oldT);
        if (!count) fail(`old_text was not found in ${p.src}/index.md. Read the page again (read_page) and copy the text exactly, including spaces and line breaks.`);
        if (count > 1 && !replace_all) fail(`old_text occurs ${count} times in ${p.src}/index.md. Include more surrounding text so it is unique, or set replace_all to true.`);
        let next;
        if (replace_all) next = cur.split(oldT).join(newT);
        else {
          const i = cur.indexOf(oldT);
          next = cur.slice(0, i) + newT + cur.slice(i + oldT.length);
        }
        if (next === cur) return 'No change: new_text is the same as old_text.';
        const before = validateVitentText(cur).filter(i => i.level === 'error');
        const after = validateVitentText(next);
        const afterErrors = after.filter(i => i.level === 'error');
        const introduced = introducedErrors(before, afterErrors);
        if (introduced.length) {
          fail(`Not written: this edit would introduce ${introduced.length} Vitent error(s) in ${p.src}/index.md:\n${formatIssues(introduced)}`);
        }
        fs.writeFileSync(p.index, crlf ? next.replace(/\n/g, '\r\n') : next);
        const remaining = afterErrors.length ? issueSummary('Errors that were already on the page (not caused by this edit)', afterErrors) : '';
        const warns = [...after.filter(i => i.level !== 'error'), ...missingRefs(dir, p.abs, next)];
        return `Edited ${p.src}/index.md: replaced ${replace_all ? count : 1} occurrence(s). The app reloads it automatically.${remaining}${issueSummary('Warnings', warns)}`;
      },
    },

    {
      name: 'create_page',
      title: 'Create a page',
      description: 'Creates a new page <folder>/<name>.vitent/index.md (folder = the folder of the chapter\'s first page, or content/<chapter_id>) and adds it to the chapter\'s pages in course.json, after the page given in `after` or at the end of the chapter. The text is validated first; nothing is written if it has errors.',
      inputSchema: {
        type: 'object',
        properties: {
          course_id: S.courseId,
          chapter_id: { type: 'string', description: 'Id of the chapter to add the page to (see get_course).' },
          name: { type: 'string', description: 'File-safe page name without .vitent: letters, digits, - _ . (e.g. "pointers-practice").' },
          text: { type: 'string', description: 'Complete index.md content (Vitent Markdown with --- frontmatter ---).' },
          title: { type: 'string', description: 'Optional page title. Added to the frontmatter when it has none, otherwise written to the course.json entry.' },
          after: { type: 'string', description: 'Optional page path in the same chapter to insert after. Default: end of the chapter.' },
        },
        required: ['course_id', 'chapter_id', 'name', 'text'],
        additionalProperties: false,
      },
      annotations: writes(false),
      run({ course_id, chapter_id, name, text, title, after }) {
        const { dir } = openCourse(course_id);
        const courseFile = path.join(dir, 'course.json');
        const courseText = fs.readFileSync(courseFile, 'utf8');
        let raw;
        try { raw = JSON.parse(courseText.replace(/^﻿/, '')); } catch (e) { fail(`course.json is not valid JSON: ${e.message}`); }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('course.json must be a JSON object');
        const course = normalizeCourse(raw);
        let loc = null;
        course.units.forEach((u, ui) => u.chapters.forEach((ch, ci) => { if (!loc && ch.id === chapter_id) loc = { ui, ci, ch }; }));
        if (!loc) {
          const ids = course.units.flatMap(u => u.chapters.map(ch => ch.id));
          fail(`chapter "${chapter_id}" not found (chapters: ${ids.join(', ') || 'none'})`);
        }
        const rawUnits = Array.isArray(raw.units) && raw.units.length ? raw.units : [{ chapters: raw.chapters }];
        const rawChapter = rawUnits[loc.ui].chapters[loc.ci];
        if (!Array.isArray(rawChapter.pages)) rawChapter.pages = [];

        const slug = String(name).trim().replace(/\.vitent$/i, '');
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(slug) || slug.includes('..')) {
          fail(`name "${name}" is not a file-safe slug: use letters, digits, - _ . (e.g. "pointers-practice")`);
        }
        const first = loc.ch.pages[0]?.src;
        const folder = first ? path.posix.dirname(first) : `content/${sanitizeId(chapter_id) || 'chapter'}`;
        const src = normRel(`${folder}/${slug}.vitent`);
        if (allPages(course).some(p => p.page.src.toLowerCase() === src.toLowerCase())) fail(`${src} is already listed in course.json`);
        const abs = inside(dir, src);
        if (fs.existsSync(abs)) fail(`${src} already exists on disk; choose another name`);

        let insertAt = rawChapter.pages.length;
        if (after != null && after !== '') {
          const afterSrc = pageSrcOf(after, 'after');
          const idx = rawChapter.pages.findIndex(p => refSrc(p) === afterSrc);
          if (idx < 0) fail(`after: page "${afterSrc}" is not in chapter "${chapter_id}" (its pages: ${loc.ch.pages.map(p => p.src).join(', ') || 'none'})`);
          insertAt = idx + 1;
        }

        let pageText = String(text);
        const fm = splitFrontmatter(pageText);
        let entryTitle = null;
        if (title) {
          if (!fm.data.title && !fm.error) pageText = frontmatterAddTitle(pageText, title);
          else if (fm.data.title !== title) entryTitle = String(title);
        }
        const issues = requireValidPage(src, pageText);

        const styleRef = rawChapter.pages[insertAt - 1] ?? rawChapter.pages[insertAt] ?? null;
        const objectStyle = !!styleRef && typeof styleRef === 'object';
        let entry = src;
        if (objectStyle || entryTitle) {
          entry = { src };
          const t = entryTitle || title || (objectStyle && styleRef.title ? fm.data.title : null);
          if (t) entry.title = String(t);
        }
        rawChapter.pages.splice(insertAt, 0, entry);

        fs.mkdirSync(abs, { recursive: true });
        fs.writeFileSync(path.join(abs, 'index.md'), pageText);
        fs.writeFileSync(courseFile, inStyleOf(`${JSON.stringify(raw, null, 2)}\n`, courseText));

        const courseIssues = validateCourseDir(dir).filter(i => i.where === 'course.json' && i.level === 'error');
        const warns = [...issues.filter(i => i.level !== 'error'), ...missingRefs(dir, abs, pageText)];
        return `Created ${src} in chapter "${chapter_id}" (position ${insertAt + 1} of ${rawChapter.pages.length}) and added it to course.json. The app picks it up automatically.${issueSummary('Warnings', warns)}${issueSummary('course.json errors', courseIssues)}`;
      },
    },

    {
      name: 'list_annotations',
      title: 'List highlights',
      description: 'Lists the learner\'s highlights with their targets and comments. kind "ask" = a question for the AI, "revise" = a change request; yellow/green/blue/pink are personal notes. Filter by status, kind or page.',
      inputSchema: {
        type: 'object',
        properties: {
          course_id: S.courseId,
          status: { type: 'string', enum: STATUSES, description: 'Only highlights with this status (open = waiting).' },
          kind: { type: 'string', enum: HIGHLIGHT_KINDS, description: 'Only highlights of this kind.' },
          page: { type: 'string', description: 'Only highlights on this page (path ending in .vitent).' },
        },
        required: ['course_id'],
        additionalProperties: false,
      },
      annotations: READ_ONLY,
      run({ course_id, status, kind, page }) {
        const { dir } = openCourse(course_id);
        const src = page ? normPage(page) : null;
        const list = loadAnnotations(dir).highlights.filter(h =>
          (!status || h.status === status) && (!kind || h.kind === kind) && (!src || normPage(h.page) === src));
        if (!list.length) return 'No highlights match.';
        return toJson({ count: list.length, highlights: list });
      },
    },

    {
      name: 'reply_annotation',
      title: 'Reply to a highlight',
      description: 'Appends a comment by "answer" (the AI) to a highlight and updates its status: default "answered" for ask, "applied" for revise, unchanged for other kinds. Use Markdown in text. For a revise, change the page first, then reply with a short list of what changed. Learner comments are never modified.',
      inputSchema: {
        type: 'object',
        properties: {
          course_id: S.courseId,
          highlight_id: { type: 'string', description: 'Highlight id, e.g. "h-mgk2x1ab3cd" (see list_annotations).' },
          text: { type: 'string', description: 'The reply, in Markdown, in the learner\'s language.' },
          status: { type: 'string', enum: STATUSES, description: 'Optional new status. Default: answered (ask) / applied (revise) / unchanged.' },
        },
        required: ['course_id', 'highlight_id', 'text'],
        additionalProperties: false,
      },
      annotations: writes(false),
      run({ course_id, highlight_id, text, status }) {
        const { dir } = openCourse(course_id);
        if (!String(text).trim()) fail('text must not be empty');
        const file = path.join(dir, 'annotations.json');
        const existing = readTextOrNull(file);
        if (existing == null) fail('this course has no annotations.json yet (no highlights)');
        let raw;
        try { raw = JSON.parse(existing.replace(/^﻿/, '')); } catch (e) { fail(`annotations.json is not valid JSON: ${e.message}`); }
        if (!raw || !Array.isArray(raw.highlights)) fail('annotations.json has no "highlights" list');
        const h = raw.highlights.find(x => x && x.id === highlight_id);
        if (!h) fail(`highlight "${highlight_id}" not found (list_annotations shows the ids)`);
        const now = new Date().toISOString();
        if (!Array.isArray(h.comments)) h.comments = [];
        const comment = { id: `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, author: 'answer', text: String(text), created: now };
        h.comments.push(comment);
        const next = status || (h.kind === 'ask' ? 'answered' : h.kind === 'revise' ? 'applied' : null);
        if (next) h.status = next;
        h.updated = now;
        fs.writeFileSync(file, inStyleOf(`${JSON.stringify(raw, null, 2)}\n`, existing));
        return toJson({ highlight: h.id, kind: h.kind, status: h.status || 'open', comment: comment.id, comments: h.comments.length });
      },
    },

    {
      name: 'validate_course',
      title: 'Validate a course',
      description: 'Runs the full course check (course.json, every page\'s frontmatter and directives, referenced assets, actions, buttons, annotations.json) and returns the errors and warnings.',
      inputSchema: { type: 'object', properties: { course_id: S.courseId }, required: ['course_id'], additionalProperties: false },
      annotations: READ_ONLY,
      run({ course_id }) {
        const { id, dir } = openCourse(course_id);
        const issues = validateCourseDir(dir);
        const errors = issues.filter(i => i.level === 'error');
        const warns = issues.filter(i => i.level !== 'error');
        const head = errors.length
          ? `${id}: ${errors.length} error(s), ${warns.length} warning(s). Fix the errors.`
          : `${id}: valid — 0 error(s), ${warns.length} warning(s).`;
        return head + issueSummary('Errors', errors) + issueSummary('Warnings', warns);
      },
    },

    {
      name: 'list_files',
      title: 'List course files',
      description: `Recursive file listing (with sizes) of a course folder or one of its subfolders. Capped at ${MAX_LIST} entries; pass dir to narrow it down.`,
      inputSchema: {
        type: 'object',
        properties: { course_id: S.courseId, dir: { type: 'string', description: 'Folder relative to the course root, e.g. "content/w1" or "learner/workspaces". Default: the course root.' } },
        required: ['course_id'],
        additionalProperties: false,
      },
      annotations: READ_ONLY,
      run({ course_id, dir: sub }) {
        const { id, dir } = openCourse(course_id);
        const rel = normRel(sub || '').replace(/\/+$/, '');
        const root = rel ? inside(dir, rel) : dir;
        if (!fs.existsSync(root)) fail(`folder "${rel}" does not exist in this course`);
        if (!fs.statSync(root).isDirectory()) fail(`"${rel}" is a file; use read_file`);
        const { entries, truncated } = listTree(root);
        const prefix = rel ? `${rel}/` : '';
        const lines = entries.map(e => (e.dir ? `${prefix}${e.path}/` : `${prefix}${e.path}  (${fmtSize(e.size)})`));
        const head = `${id}/${rel || ''} — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}${truncated ? ` (capped at ${MAX_LIST}; pass a narrower dir)` : ''}`;
        return [head, ...lines].join('\n');
      },
    },

    {
      name: 'read_file',
      title: 'Read a course file',
      description: 'Returns the UTF-8 text of any course file (course.json, a page asset, a script, learner/progress.json, learner code in learner/workspaces/…). Binary files and files over 1 MB are refused.',
      inputSchema: {
        type: 'object',
        properties: { course_id: S.courseId, path: { type: 'string', description: 'File path relative to the course root, e.g. "course.json" or "learner/progress.json".' } },
        required: ['course_id', 'path'],
        additionalProperties: false,
      },
      annotations: READ_ONLY,
      run({ course_id, path: file }) {
        const { dir } = openCourse(course_id);
        const rel = normRel(file).replace(/\/+$/, '');
        if (!rel) fail('path is required');
        const abs = inside(dir, rel);
        if (!fs.existsSync(abs)) fail(`file "${rel}" does not exist in this course (list_files shows what is there)`);
        const st = fs.statSync(abs);
        if (st.isDirectory()) fail(`"${rel}" is a folder; use list_files`);
        if (st.size > MAX_FILE_BYTES) fail(`"${rel}" is ${fmtSize(st.size)}; only files up to 1 MB are returned`);
        const buf = fs.readFileSync(abs);
        if (looksBinary(rel, buf)) fail(`"${rel}" is a binary file (${fmtSize(st.size)}); only text files can be read`);
        const text = buf.toString('utf8');
        return text.length ? clip(text) : '(empty file)';
      },
    },

    {
      name: 'write_file',
      title: 'Write a course file',
      description: 'Writes a UTF-8 text file inside the course (page assets, code starters, scripts, widgets, course.json …), creating folders as needed. Refused: anything under learner/ (the learner\'s data is read-only), annotations.json (use reply_annotation) and paths outside the course. A page index.md is validated like write_page; course.json must be valid JSON.',
      inputSchema: {
        type: 'object',
        properties: {
          course_id: S.courseId,
          path: { type: 'string', description: 'File path relative to the course root, e.g. "content/w1/workspace.vitent/code/main.c".' },
          content: { type: 'string', description: 'Complete file content.' },
        },
        required: ['course_id', 'path', 'content'],
        additionalProperties: false,
      },
      annotations: writes(true),
      run({ course_id, path: file, content }) {
        const { dir } = openCourse(course_id);
        const rel0 = normRel(file).replace(/\/+$/, '');
        if (!rel0) fail('path is required');
        const abs = inside(dir, rel0);
        const rel = path.relative(dir, abs).split(path.sep).join('/');
        if (!rel) fail('path must name a file inside the course');
        const lower = rel.toLowerCase();
        if (lower === 'learner' || lower.startsWith('learner/')) fail('learner/ holds the learner\'s own progress and code; it is read-only for AI agents');
        if (lower === 'annotations.json' || lower.startsWith('annotations.json.')) fail('annotations.json is managed by the app; use reply_annotation to answer a highlight');
        if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) fail(`"${rel}" is a folder`);
        const text = String(content);
        let extra = '';
        if (lower === 'course.json') {
          let parsed;
          try { parsed = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { fail(`Not written: course.json must be valid JSON (${e.message})`); }
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('Not written: course.json must be a JSON object');
        }
        let pageIssues = null;
        if (/\.vitent\/index\.md$/i.test(lower)) pageIssues = requireValidPage(rel.replace(/\/index\.md$/i, ''), text);
        const existing = readTextOrNull(abs);
        const next = inStyleOf(text, existing != null && !existing.includes('\0') ? existing : null);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, next);
        if (lower === 'course.json') {
          const issues = validateCourseDir(dir);
          extra = issueSummary('Course errors (run validate_course for warnings)', issues.filter(i => i.level === 'error'));
        }
        if (pageIssues) {
          const pageAbs = path.dirname(abs);
          extra = issueSummary('Warnings', [...pageIssues.filter(i => i.level !== 'error'), ...missingRefs(dir, pageAbs, text)]);
        }
        return `${existing == null ? 'Created' : 'Wrote'} ${rel} (${fmtSize(Buffer.byteLength(next))}).${extra}`;
      },
    },
  ];
}

/* ─── JSON-RPC ─── */

export function createMcpHandler({ dataDir, version = '0.0.0', log = () => {} } = {}) {
  if (!dataDir) throw new Error('createMcpHandler: dataDir is required');
  const tools = createTools(path.resolve(dataDir));
  const byName = new Map(tools.map(t => [t.name, t]));

  const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
  const err = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  const textResult = (text, isError = false) => (isError
    ? { content: [{ type: 'text', text: String(text) }], isError: true }
    : { content: [{ type: 'text', text: String(text) }] });

  function callTool(params) {
    const tool = byName.get(params.name);
    if (!tool) return textResult(`Unknown tool "${params.name}". Available tools: ${tools.map(t => t.name).join(', ')}.`, true);
    const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {};
    try {
      return textResult(tool.run(checkArgs(tool.inputSchema, args)));
    } catch (e) {
      if (!(e instanceof ToolError)) log(`${tool.name} failed: ${e.stack || e.message}`);
      return textResult(e instanceof ToolError ? e.message : `${tool.name} failed: ${e.message}`, true);
    }
  }

  function handleMessage(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return err(null, -32600, 'Invalid Request');
    const hasId = msg.id !== undefined;
    if (typeof msg.method !== 'string') {
      if ('result' in msg || 'error' in msg) return null; /* a response; this server sends no requests */
      return err(hasId ? msg.id : null, -32600, 'Invalid Request');
    }
    if (!hasId) return null; /* notification: notifications/initialized, notifications/cancelled, … */
    const id = msg.id;
    const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
    try {
      switch (msg.method) {
        case 'initialize':
          return ok(id, {
            protocolVersion: typeof params.protocolVersion === 'string' && params.protocolVersion ? params.protocolVersion : DEFAULT_PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'vibe-learn', title: 'Vibe Learn Anything', version: String(version) },
            instructions: INSTRUCTIONS,
          });
        case 'ping':
          return ok(id, {});
        case 'tools/list':
          return ok(id, {
            tools: tools.map(t => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })),
          });
        case 'tools/call':
          if (typeof params.name !== 'string' || !params.name) return err(id, -32602, 'Invalid params: "name" is required');
          return ok(id, callTool(params));
        default:
          return err(id, -32601, `Method not found: ${msg.method}`);
      }
    } catch (e) {
      log(`${msg.method} failed: ${e.stack || e.message}`);
      return err(id, -32603, `Internal error: ${e.message}`);
    }
  }

  function handleLine(line) {
    const s = String(line).trim();
    if (!s) return null;
    let msg;
    try { msg = JSON.parse(s); } catch { return err(null, -32700, 'Parse error'); }
    if (Array.isArray(msg)) {
      if (!msg.length) return err(null, -32600, 'Invalid Request');
      const out = msg.map(handleMessage).filter(Boolean);
      return out.length ? out : null;
    }
    return handleMessage(msg);
  }

  return { handleLine, handleMessage, tools };
}

/* Newline-delimited JSON-RPC over a pair of streams (stdin/stdout by default). */
export function startMcpServer({ dataDir, input = process.stdin, output = process.stdout, version = '0.0.0', log } = {}) {
  const logger = log || (m => process.stderr.write(`[vibe-learn mcp] ${m}\n`));
  const handler = createMcpHandler({ dataDir, version, log: logger });
  const decoder = new StringDecoder('utf8');
  let buf = '';
  let closed = false;
  let resolveDone;
  const done = new Promise(r => { resolveDone = r; });

  const send = msg => {
    if (closed || msg == null) return;
    try { output.write(`${JSON.stringify(msg)}\n`); } catch (e) { logger(`write failed: ${e.message}`); }
  };
  const processLine = line => {
    try { send(handler.handleLine(line)); } catch (e) {
      logger(`unexpected failure: ${e.stack || e.message}`);
      send({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } });
    }
  };
  const onData = chunk => {
    buf += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      processLine(line);
    }
  };
  const finish = () => {
    if (closed) return;
    buf += decoder.end();
    if (buf.trim()) processLine(buf);
    buf = '';
    closed = true;
    input.off?.('data', onData);
    resolveDone();
  };
  const onOutputError = e => { logger(`output error: ${e.message}`); finish(); };

  input.on('data', onData);
  input.once('end', finish);
  input.once('close', finish);
  output.on?.('error', onOutputError);
  input.resume?.();
  logger(`serving ${path.resolve(dataDir)} (library: ${path.join(path.resolve(dataDir), 'library')})`);

  return {
    done,
    close() {
      finish();
      output.off?.('error', onOutputError);
      input.pause?.();
    },
  };
}
