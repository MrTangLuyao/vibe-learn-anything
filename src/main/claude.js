/* ============================================================
 * src/main/claude.js — the learner's own Claude Code (`claude` CLI).
 *
 *   locate() / status()   find the CLI (PATH, the native installer,
 *                         npm, or the copy bundled with the desktop
 *                         app) and whether it is signed in
 *   run()                 one headless turn (-p, stream-json) inside a
 *                         course folder, with this app's MCP server
 *   mcp*()                register the MCP server with Claude Code /
 *                         the desktop app
 * ============================================================ */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { P } from './paths.js';
import * as settings from './settings.js';
import { buildEnv } from './exec.js';

const WIN = process.platform === 'win32';
const EXE = WIN ? 'claude.exe' : 'claude';
const SERVER = 'vibe-learn';
const MCP = `mcp__${SERVER}__`;
const READ_TOOLS = ['get_current_context', 'list_courses', 'get_course', 'read_page', 'list_annotations', 'validate_course', 'list_files', 'read_file'];
const WRITE_TOOLS = ['write_page', 'edit_page', 'create_page', 'reply_annotation', 'write_file'];

let located;
let statusCache = null;
let statusPending = null;
const procs = new Map();

/* ─── finding it ─── */

const versionKey = v => String(v).split(/[.-]/).map(n => n.padStart(8, '0')).join('.');

function appDataDir() {
  if (WIN) return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

/* The desktop app's data folders. The Microsoft Store (MSIX) build keeps its
   AppData inside the package — %LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming —
   which apps outside the package never see at the usual %APPDATA% path. */
function desktopDataDirs() {
  const dirs = [];
  if (WIN) {
    const pk = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Packages');
    try {
      for (const n of fs.readdirSync(pk)) if (/^Claude_/i.test(n)) dirs.push(path.join(pk, n, 'LocalCache', 'Roaming', 'Claude'));
    } catch { /* no packages folder */ }
  }
  dirs.push(path.join(appDataDir(), 'Claude'));
  return dirs.filter(d => fs.existsSync(d));
}

/* The desktop app keeps its own copy: <data>/claude-code/<version>/[<hash>/]claude — newest first. */
function desktopCopies() {
  const found = [];
  for (const data of desktopDataDirs()) {
    const base = path.join(data, 'claude-code');
    let versions = [];
    try { versions = fs.readdirSync(base).filter(v => /^\d/.test(v)); } catch { continue; }
    for (const v of versions) {
      const dir = path.join(base, v);
      found.push({ v, file: path.join(dir, EXE) });
      try { for (const sub of fs.readdirSync(dir)) found.push({ v, file: path.join(dir, sub, EXE) }); } catch { /* unreadable */ }
    }
  }
  return found.sort((a, b) => versionKey(b.v).localeCompare(versionKey(a.v))).map(x => x.file);
}

function onPath() {
  try {
    const r = WIN
      ? spawnSync('where', ['claude'], { encoding: 'utf8', windowsHide: true, timeout: 4000 })
      : spawnSync('/bin/sh', ['-lc', 'command -v claude'], { encoding: 'utf8', timeout: 4000 });
    if (r.status !== 0) return [];
    const lines = r.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    /* Windows: npm also drops an extensionless shell script next to claude.cmd. */
    return WIN ? lines.filter(l => /\.(exe|cmd|bat)$/i.test(l)) : lines;
  } catch { return []; }
}

const isFile = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };

export function locate({ fresh = false } = {}) {
  if (located !== undefined && !fresh) return located;
  const home = os.homedir();
  const list = [
    settings.get('ai.claude.path'),
    ...onPath(),
    path.join(home, '.local', 'bin', EXE),
    path.join(home, '.claude', 'local', EXE),
    WIN ? path.join(appDataDir(), 'npm', 'claude.cmd') : '/usr/local/bin/claude',
    ...(process.platform === 'darwin' ? ['/opt/homebrew/bin/claude'] : []),
    ...desktopCopies(),
  ].filter(Boolean);
  located = list.find(isFile) || null;
  return located;
}

