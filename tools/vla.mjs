#!/usr/bin/env node
/* ============================================================
 * tools/vla.mjs — command-line helper for AI agents and authors.
 *
 *   node tools/vla.mjs new <dir> [--title T] [--id ID]   scaffold a course source folder
 *   node tools/vla.mjs validate <dir|file.vla>            check everything, exit 1 on errors
 *   node tools/vla.mjs pack <dir> [-o out.vla]            validate + build the .vla
 *   node tools/vla.mjs unpack <file.vla> <dir>            unpack (nested .vitent → folders)
 *   node tools/vla.mjs notes <dir|file.vla> [--all]       list highlights waiting for the AI
 *   node tools/vla.mjs answer <dir> <highlightId> [--status S] [--text T | --file F]
 *                                                         append an "answer" comment
 *   node tools/vla.mjs info <dir|file.vla>                course outline
 * ============================================================ */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  extractVla, packVla, validateCourseDir, readJson, writeJson, normalizeCourse, allPages,
  pageMeta, normalizeAnnotations, sanitizeId, emptyAnnotations,
} from '../src/shared/vla-core.mjs';

const argv = process.argv.slice(2);
const cmd = argv.shift();

function flag(name, fallback = null) {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
}
function bool(name) {
  const i = argv.indexOf(name);
  if (i < 0) return false;
  argv.splice(i, 1);
  return true;
}
function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

/* Accept a folder or a .vla; a .vla is unpacked to a temp folder. */
function openCourse(target) {
  if (!target) die('missing <dir|file.vla>');
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) die(`not found: ${target}`);
  if (fs.statSync(abs).isDirectory()) return { dir: abs, temp: false };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vla-'));
  extractVla(abs, dir);
  return { dir, temp: true };
}

function printIssues(issues) {
  const errors = issues.filter(i => i.level === 'error');
  const warns = issues.filter(i => i.level !== 'error');
  for (const i of errors) console.log(`  ✗ ${i.where}  ${i.msg}`);
  for (const i of warns) console.log(`  ! ${i.where}  ${i.msg}`);
  console.log(errors.length ? `\n${errors.length} error(s), ${warns.length} warning(s)` : `✓ valid (${warns.length} warning(s))`);
  return errors.length;
}

const SCAFFOLD_PAGE = `---
title: 欢迎
kind: doc
---

# 欢迎来到这门课

这是第一页。用 **Vitent Markdown** 写内容，见 ai_manual/02-vitent-format.md。

:::tip[小提示]
选中文字后可以高亮、写注释，或者用「问 AI」提问。
:::

:::quiz{id="q-welcome"}
这门课的内容文件扩展名是？
- [ ] .html
- [x] .vitent
- [ ] .docx
::::explain
每一页都是一个 \`.vitent\` 包：\`index.md\` 加上任意资源文件。
::::
:::
`;

