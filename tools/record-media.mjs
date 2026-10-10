/* ============================================================
 * tools/record-media.mjs — README media from the real app.
 *   • renders build/icon.svg → build/icon.png, build/icon.ico, docs/media/icon.png
 *   • records demo GIFs and screenshots into docs/media/
 *
 *   node tools/record-media.mjs [--only hero,highlight,...] [--show]
 *
 * The window stays off-screen and never takes focus (VLA_TEST_HIDDEN).
 * "Ask AI" answers come from a local fake endpoint and the agent is
 * test/fake-agent.mjs, so no real AI is called.
 * ============================================================ */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import gifenc from 'gifenc';

const { GIFEncoder, quantize, applyPalette } = gifenc;

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const media = path.join(root, 'docs', 'media');
const argv = process.argv.slice(2);
const only = (() => { const i = argv.indexOf('--only'); return i >= 0 ? new Set(argv[i + 1].split(',')) : null; })();
const want = name => !only || only.has(name);
const pause = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(media, { recursive: true });

/* ─── fake "Ask AI" endpoint (OpenAI-compatible SSE) ─── */
function fakeEndpoint() {
  const server = http.createServer((req, res) => {
    if (!req.url.endsWith('/chat/completions')) { res.writeHead(404); res.end(); return; }
    req.resume();
    req.on('end', () => {
      const parts = ['**循环不变式**', '是每一轮循环开始时都成立的命题。\n\n', '证明二分查找正确只要三步：\n\n',
        '1. **初始化**：开始时 `[lo, hi]` 是整个数组，目标若存在一定在里面；\n',
        '2. **保持**：比较 `a[mid]` 后只扔掉不可能的一半，命题仍成立；\n',
        '3. **终止**：区间为空时，说明目标不存在。\n\n', '每轮区间减半，所以最多 $\\lceil \\log_2 (n+1) \\rceil$ 轮。'];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      let i = 0;
      const timer = setInterval(() => {
        if (i < parts.length) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`);
        else { res.write('data: [DONE]\n\n'); res.end(); clearInterval(timer); }
      }, 170);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/* ─── ICO from PNGs (PNG-compressed entries) ─── */
function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o);
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.buf.length;
  });
  return Buffer.concat([header, dir, ...entries.map(e => e.buf)]);
}

/* ─── launch ─── */
const server = await fakeEndpoint();
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vla-media-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
  trust: { 'vla-tour': true },
  workDir: path.join(userData, 'VibeLearn'),
  ai: {
    http: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'demo' },
    agent: { command: `node "${path.join(root, 'test', 'fake-agent.mjs')}"`, stdin: true },
  },
}, null, 2));

const app = await electron.launch({
  executablePath: require('electron'),
  args: [root, `--user-data=${userData}`],
  cwd: root,
  env: { ...process.env, VLA_TEST_HIDDEN: argv.includes('--show') ? '0' : '1' },
});
const win = await app.firstWindow();
win.on('pageerror', e => console.log(`[pageerror] ${e.message}`));
await win.waitForLoadState('domcontentloaded');
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
await pause(500);
await win.waitForSelector('.course-card', { timeout: 20000 });

/* ─── icon ─── */
if (want('icon')) {
  const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8');
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
  const pngs = await win.evaluate(async ({ svgText, sizes }) => {
    const img = new Image();
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgText)))}`;
    await img.decode();
    return sizes.map(size => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, size, size);
      return { size, data: c.toDataURL('image/png').split(',')[1] };
    });
  }, { svgText: svg, sizes });
  const bufs = pngs.map(p => ({ size: p.size, buf: Buffer.from(p.data, 'base64') }));
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), bufs.find(b => b.size === 512).buf);
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico(bufs.filter(b => b.size <= 256)));
  fs.writeFileSync(path.join(media, 'icon.png'), bufs.find(b => b.size === 256).buf);
  fs.copyFileSync(path.join(root, 'build', 'icon.svg'), path.join(root, 'src', 'renderer', 'assets', 'icon.svg'));
  console.log('✓ icon');
}