/* ─── spawning ─── */

function quoteWin(s) {
  s = String(s);
  return /[\s"&|<>^%]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function spawnCli(file, args, opts) {
  /* .cmd shims (npm installs) need a shell; real executables never get one. */
  if (WIN && /\.(cmd|bat)$/i.test(file)) return spawn([file, ...args].map(quoteWin).join(' '), { ...opts, shell: true, windowsHide: true });
  return spawn(file, args, { ...opts, windowsHide: true });
}

function capture(file, args, timeout = 15000) {
  return new Promise(resolve => {
    let out = '';
    let err = '';
    let child;
    try { child = spawnCli(file, args, { env: buildEnv(), stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { resolve({ code: -1, stdout: '', stderr: e.message }); return; }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, timeout);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { err += e.message; });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout: out, stderr: err }); });
  });
}

/* ─── status ─── */

async function probe(fresh) {
  const file = locate({ fresh });
  if (!file) return { found: false };
  const v = await capture(file, ['--version'], 20000);
  const version = /(\d+\.\d+\.\d+)/.exec(v.stdout)?.[1] || null;
  let loggedIn = null;
  let authMethod = null;
  const a = await capture(file, ['auth', 'status'], 20000);
  try {
    const j = JSON.parse(a.stdout.slice(a.stdout.indexOf('{')));
    loggedIn = !!j.loggedIn;
    authMethod = j.authMethod || null;
  } catch { /* older CLI without `auth status` */ }
  if (!loggedIn && process.env.ANTHROPIC_API_KEY) { loggedIn = true; authMethod = 'api-key'; }
  return {
    found: true,
    path: file,
    version,
    loggedIn,
    authMethod,
    bundled: /[\\/]claude-code[\\/]\d/.test(file),
    works: v.code === 0,
  };
}

export function cachedStatus() {
  return statusCache?.value || null;
}

export function status({ fresh = false } = {}) {
  if (!fresh && statusCache && Date.now() - statusCache.at < 5 * 60 * 1000) return Promise.resolve(statusCache.value);
  if (statusPending) return statusPending;
  statusPending = probe(fresh)
    .then(value => { statusCache = { at: Date.now(), value }; return value; })
    .finally(() => { statusPending = null; });
  return statusPending;
}

/* ─── the MCP server this app ships (dist/kit/tools/vla.mjs mcp) ─── */

export function mcpServerSpec() {
  const tool = path.join(P.kit, 'tools', 'vla.mjs').replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked');
  return { command: process.execPath, args: [tool, 'mcp', '--data', P.data], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

function mcpConfigFile() {
  const file = path.join(P.temp, 'mcp-vibe-learn.json');
  fs.mkdirSync(P.temp, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { [SERVER]: mcpServerSpec() } }, null, 2));
  return file;
}

/* ─── one headless turn ─── */

function short(v, n = 160) {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? '');
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/* What the page needs to show a tool step — never whole file contents. */
function toolInput(input = {}) {
  const out = {};
  for (const k of ['file_path', 'path', 'pattern', 'glob', 'command', 'url', 'query', 'course_id', 'page', 'chapter_id', 'name', 'highlight_id', 'dir', 'description']) {
    if (input[k] != null) out[k] = short(input[k]);
  }
  return out;
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(c => (typeof c === 'string' ? c : c?.text || '')).join('\n');
  return '';
}

const LOGIN_RE = /\/login|log ?in|not logged|invalid api key|authenticat|oauth token|credential/i;

function failure(message, extra = {}) {
  const e = new Error(message);
  e.code = LOGIN_RE.test(message) ? 'NO_LOGIN' : 'CLAUDE';
  Object.assign(e, extra);
  return e;
}

