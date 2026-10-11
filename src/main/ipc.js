/* ============================================================
 * src/main/ipc.js — every channel the page can call (see preload.cjs).
 * Anything that runs course-supplied commands or reaches the network
 * on a course's behalf goes through ensureTrust() first.
 * ============================================================ */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { app, ipcMain, dialog, shell, clipboard, BrowserWindow } from 'electron';
import { P } from './paths.js';
import * as settings from './settings.js';
import * as library from './library.js';
import * as exec from './exec.js';
import * as ai from './ai.js';
import * as kit from './kit.js';
import * as claude from './claude.js';
import * as snapshot from './snapshot.js';
import { watchCourse, unwatch } from './watch.js';
import { safeJoin, normRel, readJson } from '../shared/vla-core.mjs';
import { runnerFor } from '../shared/runners.mjs';


function zh() {
  return settings.get('lang') !== 'en';
}

function courseTitle(id) {
  try { return readJson(path.join(library.dirOf(id), 'course.json')).title || id; } catch { return id; }
}

async function ensureTrust(event, courseId, what) {
  if (!courseId) return false;
  if (settings.isTrusted(courseId)) return true;
  const win = BrowserWindow.fromWebContents(event.sender);
  const z = zh();
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: z ? ['信任此课程', '仅这一次', '取消'] : ['Trust this course', 'Just this once', 'Cancel'],
    defaultId: 1,
    cancelId: 2,
    noLink: true,
    title: z ? '运行课程里的操作？' : 'Run an action from this course?',
    message: z ? `课程「${courseTitle(courseId)}」想要：` : `The course "${courseTitle(courseId)}" wants to:`,
    detail: `${what}\n\n${z
      ? '课程可以在你的电脑上运行命令、访问网络。只信任你了解来源的课程；信任可以在「设置 → 安全」里撤销。'
      : 'Courses can run commands on your computer and reach the network. Only trust courses you know; you can revoke trust in Settings → Security.'}`,
  });
  if (response === 0) { settings.setTrusted(courseId, true); return true; }
  if (response === 1) return true;
  return false;
}

function denied() {
  return { denied: true, code: null, stdout: '', stderr: zh() ? '已取消：未信任此课程' : 'Cancelled: course not trusted' };
}

/* cwd spec from the page → absolute folder inside the course. */
function resolveCwd(spec = {}) {
  const { courseId, page, ws, cwd } = spec;
  if (cwd === 'kit') return kit.workDir();
  if (!courseId) return os.homedir();
  const courseDir = library.dirOf(courseId);
  const pageDir = page ? safeJoin(courseDir, normRel(page)) : courseDir;
  if (cwd === 'course') return courseDir;
  if (cwd === 'page') return pageDir;
  if (cwd === 'home') return os.homedir();
  if (typeof cwd === 'string' && cwd.startsWith('ws:') && page) return library.wsPath(courseId, page, cwd.slice(3));
  if (ws && page) return library.wsPath(courseId, page, ws);
  return pageDir;
}

function templateCtx(spec, dir) {
  const courseDir = spec.courseId ? library.dirOf(spec.courseId) : '';
  return {
    main: spec.main,
    file: spec.file,
    dir,
    page: spec.page && courseDir ? safeJoin(courseDir, normRel(spec.page)) : '',
    course: courseDir,
  };
}

/* <profile>/live.json — what the learner is looking at, for the MCP server. */
let liveTimer = null;
let liveData = null;
function writeLive(ctx) {
  const { now, ...rest } = ctx || {};
  liveData = { ...rest, updatedAt: new Date().toISOString() };
  clearTimeout(liveTimer);
  const write = () => { try { fs.writeFileSync(path.join(P.data, 'live.json'), JSON.stringify(liveData, null, 2)); } catch { /* best effort */ } };
  if (now) write();
  else liveTimer = setTimeout(write, 150);
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => fn(event, ...args));
}

