/* ============================================================
 * ai.js — everything that talks to the learner's AI.
 *   status() / pickProvider()   which AI answers: Claude Code (the
 *                               learner's own CLI), an HTTP endpoint,
 *                               or another command-line agent
 *   ask()                       quick Q&A
 *   runAgent()                  the AI works inside the course folder
 *   turn()                      one turn of the side-panel chat
 *   *Prompt()                   the instructions we hand to an AI
 * ============================================================ */

import { getLang, t } from './core/i18n.js';
import { state } from './core/store.js';

let reqSeq = 0;
let lastStatus = null;

export async function status(opts = {}) {
  lastStatus = await window.vla.ai.status(opts);
  return lastStatus;
}

export function cachedStatus() {
  return lastStatus;
}

/* 'claude' | 'http' | 'agent' | null */
export function pickProvider(s) {
  if (!s) return null;
  const pref = state.settings?.ai?.prefer || 'auto';
  const c = s.claude;
  const has = { claude: !!c?.found, http: !!s.http, agent: !!s.agent };
  if (pref !== 'auto' && has[pref]) return pref;
  if (c?.found && c.loggedIn !== false) return 'claude';
  if (s.http) return 'http';
  if (s.agent) return 'agent';
  if (c?.found) return 'claude';
  return null;
}

function aiError(r) {
  const e = new Error(r.error);
  e.code = r.code || 'AI';
  return e;
}

/* handlers: onDelta(text piece), onText(whole current text), onEvent(e), onLog(text) */
function stream(kind, req, handlers = {}) {
  const requestId = `r${Date.now()}-${++reqSeq}`;
  let text = '';
  let started = false;
  const offs = [
    window.vla.ai.onChunk(p => {
      if (p.requestId !== requestId) return;
      text += p.delta;
      handlers.onDelta?.(p.delta);
      handlers.onText?.(text);
    }),
    window.vla.ai.onLog(p => { if (p.requestId === requestId) handlers.onLog?.(p.text); }),
    window.vla.ai.onEvent(p => {
      if (p.requestId !== requestId) return;
      /* A new text block after tool use: the answer starts over (handlers see
         the event first, while the previous text is still there). */
      handlers.onEvent?.(p);
      if (p.kind === 'text-start') { if (started && text) { text = ''; handlers.onText?.(''); } started = true; }
    }),
  ];
  const call = kind === 'chat' ? window.vla.ai.chat : kind === 'claude' ? window.vla.ai.claude : window.vla.ai.agent;
  const promise = call({ ...req, requestId })
    .then(r => { if (r?.error) throw aiError(r); return r; })
    .finally(() => offs.forEach(off => off()));
  return { promise, abort: () => window.vla.ai.abort(requestId), requestId };
}

const flatten = messages => messages
  .map(m => (m.role === 'system' ? m.content : `${m.role === 'user' ? '### Learner' : '### Answer'}\n${m.content}`))
  .join('\n\n');

function noAi() {
  return Object.assign(new Error(t('ai.notConfigured')), { code: 'NO_AI' });
}

/* Q&A. Resolves to a job { promise, abort }. */
export async function ask({ messages, courseId, onDelta, onText, onLog, onEvent }) {
  const s = await status();
  const p = pickProvider(s);
  const handlers = { onDelta, onText, onLog, onEvent };
  if (p === 'http') return stream('chat', { messages }, handlers);
  const readOnly = getLang() === 'en' ? 'Reply with the answer only (Markdown). Do not modify any files.' : '只输出回答本身（Markdown），不要修改任何文件。';
  if (p === 'claude') return stream('claude', { prompt: `${flatten(messages)}\n\n${readOnly}`, courseId, mode: 'ask' }, handlers);
  if (p === 'agent') return stream('agent', { prompt: `${flatten(messages)}\n\n${readOnly}`, courseId }, handlers);
  throw noAi();
}

