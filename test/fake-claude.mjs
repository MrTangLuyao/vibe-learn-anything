#!/usr/bin/env node
/* ============================================================
 * test/fake-claude.mjs — a stand-in for the agent CLI used by
 * test/e2e-chat.mjs. It speaks the same headless protocol the app
 * expects (-p, --output-format stream-json, --resume, --mcp-config)
 * and really talks to the app's MCP server from --mcp-config:
 *   • every turn calls get_current_context and answers with where the
 *     learner is (proves context reaches the AI);
 *   • a prompt containing "EDIT-TEST" in an editable turn appends a
 *     paragraph to the current page with edit_page.
 * ============================================================ */

import fs from 'node:fs';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const out = obj => process.stdout.write(`${JSON.stringify(obj)}\n`);

if (args.includes('--version')) { console.log('9.9.9 (fake agent)'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'oauth' })); process.exit(0); }
if (args[0] === 'auth' || args[0] === 'mcp') process.exit(0);
if (!args.includes('-p')) { console.error('fake agent: only -p is supported'); process.exit(2); }

/* ─── a tiny MCP client ─── */
function mcpClient(spec) {
  const child = spawn(spec.command, spec.args || [], { env: { ...process.env, ...(spec.env || {}) }, stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '';
  let seq = 0;
  const waiting = new Map();
  child.stdout.on('data', d => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg);
      waiting.delete(msg.id);
    }
  });
  const call = (method, params) => new Promise(resolve => {
    const id = ++seq;
    waiting.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  return {
    async init() { await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake', version: '1' } }); child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n'); },
    async tool(name, a) { const r = await call('tools/call', { name, arguments: a }); return r.result; },
    close() { child.kill(); },
  };
}

const prompt = await new Promise(resolve => { let s = ''; process.stdin.on('data', d => { s += d; }); process.stdin.on('end', () => resolve(s)); });
const session = opt('--resume') || `sess-${Date.now()}`;
const editable = opt('--permission-mode') === 'acceptEdits';
const cfg = JSON.parse(fs.readFileSync(opt('--mcp-config'), 'utf8'));
const server = cfg.mcpServers?.['vibe-learn'];
const t0 = Date.now();

out({ type: 'system', subtype: 'init', session_id: session, model: 'fake-model', mcp_servers: [{ name: 'vibe-learn', status: server ? 'connected' : 'failed' }] });

let tid = 0;
const toolUse = async (mcp, name, input) => {
  const id = `tu_${++tid}`;
  out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name: `mcp__vibe-learn__${name}`, input: {} } } });
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: `mcp__vibe-learn__${name}`, input }] } });
  const r = await mcp.tool(name, input);
  const text = (r?.content || []).map(c => c.text).join('\n');
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: !!r?.isError }] } });
  return { text, isError: !!r?.isError };
};
const say = text => {
  out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
  for (const piece of text.match(/[\s\S]{1,12}/g) || []) out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } } });
  out({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
};

let answer;
try {
  const mcp = mcpClient(server);
  await mcp.init();
  say('Let me look at where you are.');
  const ctx = await toolUse(mcp, 'get_current_context', {});
  const live = {};
  for (const k of ['courseId', 'page', 'pageTitle']) live[k] = new RegExp(`"${k}":\\s*"([^"]*)"`).exec(ctx.text)?.[1] || '';
  const code = /【学习者的代码】(\S+)|\[The learner's code\] (\S+)/.exec(prompt);
  if (prompt.includes('EDIT-TEST') && editable && live.page) {
    const page = await toolUse(mcp, 'read_page', { course_id: live.courseId, page: live.page });
    const body = /===== .*?\/index\.md =====\r?\n([\s\S]*?)\r?\n===== end of/.exec(page.text)?.[1] ?? '';
    await toolUse(mcp, 'write_page', { course_id: live.courseId, page: live.page, text: `${body.replace(/\s+$/, '')}\n\nAI-ADDED: a new example paragraph.\n` });
    await toolUse(mcp, 'validate_course', { course_id: live.courseId });
    answer = `I added an example to 「${live.pageTitle}」.`;
  } else {
    answer = `You are on 「${live.pageTitle || 'the library'}」 (${editable ? 'editable' : 'read-only'}, session ${opt('--resume') ? 'resumed' : 'new'}).${code ? ` I can see ${code[1] || code[2]}.` : ''}`;
  }
  mcp.close();
} catch (e) {
  answer = `fake agent failed: ${e.message}`;
}
say(answer);
out({ type: 'result', subtype: 'success', is_error: false, result: answer, session_id: session, total_cost_usd: 0.0012, duration_ms: Date.now() - t0, num_turns: 3 });
