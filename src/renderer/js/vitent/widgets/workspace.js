/* ============================================================
 * :::workspace — a code workspace like Ed's: file tree, tabs,
 * Monaco editor, status bar, terminal, Run, tests ("Submit"),
 * hints, reference solution. Learner files persist in
 * learner/workspaces/<page>/<id>/ inside the course.
 * ============================================================ */

import { h, icon, debounce } from '../../core/dom.js';
import { t } from '../../core/i18n.js';
import { toast, confirm, prompt, menu, spinner } from '../../core/ui.js';
import { fencesIn, yamlBody } from '../../../../shared/vitent-parse.mjs';
import { runnerFor, langOfFile } from '../../../../shared/runners.mjs';
import { loadMonaco, createEditor } from '../../lib/monaco.js';
import { TermSession } from '../../lib/term.js';

function filesFrom(nodes) {
  return nodes.filter(c => c.type === 'md').flatMap(c => fencesIn(c.text));
}

function compareOutput(got, want, match = 'trim') {
  const g = String(got ?? '').replace(/\r\n/g, '\n');
  const w = String(want ?? '').replace(/\r\n/g, '\n');
  if (match === 'exact') return g === w;
  if (match === 'contains') return g.includes(w.trim());
  if (match === 'regex') { try { return new RegExp(w, 'm').test(g); } catch { return false; } }
  const norm = s => s.split('\n').map(l => l.replace(/\s+$/, '')).join('\n').trim();
  return norm(g) === norm(w);
}

