#!/usr/bin/env node
/* ============================================================
 * test/fake-agent.mjs — a stand-in for a command-line AI agent.
 * Run inside an unpacked course folder (the app does this when you
 * choose "let the AI agent handle notes"). It follows the rules of
 * ai_manual/05-annotations.md mechanically:
 *   ask    → append an "answer" comment, status "answered"
 *   revise → append a callout to the page, an "answer" comment, status "applied"
 * Settings → AI → agent command:  node "<repo>/test/fake-agent.mjs"
 * ============================================================ */

import fs from 'node:fs';
import path from 'node:path';

let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { prompt += d; });
process.stdin.on('end', run);
if (process.stdin.isTTY) run();

function run() {
  const file = path.resolve('annotations.json');
  if (!fs.existsSync(file)) { console.log('no annotations.json here'); return; }
  const ann = JSON.parse(fs.readFileSync(file, 'utf8'));
  const now = () => new Date().toISOString();
  const id = () => `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  let asked = 0;
  let revised = 0;
  for (const h of ann.highlights || []) {
    if (h.status !== 'open') continue;
    const question = [...(h.comments || [])].reverse().find(c => c.author === 'learner')?.text || '';
    const quote = (h.targets || []).find(t => t.type === 'text')?.exact || '';
    if (h.kind === 'ask') {
      h.comments.push({ id: id(), author: 'answer', created: now(), text: `**（模拟回答）** 你问：「${question}」。\n\n关于「${quote.slice(0, 40)}」：这是一个用来测试 AI 回路的模拟回答。` });
      h.status = 'answered';
      h.updated = now();
      asked++;
    } else if (h.kind === 'revise') {
      const page = path.join(h.page, 'index.md');
      fs.appendFileSync(page, `\n\n:::success[AI 已修改]\n按照你的要求「${question}」补充了这一段（模拟修改）。\n:::\n`);
      h.comments.push({ id: id(), author: 'answer', created: now(), text: '已在本页末尾补充了一段说明（模拟修改）。' });
      h.status = 'applied';
      h.updated = now();
      revised++;
    }
  }
  fs.writeFileSync(file, JSON.stringify(ann, null, 2) + '\n');
  console.log(`prompt: ${prompt.length} chars`);
  console.log(`answered ${asked} ask, applied ${revised} revise`);
}