const commands = {
  new() {
    const dir = argv[0];
    if (!dir) die('usage: vla new <dir> [--title T] [--id ID]');
    const title = flag('--title', path.basename(dir));
    const id = sanitizeId(flag('--id', title)) || 'course';
    const abs = path.resolve(dir);
    if (fs.existsSync(path.join(abs, 'course.json'))) die(`${dir}/course.json already exists`);
    fs.mkdirSync(path.join(abs, 'content', 'welcome.vitent'), { recursive: true });
    fs.mkdirSync(path.join(abs, 'assets'), { recursive: true });
    writeJson(path.join(abs, 'course.json'), {
      vla: 1,
      id,
      title,
      code: id.toUpperCase().slice(0, 10),
      subtitle: '',
      description: '',
      color: '#d97757',
      version: '1.0.0',
      language: 'zh-CN',
      units: [
        { id: 'unit-1', title: '第 1 单元', chapters: [{ id: 'ch-welcome', title: '开始', kind: 'lesson', pages: ['content/welcome.vitent'] }] },
      ],
      actions: {},
      buttons: [],
    });
    fs.writeFileSync(path.join(abs, 'content', 'welcome.vitent', 'index.md'), SCAFFOLD_PAGE);
    console.log(`✓ created ${dir}\n  next: edit course.json and content/, then  node tools/vla.mjs pack ${dir}`);
  },

  validate() {
    const { dir } = openCourse(argv[0]);
    process.exit(printIssues(validateCourseDir(dir)) ? 1 : 0);
  },

  pack() {
    const src = argv[0];
    if (!src) die('usage: vla pack <dir> [-o out.vla]');
    const out = flag('-o', flag('--out', null));
    const force = bool('--force');
    const abs = path.resolve(src);
    if (!fs.statSync(abs).isDirectory()) die(`${src} is not a folder`);
    const errors = printIssues(validateCourseDir(abs));
    if (errors && !force) die('fix the errors above (or pass --force)');
    const course = normalizeCourse(readJson(path.join(abs, 'course.json')));
    const target = path.resolve(out || path.join(path.dirname(abs), `${course.id}.vla`));
    const { bytes } = packVla(abs, target);
    console.log(`✓ packed ${path.relative(process.cwd(), target) || target}  (${(bytes / 1024).toFixed(1)} KB)`);
  },

  unpack() {
    const [file, dir] = argv;
    if (!file || !dir) die('usage: vla unpack <file.vla> <dir>');
    const abs = path.resolve(dir);
    if (fs.existsSync(abs) && fs.readdirSync(abs).length) die(`${dir} is not empty`);
    extractVla(path.resolve(file), abs);
    console.log(`✓ unpacked to ${dir}`);
  },

  info() {
    const { dir } = openCourse(argv[0]);
    const course = normalizeCourse(readJson(path.join(dir, 'course.json')));
    console.log(`${course.title}  [${course.id}] v${course.version}`);
    for (const u of course.units) {
      console.log(`\n▸ ${u.title || '(untitled unit)'}`);
      for (const ch of u.chapters) {
        console.log(`  ● ${ch.title}  (${ch.id})`);
        for (const p of ch.pages) {
          const m = pageMeta(dir, p.src);
          console.log(`      - ${p.title || m.title || '?'}  ${m.missing ? '✗ MISSING ' : ''}${p.src}`);
        }
      }
    }
  },

  notes() {
    const all = bool('--all');
    const { dir } = openCourse(argv[0]);
    const ann = normalizeAnnotations(readJson(path.join(dir, 'annotations.json'), emptyAnnotations()));
    const list = ann.highlights.filter(h => all || ((h.kind === 'ask' || h.kind === 'revise') && h.status === 'open'));
    if (!list.length) { console.log(all ? 'no highlights' : '✓ nothing waiting: no open ask/revise highlights'); return; }
    for (const h of list) {
      console.log(`\n■ ${h.id}  [${h.kind}] ${h.status}  page: ${h.page}`);
      for (const t of h.targets) {
        if (t.type === 'text') console.log(`    “${t.exact}”${t.section ? `  (section: ${t.section})` : ''}`);
        else console.log(`    [${t.widget || 'block'} ${t.block}] ${t.label || ''}${t.detail ? ' ' + JSON.stringify(t.detail) : ''}`);
      }
      for (const c of h.comments) console.log(`    ${c.author === 'answer' ? '◆ answer' : '● learner'}: ${c.text.replace(/\n/g, '\n      ')}`);
    }
    console.log(`\n${list.length} highlight(s)`);
  },

  answer() {
    const [dir, hid] = argv;
    const status = flag('--status', null);
    const file = flag('--file', null);
    const text = file ? fs.readFileSync(file, 'utf8') : flag('--text', null);
    if (!dir || !hid || text == null) die('usage: vla answer <dir> <highlightId> (--text T | --file F) [--status answered|applied|resolved]');
    const annFile = path.join(path.resolve(dir), 'annotations.json');
    const ann = normalizeAnnotations(readJson(annFile, emptyAnnotations()));
    const h = ann.highlights.find(x => x.id === hid);
    if (!h) die(`highlight ${hid} not found`);
    const now = new Date().toISOString();
    h.comments.push({ id: `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, author: 'answer', text, created: now });
    h.status = status || (h.kind === 'revise' ? 'applied' : 'answered');
    h.updated = now;
    writeJson(annFile, ann);
    console.log(`✓ answered ${hid} → ${h.status}`);
  },
};

if (!cmd || !commands[cmd]) {
  console.log(`vla — Vibe Learn Anything course tool

  new <dir> [--title T] [--id ID]      scaffold a course source folder
  validate <dir|file.vla>              check course.json, pages, directives, assets
  pack <dir> [-o out.vla] [--force]    validate and build the .vla
  unpack <file.vla> <dir>              unpack (nested .vitent become folders)
  info <dir|file.vla>                  print the outline
  notes <dir|file.vla> [--all]         list open ask / revise highlights
  answer <dir> <id> --text T|--file F [--status S]   add an "answer" comment`);
  process.exit(cmd ? 1 : 0);
}
commands[cmd]();