export const workspace = {
  label: node => node.attrs.title || node.label || 'workspace',
  render(node, rctx, id) {
    const a = node.attrs;
    const all = filesFrom(node.children);
    const named = all.filter(f => f.attrs.file);
    const runner = runnerFor(a.runner || (named[0] ? named[0].lang : all[0]?.lang), rctx.course.runners || {});
    const starterFiles = (named.length ? named : all.slice(0, 1)).map((f, i) => ({
      path: String(f.attrs.file || (i === 0 ? (a.main || runner?.main || `main.${f.lang || 'txt'}`) : `file${i}.${f.lang || 'txt'}`)),
      content: f.code.endsWith('\n') ? f.code : `${f.code}\n`,
    }));
    const starter = { files: starterFiles, dir: a.dir || null };
    const main = String(a.main || starterFiles[0]?.path || runner?.main || 'main.txt');
    const build = a.build ?? runner?.build ?? '';
    const run = a.run ?? runner?.run ?? '';
    const testsNode = node.children.find(c => c.type === 'container' && c.name === 'tests');
    let tests = [];
    if (testsNode) {
      try { tests = yamlBody(testsNode.raw) || []; } catch (e) { tests = []; toast(`tests: ${e.message}`, { type: 'err' }); }
    }
    const testBuild = testsNode?.attrs.build ?? build;
    if (tests.length) rctx.counts.tests++;
    const solution = node.children.find(c => c.type === 'container' && c.name === 'solution');
    const solutionFiles = solution ? filesFrom(solution.children).map((f, i) => ({ path: String(f.attrs.file || (i ? `solution${i}.${f.lang}` : main)), content: f.code })) : [];
    const hints = node.children.filter(c => c.type === 'container' && c.name === 'hint');
    const readonly = new Set(String(a.readonly || '').split(',').map(s => s.trim()).filter(Boolean));
    const intro = node.children.filter(c => c.type === 'md').map(c => c.text.replace(/(^|\n) {0,3}(`{3,}|~{3,})[\s\S]*?\n {0,3}\2[^\n]*/g, '')).join('\n').trim();

    /* ─── DOM ─── */
    const el = h('div.vx-ws', { style: { '--ws-h': a.height ? `${a.height}px` : null } });
    const title = a.title || node.label || t('ws.title');
    const tabsEl = h('div.ws-tabs');
    const treeEl = h('div.ws-tree', { hidden: !a.tree });
    const editorHost = h('div.ws-editor', h('div.ws-empty', spinner(), ' ', t('ws.loading')));
    const statusPath = h('span');
    const statusPos = h('span');
    const statusLang = h('span');
    const saved = h('span.saved', h('i'), h('span', t('ws.saved')));
    const pane = h('div.ws-pane', { hidden: true });
    const termHost = h('div.term-host');
    const results = h('div.ws-results', { hidden: true });
    pane.append(termHost, results);
    const termToggle = h('button.chip-btn', { onClick: () => togglePane('terminal') }, icon('square-terminal'), h('span', t('terminal')), icon('chevron-up'));
    const resultsToggle = h('button.chip-btn', { hidden: !tests.length, onClick: () => togglePane('results') }, icon('list-checks'), h('span', t('ws.results')));
    const runBtn = h('button.btn.btn-tonal.btn-sm', { hidden: !run, onClick: () => doRun() }, icon('play'), h('span', t('run')));
    const submitBtn = h('button.btn.btn-primary.btn-sm', { hidden: !tests.length, onClick: () => doTests() }, icon('check'), h('span', t('ws.submit')));

    el.append(
      h('div.ws-head', { 'data-vh-skip': '' },
        icon('code-xml'),
        h('div.ws-title', title, runner ? h('small', runner.label || runner.id) : null),
        hints.length ? h('button.chip-btn', { onClick: () => showHints() }, icon('lightbulb'), h('span', t('ws.hint'))) : null,
        solutionFiles.length ? h('button.chip-btn', { onClick: () => showSolution() }, icon('key-round'), h('span', t('ws.solution'))) : null,
        h('button.icon-btn.icon-btn-sm', { 'data-tip': t('ws.reset'), onClick: () => doReset() }, icon('rotate-ccw')),
        h('button.icon-btn.icon-btn-sm', { 'data-tip': t('showFolder'), onClick: () => window.vla.ws.reveal(rctx.courseId, rctx.src, id) }, icon('folder-open')),
        h('button.icon-btn.icon-btn-sm', { 'data-tip': t('ws.max'), onClick: () => toggleMax() }, icon('maximize-2'))),
      intro ? h('div', { style: { padding: '10px 16px 0', fontSize: '14px' } }, rctx.md(intro)) : null,
      h('div.ws-bar', { 'data-vh-skip': '' },
        h('button.chip-btn.ws-files-btn', { onClick: () => { treeEl.hidden = !treeEl.hidden; } }, icon('folder-tree'), h('span', t('ws.files'))),
        h('button.icon-btn.icon-btn-sm', { 'data-tip': t('ws.newFile'), onClick: () => newFile(), style: { alignSelf: 'center', margin: '0 4px' } }, icon('plus')),
        tabsEl),
      h('div.ws-main', { 'data-vh-skip': '' }, treeEl, editorHost),
      h('div.ws-status', { 'data-vh-skip': '' }, statusPath, statusPos, statusLang, saved),
      h('div.ws-bottom', { 'data-vh-skip': '' },
        h('div.ws-bottom-bar', termToggle, resultsToggle, h('span.grow'), runBtn, submitBtn),
        pane));

    /* ─── state ─── */
    let monaco = null;
    let editor = null;
    let tree = [];
    const models = new Map();
    const open = [];
    let active = null;
    let term = null;
    let paneMode = null;
    const dirty = new Set();

    const uri = path => monaco.Uri.parse(`file:///${rctx.courseId}/${rctx.src.replace(/[^\w.-]+/g, '_')}/${id}/${path}`);

    const setSaved = () => {
      saved.classList.toggle('is-dirty', dirty.size > 0);
      saved.lastChild.textContent = dirty.size ? t('ws.unsaved') : t('ws.saved');
    };

    const writeFile = async path => {
      const m = models.get(path);
      if (!m || m.isSolution) return;
      await window.vla.ws.write(rctx.courseId, rctx.src, id, path, m.model.getValue());
      dirty.delete(path);
      renderTabs();
      setSaved();
    };
    const saveAll = async () => { for (const p of [...dirty]) await writeFile(p); };
    const autosave = debounce(path => writeFile(path), 700);

    async function getModel(path, content, opts = {}) {
      if (models.has(path)) return models.get(path).model;
      const text = content ?? await window.vla.ws.read(rctx.courseId, rctx.src, id, path);
      const model = monaco.editor.createModel(text, langOfFile(path), uri(opts.solution ? `__solution__/${path}` : path));
      const entry = { model, isSolution: !!opts.solution, readonly: !!opts.solution || readonly.has(path) };
      models.set(opts.solution ? `${path} ✦` : path, entry);
      if (!entry.isSolution) {
        model.onDidChangeContent(() => { dirty.add(path); setSaved(); renderTabs(); autosave(path); });
      }
      return model;
    }

    function renderTabs() {
      tabsEl.replaceChildren(...open.map(path => h(`button.ws-tab${path === active ? '.is-active' : ''}`, {
        onClick: () => openFile(path),
        onAuxclick: e => { if (e.button === 1) closeTab(path); },
      },
      icon(path.endsWith(' ✦') ? 'key-round' : 'file-code', { width: 14, height: 14 }),
      h('span', path),
      dirty.has(path) ? h('span.dirty') : null,
      h('span.ws-tab-x', { role: 'button', onClick: e => { e.stopPropagation(); closeTab(path); } }, icon('x')))));
    }

    function renderTree() {
      treeEl.replaceChildren(...tree.filter(f => !f.dir).map(f => h(`button.ws-tree-item${f.path === active ? '.is-active' : ''}`, {
        style: { paddingLeft: `${8 + (f.path.split('/').length - 1) * 12}px` },
        onClick: () => openFile(f.path),
        onContextmenu: e => {
          e.preventDefault();
          menu({ x: e.clientX, y: e.clientY }, [
            { label: t('ws.rename'), icon: 'pencil', onClick: () => renameFile(f.path) },
            { label: t('delete'), icon: 'trash-2', danger: true, onClick: () => deleteFile(f.path) },
          ]);
        },
      }, icon('file', { width: 14, height: 14 }), h('span', f.path))));
    }

    async function openFile(path) {
      if (!editor) return;
      const entry = models.get(path);
      const model = entry ? entry.model : await getModel(path);
      if (!open.includes(path)) open.push(path);
      active = path;
      editor.setModel(model);
      const ro = models.get(path)?.readonly;
      editor.updateOptions({ readOnly: !!ro });
      statusPath.textContent = path;
      statusLang.textContent = model.getLanguageId();
      renderTabs();
      renderTree();
    }

    function closeTab(path) {
      const i = open.indexOf(path);
      if (i < 0) return;
      open.splice(i, 1);
      if (dirty.has(path)) writeFile(path);
      if (active === path) {
        const next = open[Math.max(0, i - 1)];
        if (next) openFile(next);
        else { active = null; editor.setModel(null); statusPath.textContent = ''; renderTabs(); }
      } else renderTabs();
    }

    async function refreshTree() {
      tree = await window.vla.ws.list(rctx.courseId, rctx.src, id);
      renderTree();
    }

    async function newFile() {
      const name = await prompt({ title: t('ws.newFile'), label: t('ws.fileName'), placeholder: 'utils.c' });
      if (!name) return;
      await window.vla.ws.write(rctx.courseId, rctx.src, id, name.trim(), '');
      await refreshTree();
      openFile(name.trim());
    }

    async function renameFile(path) {
      const name = await prompt({ title: t('ws.rename'), label: t('ws.fileName'), value: path });
      if (!name || name === path) return;
      await saveAll();
      await window.vla.ws.rename(rctx.courseId, rctx.src, id, path, name.trim());
      models.get(path)?.model.dispose();
      models.delete(path);
      const i = open.indexOf(path);
      if (i >= 0) open.splice(i, 1, name.trim());
      await refreshTree();
      openFile(name.trim());
    }

    async function deleteFile(path) {
      if (!(await confirm({ title: t('ws.deleteQ', { name: path }), danger: true, ok: t('delete') }))) return;
      await window.vla.ws.remove(rctx.courseId, rctx.src, id, path);
      models.get(path)?.model.dispose();
      models.delete(path);
      dirty.delete(path);
      closeTab(path);
      await refreshTree();
    }

    async function init() {
      try {
        monaco = await loadMonaco();
        const r = await window.vla.ws.init(rctx.courseId, rctx.src, id, starter);
        tree = r.tree;
        editorHost.replaceChildren();
        editor = await createEditor(editorHost, { readOnly: false });
        editor.onDidChangeCursorPosition(e => { statusPos.textContent = `${e.position.lineNumber}:${e.position.column}`; });
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveAll());
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => doRun());
        const first = tree.find(f => !f.dir && f.path === main) || tree.find(f => !f.dir);
        /* Tabs: open="a.c,b.c" if given, else every top-level file (like Ed). */
        const extra = a.open
          ? String(a.open).split(',').map(s => s.trim()).filter(Boolean)
          : tree.filter(f => !f.dir && !f.path.includes('/')).map(f => f.path).slice(0, 6);
        if (first) open.push(first.path);
        for (const p of extra) if (tree.some(f => f.path === p) && !open.includes(p)) open.push(p);
        if (first) await openFile(first.path);
        else editorHost.append(h('div.ws-empty', t('ws.empty')));
        renderTree();
        if (a.terminal === 'open') togglePane('terminal');
      } catch (e) {
        editorHost.replaceChildren(h('div.vx-error', `${t('ws.loadFailed')}: ${e.message}`));
      }
    }

    function ensureTerm() {
      if (term) return term;
      term = new TermSession(termHost, {
        onExit: code => {
          term.term.writeln(`\r\n\x1b[2m${t('ws.exited', { code: code ?? '—' })}\x1b[0m`);
          term.restartOnKey = () => { term.restartOnKey = null; term.term.clear(); term.start({ courseId: rctx.courseId, page: rctx.src, ws: id }); };
        },
      });
      return term;
    }

    function togglePane(mode, { autoShell = true } = {}) {
      if (paneMode === mode && !pane.hidden) { pane.hidden = true; paneMode = null; termToggle.querySelector('.i-chevron-down')?.replaceWith(icon('chevron-up')); return; }
      pane.hidden = false;
      paneMode = mode;
      termHost.hidden = mode !== 'terminal';
      results.hidden = mode !== 'results';
      termToggle.classList.toggle('is-active', mode === 'terminal');
      resultsToggle.classList.toggle('is-active', mode === 'results');
      if (mode === 'terminal') {
        const s = ensureTerm();
        setTimeout(() => s.refit(), 0);
        if (autoShell && !s.alive && !s.restartOnKey) s.start({ courseId: rctx.courseId, page: rctx.src, ws: id });
        s.focus();
      }
    }

    async function doRun() {
      if (!run) return;
      await saveAll();
      if (paneMode !== 'terminal' || pane.hidden) togglePane('terminal', { autoShell: false });
      const s = ensureTerm();
      s.restartOnKey = null;
      s.clear();
      const command = build ? `${build} && ${run}` : run;
      s.term.writeln(`\x1b[38;2;217;119;87m▶ ${t('run.running')}\x1b[0m`);
      await s.start({ courseId: rctx.courseId, page: rctx.src, ws: id, command, main });
      s.focus();
    }

    async function doTests() {
      await saveAll();
      if (paneMode !== 'results' || pane.hidden) togglePane('results');
      results.replaceChildren(h('div.tests-summary', spinner(), t('ws.testing')));
      const base = { courseId: rctx.courseId, page: rctx.src, ws: id, main };
      if (testBuild) {
        const b = await window.vla.exec.run({ ...base, command: testBuild, timeout: 120000 });
        if (b.denied) { results.replaceChildren(h('div.tests-summary', icon('shield-alert'), t('term.denied'))); return; }
        if (b.code !== 0) {
          results.replaceChildren(h('div.tests-summary', { style: { color: 'var(--err)' } }, icon('circle-x'), t('run.buildFailed')), h('pre.vx-output', `${b.stdout}${b.stderr}`));
          rctx.report('tests', id, { passed: 0, total: tests.length, at: new Date().toISOString(), build: false });
          return;
        }
      }
      const rows = [];
      let passed = 0;
      for (const [i, tc] of tests.entries()) {
        const cmd = `${run}${tc.args ? ` ${tc.args}` : ''}`;
        const r = await window.vla.exec.run({ ...base, command: cmd, stdin: tc.stdin != null ? String(tc.stdin) : '', timeout: (tc.timeout || 10) * 1000 });
        if (r.denied) { results.replaceChildren(h('div.tests-summary', icon('shield-alert'), t('term.denied'))); return; }
        const ok = !r.timedOut && (tc.expect == null ? r.code === 0 : compareOutput(r.stdout, tc.expect, tc.match)) && (tc.code == null || tc.code === r.code);
        if (ok) passed++;
        rows.push(h(`div.test-row.${ok ? 'is-pass' : 'is-fail'}`,
          icon(ok ? 'circle-check' : 'circle-x'),
          h('div.tr-main',
            h('div.tr-name', tc.name || `${t('ws.test')} ${i + 1}`, r.timedOut ? h('span.badge.badge-err', { style: { marginLeft: '8px' } }, t('timeout')) : null),
            !ok && !tc.hidden ? h('div.tr-diff',
              h('div', h('small', t('ws.expected')), h('pre', String(tc.expect ?? `exit 0`))),
              h('div', h('small', t('ws.got')), h('pre', `${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}` || '∅'))) : null,
            !ok && tc.hidden ? h('div.faint', t('ws.hiddenTest')) : null)));
      }
      const all = passed === tests.length;
      results.replaceChildren(
        h('div.tests-summary', { style: { color: all ? 'var(--ok)' : 'var(--err)' } }, icon(all ? 'party-popper' : 'circle-x'), t('ws.passed', { n: passed, total: tests.length })),
        ...rows);
      rctx.report('tests', id, { passed, total: tests.length, at: new Date().toISOString() });
      if (all) toast(t('ws.allPassed'), { type: 'ok' });
    }

    async function doReset() {
      if (!(await confirm({ title: t('ws.resetQ'), message: t('ws.resetBody'), danger: true, ok: t('ws.reset') }))) return;
      for (const m of models.values()) m.model.dispose();
      models.clear();
      open.length = 0;
      dirty.clear();
      const r = await window.vla.ws.reset(rctx.courseId, rctx.src, id, starter);
      tree = r.tree;
      const first = tree.find(f => !f.dir && f.path === main) || tree.find(f => !f.dir);
      if (first) await openFile(first.path);
      setSaved();
    }

    async function showSolution() {
      if (!(await confirm({ title: t('ws.solutionQ'), message: t('ws.solutionBody'), ok: t('ws.solution'), iconName: 'key-round' }))) return;
      for (const f of solutionFiles) {
        const key = `${f.path} ✦`;
        if (!models.has(key)) await getModel(f.path, f.content, { solution: true });
        if (!open.includes(key)) open.push(key);
      }
      openFile(`${solutionFiles[0].path} ✦`);
    }

    function showHints() {
      if (paneMode !== 'results' || pane.hidden) togglePane('results');
      resultsToggle.hidden = false;
      const box = h('div');
      hints.forEach(hn => box.append(rctx.children(hn.children, h('div.quiz-explain.is-hint', { style: { margin: '0 0 10px' } }, h('div.qe-title', t('quiz.hint'))))));
      results.replaceChildren(box);
    }

    function toggleMax() {
      el.classList.toggle('is-max');
      const onKey = e => { if (e.key === 'Escape') { el.classList.remove('is-max'); document.removeEventListener('keydown', onKey); } };
      if (el.classList.contains('is-max')) document.addEventListener('keydown', onKey);
      setTimeout(() => { editor?.layout(); term?.refit(); }, 50);
    }

    el._vhDetail = () => {
      const sel = editor?.getSelection();
      const model = editor?.getModel();
      return {
        file: active,
        lines: sel && !sel.isEmpty() ? [sel.startLineNumber, sel.endLineNumber] : null,
        text: sel && model && !sel.isEmpty() ? model.getValueInRange(sel).slice(0, 2000) : null,
      };
    };

    rctx.lazy(el, init);
    rctx.onDispose(() => {
      autosave.cancel();
      for (const path of dirty) {
        const m = models.get(path);
        if (m && !m.isSolution) window.vla.ws.write(rctx.courseId, rctx.src, id, path, m.model.getValue());
      }
      dirty.clear();
      term?.dispose();
      editor?.dispose();
      for (const m of models.values()) m.model.dispose();
    });
    return el;
  },
};