function buildArgs({ mode, sessionId, model, addDirs, partial }) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  if (partial) args.push('--include-partial-messages');
  args.push('--mcp-config', mcpConfigFile());
  if (!settings.get('ai.claude.userMcp')) args.push('--strict-mcp-config');
  if (mode === 'edit') {
    args.push('--permission-mode', 'acceptEdits',
      '--allowedTools', ['Read', 'Glob', 'Grep', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'TodoWrite', 'WebSearch', 'WebFetch', `mcp__${SERVER}`].join(','));
  } else {
    args.push('--allowedTools', ['Read', 'Glob', 'Grep', 'TodoWrite', 'WebSearch', 'WebFetch', ...READ_TOOLS.map(n => MCP + n)].join(','),
      '--disallowedTools', ['Bash', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', ...WRITE_TOOLS.map(n => MCP + n)].join(','));
  }
  for (const d of addDirs || []) if (d && fs.existsSync(d)) args.push('--add-dir', d);
  if (model) args.push('--model', model);
  if (sessionId) args.push('--resume', sessionId);
  return args;
}

function runOnce(wc, req, partial) {
  const file = locate();
  if (!file) return Promise.reject(Object.assign(new Error('Claude Code was not found'), { code: 'NO_CLAUDE' }));
  const { requestId, prompt, cwd } = req;
  const send = (ch, payload) => { if (!wc.isDestroyed()) wc.send(ch, { requestId, ...payload }); };
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnCli(file, buildArgs({ ...req, partial }), { cwd: cwd && fs.existsSync(cwd) ? cwd : os.homedir(), env: buildEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { reject(failure(e.message)); return; }
    const job = { child, aborted: false };
    procs.set(requestId, job);
    let buf = '';
    let stderr = '';
    let final = null;
    let sessionId = req.sessionId || null;
    let streamed = false;
    let sawOutput = false;

    const handle = line => {
      let m;
      try { m = JSON.parse(line); } catch { send('ai:log', { text: `${line}\n` }); return; }
      sawOutput = true;
      if (m.parent_tool_use_id) return;
      switch (m.type) {
        case 'system':
          if (m.subtype === 'init') {
            sessionId = m.session_id || sessionId;
            send('ai:event', { kind: 'init', sessionId, model: m.model, mcp: (m.mcp_servers || []).map(s => ({ name: s.name, status: s.status })) });
          }
          break;
        case 'stream_event': {
          const ev = m.event || {};
          if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') { streamed = true; send('ai:event', { kind: 'text-start' }); }
          else if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') send('ai:event', { kind: 'tool-start', id: ev.content_block.id, name: ev.content_block.name });
          else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') send('ai:chunk', { delta: ev.delta.text });
          break;
        }
        case 'assistant':
          for (const b of m.message?.content || []) {
            if (b.type === 'text' && !streamed && b.text) { send('ai:event', { kind: 'text-start' }); send('ai:chunk', { delta: b.text }); }
            if (b.type === 'tool_use') send('ai:event', { kind: 'tool', id: b.id, name: b.name, input: toolInput(b.input) });
          }
          break;
        case 'user':
          for (const b of m.message?.content || []) {
            if (b.type === 'tool_result') send('ai:event', { kind: 'tool-result', id: b.tool_use_id, isError: !!b.is_error, text: short(resultText(b.content), 300) });
          }
          break;
        case 'result':
          final = m;
          sessionId = m.session_id || sessionId;
          break;
        default:
          break;
      }
    };

    child.stdout.on('data', d => {
      buf += d.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) handle(line);
      }
    });
    child.stderr.on('data', d => { const s = d.toString('utf8'); stderr += s; send('ai:log', { text: s }); });
    child.stdin.on('error', () => {});
    child.on('error', e => reject(failure(e.message)));
    child.on('close', code => {
      procs.delete(requestId);
      if (buf.trim()) handle(buf.trim());
      if (job.aborted) { resolve({ text: final?.result || '', aborted: true, sessionId }); return; }
      if (final) {
        const text = String(final.result ?? '');
        if (final.is_error || (final.subtype && final.subtype !== 'success')) {
          reject(failure(text || stderr.trim() || final.subtype, { sessionId }));
          return;
        }
        resolve({ text, sessionId, cost: final.total_cost_usd ?? null, ms: final.duration_ms ?? null, turns: final.num_turns ?? null });
        return;
      }
      const err = failure(stderr.trim() || `Claude Code exited with code ${code}`, { sessionId });
      err.noOutput = !sawOutput;
      reject(err);
    });
    child.stdin.end(String(prompt ?? ''));
  });
}

