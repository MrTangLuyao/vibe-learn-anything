// In-place (Typora-style) text editing: edit text by keyboard, verify the
// saved index.md byte for byte, and that widgets stay locked.
//   node test/drive.mjs test/e2e-edit.mjs --trust vla-tour
const COURSE = 'vla-tour';
const go = (win, hash) => win.evaluate(h => { location.hash = h; }, hash);
const read = (win, rel) => win.evaluate(([c, r]) => window.vla.course.readText(c, r), [COURSE, rel]);

function check(cond, msg) {
  if (!cond) throw new Error(`check failed: ${msg}`);
}

async function until(fn, what, ms = 6000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    last = await fn();
    if (last) return last;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/* Tag the editable unit (tag, containing text) so it can be targeted. */
async function tagUnit(win, sel, text, name) {
  const ok = await win.evaluate(([s, t, n]) => {
    const el = [...document.querySelectorAll(`.vt-article ${s}`)].find(e => e.matches('[data-ie-unit]') && e.textContent.includes(t));
    if (!el) return false;
    el.setAttribute('data-test', n);
    return true;
  }, [sel, text, name]);
  check(ok, `editable ${sel} containing "${text}"`);
  return `[data-test="${name}"]`;
}

async function caretEnd(win, sel) {
  await win.evaluate(s => {
    const el = document.querySelector(s);
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const se = getSelection();
    se.removeAllRanges();
    se.addRange(r);
  }, sel);
}

async function selectText(win, sel, text) {
  const ok = await win.evaluate(([s, t]) => {
    const el = document.querySelector(s);
    el.focus();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const i = n.nodeValue.indexOf(t);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + t.length);
      const se = getSelection();
      se.removeAllRanges();
      se.addRange(r);
      return true;
    }
    return false;
  }, [sel, text]);
  check(ok, `text "${text}" in ${sel}`);
}

async function blurAndWait(win, wanted, rel, label) {
  await win.keyboard.press('Escape');
  return until(async () => {
    const txt = await read(win, rel);
    const state = await win.evaluate(() => document.querySelector('.ie-bar')?.dataset.state);
    return state === 'saved' && wanted(txt) ? txt : null;
  }, label);
}

async function hoverLocked(win, sel) {
  await win.evaluate(s => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
  await win.waitForTimeout(350);
  const r = await win.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + Math.min(30, b.height / 2) }; }, sel);
  await win.mouse.move(r.x, r.y);
  await win.mouse.move(r.x + 4, r.y + 2);
  await win.waitForSelector('.ie-lock-hint');
  return win.textContent('.ie-lock-hint');
}

async function enterEdit(win) {
  await win.click('[data-button-id="edit"]');
  await win.waitForSelector('.vt-article.is-inline-editing [data-ie-unit]');
  await win.waitForSelector('.ie-bar');
}

async function exitEdit(win) {
  await win.click('.ie-bar .ie-done');
  await win.waitForSelector('.reader .vt-article:not(.is-inline-editing)');
  await win.waitForFunction(() => !document.querySelector('.ie-bar'));
}

