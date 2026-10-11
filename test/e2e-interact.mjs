// Interactive smoke test: run code, tests, terminal, highlight→notes, quiz, edit, settings, help.
const go = (win, hash) => win.evaluate(h => { location.hash = h; }, hash);

export default async ({ win, shot, step, log }) => {
  await go(win, '#/');
  await win.waitForSelector('.course-card', { timeout: 15000 });

  await step('snippet run', async () => {
    await go(win, '#/learn/vla-tour/w1-workshop/1');
    await win.waitForSelector('.vt-code .btn-primary');
    await win.click('.vt-code .btn-primary');
    await win.waitForSelector('.vt-code-output .o-meta:not(:has(.spinner))', { timeout: 20000 });
    await win.waitForTimeout(300);
    log('output:', await win.textContent('.vt-code-output'));
    await shot('i01-snippet');
  });

  await step('workspace tests', async () => {
    await go(win, '#/learn/vla-tour/w1-workshop/2');
    await win.waitForSelector('.vx-ws .monaco-editor', { timeout: 20000 });
    await win.waitForTimeout(800);
    log('tabs:', await win.$$eval('.ws-tab span', els => els.map(e => e.textContent)));
    await win.click('.vx-ws .btn-primary');
    await win.waitForSelector('.test-row', { timeout: 30000 });
    await win.waitForTimeout(300);
    log('summary1:', await win.textContent('.tests-summary'));
    await shot('i02-tests-fail');
    await win.click('.ws-tab:has-text("search.js")');
    await win.waitForTimeout(500);
    await win.evaluate(() => {
      const m = window.monaco.editor.getModels().find(x => x.uri.path.endsWith('/search.js'));
      m.setValue("function binarySearch(a, x) {\n  let lo = 0, hi = a.length - 1;\n  while (lo <= hi) {\n    const mid = lo + ((hi - lo) >> 1);\n    if (a[mid] === x) return mid;\n    if (a[mid] < x) lo = mid + 1; else hi = mid - 1;\n  }\n  return -1;\n}\nmodule.exports = { binarySearch };\n");
    });
    await win.waitForTimeout(300);
    await win.click('.vx-ws .btn-primary');
    await win.waitForFunction(() => /5\/5|5 \/ 5/.test(document.querySelector('.tests-summary')?.textContent || ''), null, { timeout: 30000 });
    log('summary2:', await win.textContent('.tests-summary'));
    await shot('i03-tests-pass');
    await win.click('.vx-ws .ws-bottom-bar .btn-tonal');
    await win.waitForTimeout(3000);
    await shot('i04-run-terminal');
    log('page complete?', await win.$$eval('.page-item.is-current .pi-check svg', els => els.length));
  });

  await step('actions + terminal', async () => {
    await go(win, '#/learn/vla-tour/w1-workshop/3');
    await win.waitForSelector('.vx-button .btn-primary');
    await win.click('.vx-button .btn-primary');
    await win.waitForSelector('.vx-button .vx-output', { timeout: 20000 });
    log('script output:', await win.textContent('.vx-button .vx-output'));
    const gap = await win.evaluate(() => {
      const t = document.querySelector('.vx-terminal');
      return [...t.children].map(c => `${c.className}:${c.offsetHeight}`).join(' | ');
    });
    log('terminal children:', gap);
    await win.click('.vx-terminal .term-start .btn');
    await win.waitForTimeout(2500);
    await win.keyboard.type('echo hello-from-vla\r');
    await win.waitForTimeout(1500);
    await win.evaluate(() => document.querySelector('.vx-terminal').scrollIntoView({ block: 'center' }));
    await shot('i05-actions-terminal');
  });

  await step('quiz', async () => {
    await go(win, '#/learn/vla-tour/w0-check/1');
    await win.waitForSelector('.quiz-opt');
    const opts = await win.$$('.vx-quiz >> nth=0 >> .quiz-opt');
    await opts[0].click();
    await win.waitForTimeout(200);
    await opts[1].click();
    await win.waitForTimeout(400);
    await win.fill('.vx-quiz >> nth=2 >> input', '20');
    await win.press('.vx-quiz >> nth=2 >> input', 'Enter');
    await win.waitForTimeout(400);
    await shot('i06-quiz');
  });

  await step('highlight → ask', async () => {
    await go(win, '#/learn/vla-tour/w2-ai/1');
    await win.waitForSelector('.vt-article blockquote');
    await win.evaluate(() => {
      const bq = document.querySelector('.vt-article blockquote p');
      const r = document.createRange();
      r.selectNodeContents(bq);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      bq.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    });
    await win.waitForSelector('.sel-pop');
    await shot('i07-bubble');
    await win.click('.sel-pop .chip-btn >> nth=0');
    await win.waitForSelector('.hl-toolbar');
    await win.click('.vx-quiz + .vh-mark-btn');
    await win.waitForTimeout(300);
    await shot('i08-hl-mode');
    await win.click('.hl-done');
    await win.waitForSelector('.comment-new textarea');
    await win.fill('.comment-new textarea', '循环不变式具体怎么用来证明正确性？');
    await win.click('.comment-new .btn-primary');
    await win.waitForTimeout(500);
    await win.fill('.comment-new textarea', '第二条注释：顺便问一下边界。');
    await win.press('.comment-new textarea', 'Control+Enter');
    await win.waitForTimeout(500);
    await shot('i09-thread');
  });

  await step('edit mode', async () => {
    await go(win, '#/learn/vla-tour/w0-read/1');
    await win.waitForSelector('.vt-article');
    await win.click('[data-button-id="edit"]');
    await win.waitForSelector('.vt-article.is-inline-editing [data-ie-unit]', { timeout: 20000 });
    await win.waitForSelector('.ie-bar');
    log('editable units:', await win.$$eval('[data-ie-unit]', els => els.length));
    await win.waitForTimeout(300);
    await shot('i10-edit');
    await win.click('.ie-bar .ie-done');
    await win.waitForSelector('.reader .vt-article:not(.is-inline-editing)');
  });

  await step('pdf text layer', async () => {
    await go(win, '#/learn/vla-tour/w0-read/4');
    await win.waitForSelector('.textLayer span', { timeout: 20000 });
    await win.waitForTimeout(800);
    await shot('i11-pdf');
  });

  await step('widget', async () => {
    await go(win, '#/learn/vla-tour/w2-ai/2');
    await win.waitForTimeout(2500);
    await shot('i12-widget');
  });

  await step('settings + help + light', async () => {
    await go(win, '#/settings');
    await win.waitForSelector('.settings-card');
    await win.waitForTimeout(1200);
    await shot('i13-settings');
    await go(win, '#/help/m03');
    await win.waitForTimeout(1500);
    await shot('i14-help');
    await win.evaluate(() => window.vla.settings.set({ theme: 'light' }));
    await go(win, '#/learn/vla-tour/w0-read/2');
    await win.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await win.waitForTimeout(1500);
    await shot('i15-light');
    await go(win, '#/');
    await win.waitForTimeout(800);
    await shot('i16-light-dash');
    await win.evaluate(() => window.vla.settings.set({ theme: 'dark' }));
  });
};