/* The AI edits the course folder (or the AI workspace) in place. */
export async function runAgent({ prompt, courseId, onDelta, onText, onLog, onEvent }) {
  const s = await status();
  const p = pickProvider(s);
  const handlers = { onDelta, onText, onLog, onEvent };
  if (p === 'claude') return stream('claude', { prompt, courseId, mode: 'edit' }, handlers);
  if (s.agent) return stream('agent', { prompt, courseId }, handlers);
  throw Object.assign(new Error(t('ai.agentMissing')), { code: 'NO_AGENT' });
}

/* One chat turn. provider from pickProvider(); for http, `messages` carries the history. */
export function turn(provider, { prompt, firstPrompt, messages, courseId, mode, sessionId }, handlers) {
  if (provider === 'claude') return stream('claude', { prompt, firstPrompt, courseId, mode, sessionId }, handlers);
  if (provider === 'http') return stream('chat', { messages, maxTokens: 4096 }, handlers);
  if (provider === 'agent') return stream('agent', { prompt: firstPrompt || prompt, courseId }, handlers);
  throw noAi();
}

/* Forward slashes read cleanly in prompts and work on every OS. */
export const slash = p => String(p || '').replace(/\\/g, '/');

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n…(truncated)` : s);

/* Messages for an "ask" thread. */
export function askMessages({ course, pageTitle, pageText, highlight, question }) {
  const en = getLang() === 'en';
  const sys = en
    ? `You are "answer", the teaching assistant inside Vibe Learn Anything for the course "${course.title}". ${course.ai?.context || ''}
Answer the learner's question about the highlighted material: accurate, concise, friendly, step by step when useful. Use Markdown, $…$ / $$…$$ for math and fenced code blocks with a language. Reply in English.`
    : `你是 Vibe Learn Anything 中课程「${course.title}」的助教 answer。${course.ai?.context || ''}
请回答学习者关于高亮内容的问题：准确、简洁、友好，必要时分步骤讲解。使用 Markdown，数学用 $…$ / $$…$$，代码用带语言标注的代码块。用中文回答。`;
  const targets = (highlight?.targets || []).map(tg => (tg.type === 'text'
    ? `> ${tg.exact}${tg.section ? `\n(${en ? 'section' : '所在小节'}: ${tg.section})` : ''}`
    : `[${tg.widget || 'block'}: ${tg.label || tg.block}]${tg.detail ? `\n${JSON.stringify(tg.detail).slice(0, 2000)}` : ''}`)).join('\n\n');
  const thread = (highlight?.comments || []).map(c => `${c.author}: ${c.text}`).join('\n');
  const user = `${en ? 'Page' : '页面'}: ${pageTitle}

${en ? 'Page content (Vitent Markdown)' : '页面内容（Vitent Markdown）'}:
"""
${clip(pageText || '', 14000)}
"""

${targets ? `${en ? 'Highlighted' : '学习者高亮的内容'}:\n${targets}\n\n` : ''}${thread ? `${en ? 'Thread so far' : '已有讨论'}:\n${thread}\n\n` : ''}${en ? 'Question' : '问题'}: ${question}`;
  return [{ role: 'system', content: sys }, { role: 'user', content: user }];
}

/* Asking the AI agent to generate a new course in the AI workspace. */
export function generatePrompt(dir) {
  const workDir = slash(dir);
  return getLang() === 'en'
    ? `Read ${workDir}/generate_course.md and follow it: interview me with questions first, then generate a Vibe Learn Anything course (.vla) for me and pack it into ${workDir}/out/.`
    : `请阅读 ${workDir}/generate_course.md 并严格按照其中的流程：先向我提问了解需求，再为我生成一门 Vibe Learn Anything 课程（.vla），最后打包到 ${workDir}/out/。`;
}