export default async ({ win, shot, step, log }) => {
  await go(win, '#/');
  await win.waitForSelector('.course-card', { timeout: 15000 });

  /* ─── text, math, lists, tables ─── */
  const PAGE = 'content/w0/text-and-math.vitent/index.md';
  let original;
  let lines;

  await step('open the text page and highlight a sentence', async () => {
    await go(win, '#/learn/vla-tour/w0-read/2');
    await win.waitForSelector('.vt-article table');
    original = await read(win, PAGE);
    lines = original.split('\n');
    log('line endings:', original.includes('\r\n') ? 'CRLF' : 'LF', '· lines:', lines.length);
    await win.evaluate(() => {
      const p = [...document.querySelectorAll('.vt-article p')].find(e => e.textContent.includes('还有几个行内小组件'));
      const r = document.createRange();
      r.selectNodeContents(p);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    });
    await win.waitForSelector('.sel-pop');
    await win.click('.sel-pop .hl-swatch >> nth=0');
    await win.waitForSelector('.vt-article mark.vh');
  });

  await step('enter edit mode: text editable, controls locked', async () => {
    await enterEdit(win);
    const s = await win.evaluate(() => {
      const a = document.querySelector('.vt-article');
      const ce = el => el.isContentEditable;
      return {
        units: a.querySelectorAll('[data-ie-unit]').length,
        marks: a.querySelectorAll('mark.vh, .vh-dot').length,
        codeEditable: [...a.querySelectorAll('.vt-code, .vt-code *')].some(ce),
        mathBlockEditable: [...a.querySelectorAll('.vt-math-block, .vt-math-block *')].some(ce),
        mermaidEditable: [...a.querySelectorAll('.vt-mermaid, .vt-mermaid *')].some(ce),
        headerEditable: [...a.querySelectorAll('.vt-header, .vt-header *')].some(ce),
        atomsLocked: [...a.querySelectorAll('[data-ie-unit] .vt-math, [data-ie-unit] kbd, [data-ie-unit] .vt-badge, [data-ie-unit] .vt-term, [data-ie-unit] .vt-icon')].every(e => e.getAttribute('contenteditable') === 'false' && !ce(e)),
        whole: a.isContentEditable,
        h2: a.querySelectorAll('h2[data-ie-unit]').length,
        cells: a.querySelectorAll('td[data-ie-unit], th[data-ie-unit]').length,
        items: a.querySelectorAll('li > p[data-ie-unit]').length,
      };
    });
    log('edit state:', JSON.stringify(s));
    check(s.units >= 20, 'many editable units');
    check(s.marks === 0, 'highlights are unpainted while editing');
    check(!s.codeEditable && !s.mathBlockEditable && !s.mermaidEditable && !s.headerEditable, 'widgets are not editable');
    check(s.atomsLocked, 'inline atoms are contenteditable=false');
    check(!s.whole, 'the article itself is not contenteditable');
    check(s.h2 === 5 && s.cells === 12 && s.items === 5, 'headings, cells and list items are editable');
    const hint = await hoverLocked(win, '.vt-code');
    check(hint.includes('控件不能在这里修改'), 'locked hint text');
    await shot('e01-edit-mode');
  });

  const expect = [...lines];
  const L = text => {
    const i = lines.findIndex(l => l.includes(text));
    check(i >= 0, `source line with "${text}"`);
    return i;
  };
  const iPara = L('Vitent 的正文就是普通 Markdown');
  const iHead = L('## 数学公式');
  const iItem = L('- 按键：');
  const iMath = L('行内公式：');
  const iFormula = L('独立公式：');
  const iQuote2 = L('> —— 某位老师');
  const iRow = L('| 按下标访问 |');

  await step('type at the end of a paragraph with inline markup', async () => {
    const p = await tagUnit(win, 'p', 'Vitent 的正文就是普通', 'para');
    await caretEnd(win, p);
    await win.keyboard.type('另外还有 `代码`。');
    expect[iPara] = `${lines[iPara]}另外还有 \`代码\`。`;
    await blurAndWait(win, t => t.split('\n')[iPara] === expect[iPara], PAGE, 'paragraph saved');
    const rendered = await win.evaluate(s => document.querySelector(s).innerHTML, p);
    check(/<code>代码<\/code>/.test(rendered), 'typed `code` renders as code after blur');
  });

  await step('heading', async () => {
    const hd = await tagUnit(win, 'h2', '数学公式', 'head');
    await caretEnd(win, hd);
    await win.keyboard.type('与符号');
    expect[iHead] = '## 数学公式（KaTeX）与符号';
    await blurAndWait(win, t => t.split('\n')[iHead] === expect[iHead], PAGE, 'heading saved');
  });

  await step('list item with inline directives', async () => {
    const li = await tagUnit(win, 'li > p', '按键', 'item');
    await caretEnd(win, li);
    await win.keyboard.type('（保存）');
    expect[iItem] = '- 按键：:kbd[Ctrl] + :kbd[S]（保存）';
    await blurAndWait(win, t => t.split('\n')[iItem] === expect[iItem], PAGE, 'list item saved');
  });

  await step('table cell', async () => {
    const td = await tagUnit(win, 'td', '按下标访问', 'cell');
    await caretEnd(win, td);
    await win.keyboard.type('元素');
    expect[iRow] = '| 按下标访问元素 | $O(1)$ | $O(n)$ |';
    await blurAndWait(win, t => t.split('\n')[iRow] === expect[iRow], PAGE, 'table row saved');
  });

  await step('Ctrl+B next to inline math', async () => {
    const p = await tagUnit(win, 'p', '行内公式', 'math');
    await selectText(win, p, '二分查找');
    await win.keyboard.press('Control+b');
    expect[iMath] = lines[iMath].replace('二分查找', '**二分查找**');
    await blurAndWait(win, t => t.split('\n')[iMath] === expect[iMath], PAGE, 'bold saved');
    check(await win.evaluate(s => !!document.querySelector(`${s} strong, ${s} b`), p), 'bold in the DOM');
  });

  await step('Shift+Enter in a blockquote', async () => {
    const q = await tagUnit(win, 'blockquote p', '某位老师', 'quote');
    await caretEnd(win, q);
    await win.keyboard.press('Shift+Enter');
    await win.keyboard.type('第三行');
    expect[iQuote2] = `${lines[iQuote2]}\\\n> 第三行`;
    await blurAndWait(win, t => t.includes('> —— 某位老师\\\n> 第三行'), PAGE, 'hard break saved');
  });

  await step('Enter adds a paragraph; an empty one is discarded', async () => {
    const before = await read(win, PAGE);
    const lead = await tagUnit(win, 'p', '还有几个行内小组件', 'lead');
    await caretEnd(win, lead);
    await win.keyboard.press('Enter');
    await win.waitForSelector('[data-ie-new] , p.is-empty[data-ie-unit]');
    await win.keyboard.press('Backspace');
    await win.waitForTimeout(300);
    check(await win.evaluate(() => !document.querySelector('.vt-article p.is-empty[data-ie-unit]')), 'empty paragraph removed');
    check(await win.evaluate(s => document.activeElement === document.querySelector(s), lead), 'focus back on the previous paragraph');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);
    check((await read(win, PAGE)) === before, 'nothing written for an empty paragraph');

    const f = await tagUnit(win, 'p', '独立公式', 'formula');
    await caretEnd(win, f);
    await win.keyboard.press('Enter');
    await win.keyboard.type('新段落，含 **粗体**');
    expect[iFormula] = `${lines[iFormula]}\n\n新段落，含 **粗体**`;
    await blurAndWait(win, t => t.includes('独立公式：\n\n新段落，含 **粗体**\n\n$$'), PAGE, 'new paragraph saved');
    check(await win.evaluate(() => [...document.querySelectorAll('.vt-article p[data-ie-unit] strong')].some(s => s.textContent === '粗体')), 'typed **bold** renders bold');
  });

  await step('typing on a locked widget does nothing; exact file check', async () => {
    await win.click('.vt-math-block');
    await win.keyboard.type('zzz');
    await win.waitForTimeout(900);
    const saved = await read(win, PAGE);
    const want = expect.join('\n');
    if (saved !== want) {
      const a = saved.split('\n');
      const b = want.split('\n');
      for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) log(`  line ${i}: got ${JSON.stringify(a[i])} want ${JSON.stringify(b[i])}`);
    }
    check(saved === want, 'saved index.md is exactly the original plus the edits');
    await shot('e02-edited');
  });

  await step('Ctrl+E inside text leaves edit mode; page re-renders with highlights', async () => {
    const p = await tagUnit(win, 'p', '高亮其中几行', 'last');
    await caretEnd(win, p);
    await win.keyboard.press('Control+e');
    await win.waitForSelector('.reader .vt-article:not(.is-inline-editing)');
    await win.waitForSelector('.vt-article mark.vh');
    const html = await win.evaluate(() => document.querySelector('.vt-article').innerHTML);
    check(/<strong>二分查找<\/strong>/.test(html), 'bold survives re-render');
    check(html.includes('新段落'), 'new paragraph rendered');
    check(!/contenteditable/.test(html), 'no contenteditable left');
    check((await read(win, PAGE)) === expect.join('\n'), 'file unchanged by leaving');
    await shot('e03-after');
  });

  /* ─── layout containers ─── */
  const LAYOUT = 'content/w0/layout.vitent/index.md';
  await step('layout page: callout and column text editable, slides/tabs code locked', async () => {
    await go(win, '#/learn/vla-tour/w0-read/3');
    await win.waitForSelector('.vx-columns');
    const src = await read(win, LAYOUT);
    const ls = src.split('\n');
    await enterEdit(win);
    const s = await win.evaluate(() => ({
      callout: document.querySelectorAll('.vx-callout [data-ie-unit]').length,
      columns: document.querySelectorAll('.vx-columns li > p[data-ie-unit]').length,
      steps: document.querySelectorAll('.vx-steps [data-ie-unit]').length,
      slides: document.querySelectorAll('.vx-slides [data-ie-unit]').length,
      tabsCode: [...document.querySelectorAll('.vx-tabs .vt-code *')].some(e => e.isContentEditable),
      titles: [...document.querySelectorAll('.co-title, .step-title, .tab-btn')].some(e => e.isContentEditable),
    }));
    log('layout:', JSON.stringify(s));
    check(s.callout >= 5 && s.columns === 4 && s.steps === 3, 'text inside layout containers is editable');
    check(s.slides === 0 && !s.tabsCode && !s.titles, 'slides, tab code and titles are locked');

    const warn = await tagUnit(win, '.vx-callout p', '用来提醒常见错误', 'warn');
    await caretEnd(win, warn);
    await win.keyboard.type('再加一句。');
    const iw = ls.findIndex(l => l.includes('用来提醒常见错误'));
    const want = [...ls];
    want[iw] = `${ls[iw]}再加一句。`;
    await blurAndWait(win, t => t.split('\n')[iw] === want[iw], LAYOUT, 'callout saved');

    // A line added above a :::reveal that is still closed …
    const ask = await tagUnit(win, '.vx-callout p', '为什么二分查找要求数组', 'ask');
    await caretEnd(win, ask);
    await win.keyboard.press('Shift+Enter');
    await win.keyboard.type('多想一步。');
    const ia = ls.findIndex(l => l.includes('为什么二分查找要求数组'));
    want[ia] = `${ls[ia]}\\\n多想一步。`;
    await blurAndWait(win, t => t === want.join('\n'), LAYOUT, 'callout line added');
    // … and its body, opened afterwards, still maps to the right line.
    await win.click('.vx-reveal > .btn');
    await win.waitForSelector('.rv-body p[data-ie-unit]');
    const rv = await tagUnit(win, '.rv-body p', '扔掉一半', 'reveal');
    await caretEnd(win, rv);
    await win.keyboard.type('（揭示）');
    const ir = ls.findIndex(l => l.includes('扔掉一半'));
    want[ir] = `${ls[ir]}（揭示）`;
    await blurAndWait(win, t => t === want.join('\n'), LAYOUT, 'reveal body saved');

    const item = await tagUnit(win, '.vx-columns li > p', '实现简单', 'col');
    await caretEnd(win, item);
    await win.keyboard.press('Enter');
    await win.keyboard.type('代码短');
    const ii = ls.findIndex(l => l === '- 实现简单');
    want.splice(ii + 1, 0, '- 代码短');
    await blurAndWait(win, t => t === want.join('\n'), LAYOUT, 'new list item saved');
    await shot('e04-layout');
    await exitEdit(win);
    check((await read(win, LAYOUT)) === want.join('\n'), 'layout file exact');
    check(await win.evaluate(() => [...document.querySelectorAll('.vx-columns li')].some(li => li.textContent.trim() === '代码短')), 'new item rendered');
  });

  /* ─── split / merge, quote in a list, loose ordered list, paste ─── */
  await step('split and merge, quote inside a list, ordered list, leaving a list, paste', async () => {
    const HL = 'content/w2/highlight.vitent/index.md';
    await go(win, '#/learn/vla-tour/w2-ai/1');
    await win.waitForSelector('.vt-article ol');
    const src = await read(win, HL);
    const ls = src.split('\n');
    await enterEdit(win);

    // Enter in the middle splits the paragraph; Backspace at the start joins it again.
    const first = await tagUnit(win, 'p', '这是 Vibe Learn', 'first');
    await win.evaluate(s => {
      const el = document.querySelector(s);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const n = walker.currentNode;
        const i = n.nodeValue.indexOf('甚至');
        if (i < 0) continue;
        el.focus();
        const r = document.createRange();
        r.setStart(n, i);
        r.collapse(true);
        getSelection().removeAllRanges();
        getSelection().addRange(r);
        return;
      }
    }, first);
    await win.keyboard.press('Enter');
    const i0 = ls.findIndex(l => l.startsWith('这是 Vibe Learn'));
    const split = [...ls];
    split.splice(i0, 1, ls[i0].slice(0, ls[i0].indexOf('甚至')), '', ls[i0].slice(ls[i0].indexOf('甚至')));
    await until(async () => (await read(win, HL)) === split.join('\n'), 'split saved');
    check(await win.evaluate(() => document.activeElement?.textContent.startsWith('甚至直接改进课程')), 'caret moved to the new paragraph');
    await win.keyboard.press('Backspace');
    await blurAndWait(win, t => t === src, HL, 'merge restores the paragraph');
    check(await win.evaluate(() => [...document.querySelectorAll('.vt-article p')].some(p => p.querySelector('strong') && p.textContent.includes('甚至直接改进课程'))), 'merged paragraph re-rendered');

    const want = [...ls];
    // A blockquote inside a list item keeps "   > ".
    const q = await tagUnit(win, 'li blockquote p', '循环不变式', 'q');
    await caretEnd(win, q);
    await win.keyboard.type('（重要）');
    const iq = ls.findIndex(l => l.includes('循环不变式是'));
    want[iq] = `${ls[iq]}（重要）`;
    await blurAndWait(win, t => t === want.join('\n'), HL, 'quote in list saved');
    check(want[iq].startsWith('   > '), 'quote prefix kept');

    // Enter in a loose ordered list → next number; Enter on the empty item leaves the list.
    const three = await tagUnit(win, 'ol li > p', '点右上角绿色的', 'three');
    await caretEnd(win, three);
    await win.keyboard.press('Enter');
    await win.keyboard.type('新的一步');
    const i3 = ls.findIndex(l => l.startsWith('3. '));
    want.splice(i3 + 1, 0, '4. 新的一步');
    await blurAndWait(win, t => t === want.join('\n'), HL, 'new ordered item saved');

    const four = await tagUnit(win, 'ol li > p', '如果在「设置', 'four');
    await caretEnd(win, four);
    await win.keyboard.press('Enter');
    await win.keyboard.press('Enter');
    await win.keyboard.type('列表后的段落');
    const i4 = want.findIndex(l => l.startsWith('4. 如果在'));
    want.splice(i4 + 1, 0, '', '列表后的段落');
    await blurAndWait(win, t => t === want.join('\n'), HL, 'paragraph after the list saved');
    check(await win.evaluate(() => [...document.querySelectorAll('.vt-article > p')].some(p => p.textContent === '列表后的段落' && p.previousElementSibling?.tagName === 'OL')), 'paragraph placed after the list');

    // Paste is plain text; a newline becomes a hard line break.
    const pp = await tagUnit(win, 'p', '菜单里有两种方式', 'paste');
    await caretEnd(win, pp);
    await win.evaluate(s => {
      const dt = new DataTransfer();
      dt.setData('text/plain', '甲 **乙**\n丙');
      dt.setData('text/html', '<b style="color:red">甲</b><div>丙</div>');
      document.querySelector(s).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, pp);
    const ip = want.findIndex(l => l.includes('菜单里有两种方式'));
    want[ip] = `${want[ip]}甲 **乙**\\\n丙`;
    await blurAndWait(win, t => t === want.join('\n'), HL, 'paste saved');
    check(await win.evaluate(s => !document.querySelector(s).querySelector('[style], div, b[style]'), pp), 'no pasted HTML');
    await shot('e05-split-list-paste');
    await exitEdit(win);
  });

  /* ─── a CRLF file stays CRLF ─── */
  await step('CRLF line endings are kept', async () => {
    const W = 'content/w0/welcome.vitent/index.md';
    const lf = await read(win, W);
    const crlf = lf.replace(/\r?\n/g, '\r\n');
    await win.evaluate(([c, s, t]) => window.vla.course.savePage(c, s, t), [COURSE, 'content/w0/welcome.vitent', crlf]);
    await go(win, '#/learn/vla-tour/w0-read/2');
    await win.waitForSelector('.vt-article table');
    await go(win, '#/learn/vla-tour/w0-read/1');
    await win.waitForSelector('.vx-callout');
    await enterEdit(win);
    const p = await tagUnit(win, '.vx-callout li > p', '问 AI 按钮', 'crlf');
    await caretEnd(win, p);
    await win.keyboard.type('（试试看）');
    const want = crlf.split('\r\n');
    const i = want.findIndex(l => l.startsWith('3. **问 AI 按钮**'));
    want[i] = `${want[i]}（试试看）`;
    await blurAndWait(win, t => t === want.join('\r\n'), W, 'CRLF file saved');
    const saved = await read(win, W);
    check(!/[^\r]\n/.test(saved), 'no bare LF introduced');
    check(want[i].includes(':ask[为什么要把课程做成文件，而不是网页？]'), 'inline :ask kept verbatim');
    await exitEdit(win);
  });

  /* ─── quiz page: widgets locked, nothing written without edits ─── */
  await step('quiz page: questions locked, intro editable, no write without edits', async () => {
    const QUIZ = 'content/w0/quizzes.vitent/index.md';
    await go(win, '#/learn/vla-tour/w0-check/1');
    await win.waitForSelector('.vx-quiz');
    const before = await read(win, QUIZ);
    await win.keyboard.press('Control+e');
    await win.waitForSelector('.vt-article.is-inline-editing');
    const s = await win.evaluate(() => ({
      quizUnits: document.querySelectorAll('.vx-quiz [data-ie-unit], .vx-quiz [contenteditable="true"]').length,
      intro: document.querySelectorAll('.vt-article > p[data-ie-unit]').length,
    }));
    log('quiz:', JSON.stringify(s));
    check(s.quizUnits === 0 && s.intro >= 1, 'quiz text locked, page text editable');
    await hoverLocked(win, '.vx-quiz .quiz-q');
    await shot('e06-quiz-locked');
    await win.keyboard.press('Control+e');
    await win.waitForSelector('.vt-article:not(.is-inline-editing)');
    check((await read(win, QUIZ)) === before, 'quiz page untouched');
  });
};
