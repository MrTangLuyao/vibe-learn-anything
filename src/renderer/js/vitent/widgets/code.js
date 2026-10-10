/* Fenced code: static highlight, ```lang run, ```lang editable, mermaid, math. */
import hljs from 'highlight.js/lib/common';
import katex from 'katex';
import { h, icon, escapeHtml, uid } from '../../core/dom.js';
import { t } from '../../core/i18n.js';
import { bus } from '../../core/store.js';
import { toast } from '../../core/ui.js';
import { loadMermaid } from '../../lib/lazy.js';
import { createEditor } from '../../lib/monaco.js';
import { LANG_TO_RUNNER, langOfFile } from '../../../../shared/runners.mjs';

const HLJS_ALIAS = { 'c++': 'cpp', sh: 'bash', shell: 'bash', ps1: 'powershell', py: 'python', js: 'javascript', ts: 'typescript', yml: 'yaml', md: 'markdown', text: 'plaintext', txt: 'plaintext' };

export function highlightCode(code, lang) {
  const l = HLJS_ALIAS[lang] || lang;
  if (l && l !== 'plaintext' && hljs.getLanguage(l)) {
    try { return hljs.highlight(code, { language: l, ignoreIllegals: true }).value; } catch { /* fall through */ }
  }
  return escapeHtml(code);
}

function parseLines(spec) {
  const set = new Set();
  for (const part of String(spec || '').split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let i = a; i <= b; i++) set.add(i);
  }
  return set;
}

function codeHtml(code, lang, lines) {
  if (!lines?.size) return highlightCode(code, lang);
  return code.split('\n').map((line, i) => {
    const html = highlightCode(line, lang) || ' ';
    return lines.has(i + 1) ? `<span class="line-hl">${html}</span>` : `${html}\n`;
  }).join('');
}

function copyButton(getText, cls = 'icon-btn.icon-btn-xs') {
  return h(`button.${cls}`, {
    'data-tip': t('copy'),
    onClick: async e => {
      e.stopPropagation();
      await window.vla.app.clipboard(getText());
      toast(t('copied'), { type: 'ok', timeout: 1400 });
    },
  }, icon('copy'));
}

function mermaidBlock(code, rctx) {
  const box = h('div.vt-mermaid', { 'data-vh-skip': '' }, h('span.spinner'));
  const draw = async () => {
    try {
      const mermaid = await loadMermaid();
      const { svg } = await mermaid.render(`mmd-${uid('m')}`, code);
      box.classList.remove('is-error');
      box.innerHTML = svg;
    } catch (e) {
      box.classList.add('is-error');
      box.textContent = `mermaid: ${e.message || e}`;
    }
  };
  rctx.lazy(box, draw);
  const off = bus.on('theme', () => { if (box.isConnected) draw(); });
  rctx.onDispose(off);
  const id = rctx.id('diagram');
  return rctx.register(id, box, 'diagram', code.split('\n')[0]);
}

function mathBlock(code) {
  const box = h('div.vt-math-block', { 'data-vh-skip': '' });
  try { box.innerHTML = katex.renderToString(code, { displayMode: true, throwOnError: false, output: 'html' }); } catch (e) { box.textContent = e.message; }
  return box;
}

export function renderOutput(r) {
  const out = h('div.vt-code-output', { 'data-vh-skip': '' });
  const meta = [];
  if (r.phase === 'build' && r.code !== 0) meta.push(t('run.buildFailed'));
  if (r.code != null) meta.push(`exit ${r.code}`);
  if (r.ms != null) meta.push(`${r.ms} ms`);
  if (r.timedOut) meta.push(t('timeout'));
  if (r.denied) meta.push(t('term.denied'));
  out.append(h('div.o-meta', h(r.code === 0 ? 'span.o-ok' : 'span.o-err', r.code === 0 ? '●' : '●'), meta.join(' · ')));
  if (r.stdout) out.append(h('span', r.stdout));
  if (r.stderr) out.append(h('span.o-err', r.stderr));
  if (!r.stdout && !r.stderr) out.append(h('span.faint', t('noOutput')));
  return out;
}

export function renderFence(f, rctx) {
  const { lang, attrs: a } = f;
  if (lang === 'mermaid') return mermaidBlock(f.code, rctx);
  if (['math', 'latex', 'tex', 'katex'].includes(lang)) return mathBlock(f.code);

  const runnerName = typeof a.run === 'string' ? a.run : a.run ? (LANG_TO_RUNNER[lang] || lang) : null;
  const editable = !!a.editable;
  const id = rctx.id('code', a);
  let code = f.code;
  let editor = null;

  const pre = h('pre', h('code', { className: `hljs language-${lang || 'plaintext'}`, html: codeHtml(code, lang, parseLines(a.lines)) }));
  const wrap = h('div.vt-code');
  const head = h('div.vt-code-head', { 'data-vh-skip': '' });
  const showHead = a.title || runnerName || editable;
  if (showHead) {
    head.append(lang ? h('span.lang', lang) : null, a.title ? h('span.title', a.title) : null, h('span.grow'), copyButton(() => (editor ? editor.getValue() : code)));
    wrap.append(head);
  } else {
    wrap.append(h('div.copy-float', { 'data-vh-skip': '' }, copyButton(() => code)));
  }
  const body = h('div');
  body.append(pre);
  wrap.append(body);

  if (runnerName) {
    let output = null;
    const runBtn = h('button.btn.btn-primary.btn-sm', {
      onClick: async () => {
        runBtn.disabled = true;
        const src = editor ? editor.getValue() : code;
        output?.remove();
        output = h('div.vt-code-output', { 'data-vh-skip': '' }, h('div.o-meta', h('span.spinner'), ' ', t('run.running')));
        wrap.append(output);
        try {
          const r = await window.vla.exec.snippet({
            courseId: rctx.courseId, page: rctx.src, runner: runnerName, lang, code: src,
            stdin: a.stdin != null ? String(a.stdin).replace(/\\n/g, '\n') : '', runners: rctx.course.runners, timeout: (a.timeout || 20) * 1000,
          });
          const fresh = renderOutput(r);
          output.replaceWith(fresh);
          output = fresh;
        } finally {
          runBtn.disabled = false;
        }
      },
    }, icon('play'), h('span', t('run')));
    head.append(runBtn);
  }

  if (editable) {
    rctx.lazy(wrap, async () => {
      const lines = Math.max(4, code.split('\n').length);
      const host = h('div.vt-code-edit', { style: { height: `${Math.min(460, lines * 22 + 28)}px` }, 'data-vh-skip': '' });
      body.replaceChildren(host);
      try {
        editor = await createEditor(host, { value: code, language: langOfFile(`x.${lang}`) === 'plaintext' ? lang : langOfFile(`x.${lang}`), lineNumbers: 'on', folding: false });
        rctx.onDispose(() => editor.dispose());
        head.append(h('button.icon-btn.icon-btn-xs', { 'data-tip': t('reset'), onClick: () => editor.setValue(code) }, icon('rotate-ccw')));
      } catch (e) {
        body.replaceChildren(pre);
        console.error(e);
      }
    });
  }

  wrap._vhDetail = () => {
    if (!editor) return { lang };
    const sel = editor.getSelection();
    return { lang, lines: sel && !sel.isEmpty() ? [sel.startLineNumber, sel.endLineNumber] : null, text: sel && !sel.isEmpty() ? editor.getModel().getValueInRange(sel).slice(0, 2000) : null };
  };
  return rctx.register(id, wrap, 'code', a.title || lang || '');
}