/* ─── capture helpers (frames are grabbed in the main process) ─── */
const WIDTH = 960;

async function startRec(fps = 10) {
  await app.evaluate(({ BrowserWindow }, { fps, width }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const rec = { frames: [], busy: false };
    globalThis.__rec = rec;
    rec.timer = setInterval(async () => {
      if (rec.busy) return;
      rec.busy = true;
      try {
        const img = (await w.webContents.capturePage()).resize({ width, quality: 'good' });
        const { width: fw, height: fh } = img.getSize();
        const bmp = img.toBitmap();
        const last = rec.frames[rec.frames.length - 1];
        if (last && last.bmp.equals(bmp)) last.end = Date.now();
        else rec.frames.push({ t: Date.now(), end: Date.now(), w: fw, h: fh, bmp });
      } catch { /* window busy */ } finally { rec.busy = false; }
    }, 1000 / fps);
  }, { fps, width: WIDTH });
}

async function stopRec(name, { hold = 1600 } = {}) {
  const count = await app.evaluate(async () => {
    const rec = globalThis.__rec;
    clearInterval(rec.timer);
    while (rec.busy) await new Promise(r => setTimeout(r, 15));
    return rec.frames.length;
  });
  const gif = GIFEncoder();
  let prev = null;
  for (let i = 0; i < count; i++) {
    const f = await app.evaluate((_e, i) => {
      const fr = globalThis.__rec.frames[i];
      return { t: fr.t, w: fr.w, h: fr.h, data: fr.bmp.toString('base64') };
    }, i);
    if (prev) {
      writeFrame(gif, prev, Math.max(40, f.t - prev.t));
    }
    prev = f;
  }
  if (prev) writeFrame(gif, prev, hold);
  gif.finish();
  await app.evaluate(() => { globalThis.__rec = null; });
  const file = path.join(media, `${name}.gif`);
  fs.writeFileSync(file, gif.bytes());
  console.log(`✓ ${name}.gif  ${count} frames  ${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB`);
}

function writeFrame(gif, f, delay) {
  const bgra = Buffer.from(f.data, 'base64');
  const rgba = new Uint8Array(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2];
    rgba[i + 1] = bgra[i + 1];
    rgba[i + 2] = bgra[i];
    rgba[i + 3] = 255;
  }
  const palette = quantize(rgba, 256);
  const index = applyPalette(rgba, palette);
  gif.writeFrame(index, f.w, f.h, { palette, delay });
}

