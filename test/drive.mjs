/* ============================================================
 * test/drive.mjs — drive the real Electron app for smoke tests.
 *
 *   node test/drive.mjs <script.mjs> [--user-data DIR] [--out DIR]
 *
 * The script default-exports async ({ app, win, shot, step, log }) => {}.
 * shot(name) saves <out>/<name>.png. Console errors are printed.
 * ============================================================ */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const scriptPath = args.find(a => a.endsWith('.mjs'));
const userData = path.resolve(opt('--user-data', fs.mkdtempSync(path.join(os.tmpdir(), 'vla-e2e-'))));
const out = path.resolve(opt('--out', path.join(root, 'test-output')));
fs.mkdirSync(out, { recursive: true });
/* --trust a,b pre-trusts courses so the native "trust this course?" box
   never blocks an automated run. */
const trust = opt('--trust', '');
{
  const file = path.join(userData, 'settings.json');
  const s = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  if (trust) s.trust = { ...(s.trust || {}), ...Object.fromEntries(trust.split(',').map(id => [id, true])) };
  /* Keep the AI workspace inside the throwaway profile, not in Documents. */
  s.workDir = s.workDir || path.join(userData, 'VibeLearn');
  fs.writeFileSync(file, JSON.stringify(s, null, 2));
}

const exe = opt('--exe', null);
const app = await electron.launch({
  executablePath: exe ? path.resolve(exe) : require('electron'),
  args: [...(exe ? [] : [root]), `--user-data=${userData}`, ...(args.includes('--dev') ? ['--dev'] : [])],
  cwd: root,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', VLA_TEST_HIDDEN: args.includes('--show') ? '0' : '1' },
});
const win = await app.firstWindow();
const errors = [];
win.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { const s = `[${m.type()}] ${m.text()}`; errors.push(s); console.log(s); } });
win.on('pageerror', e => { const s = `[pageerror] ${e.message}\n${e.stack || ''}`; errors.push(s); console.log(s); });
await win.waitForLoadState('domcontentloaded');
await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});

const shot = async name => { const p = path.join(out, `${name}.png`); await win.screenshot({ path: p }); console.log(`shot ${p}`); return p; };
const step = async (label, fn) => { console.log(`▸ ${label}`); await fn(); };

try {
  if (scriptPath) {
    const mod = await import(pathToFileURL(path.resolve(scriptPath)).href);
    await mod.default({ app, win, shot, step, log: console.log, userData, root });
  } else {
    await win.waitForTimeout(1500);
    await shot('home');
  }
} catch (e) {
  console.log(`✗ ${e.stack || e}`);
  await shot('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  console.log(`errors: ${errors.length}`);
  await app.close();
}
