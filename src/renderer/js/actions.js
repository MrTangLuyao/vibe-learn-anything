/* ============================================================
 * actions.js — the action system shared by buttons, :btn[], ::button
 * and widgets. An action is an id (looked up in the page's actions,
 * then the course's) or an inline object:
 *   exec | script | http | open | ask-ai | ui | copy | goto | sequence
 * ============================================================ */

import { h, icon } from './core/dom.js';
import { t } from './core/i18n.js';
import { toast, confirm } from './core/ui.js';
import { normRelPath } from './paths.js';

/* {{page.title}} {{course.title}} {{selection}} … */
export function fill(str, vars) {
  return String(str ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key) => {
    const v = key.split('.').reduce((o, k) => (o == null ? o : o[k]), vars);
    return v == null ? m : String(v);
  });
}

export function lookupAction(spec, ctx) {
  if (spec && typeof spec === 'object') return spec;
  const id = String(spec || '');
  return ctx.fm?.actions?.[id] || ctx.course?.actions?.[id] || null;
}

function shellQuote(s) {
  return /[\s"&|<>^]/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : s;
}

/* Result view used by ::button output=panel and friends. */
export function renderResult(r) {
  const box = h('div.vx-output', { 'data-vh-skip': '' });
  if (!r) return box;
  if (r.kind === 'http') {
    box.append(h('div.o-meta', `HTTP ${r.status ?? '—'} · ${r.method} ${r.url}`));
    let body = r.text ?? r.error ?? '';
    try { body = JSON.stringify(JSON.parse(body), null, 2); } catch { /* not JSON */ }
    box.append(h(r.ok ? 'span' : 'span.o-err', body));
    return box;
  }
  if (r.kind === 'exec') {
    box.append(h('div.o-meta', `$ ${r.command || ''}${r.ms != null ? ` · ${r.ms} ms` : ''}${r.code != null ? ` · exit ${r.code}` : ''}${r.timedOut ? ` · ${t('timeout')}` : ''}`));
    if (r.stdout) box.append(h('span', r.stdout));
    if (r.stderr) box.append(h('span.o-err', r.stderr));
    if (!r.stdout && !r.stderr) box.append(h('span.faint', t('noOutput')));
    return box;
  }
  box.append(h('span', r.text ?? ''));
  return box;
}

/*
 * ctx = { courseId, course, fm, pageSrc, vars, lesson: { ui(cmd), goto(target), terminal(spec), ask(prompt, opts) } }
 * returns { kind, ok, ... } — a result for exec/script/http, else null.
 */
export async function runAction(spec, ctx, extra = {}) {
  const a = lookupAction(spec, ctx);
  if (!a) { toast(t('action.unknown', { id: String(spec) }), { type: 'err' }); return null; }
  if (a.confirm && !(await confirm({ title: fill(a.confirm, ctx.vars) }))) return null;
  const vars = { ...(ctx.vars || {}), ...extra };
  switch (a.type) {
    case 'exec': {
      const command = fill(a.command, vars);
      if (a.output === 'terminal') { ctx.lesson?.terminal({ command, cwd: a.cwd, title: a.label }); return null; }
      const r = await window.vla.exec.run({
        courseId: ctx.courseId, page: ctx.pageSrc, cwd: a.cwd || 'page', command,
        stdin: a.stdin ? fill(a.stdin, vars) : '', timeout: (a.timeout || 30) * 1000, env: a.env,
      });
      const res = { kind: 'exec', ok: r.code === 0, ...r };
      if (a.output === 'toast') toast(r.code === 0 ? (r.stdout.trim().slice(0, 300) || t('done')) : (r.stderr || r.stdout || 'error').slice(0, 300), { type: r.code === 0 ? 'ok' : 'err' });
      return a.output === 'none' || a.output === 'toast' ? null : res;
    }
    case 'script': {
      const file = String(a.file || '');
      const fromCourse = file.startsWith('@/');
      const command = `node ${shellQuote(fromCourse ? file.slice(2) : file)} ${(a.args || []).map(x => shellQuote(fill(x, vars))).join(' ')}`.trim();
      if (a.output === 'terminal') { ctx.lesson?.terminal({ command, cwd: fromCourse ? 'course' : 'page', title: a.label }); return null; }
      const r = await window.vla.exec.run({
        courseId: ctx.courseId, page: ctx.pageSrc, cwd: fromCourse ? 'course' : 'page', command,
        stdin: a.stdin ? fill(a.stdin, vars) : '', timeout: (a.timeout || 30) * 1000, env: a.env,
      });
      return { kind: 'exec', ok: r.code === 0, ...r };
    }
    case 'http': {
      const url = fill(a.url, vars);
      const method = (a.method || 'GET').toUpperCase();
      let body = a.body;
      if (typeof body === 'string') body = fill(body, vars);
      else if (body && typeof body === 'object') body = JSON.parse(fill(JSON.stringify(body), vars));
      const r = await window.vla.http.request({ courseId: ctx.courseId, method, url, headers: a.headers, body, timeout: (a.timeout || 30) * 1000 });
      if (r.denied) return null;
      const res = { kind: 'http', method, url, ...r, ok: !!r.ok };
      if (a.output === 'toast') { toast(`HTTP ${r.status ?? ''} ${(r.text || r.error || '').slice(0, 200)}`, { type: r.ok ? 'ok' : 'err' }); return null; }
      return a.output === 'none' ? null : res;
    }
    case 'open': {
      if (a.url) { window.vla.app.openExternal(fill(a.url, vars)); return null; }
      if (a.path) {
        const rel = String(a.path).startsWith('@/') ? normRelPath(String(a.path).slice(2)) : normRelPath(`${ctx.pageSrc}/${a.path}`);
        const r = await window.vla.course.openFile(ctx.courseId, rel);
        if (r) toast(r, { type: 'err' });
      }
      return null;
    }
    case 'ask-ai':
      ctx.lesson?.ask(fill(a.prompt || '', vars), { context: a.context, anchor: extra.anchor });
      return null;
    case 'ui':
      ctx.lesson?.ui(a.command, a);
      return null;
    case 'copy':
      await window.vla.app.clipboard(fill(a.text || '', vars));
      toast(t('copied'), { type: 'ok', timeout: 1500 });
      return null;
    case 'goto':
      ctx.lesson?.goto({ page: a.page, chapter: a.chapter, index: a.index });
      return null;
    case 'sequence': {
      let last = null;
      for (const step of a.steps || []) {
        last = await runAction(step, ctx, extra);
        if (last && last.ok === false && !a.continueOnError) break;
      }
      return last;
    }
    default:
      toast(t('action.badType', { type: a.type }), { type: 'err' });
      return null;
  }
}

export function actionIcon(a) {
  return { exec: 'play', script: 'file-code', http: 'globe', open: 'external-link', 'ask-ai': 'sparkles', ui: 'mouse-pointer-click', copy: 'copy', goto: 'arrow-right', sequence: 'list-ordered' }[a?.type] || 'play';
}