async function screenshot(name) {
  const data = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(path.join(media, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`✓ ${name}.png`);
}

/* A visible cursor for the recordings (the real one is not captured). */
async function cursor() {
  await win.evaluate(() => {
    if (document.getElementById('rec-cursor')) return;
    const c = document.createElement('div');
    c.id = 'rec-cursor';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2.5l6.8 18.2 2.5-7.4 7.4-2.5z" fill="#fff" stroke="#151515" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '-40px', top: '-40px', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(-4px,-3px)', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.45))' });
    const ring = document.createElement('div');
    Object.assign(ring.style, { position: 'fixed', width: '34px', height: '34px', marginLeft: '-17px', marginTop: '-17px', borderRadius: '50%', border: '3px solid #ffb49d', pointerEvents: 'none', zIndex: 2147483646, opacity: '0' });
    document.documentElement.append(ring, c);
    addEventListener('mousemove', e => { c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px`; }, true);
    addEventListener('mousedown', e => {
      ring.style.left = `${e.clientX}px`;
      ring.style.top = `${e.clientY}px`;
      ring.animate([{ opacity: 0.9, transform: 'scale(.4)' }, { opacity: 0, transform: 'scale(1.3)' }], { duration: 450, easing: 'ease-out' });
    }, true);
  });
}

async function center(sel, { scroll = true } = {}) {
  const el = await win.waitForSelector(sel, { timeout: 20000 });
  if (scroll) { await el.scrollIntoViewIfNeeded(); await pause(250); }
  const b = await el.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function moveTo(target, steps = 16) {
  const p = typeof target === 'string' ? await center(target) : target;
  await win.mouse.move(p.x, p.y, { steps });
  return p;
}

async function click(target, { wait = 350 } = {}) {
  await moveTo(target);
  await pause(160);
  await win.mouse.down();
  await pause(70);
  await win.mouse.up();
  await pause(wait);
}

async function go(hash) {
  await win.evaluate(h => { location.hash = h; }, hash);
  await pause(900);
}

/* Start each recording without a leftover notes panel. */
async function closePanels() {
  await win.evaluate(() => document.querySelector('.side-panel-head .icon-btn:last-child')?.click());
  await pause(300);
}

async function smoothScroll(sel, top) {
  await win.evaluate(([s, t]) => document.querySelector(s).scrollTo({ top: t, behavior: 'smooth' }), [sel, top]);
  await pause(900);
}

async function scrollToEl(sel, block = 'center') {
  await win.evaluate(([s, b]) => document.querySelector(s).scrollIntoView({ behavior: 'smooth', block: b }), [sel, block]);
  await pause(900);
}

async function dragSelect(sel) {
  const pts = await win.evaluate(s => {
    const el = document.querySelector(s);
    const r = document.createRange();
    r.selectNodeContents(el);
    const rects = [...r.getClientRects()].filter(x => x.width > 2);
    const a = rects[0];
    const z = rects[rects.length - 1];
    return { x1: a.left + 1, y1: a.top + a.height / 2, x2: z.right - 1, y2: z.top + z.height / 2 };
  }, sel);
  await moveTo({ x: pts.x1, y: pts.y1 });
  await pause(200);
  await win.mouse.down();
  await win.mouse.move(pts.x2, pts.y2, { steps: 28 });
  await pause(120);
  await win.mouse.up();
  await pause(600);
}

await cursor();
await win.mouse.move(720, 450);

/* ─── 1. tour: dashboard → course → chapter → pages ─── */
if (want('hero')) {
  await go('#/');
  await screenshot('dashboard');
  await startRec();
  await pause(600);
  await moveTo('.course-card');
  await pause(700);
  await click('.course-card', { wait: 900 });
  await pause(600);
  await click('.chapter-row >> nth=0', { wait: 1200 });
  await pause(800);
  await smoothScroll('.reader', 520);
  await pause(500);
  await click('[data-button-id="next"]', { wait: 1200 });
  await smoothScroll('.reader', 700);
  await click('.page-item >> nth=2', { wait: 1200 });
  await scrollToEl('.vx-tabs', 'center');
  await click('.vx-tabs .tab-btn >> nth=1', { wait: 700 });
  await click('.vx-tabs .tab-btn >> nth=2', { wait: 900 });
  await stopRec('tour');
  await go('#/course/vla-tour');
  await pause(500);
  await screenshot('course');
}

/* ─── 2. highlight → ask AI now ─── */
if (want('highlight')) {
  await go('#/learn/vla-tour/w2-ai/1');
  await win.waitForSelector('.vt-article blockquote');
  await scrollToEl('.vt-article blockquote', 'center');
  await startRec();
  await pause(500);
  await dragSelect('.vt-article blockquote p');
  await click('.sel-pop .chip-btn >> nth=0', { wait: 600 });
  await scrollToEl('.vx-quiz', 'center');
  await click('.vx-quiz + .vh-mark-btn', { wait: 500 });
  await click('.hl-done', { wait: 800 });
  await win.waitForSelector('.comment-new textarea');
  await moveTo('.comment-new textarea');
  await win.keyboard.type('这个循环不变式怎么用来证明二分查找是对的？', { delay: 45 });
  await pause(400);
  await click('.comment-new .btn-tonal', { wait: 400 });
  await win.waitForFunction(() => !document.querySelector('.comment .ai-streaming') && document.querySelector('.comment.is-answer'), null, { timeout: 20000 });
  await pause(900);
  await moveTo('.vt-article blockquote');
  await pause(800);
  await stopRec('highlight', { hold: 2500 });
  await screenshot('notes');
}

/* ─── 3. code workspace: submit → fix → pass → run ─── */
if (want('workspace')) {
  await go('#/learn/vla-tour/w1-workshop/2');
  await closePanels();
  await win.waitForSelector('.vx-ws .monaco-editor', { timeout: 20000 });
  await scrollToEl('.vx-ws', 'start');
  await startRec();
  await pause(600);
  await click('.vx-ws .ws-bottom-bar .btn-primary', { wait: 300 });
  await win.waitForSelector('.test-row', { timeout: 30000 });
  await pause(1500);
  await click('.ws-tab:has-text("search.js")', { wait: 700 });
  const solution = "function binarySearch(a, x) {\n  let lo = 0, hi = a.length - 1;\n  while (lo <= hi) {\n    const mid = lo + ((hi - lo) >> 1);\n    if (a[mid] === x) return mid;\n    if (a[mid] < x) lo = mid + 1;\n    else hi = mid - 1;\n  }\n  return -1;\n}\n\nmodule.exports = { binarySearch };\n";
  const lines = solution.split('\n');
  for (let i = 1; i <= lines.length; i++) {
    await win.evaluate(text => {
      const m = window.monaco.editor.getModels().find(x => x.uri.path.endsWith('/search.js') && !x.uri.path.includes('__solution__'));
      m.setValue(text);
    }, lines.slice(0, i).join('\n'));
    await pause(130);
  }
  await pause(600);
  await click('.vx-ws .ws-bottom-bar .btn-primary', { wait: 300 });
  await win.waitForFunction(() => /5\/5/.test(document.querySelector('.tests-summary')?.textContent || ''), null, { timeout: 30000 });
  await pause(1600);
  await click('.vx-ws .ws-bottom-bar .btn-tonal', { wait: 2500 });
  await stopRec('workspace', { hold: 2000 });
  await screenshot('workspace');
}

/* ─── 4. quizzes, cloze, parsons, flashcards ─── */
if (want('practice')) {
  await go('#/learn/vla-tour/w0-check/1');
  await closePanels();
  await win.waitForSelector('.quiz-opt');
  await startRec();
  await pause(500);
  await click('.vx-quiz >> nth=0 >> .quiz-opt >> nth=0', { wait: 900 });
  await click('.vx-quiz >> nth=0 >> .quiz-opt >> nth=1', { wait: 1200 });
  await win.evaluate(() => document.querySelectorAll('.vx-quiz')[1].scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await pause(800);
  const multi = await win.$$('.vx-quiz >> nth=1 >> .quiz-opt');
  const labels = await Promise.all(multi.map(m => m.textContent()));
  for (const [i, text] of labels.entries()) if (/二分|平衡/.test(text)) await click(`.vx-quiz >> nth=1 >> .quiz-opt >> nth=${i}`, { wait: 350 });
  await click('.vx-quiz >> nth=1 >> .btn-primary', { wait: 1200 });
  await win.evaluate(() => document.querySelector('.cloze-blank').closest('.vx-quiz').scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await pause(900);
  const blanks = ['<=', '2', 'mid + 1'];
  for (const [i, v] of blanks.entries()) {
    await click(`.cloze-blank >> nth=${i}`, { wait: 150 });
    await win.keyboard.type(v, { delay: 70 });
  }
  await click('.vx-quiz:has(.cloze-blank) .btn-primary', { wait: 1400 });
  await stopRec('practice', { hold: 1800 });
}

/* ─── 5. the AI agent revises the course ─── */
if (want('agent')) {
  await go('#/learn/vla-tour/w0-read/2');
  await win.waitForSelector('.vt-article blockquote');
  await scrollToEl('.vt-article blockquote', 'center');
  await dragSelect('.vt-article blockquote p');
  await win.click('.sel-pop .chip-btn >> nth=1');
  await win.click('.hl-done');
  await win.waitForSelector('.comment-new textarea');
  await win.fill('.comment-new textarea', '请再举一个生活中的例子。');
  await win.click('.comment-new .btn-primary');
  await pause(500);
  await go('#/course/vla-tour');
  await startRec();
  await pause(600);
  await click('.course-actions .btn-tonal', { wait: 600 });
  await click('.menu-item >> nth=0', { wait: 300 });
  await win.waitForFunction(() => /完成|Done/.test(document.querySelector('.dialog .ai-streaming')?.textContent || ''), null, { timeout: 30000 });
  await pause(1500);
  await click('.dialog-foot .btn', { wait: 600 });
  await go('#/learn/vla-tour/w0-read/2');
  await win.waitForSelector('.vx-callout[data-type="success"]', { timeout: 15000 });
  await scrollToEl('.vx-callout[data-type="success"]', 'center');
  await pause(600);
  await click('[data-button-id="notes"]', { wait: 900 });
  await click('.note-card', { wait: 1500 });
  await stopRec('agent', { hold: 2400 });
}

/* ─── 6. edit any page, live preview ─── */
if (want('edit')) {
  await go('#/learn/vla-tour/w0-read/1');
  await closePanels();
  await win.waitForSelector('.vt-article');
  await startRec();
  await pause(500);
  await click('[data-button-id="edit"]', { wait: 1500 });
  await win.waitForSelector('.editor-split .monaco-editor', { timeout: 20000 });
  await win.evaluate(() => {
    const ed = window.monaco.editor.getEditors().find(e => e.getModel()?.getLanguageId() === 'markdown');
    const model = ed.getModel();
    const line = model.getLineCount();
    ed.setPosition({ lineNumber: 7, column: 1 });
    ed.revealLineNearTop(5);
    ed.focus();
    void line;
  });
  await pause(500);
  await win.keyboard.type(':::tip[在软件里直接改]\n任何一页都能编辑，右边实时预览。\n:::\n\n', { delay: 40 });
  await pause(1500);
  await moveTo('.es-bar .btn-primary');
  await pause(400);
  await win.keyboard.press('Control+S');
  await pause(1200);
  await stopRec('edit', { hold: 1800 });
  await click('.es-bar .btn-primary', { wait: 800 });
}

/* ─── 7. themes + other screens ─── */
if (want('theme')) {
  await go('#/learn/vla-tour/w0-read/2');
  await closePanels();
  await win.waitForSelector('.vt-article');
  await smoothScroll('.reader', 0);
  await startRec();
  await pause(500);
  await click('.appbar .icon-btn.icon-btn-sm >> nth=-3', { wait: 1400 });
  await go('#/');
  await pause(1200);
  await screenshot('light');
  await go('#/learn/vla-tour/w0-read/2');
  await pause(900);
  await click('.appbar .icon-btn.icon-btn-sm >> nth=-3', { wait: 600 });
  await click('.appbar .icon-btn.icon-btn-sm >> nth=-3', { wait: 1400 });
  await stopRec('theme', { hold: 1200 });
  await win.evaluate(() => window.vla.settings.set({ theme: 'dark' }));
}

if (want('screens')) {
  await go('#/learn/vla-tour/w0-read/4');
  await win.waitForSelector('.textLayer span', { timeout: 20000 });
  await pause(1200);
  await screenshot('pdf');
  await go('#/learn/vla-tour/w0-read/3');
  await scrollToEl('.vx-slides', 'center');
  await screenshot('slides');
  await go('#/settings');
  await pause(1000);
  await screenshot('settings');
  await go('#/');
  await pause(500);
  await win.click('.hero-actions .btn-primary');
  await win.waitForSelector('.dialog .steps-list');
  await pause(800);
  await screenshot('generate');
  await win.keyboard.press('Escape');
}

await app.close();
server.close();
console.log('done');
