/* ============================================================
 * src/main/ai.js — talking to an AI, provider-neutral.
 *
 *   chat()   OpenAI-compatible POST {baseUrl}/chat/completions, streamed.
 *            Base URL, model and key come from Settings → AI.
 *   agent()  a local command-line agent (Settings → AI → agent command).
 *            The prompt goes to stdin, or replaces {prompt} in the command.
 *            Runs inside the course folder so it can edit files directly.
 * ============================================================ */

import { spawn } from 'node:child_process';
import * as settings from './settings.js';
import { buildEnv } from './exec.js';
import * as claude from './claude.js';

const WIN = process.platform === 'win32';
const controllers = new Map();
const agents = new Map();

/* Quick, synchronous view; claude is whatever was last probed (null = not yet). */
export function status() {
  const s = settings.load().ai;
  return {
    http: !!(s.http.baseUrl && s.http.model),
    agent: !!s.agent.command,
    interactive: !!(s.agent.interactive || s.agent.command),
    claude: claude.cachedStatus(),
    prefer: s.prefer || 'auto',
  };
}

export async function fullStatus({ fresh = false } = {}) {
  const c = await claude.status({ fresh });
  return { ...status(), claude: c };
}

function endpoint(base) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(b)) return b;
  return `${b}/chat/completions`;
}

export async function chat(wc, { requestId, messages, temperature, maxTokens }) {
  const cfg = settings.load().ai.http;
  if (!cfg.baseUrl || !cfg.model) throw new Error('AI HTTP endpoint is not configured (Settings → AI)');
  const ctrl = new AbortController();
  controllers.set(requestId, ctrl);
  const send = (ch, payload) => { if (!wc.isDestroyed()) wc.send(ch, { requestId, ...payload }); };
  const key = settings.apiKey();
  const headers = { 'content-type': 'application/json', accept: 'text/event-stream' };
  if (key) headers.authorization = `Bearer ${key}`;
  let full = '';
  try {
    const res = await fetch(endpoint(cfg.baseUrl), {
      method: 'POST',
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream: true,
        temperature: temperature ?? cfg.temperature ?? 0.3,
        max_tokens: maxTokens ?? cfg.maxTokens ?? 2048,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 400)}`);
    }
    const type = res.headers.get('content-type') || '';
    if (!type.includes('event-stream')) {
      const json = await res.json();
      full = json.choices?.[0]?.message?.content ?? '';
      send('ai:chunk', { delta: full });
      return { text: full };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const delta = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? '';
          if (delta) { full += delta; send('ai:chunk', { delta }); }
          if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
    return { text: full };
  } catch (e) {
    if (e.name === 'AbortError') return { text: full, aborted: true };
    throw e;
  } finally {
    controllers.delete(requestId);
  }
}

export function abort(requestId) {
  claude.abort(requestId);
  controllers.get(requestId)?.abort();
  const a = agents.get(requestId);
  if (a) {
    if (WIN) spawn('taskkill', ['/pid', String(a.pid), '/T', '/F'], { windowsHide: true });
    else a.kill('SIGTERM');
  }
}

function quoteArg(s) {
  if (WIN) return `"${String(s).replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/* Non-interactive agent run. Resolves with everything it printed. */
export function agent(wc, { requestId, prompt, cwd }) {
  const cfg = settings.load().ai.agent;
  if (!cfg.command) return Promise.reject(new Error('AI agent command is not configured (Settings → AI)'));
  const usesArg = cfg.command.includes('{prompt}');
  const command = usesArg ? cfg.command.replace('{prompt}', quoteArg(prompt)) : cfg.command;
  const send = (ch, payload) => { if (!wc.isDestroyed()) wc.send(ch, { requestId, ...payload }); };
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(WIN ? `chcp 65001>nul & ${command}` : command, { cwd, env: buildEnv(), shell: true, windowsHide: true });
    } catch (e) { reject(e); return; }
    agents.set(requestId, child);
    let out = '';
    let err = '';
    child.stdout.on('data', d => { const t = d.toString('utf8'); out += t; send('ai:chunk', { delta: t }); });
    child.stderr.on('data', d => { const t = d.toString('utf8'); err += t; send('ai:log', { text: t }); });
    child.stdin.on('error', () => {});
    child.on('error', e => reject(e));
    child.on('close', code => {
      agents.delete(requestId);
      if (code === 0 || out.trim()) resolve({ text: out.trim(), code, stderr: err.slice(-4000) });
      else reject(new Error(`agent exited with code ${code}: ${err.slice(-800)}`));
    });
    if (!usesArg && cfg.stdin !== false) child.stdin.write(prompt);
    child.stdin.end();
  });
}
