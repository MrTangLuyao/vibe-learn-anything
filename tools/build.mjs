/* ============================================================
 * tools/build.mjs — builds dist/
 *   dist/renderer/   the app UI (esbuild bundle + vendor files)
 *   dist/kit/        the AI workspace kit: manual + self-contained vla.mjs
 *   node tools/build.mjs [--watch] [--prod]
 * ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const watch = process.argv.includes('--watch');
const prod = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';

function copy(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) copy(path.join(src, name), path.join(dest, name));
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function copyStatic() {
  const r = path.join(out, 'renderer');
  fs.mkdirSync(r, { recursive: true });
  copy(path.join(root, 'src/renderer/index.html'), path.join(r, 'index.html'));
  copy(path.join(root, 'src/renderer/widget'), path.join(r, 'widget'));
  copy(path.join(root, 'src/renderer/assets/icon.svg'), path.join(r, 'icon.svg'));
  const monaco = path.join(r, 'vendor/monaco/vs');
  if (!fs.existsSync(path.join(monaco, 'loader.js'))) copy(path.join(root, 'node_modules/monaco-editor/min/vs'), monaco);
  const docs = path.join(r, 'docs');
  fs.rmSync(docs, { recursive: true, force: true });
  copy(path.join(root, 'ai_manual'), path.join(docs, 'ai_manual'));
  copy(path.join(root, 'generate_course.md'), path.join(docs, 'generate_course.md'));
  copy(path.join(root, 'docs/user-guide.md'), path.join(docs, 'user-guide.md'));
  const pdf = path.join(r, 'vendor/pdfjs');
  fs.mkdirSync(pdf, { recursive: true });
  copy(path.join(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'), path.join(pdf, 'pdf.worker.min.mjs'));
  for (const dir of ['cmaps', 'standard_fonts']) {
    const src = path.join(root, 'node_modules/pdfjs-dist', dir);
    if (fs.existsSync(src) && !fs.existsSync(path.join(pdf, dir))) copy(src, path.join(pdf, dir));
  }
}

function buildKit() {
  const k = path.join(out, 'kit');
  fs.rmSync(k, { recursive: true, force: true });
  fs.mkdirSync(k, { recursive: true });
  /* generate_course.md, AGENTS.md, and any agent-specific pointer file
     whose whole content is "@AGENTS.md". */
  for (const f of fs.readdirSync(root)) {
    if (!f.endsWith('.md')) continue;
    const text = fs.readFileSync(path.join(root, f), 'utf8').trim();
    if (f === 'generate_course.md' || f === 'AGENTS.md' || text === '@AGENTS.md') copy(path.join(root, f), path.join(k, f));
  }
  copy(path.join(root, 'ai_manual'), path.join(k, 'ai_manual'));
  return esbuild.build({
    entryPoints: [path.join(root, 'tools/vla.mjs')],
    outfile: path.join(k, 'tools/vla.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    logLevel: 'warning',
  });
}

const rendererOptions = {
  entryPoints: {
    app: path.join(root, 'src/renderer/js/main.js'),
    style: path.join(root, 'src/renderer/styles/index.css'),
  },
  outdir: path.join(out, 'renderer'),
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome130'],
  minify: prod,
  sourcemap: prod ? false : 'linked',
  chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  loader: {
    '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.eot': 'file',
    '.svg': 'file', '.png': 'file', '.gif': 'file', '.cur': 'file',
  },
  define: { 'process.env.NODE_ENV': JSON.stringify(prod ? 'production' : 'development') },
  logLevel: 'warning',
};

const t0 = Date.now();
copyStatic();
await buildKit();
if (watch) {
  const ctx = await esbuild.context(rendererOptions);
  await ctx.watch();
  console.log('watching src/renderer …');
} else {
  await esbuild.build(rendererOptions);
  console.log(`✓ built dist/ in ${Date.now() - t0} ms`);
}
