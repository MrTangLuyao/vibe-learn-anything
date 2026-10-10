/* ============================================================
 * src/main/exec.js — running things on the learner's machine.
 *   runCapture()   one-shot command, stdout/stderr captured (tests, snippets)
 *   pty*()         terminal sessions for xterm (node-pty, pipe fallback)
 *   expand()       runner template variables
 * Course-supplied commands are only reached after ipc.js asked the
 * learner to trust the course.
 * ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { P } from './paths.js';
import * as settings from './settings.js';
import { platformCommand } from '../shared/runners.mjs';

const require = createRequire(import.meta.url);
let nodePty = null;
try { nodePty = require('node-pty'); } catch { nodePty = null; }

const WIN = process.platform === 'win32';
const stripAnsi = s => s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
const whichCache = new Map();
let pythonCache = null;

export const hasPty = () => !!nodePty;

export function which(name) {
  if (whichCache.has(name)) return whichCache.get(name);
  let found = null;
  try {
    const r = WIN
      ? spawnSync('where', [name], { encoding: 'utf8', windowsHide: true, timeout: 4000 })
      : spawnSync('/bin/sh', ['-c', `command -v ${JSON.stringify(name)}`], { encoding: 'utf8', timeout: 4000 });
    if (r.status === 0) found = r.stdout.split(/\r?\n/).find(Boolean) || null;
  } catch { found = null; }
  whichCache.set(name, found);
  return found;
}

export function clearCaches() {
  whichCache.clear();
  pythonCache = null;
}

function works(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    return r.status === 0 && /Python 3/.test(`${r.stdout}${r.stderr}`);
  } catch { return false; }
}

export function pythonCommand() {
  const forced = settings.get('python');
  if (forced) return forced;
  if (pythonCache) return pythonCache;
  const tries = WIN ? [['py', ['-3']], ['python', []], ['python3', []]] : [['python3', []], ['python', []]];
  for (const [cmd, pre] of tries) {
    if (works(cmd, [...pre, '--version'])) { pythonCache = [cmd, ...pre].join(' '); return pythonCache; }
  }
  pythonCache = WIN ? 'python' : 'python3';
  return pythonCache;
}

/* bin/ holds `node` (only when the system has none) and `vla` shims, so
   courses can always rely on Node.js and on the course tool. */
export function ensureShims() {
  fs.mkdirSync(P.bin, { recursive: true });
  const exe = process.execPath;
  /* Packaged apps keep the kit inside app.asar; external processes need the unpacked copy. */
  const kitTool = path.join(P.kit, 'tools', 'vla.mjs').replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked');
  const needNode = !which('node');
  if (WIN) {
    const nodeCmd = `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exe}" %*\r\n`;
    fs.writeFileSync(path.join(P.bin, 'vla-node.cmd'), nodeCmd);
    if (needNode) fs.writeFileSync(path.join(P.bin, 'node.cmd'), nodeCmd);
    else fs.rmSync(path.join(P.bin, 'node.cmd'), { force: true });
    fs.writeFileSync(path.join(P.bin, 'vla.cmd'), `@echo off\r\ncall "%~dp0vla-node.cmd" "${kitTool}" %*\r\n`);
  } else {
    const nodeSh = `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${exe}" "$@"\n`;
    const write = (name, body) => { const f = path.join(P.bin, name); fs.writeFileSync(f, body); fs.chmodSync(f, 0o755); };
    write('vla-node', nodeSh);
    if (needNode) write('node', nodeSh);
    else fs.rmSync(path.join(P.bin, 'node'), { force: true });
    write('vla', `#!/bin/sh\nexec "$(dirname "$0")/vla-node" "${kitTool}" "$@"\n`);
  }
}

export function buildEnv(extra = {}) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  const key = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
  env[key] = `${P.bin}${path.delimiter}${env[key] || ''}`;
  env.PYTHONUTF8 = '1';
  env.PYTHONIOENCODING = 'utf-8';
  env.TERM = env.TERM || 'xterm-256color';
  env.COLORTERM = 'truecolor';
  for (const [k, v] of Object.entries(extra || {})) if (v != null) env[k] = String(v);
  return env;
}

/* ─── templates ─── */

function quote(s) {
  s = String(s);
  if (WIN) return /[\s&()^|<>"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

function filesWithExt(dir, ext) {
  const out = [];
  const visit = (abs, rel) => {
    let ents = [];
    try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!e.name.startsWith('.')) visit(path.join(abs, e.name), r); }
      else if (e.name.toLowerCase().endsWith(ext.toLowerCase())) out.push(r);
    }
  };
  visit(dir, '');
  return out.sort();
}

export function expand(template, ctx = {}) {
  const cmd = platformCommand(template, process.platform);
  return cmd.replace(/\{(\w+)(?::([^}]+))?\}/g, (all, name, arg) => {
    switch (name) {
      case 'main': return ctx.main ? quote(ctx.main) : all;
      case 'file': return ctx.file ? quote(ctx.file) : all;
      case 'files': return filesWithExt(ctx.dir || '.', arg || '').map(quote).join(' ');
      case 'exe': return WIN ? '.exe' : '';
      case 'bin': return WIN ? `.\\${arg}.exe` : `./${arg}`;
      case 'node': return 'node';
      case 'python': return pythonCommand();
      case 'dir': return ctx.dir ? quote(ctx.dir) : all;
      case 'page': return ctx.page ? quote(ctx.page) : all;
      case 'course': return ctx.course ? quote(ctx.course) : all;
      default: return all;
    }
  });
}