export function registerIpc() {
  /* ─── app ─── */
  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    hasPty: exec.hasPty(),
    dev: process.argv.includes('--dev'),
    paths: { data: P.data, library: P.library, workDir: kit.workDir(), kitReady: kit.isPrepared() },
    ai: ai.status(),
  }));
  handle('app:openExternal', (_e, url) => {
    if (/^(https?:|mailto:)/i.test(String(url))) return shell.openExternal(String(url));
    return false;
  });
  handle('app:openPath', (_e, p) => shell.openPath(String(p)));
  handle('app:clipboard', (_e, text) => { clipboard.writeText(String(text ?? '')); return true; });
  handle('app:titlebar', (event, colors) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && process.platform !== 'darwin' && win.setTitleBarOverlay) {
      try { win.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor, height: colors.height || 48 }); } catch { /* not supported */ }
    }
    return true;
  });
  handle('app:fullscreen', (event, on) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setFullScreen(on == null ? !win.isFullScreen() : !!on);
    return win?.isFullScreen();
  });

  /* ─── settings ─── */
  handle('settings:get', () => settings.publicSettings());
  handle('settings:set', (_e, patch) => {
    const before = settings.get('workDir');
    const s = settings.update(patch);
    exec.clearCaches();
    if (before !== settings.get('workDir')) kit.stop();
    if (patch?.ai?.claude && 'path' in patch.ai.claude) claude.status({ fresh: true }).catch(() => {});
    return s;
  });
  handle('settings:trusted', () => Object.keys(settings.load().trust));
  handle('settings:untrust', (_e, id) => { settings.setTrusted(id, false); return true; });

  /* ─── library ─── */
  handle('library:list', () => library.list());
  handle('library:import', async (event, files) => {
    let list = Array.isArray(files) ? files : files ? [files] : null;
    if (!list) {
      const win = BrowserWindow.fromWebContents(event.sender);
      const r = await dialog.showOpenDialog(win, {
        title: zh() ? '导入课程' : 'Import course',
        filters: [{ name: 'Vibe Learn course', extensions: ['vla'] }, { name: 'All files', extensions: ['*'] }],
        properties: ['openFile', 'multiSelections'],
      });
      if (r.canceled) return [];
      list = r.filePaths;
    }
    const results = [];
    for (const f of list) {
      try { results.push({ file: f, ...library.importVla(String(f)) }); }
      catch (e) { results.push({ file: f, error: e.message }); }
    }
    return results;
  });
  handle('library:resolveImport', (_e, token, mode) => library.resolveImport(token, mode));
  handle('library:export', async (event, id, opts = {}) => {
    let file = opts.file;
    if (opts.forAI) {
      kit.prepare();
      file = path.join(kit.workDir(), 'inbox', `${id}.vla`);
    }
    if (!file) {
      const win = BrowserWindow.fromWebContents(event.sender);
      const r = await dialog.showSaveDialog(win, {
        title: zh() ? '导出课程' : 'Export course',
        defaultPath: path.join(app.getPath('documents'), `${id}.vla`),
        filters: [{ name: 'Vibe Learn course', extensions: ['vla'] }],
      });
      if (r.canceled || !r.filePath) return null;
      file = r.filePath;
    }
    return library.exportVla(id, file);
  });
  handle('library:remove', (_e, id) => library.remove(id));
  handle('library:setMeta', (_e, id, patch) => library.setMeta(id, patch || {}));
  handle('library:reveal', (_e, id) => shell.openPath(library.dirOf(id)));
  handle('library:refresh', (_e, id) => library.refresh(id));

  /* ─── one course ─── */
  handle('course:get', (_e, id) => library.getCourse(id));
  handle('course:readText', (_e, id, rel) => library.readText(id, rel));
  handle('course:readBinary', (_e, id, rel) => {
    const buf = library.readBinary(id, rel);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });
  handle('course:exists', (_e, id, rel) => library.exists(id, rel));
  handle('course:savePage', (_e, id, src, text) => library.savePage(id, src, String(text)));
  handle('course:saveAnnotations', (_e, id, data) => library.saveAnnotations(id, data));
  handle('course:saveProgress', (_e, id, data) => library.saveProgress(id, data));
  handle('course:saveState', (_e, id, state) => { library.saveState(id, state); return true; });
  handle('course:openFile', (_e, id, rel) => shell.openPath(library.absPath(id, rel)));
  handle('course:revealFile', (_e, id, rel) => { shell.showItemInFolder(library.absPath(id, rel)); return true; });
  handle('course:deletePage', (_e, id, src) => library.deletePage(id, src));
  handle('course:watch', (event, id) => (id ? watchCourse(event.sender, id, library.dirOf(id)) : (unwatch(event.sender), false)));
  handle('course:dir', (_e, id) => library.dirOf(id));
  handle('course:saveFileAs', async (event, id, rel) => {
    const src = library.absPath(id, rel);
    const win = BrowserWindow.fromWebContents(event.sender);
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), path.basename(src)) });
    if (r.canceled || !r.filePath) return null;
    fs.copyFileSync(src, r.filePath);
    return r.filePath;
  });

  /* ─── workspaces ─── */
  handle('ws:init', (_e, id, page, ws, starter) => library.wsInit(id, page, ws, starter));
  handle('ws:reset', (_e, id, page, ws, starter) => library.wsReset(id, page, ws, starter));
  handle('ws:list', (_e, id, page, ws) => library.wsList(id, page, ws));
  handle('ws:read', (_e, id, page, ws, rel) => library.wsRead(id, page, ws, rel));
  handle('ws:write', (_e, id, page, ws, rel, content) => library.wsWrite(id, page, ws, rel, content));
  handle('ws:delete', (_e, id, page, ws, rel) => library.wsDelete(id, page, ws, rel));
  handle('ws:rename', (_e, id, page, ws, from, to) => library.wsRename(id, page, ws, from, to));
  handle('ws:reveal', (_e, id, page, ws) => shell.openPath(library.wsPath(id, page, ws)));

  /* ─── running things ─── */
  handle('exec:check', (_e, names) => exec.checkCommands(names));
  handle('exec:python', () => exec.pythonCommand());
  handle('exec:run', async (event, spec = {}) => {
    const dir = resolveCwd(spec);
    const command = exec.expand(spec.command, templateCtx(spec, dir));
    if (!command.trim()) return { code: -1, stdout: '', stderr: 'empty command' };
    if (!(await ensureTrust(event, spec.courseId, `${zh() ? '运行命令' : 'run'}:\n${command}`))) return denied();
    fs.mkdirSync(dir, { recursive: true });
    const r = await exec.runCapture({ command, cwd: dir, stdin: spec.stdin, timeout: spec.timeout, env: spec.env, key: spec.key });
    return { ...r, command };
  });
  handle('exec:snippet', async (event, spec = {}) => {
    const runner = runnerFor(spec.runner || spec.lang, spec.runners || {});
    if (!runner) return { code: -1, stdout: '', stderr: `no runner for "${spec.runner || spec.lang}"` };
    const dir = path.join(P.temp, 'snippets', crypto.randomBytes(5).toString('hex'));
    fs.mkdirSync(dir, { recursive: true });
    const main = runner.main || 'main.txt';
    fs.writeFileSync(path.join(dir, main), String(spec.code ?? ''));
    const ctx = { ...templateCtx(spec, dir), main, file: main, dir };
    const build = runner.build ? exec.expand(runner.build, ctx) : '';
    const run = exec.expand(runner.run, ctx);
    if (!(await ensureTrust(event, spec.courseId, `${zh() ? '运行代码片段' : 'run a code snippet'}:\n${[build, run].filter(Boolean).join('\n')}`))) return denied();
    try {
      if (build) {
        const b = await exec.runCapture({ command: build, cwd: dir, timeout: spec.timeout || 60000, key: spec.key });
        if (b.code !== 0) return { ...b, phase: 'build', command: build };
      }
      const r = await exec.runCapture({ command: run, cwd: dir, stdin: spec.stdin, timeout: spec.timeout || 20000, key: spec.key });
      return { ...r, phase: 'run', command: run };
    } finally {
      setTimeout(() => fs.rm(dir, { recursive: true, force: true }, () => {}), 2000);
    }
  });
  handle('exec:cancel', (_e, key) => exec.cancelRun(key));
  handle('exec:expand', (_e, spec = {}) => {
    const dir = resolveCwd(spec);
    return { command: exec.expand(spec.command, templateCtx(spec, dir)), cwd: dir };
  });

  handle('pty:start', async (event, spec = {}) => {
    let cwd = resolveCwd(spec);
    let command = '';
    if (spec.claudeLogin) {
      command = claude.loginCommand();
      if (!command) return { error: zh() ? '没有找到 Claude Code' : 'Claude Code was not found' };
      cwd = os.homedir();
    } else if (spec.agent) {
      /* The learner's own AI agent, interactive, in the AI workspace or in the course folder. */
      const cfg = settings.load().ai.agent;
      const tpl = cfg.interactive || cfg.command;
      if (!tpl) return { error: zh() ? '还没有在「设置 → AI」里填写智能体命令' : 'No agent command in Settings → AI' };
      command = tpl.includes('{prompt}')
        ? tpl.replace('{prompt}', spec.prompt ? `"${String(spec.prompt).replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"` : '')
        : tpl;
      cwd = spec.agent === 'course' && spec.courseId ? library.dirOf(spec.courseId) : kit.prepare();
    } else if (spec.command) {
      command = exec.expand(spec.command, templateCtx(spec, cwd));
      if (!(await ensureTrust(event, spec.courseId, `${zh() ? '在终端运行' : 'run in a terminal'}:\n${command}`))) return { denied: true };
    }
    fs.mkdirSync(cwd, { recursive: true });
    const id = exec.ptyStart(event.sender, { cols: spec.cols, rows: spec.rows, cwd, command: command || undefined });
    return { id, cwd, command };
  });
  ipcMain.on('pty:write', (_e, id, data) => exec.ptyWrite(id, String(data)));
  ipcMain.on('pty:resize', (_e, id, cols, rows) => exec.ptyResize(id, cols, rows));
  ipcMain.on('pty:kill', (_e, id) => exec.ptyKill(id));

  handle('http:request', async (event, spec = {}) => {
    const url = String(spec.url || '');
    if (!/^https?:\/\//i.test(url)) return { error: 'only http(s) URLs are allowed' };
    if (!(await ensureTrust(event, spec.courseId, `${zh() ? '发送网络请求' : 'send a request'}:\n${(spec.method || 'GET').toUpperCase()} ${url}`))) return { denied: true };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(120000, spec.timeout || 30000));
    try {
      const body = spec.body == null ? undefined : typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body);
      const headers = { ...(spec.headers || {}) };
      if (body && typeof spec.body !== 'string' && !Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
      const res = await fetch(url, { method: (spec.method || 'GET').toUpperCase(), headers, body, signal: ctrl.signal });
      const text = await res.text();
      return { status: res.status, ok: res.ok, headers: Object.fromEntries(res.headers.entries()), text: text.slice(0, 2_000_000) };
    } catch (e) {
      return { error: e.name === 'AbortError' ? 'timeout' : e.message };
    } finally {
      clearTimeout(timer);
    }
  });

  /* ─── AI ─── */
  handle('ai:status', (_e, opts) => ai.fullStatus(opts || {}));
  handle('ai:claude', (event, req = {}) => {
    const cwd = req.courseId ? library.dirOf(req.courseId) : kit.prepare();
    const addDirs = [kit.prepare()];
    /* Resolve with { error, code } instead of rejecting: IPC drops custom error fields. */
    return claude.run(event.sender, { ...req, cwd, addDirs }).catch(e => ({ error: e.message, code: e.code || 'CLAUDE' }));
  });
  handle('ai:snapshot', (_e, id) => snapshot.take(library.dirOf(id)));
  handle('ai:snapshotDiff', (_e, snap) => snapshot.diff(snap));
  handle('ai:snapshotRestore', (_e, snap) => snapshot.restore(snap));
  handle('ai:live', (_e, ctx) => { writeLive(ctx); return true; });
  handle('mcp:status', () => claude.mcpStatus());
  handle('mcp:install', (_e, target) => (target === 'desktop' ? claude.mcpInstallDesktop() : claude.mcpInstallCode()));
  handle('mcp:remove', (_e, target) => (target === 'desktop' ? claude.mcpRemoveDesktop() : claude.mcpRemoveCode()));
  handle('ai:chat', (event, req) => ai.chat(event.sender, req));
  handle('ai:agent', (event, req) => {
    const cwd = req.courseId ? library.dirOf(req.courseId) : kit.workDir();
    return ai.agent(event.sender, { ...req, cwd });
  });
  handle('ai:abort', (_e, id) => ai.abort(id));

  /* ─── AI workspace ─── */
  handle('kit:prepare', event => { const dir = kit.prepare(); kit.watch(event.sender); return dir; });
  handle('kit:open', () => { const dir = kit.prepare(); return shell.openPath(dir); });
  handle('kit:watch', event => { if (kit.isPrepared()) kit.watch(event.sender); return kit.isPrepared(); });
}
