// AI panel + live course editing + page menu + fullscreen pages, against
// test/fake-claude.mjs (a stand-in agent CLI that uses the real MCP server).
//   node test/drive.mjs test/e2e-chat.mjs
import fs from 'node:fs';
import path from 'node:path';

const go = (win, hash) => win.evaluate(h => { location.hash = h; }, hash);
const text = (win, sel) => win.evaluate(s => document.querySelector(s)?.textContent || '', sel);

export default async ({ win, shot, step, log, userData, root }) => {
  const cmd = path.join(userData, 'fake-agent.cmd');
  fs.writeFileSync(cmd, `@"${process.execPath}" "${path.join(root, 'test', 'fake-claude.mjs')}" %*\r\n`);
  await win.evaluate(p => window.vla.settings.set({ ai: { claude: { path: p, allowEdits: true } } }), cmd);

  await go(win, '#/');
  await win.waitForSelector('.course-card', { timeout: 15000 });

  await step('chat: ask with page context (fresh session)', async () => {
    await go(win, '#/learn/vla-tour/w0-read/1');
    await win.waitForSelector('.vt-article h1, .vt-article .vt-header');
    await win.click('.appbar .ai-btn');
    await win.waitForSelector('.chat-panel');
    await win.waitForFunction(() => /Claude Code/.test(document.querySelector('.chat-provider')?.textContent || ''), null, { timeout: 30000 });
    log('chips:', await text(win, '.chat-chips'));
    const liveFile = path.join(userData, 'live.json');
    for (let i = 0; i < 40 && !fs.existsSync(liveFile); i++) await win.waitForTimeout(100);
    const live = JSON.parse(fs.readFileSync(liveFile, 'utf8'));
    log('live.json:', live.view, live.courseId, live.page, live.pageTitle);
    await win.fill('.chat-input', '这一页讲什么？');
    await win.press('.chat-input', 'Enter');
    await win.waitForFunction(() => /You are on/.test(document.querySelector('.cm-ai:last-child .cm-text')?.textContent || ''), null, { timeout: 60000 });
    const answer = await text(win, '.cm-ai:last-child .cm-text');
    log('answer:', answer);
    if (!/editable/.test(answer) || !/session new/.test(answer)) throw new Error(`unexpected answer: ${answer}`);
    log('steps:', await text(win, '.cm-ai:last-child .cm-steps'));
    await shot('c01-chat-ask');
  });

  await step('chat: AI edits the page live, then undo', async () => {
    const readPage = () => win.evaluate(() => window.vla.course.readText('vla-tour', 'content/w0/welcome.vitent/index.md'));
    const before = await readPage();
    await win.fill('.chat-input', 'EDIT-TEST 请在这一页末尾加一个例子');
    await win.press('.chat-input', 'Enter');
    await win.waitForSelector('.cm-ai:last-child .cm-changes', { timeout: 60000 });
    await win.waitForFunction(() => /AI-ADDED/.test(document.querySelector('.reader .vt-article')?.textContent || ''), null, { timeout: 15000 });
    log('changes:', await text(win, '.cm-ai:last-child .cm-changes summary'));
    log('answer:', await text(win, '.cm-ai:last-child .cm-text'));
    const resumed = await win.evaluate(() => [...document.querySelectorAll('.cm-ai .cm-text')].map(e => e.textContent));
    log('turns:', resumed.length);
    await shot('c02-chat-edit');
    await win.click('.cm-ai:last-child .cm-undo');
    await win.waitForFunction(() => !/AI-ADDED/.test(document.querySelector('.reader .vt-article')?.textContent || ''), null, { timeout: 15000 });
    const after = await readPage();
    log('undo restored page file:', after === before);
    if (after !== before) throw new Error('undo did not restore the page file');
  });

  await step('workspace: AI button, code context, editor menu, maximize', async () => {
    await go(win, '#/learn/vla-tour/w1-workshop/2');
    await win.waitForSelector('.vx-ws .monaco-editor', { timeout: 20000 });
    await win.waitForTimeout(600);
    await win.click('.vx-ws .monaco-editor .view-lines');
    await win.waitForTimeout(300);
    await win.click('.vx-ws .ws-ai');
    await win.click('.menu .menu-item:has-text("解释这段代码")');
    await win.waitForFunction(() => /I can see main\.js/.test(document.querySelector('.cm-ai:last-child .cm-text')?.textContent || ''), null, { timeout: 60000 });
    log('code answer:', await text(win, '.cm-ai:last-child .cm-text'));
    log('user tags:', await win.evaluate(() => [...document.querySelectorAll('.cm-user')].pop()?.querySelector('.cm-tags')?.textContent || ''));
    await shot('c03-ws-ai');

    const lines = await win.$('.vx-ws .monaco-editor .view-lines');
    const b = await lines.boundingBox();
    await win.mouse.click(b.x + 120, b.y + 40, { button: 'right' });
    await win.waitForTimeout(500);
    const menuInfo = await win.evaluate(() => {
      const hosts = [...document.querySelectorAll('.shadow-root-host')];
      const host = hosts.find(x => x.shadowRoot?.querySelector('.monaco-menu-container')) || hosts[0];
      /* The painted surface is some element inside the menu container. */
      const painted = [...(host?.shadowRoot?.querySelectorAll('.monaco-menu-container, .monaco-menu-container *') || [])]
        .map(e => ({ cls: String(e.className).slice(0, 40), bg: getComputedStyle(e).backgroundColor }))
        .find(x => x.bg && x.bg !== 'rgba(0, 0, 0, 0)' && x.bg !== 'transparent');
      return { hosts: hosts.length, bg: painted ? `${painted.bg} on .${painted.cls}` : null, hostVar: host ? getComputedStyle(host).getPropertyValue('--vscode-menu-background') : null, text: host?.shadowRoot?.textContent?.slice(-300) || '' };
    });
    log('menu probe:', JSON.stringify(menuInfo).slice(0, 600));
    log('editor menu bg:', menuInfo.bg, '| has AI item:', /问 AI/.test(menuInfo.text));
    if (!menuInfo.bg || menuInfo.bg === 'rgba(0, 0, 0, 0)') throw new Error('editor context menu has no background');
    await shot('c04-editor-menu');
    await win.keyboard.press('Escape');

    await win.click('.vx-ws .ws-head .icon-btn:last-child');
    await win.waitForTimeout(300);
    const rect = await win.evaluate(() => {
      const r = document.querySelector('.vx-ws.is-max').getBoundingClientRect();
      return { top: r.top, right: r.right, width: innerWidth, chat: document.querySelector('.chat-panel')?.offsetWidth || 0 };
    });
    log('maximized:', JSON.stringify(rect));
    if (rect.top < 47) throw new Error('maximized workspace overlaps the title bar');
    await shot('c05-ws-max');
    await win.keyboard.press('Escape');
  });

  await step('fullscreen page fills the reader', async () => {
    await go(win, '#/learn/vla-tour/w1-workshop/4');
    await win.waitForSelector('.reader.is-fill .vx-fullscreen .vx-ws', { timeout: 20000 });
    await win.waitForTimeout(600);
    const sizes = await win.evaluate(() => {
      const r = document.querySelector('.reader').getBoundingClientRect();
      const w = document.querySelector('.vx-fullscreen .vx-ws').getBoundingClientRect();
      return { reader: [Math.round(r.width), Math.round(r.height)], ws: [Math.round(w.width), Math.round(w.height)] };
    });
    log('fill sizes:', JSON.stringify(sizes));
    if (Math.abs(sizes.reader[1] - sizes.ws[1]) > 4) throw new Error('fullscreen block does not fill the reader');
    await shot('c06-fullscreen');
  });

  await step('page list: right-click complete / reset', async () => {
    await go(win, '#/learn/vla-tour/w0-read/2');
    await win.waitForSelector('.page-item.is-current');
    const item = '.page-item:nth-child(2)';
    await win.click(item, { button: 'right' });
    await win.click('.menu .menu-item:has-text("标记为已完成")');
    await win.waitForSelector(`${item} .pi-check svg`);
    log('marked done via menu');
    await win.click(item, { button: 'right' });
    await shot('c07-page-menu');
    await win.click('.menu .menu-item:has-text("重置进度")');
    await win.click('.dialog .btn-primary');
    await win.waitForFunction(s => !document.querySelector(`${s} .pi-check svg`), item);
    log('reset via menu');
  });

  await step('quiz: answer, then start over', async () => {
    await go(win, '#/learn/vla-tour/w0-check/1');
    await win.waitForSelector('.vx-quiz .quiz-opt');
    await win.click('.vx-quiz >> nth=0 >> .quiz-opt >> nth=0');
    await win.waitForTimeout(300);
    const answered = await win.evaluate(() => document.querySelector('.vx-quiz').classList.contains('is-correct') || document.querySelector('.vx-quiz').classList.contains('is-wrong'));
    await win.click('.vx-quiz >> nth=0 >> .vx-reset');
    await win.waitForTimeout(600);
    const cleared = await win.evaluate(() => { const q = document.querySelector('.vx-quiz'); return !q.classList.contains('is-correct') && !q.classList.contains('is-wrong') && !q.querySelector('.is-picked, .is-right, .is-bad'); });
    log('quiz answered:', answered, '→ cleared:', cleared);
    if (!cleared) throw new Error('quiz reset did not clear the answer');
  });

  await step('page list: delete a page (with confirmation)', async () => {
    await go(win, '#/learn/vla-tour/w0-check/2');
    await win.waitForSelector('.page-item.is-current');
    const n0 = await win.$$eval('.page-item', els => els.length);
    await win.click('.page-item.is-current', { button: 'right' });
    await win.click('.menu .menu-item:has-text("删除这一页")');
    await win.waitForSelector('.dialog');
    await win.click('.dialog .btn-danger');
    await win.waitForFunction(n => document.querySelectorAll('.page-item').length === n - 1, n0, { timeout: 10000 });
    const course = await win.evaluate(() => window.vla.course.get('vla-tour'));
    const still = JSON.stringify(course.course).includes('flashcards.vitent');
    log('pages:', n0, '→', n0 - 1, '| still in course.json:', still);
    if (still) throw new Error('deleted page is still in course.json');
  });
};
