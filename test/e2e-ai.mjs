// AI loop end to end: a local OpenAI-compatible SSE endpoint for "Ask AI now",
// and test/fake-agent.mjs as the command-line agent that edits the course.
//   node test/drive.mjs test/e2e-ai.mjs --trust vla-tour
import http from 'node:http';
import path from 'node:path';

const go = (win, hash) => win.evaluate(h => { location.hash = h; }, hash);

function fakeEndpoint() {
  const server = http.createServer((req, res) => {
    if (!req.url.endsWith('/chat/completions')) { res.writeHead(404); res.end(); return; }
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      const { messages } = JSON.parse(body);
      const q = messages[messages.length - 1].content.split('\n').pop();
      const parts = ['这是一个', '**流式**', '回答。\n\n', `你的问题是：${q.slice(0, 60)}\n\n`, '- 要点一：不变式在循环开始前成立\n', '- 要点二：每次迭代后仍然成立\n', '- $O(\\log n)$ 次迭代后终止'];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      let i = 0;
      const timer = setInterval(() => {
        if (i < parts.length) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`);
        else { res.write('data: [DONE]\n\n'); res.end(); clearInterval(timer); }
      }, 60);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function selectAndAsk(win, selector, kind, question) {
  await win.evaluate(sel => {
    const el = document.querySelector(sel);
    el.scrollIntoView({ block: 'center' });
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  }, selector);
  await win.waitForSelector('.sel-pop');
  await win.click(`.sel-pop .chip-btn >> nth=${kind === 'ask' ? 0 : 1}`);
  await win.waitForSelector('.hl-toolbar');
  await win.click('.hl-done');
  await win.waitForSelector('.comment-new textarea');
  await win.fill('.comment-new textarea', question);
}

export default async ({ win, shot, step, log, root }) => {
  const server = await fakeEndpoint();
  const port = server.address().port;
  const agent = `node "${path.join(root, 'test', 'fake-agent.mjs')}"`;
  try {
    await win.waitForSelector('.course-card', { timeout: 15000 });
    await win.evaluate(([p, a]) => window.vla.settings.set({ ai: { http: { baseUrl: `http://127.0.0.1:${p}/v1`, model: 'fake-model', key: 'test-key' }, agent: { command: a, stdin: true } } }), [port, agent]);

    await step('ask now (streamed over HTTP)', async () => {
      await go(win, '#/learn/vla-tour/w2-ai/1');
      await win.waitForSelector('.vt-article blockquote');
      await selectAndAsk(win, '.vt-article blockquote p', 'ask', '循环不变式怎么用来证明二分查找是对的？');
      await win.click('.comment-new .btn-tonal');
      await win.waitForSelector('.comment.is-answer .c-body', { timeout: 20000 });
      await win.waitForFunction(() => !document.querySelector('.comment .ai-streaming'), null, { timeout: 20000 });
      await win.waitForTimeout(500);
      log('answer:', (await win.textContent('.comment.is-answer .c-body')).slice(0, 80));
      await shot('ai-01-ask-now');
    });

    await step('revise via the agent', async () => {
      await go(win, '#/learn/vla-tour/w0-read/2');
      await win.waitForSelector('.vt-article blockquote');
      await win.click('.side-panel-head .icon-btn >> nth=-1').catch(() => {});
      await selectAndAsk(win, '.vt-article blockquote p', 'revise', '请再加一个生活中的例子。');
      await win.click('.comment-new .btn-primary');
      await win.waitForTimeout(400);
      await go(win, '#/course/vla-tour');
      await win.waitForSelector('.course-actions .btn-tonal');
      await win.click('.course-actions .btn-tonal');
      await win.click('.menu-item >> nth=0');
      await win.waitForSelector('.dialog .ai-streaming', { timeout: 10000 });
      await win.waitForFunction(() => /完成|Done/.test(document.querySelector('.dialog .ai-streaming')?.textContent || ''), null, { timeout: 30000 });
      log('agent log:', await win.textContent('.dialog pre'));
      await shot('ai-02-agent-done');
      await win.click('.dialog-foot .btn');
      await go(win, '#/learn/vla-tour/w0-read/2');
      await win.waitForSelector('.vt-article');
      await win.waitForTimeout(800);
      const revisedCallout = await win.$('.vx-callout[data-type="success"]');
      log('revised callout present:', !!revisedCallout);
      await win.evaluate(() => document.querySelector('.vx-callout[data-type="success"]')?.scrollIntoView({ block: 'center' }));
      await shot('ai-03-revised-page');
      const ann = await win.evaluate(() => window.vla.course.get('vla-tour').then(d => d.annotations.highlights.map(h => `${h.kind}:${h.status}:${h.comments.map(c => c.author).join('+')}`)));
      log('annotations:', ann.join(' | '));
    });

    await step('ask popover from ::ask', async () => {
      await go(win, '#/learn/vla-tour/w2-ai/1');
      await win.waitForSelector('.vx-ask .ask-chip');
      await win.evaluate(() => document.querySelector('.vx-ask').scrollIntoView({ block: 'center' }));
      await win.click('.vx-ask .ask-chip');
      await win.waitForSelector('.ask-pop');
      await win.click('.ask-pop .btn-primary');
      await win.waitForFunction(() => document.querySelector('.ask-pop .vt-article')?.textContent.includes('要点二'), null, { timeout: 20000 });
      await win.waitForTimeout(400);
      await shot('ai-04-ask-popover');
      await win.click('.ask-pop .btn-tonal');
      await win.waitForTimeout(500);
    });

    await step('export for AI', async () => {
      await go(win, '#/course/vla-tour');
      await win.waitForSelector('.course-actions .btn-tonal');
      await win.click('.course-actions .btn-tonal');
      await win.click('.menu-item >> nth=1');
      await win.waitForSelector('.dialog .steps-list', { timeout: 20000 });
      await win.waitForTimeout(400);
      await shot('ai-05-export-dialog');
      await win.keyboard.press('Escape');
    });

    await step('dashboard badges', async () => {
      await go(win, '#/');
      await win.waitForSelector('.course-card');
      await win.waitForTimeout(500);
      await shot('ai-06-dashboard');
    });
  } finally {
    server.close();
  }
};
