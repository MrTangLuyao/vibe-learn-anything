/* ============================================================
 * ai.js — everything that talks to the learner's AI.
 *   ask()            quick Q&A (HTTP endpoint, else the agent command)
 *   runAgent()       the agent works inside the course folder
 *   *Prompt()        the instructions we hand to an AI
 * ============================================================ */

import { getLang, t } from './core/i18n.js';
import { state } from './core/store.js';

let reqSeq = 0;

export async function status() {
  return window.vla.ai.status();
}

function stream(kind, req, onDelta, onLog) {
  const requestId = `r${Date.now()}-${++reqSeq}`;
  const offChunk = window.vla.ai.onChunk(p => { if (p.requestId === requestId) onDelta?.(p.delta); });
  const offLog = window.vla.ai.onLog(p => { if (p.requestId === requestId) onLog?.(p.text); });
  const promise = (kind === 'chat' ? window.vla.ai.chat({ ...req, requestId }) : window.vla.ai.agent({ ...req, requestId }))
    .finally(() => { offChunk(); offLog(); });
  return { promise, abort: () => window.vla.ai.abort(requestId), requestId };
}

/* Q&A. Prefers the HTTP endpoint; falls back to the CLI agent. */
export async function ask({ messages, courseId, onDelta, onLog }) {
  const s = await status();
  const pref = state.settings?.ai?.prefer || 'auto';
  const useHttp = s.http && (pref !== 'agent' || !s.agent);
  if (useHttp) return stream('chat', { messages }, onDelta, onLog);
  if (s.agent) {
    const prompt = messages.map(m => (m.role === 'system' ? m.content : `${m.role === 'user' ? '### Learner' : '### Answer'}\n${m.content}`)).join('\n\n');
    return stream('agent', { prompt: `${prompt}\n\n${getLang() === 'en' ? 'Reply with the answer only (Markdown). Do not modify any files.' : '只输出回答本身（Markdown），不要修改任何文件。'}`, courseId }, onDelta, onLog);
  }
  throw Object.assign(new Error(t('ai.notConfigured')), { code: 'NO_AI' });
}

export function runAgent({ prompt, courseId, onDelta, onLog }) {
  return stream('agent', { prompt, courseId }, onDelta, onLog);
}

/* Forward slashes read cleanly in prompts and work on every OS. */
const slash = p => String(p || '').replace(/\\/g, '/');

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

/* The agent edits the unpacked course in place (cwd = course folder). */
export function agentPrompt({ workDir: dir, ids, course }) {
  const workDir = slash(dir);
  const list = ids?.length ? ids.join(', ') : null;
  return getLang() === 'en'
    ? `You are "answer", the AI tutor of the Vibe Learn Anything course "${course.title}". The current directory is the unpacked course (course.json, content/**/*.vitent/index.md, annotations.json).
Formats: read ${workDir}/ai_manual/05-annotations.md and ${workDir}/ai_manual/02-vitent-format.md first.
Task: in annotations.json handle ${list ? `these highlights: ${list}` : 'every highlight whose kind is "ask" or "revise" and whose status is "open"'}.
- ask: append {"id": "c-<random>", "author": "answer", "text": "<Markdown answer>", "created": "<ISO time>"} to its comments; set status "answered" and update "updated".
- revise: edit the page's index.md as the learner asked (keep valid Vitent syntax), then append an "answer" comment describing the change; set status "applied". If you changed the highlighted text, update targets[].exact to the new wording.
- Never delete or rewrite learner comments. Do not touch other highlights. Edit files in place; do not pack.
Finally run: node "${workDir}/tools/vla.mjs" validate .  and fix any error. Reply in English with a short summary.`
    : `你是 Vibe Learn Anything 课程「${course.title}」的 AI 助教 answer。当前目录就是解包后的课程（course.json、content/**/*.vitent/index.md、annotations.json）。
格式说明：先阅读 ${workDir}/ai_manual/05-annotations.md 和 ${workDir}/ai_manual/02-vitent-format.md。
任务：处理 annotations.json 中${list ? `这些高亮：${list}` : '所有 kind 为 "ask" 或 "revise" 且 status 为 "open" 的高亮'}。
- ask：在 comments 末尾追加 {"id": "c-<随机>", "author": "answer", "text": "<Markdown 回答>", "created": "<ISO 时间>"}，status 改为 "answered"，并更新 "updated"。
- revise：按学习者的要求修改对应页面的 index.md（保持 Vitent 语法正确），再追加一条 answer 评论说明改了什么，status 改为 "applied"；如果被高亮的原文被改掉了，把 targets[].exact 更新为新的文字。
- 不要删除或改写 learner 的评论，不要动其他高亮。直接修改当前目录里的文件，不要打包。
最后运行：node "${workDir}/tools/vla.mjs" validate .  并修复所有错误。最后用中文简短总结你做了什么。`;
}