/* req: { requestId, prompt, firstPrompt?, cwd, mode: 'ask'|'edit', sessionId?, model?, addDirs? } */
export async function run(wc, req) {
  const model = req.model ?? settings.get('ai.claude.model') ?? '';
  const base = { ...req, model };
  try {
    return await runOnce(wc, base, true);
  } catch (e) {
    /* Older CLIs: no --include-partial-messages. */
    if (e.noOutput && /unknown option|include-partial/i.test(e.message)) return runOnce(wc, base, false);
    /* A conversation that can no longer be resumed: start a fresh one. */
    if (req.sessionId && /no conversation found|session[^.]*not found|invalid session/i.test(e.message)) {
      return runOnce(wc, { ...base, sessionId: null, prompt: req.firstPrompt || req.prompt }, true);
    }
    throw e;
  }
}

export function abort(requestId) {
  const job = procs.get(requestId);
  if (!job) return false;
  job.aborted = true;
  if (WIN) spawn('taskkill', ['/pid', String(job.child.pid), '/T', '/F'], { windowsHide: true });
  else job.child.kill('SIGTERM');
  return true;
}

export function loginCommand() {
  const file = locate();
  if (!file) return null;
  return `${WIN ? quoteWin(file) : `'${file.replace(/'/g, `'\\''`)}'`} auth login`;
}

/* ─── registering the MCP server elsewhere ─── */

function desktopConfigPath() {
  const dirs = desktopDataDirs();
  const files = dirs.map(d => path.join(d, 'claude_desktop_config.json'));
  return files.find(f => fs.existsSync(f)) || files[0] || path.join(appDataDir(), 'Claude', 'claude_desktop_config.json');
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function mcpStatus() {
  const user = readJsonSafe(path.join(os.homedir(), '.claude.json'));
  const desktopFile = desktopConfigPath();
  const desktop = readJsonSafe(desktopFile);
  return {
    server: mcpServerSpec(),
    code: !!user?.mcpServers?.[SERVER],
    desktop: !!desktop?.mcpServers?.[SERVER],
    desktopInstalled: desktopDataDirs().length > 0,
    desktopConfig: desktopFile,
  };
}

export async function mcpInstallCode() {
  const file = locate();
  if (!file) throw new Error('Claude Code was not found');
  const spec = mcpServerSpec();
  await capture(file, ['mcp', 'remove', '-s', 'user', SERVER], 20000);
  const r = await capture(file, ['mcp', 'add', '-s', 'user', SERVER, '-e', 'ELECTRON_RUN_AS_NODE=1', '--', spec.command, ...spec.args], 30000);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.code}`).trim());
  return mcpStatus();
}

export async function mcpRemoveCode() {
  const file = locate();
  if (file) await capture(file, ['mcp', 'remove', '-s', 'user', SERVER], 20000);
  return mcpStatus();
}

export function mcpInstallDesktop() {
  const file = desktopConfigPath();
  const cfg = readJsonSafe(file) || {};
  if (fs.existsSync(file) && !readJsonSafe(file)) throw new Error(`cannot parse ${file}`);
  cfg.mcpServers = { ...(cfg.mcpServers || {}), [SERVER]: mcpServerSpec() };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  return mcpStatus();
}

export function mcpRemoveDesktop() {
  const file = desktopConfigPath();
  const cfg = readJsonSafe(file);
  if (cfg?.mcpServers?.[SERVER]) {
    delete cfg.mcpServers[SERVER];
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  }
  return mcpStatus();
}