/* The learner exported a .vla for an AI to process its annotations. */
export function exportPrompt({ workDir: dir, file, id }) {
  const workDir = slash(dir);
  return getLang() === 'en'
    ? `Process the learner's annotations in ${file} following ${workDir}/ai_manual/05-annotations.md:
1. node "${workDir}/tools/vla.mjs" unpack "${file}" "${workDir}/courses/${id}" (if the folder exists, unpack elsewhere and merge), then run  node "${workDir}/tools/vla.mjs" notes "${workDir}/courses/${id}"
2. Every open "ask" highlight: add a comment with author "answer" that answers it; set status "answered".
3. Every open "revise" highlight: edit the .vitent page as requested, then add an "answer" comment saying what changed; set status "applied".
4. Bump the course version, validate, and pack to ${workDir}/out/${id}.vla — the app will offer to import it.`
    : `请按照 ${workDir}/ai_manual/05-annotations.md 处理这个课程文件里学习者的标注：${file}
1. 运行 node "${workDir}/tools/vla.mjs" unpack "${file}" "${workDir}/courses/${id}"（目录已存在就解包到别处再合并），然后运行 node "${workDir}/tools/vla.mjs" notes "${workDir}/courses/${id}" 查看待处理的标注；
2. 每个 open 状态的「问 AI」(ask) 高亮：以 answer 身份追加一条回答评论，状态改为 answered；
3. 每个 open 状态的「请 AI 修改」(revise) 高亮：按要求修改对应的 .vitent 页面，再以 answer 身份说明改了什么，状态改为 applied；
4. 课程版本号 +0.0.1，校验通过后打包到 ${workDir}/out/${id}.vla —— 应用会提示导入。`;
}

/* The agent edits the unpacked course in place (cwd = course folder).
   mcp: the agent has this app's MCP tools (and no shell). */
export function agentPrompt({ workDir: dir, ids, course, mcp = false }) {
  const workDir = slash(dir);
  const list = ids?.length ? ids.join(', ') : null;
  const validate = getLang() === 'en'
    ? (mcp ? 'Finally call the vibe-learn MCP tool validate_course and fix any error.' : `Finally run: node "${workDir}/tools/vla.mjs" validate .  and fix any error.`)
    : (mcp ? '最后调用 vibe-learn MCP 工具 validate_course 校验，并修复所有错误。' : `最后运行：node "${workDir}/tools/vla.mjs" validate .  并修复所有错误。`);
  return getLang() === 'en'
    ? `You are "answer", the AI tutor of the Vibe Learn Anything course "${course.title}". The current directory is the unpacked course (course.json, content/**/*.vitent/index.md, annotations.json).
Formats: read ${workDir}/ai_manual/05-annotations.md and ${workDir}/ai_manual/02-vitent-format.md first.
Task: in annotations.json handle ${list ? `these highlights: ${list}` : 'every highlight whose kind is "ask" or "revise" and whose status is "open"'}.
- ask: append {"id": "c-<random>", "author": "answer", "text": "<Markdown answer>", "created": "<ISO time>"} to its comments; set status "answered" and update "updated".${mcp ? ' (The MCP tool reply_annotation does exactly this.)' : ''}
- revise: edit the page's index.md as the learner asked (keep valid Vitent syntax), then append an "answer" comment describing the change; set status "applied". If you changed the highlighted text, update targets[].exact to the new wording.
- Never delete or rewrite learner comments. Do not touch other highlights. Edit files in place; do not pack.
${validate} Reply in English with a short summary.`
    : `你是 Vibe Learn Anything 课程「${course.title}」的 AI 助教 answer。当前目录就是解包后的课程（course.json、content/**/*.vitent/index.md、annotations.json）。
格式说明：先阅读 ${workDir}/ai_manual/05-annotations.md 和 ${workDir}/ai_manual/02-vitent-format.md。
任务：处理 annotations.json 中${list ? `这些高亮：${list}` : '所有 kind 为 "ask" 或 "revise" 且 status 为 "open" 的高亮'}。
- ask：在 comments 末尾追加 {"id": "c-<随机>", "author": "answer", "text": "<Markdown 回答>", "created": "<ISO 时间>"}，status 改为 "answered"，并更新 "updated"。${mcp ? '（MCP 工具 reply_annotation 就是做这件事的。）' : ''}
- revise：按学习者的要求修改对应页面的 index.md（保持 Vitent 语法正确），再追加一条 answer 评论说明改了什么，status 改为 "applied"；如果被高亮的原文被改掉了，把 targets[].exact 更新为新的文字。
- 不要删除或改写 learner 的评论，不要动其他高亮。直接修改当前目录里的文件，不要打包。
${validate}最后用中文简短总结你做了什么。`;
}