/* ─── one-shot commands ─── */

function killTree(child) {
  if (!child || child.exitCode != null) return;
  if (WIN) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
}

const running = new Map();

export function runCapture({ command, cwd, stdin = '', timeout = 30000, env, key }) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const full = WIN ? `chcp 65001>nul & ${command}` : command;
    let child;
    try {
      child = spawn(full, { cwd, env: buildEnv(env), shell: true, windowsHide: true, detached: !WIN });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String(e.message), timedOut: false, ms: 0 });
      return;
    }
    if (key) running.set(key, child);
    let out = '';
    let err = '';
    let timedOut = false;
    const CAP = 1_000_000;
    child.stdout.on('data', d => { if (out.length < CAP) out += d.toString('utf8'); });
    child.stderr.on('data', d => { if (err.length < CAP) err += d.toString('utf8'); });
    child.stdin.on('error', () => {});
    child.on('error', e => { err += e.message; });
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, Math.max(1000, timeout));
    child.on('close', code => {
      clearTimeout(timer);
      if (key) running.delete(key);
      resolve({ code: timedOut ? null : code, stdout: stripAnsi(out), stderr: stripAnsi(err), timedOut, ms: Date.now() - t0 });
    });
    if (stdin) child.stdin.write(String(stdin));
    child.stdin.end();
  });
}

export function cancelRun(key) {
  const c = running.get(key);
  if (c) killTree(c);
}

/* ─── terminal sessions ─── */

const sessions = new Map();
let nextId = 1;

function defaultShell() {
  const pref = settings.get('shell');
  if (pref) {
    const parts = pref.match(/"[^"]+"|\S+/g).map(s => s.replace(/^"|"$/g, ''));
    return { file: parts[0], args: parts.slice(1) };
  }
  if (WIN) return { file: 'powershell.exe', args: ['-NoLogo'] };
  return { file: process.env.SHELL || '/bin/bash', args: ['-l'] };
}

export function ptyStart(wc, { cols = 80, rows = 24, cwd, command, env }) {
  const id = nextId++;
  const send = (ch, payload) => { if (!wc.isDestroyed()) wc.send(ch, payload); };
  const environment = buildEnv(env);
  const dir = cwd && fs.existsSync(cwd) ? cwd : (process.env.USERPROFILE || process.env.HOME || process.cwd());
  let file;
  let args;
  if (command) {
    if (WIN) { file = process.env.ComSpec || 'cmd.exe'; args = `/d /s /c "chcp 65001>nul & ${command}"`; }
    else { file = '/bin/sh'; args = ['-c', command]; }
  } else {
    ({ file, args } = defaultShell());
  }

  if (nodePty) {
    let p;
    try {
      p = nodePty.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd: dir, env: environment });
    } catch (e) {
      setTimeout(() => { send('pty:data', { id, data: `\r\n\x1b[31m${e.message}\x1b[0m\r\n` }); send('pty:exit', { id, code: -1 }); }, 0);
      return id;
    }
    sessions.set(id, { kind: 'pty', p, wc });
    p.onData(data => send('pty:data', { id, data }));
    p.onExit(({ exitCode }) => { sessions.delete(id); send('pty:exit', { id, code: exitCode }); });
    return id;
  }

  /* No node-pty: plain pipes. Line-based, but programs still run. */
  const child = command
    ? spawn(WIN ? `chcp 65001>nul & ${command}` : command, { cwd: dir, env: environment, shell: true, windowsHide: true })
    : spawn(file, Array.isArray(args) ? args : [], { cwd: dir, env: environment, windowsHide: true });
  sessions.set(id, { kind: 'pipe', p: child, wc });
  const fwd = d => send('pty:data', { id, data: d.toString('utf8').replace(/\r?\n/g, '\r\n') });
  child.stdout.on('data', fwd);
  child.stderr.on('data', fwd);
  child.stdin.on('error', () => {});
  child.on('error', e => fwd(Buffer.from(`\n${e.message}\n`)));
  child.on('close', code => { sessions.delete(id); send('pty:exit', { id, code }); });
  return id;
}

export function ptyWrite(id, data) {
  const s = sessions.get(id);
  if (!s) return;
  if (s.kind === 'pty') s.p.write(data);
  else {
    const text = data.replace(/\r/g, '\n');
    s.p.stdin.write(text);
    s.wc.send('pty:data', { id, data: data.replace(/\r/g, '\r\n') });
  }
}

export function ptyResize(id, cols, rows) {
  const s = sessions.get(id);
  if (s && s.kind === 'pty') { try { s.p.resize(Math.max(2, cols), Math.max(2, rows)); } catch { /* exited */ } }
}

export function ptyKill(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  try { if (s.kind === 'pty') s.p.kill(); else killTree(s.p); } catch { /* already gone */ }
}

export function killAllFor(wc) {
  for (const [id, s] of sessions) if (s.wc === wc) ptyKill(id);
}

/* ─── command presence checks for course requirements ─── */

function pythonWorks() {
  const [cmd, ...pre] = pythonCommand().split(' ');
  return works(cmd, [...pre, '--version']);
}

export function checkCommands(names) {
  const out = {};
  for (const n of names || []) {
    const name = String(n).trim().split(/\s+/)[0];
    if (!name) continue;
    out[n] = /^python3?$/.test(name) ? (pythonWorks() ? pythonCommand() : null) : which(name);
  }
  return out;
}
