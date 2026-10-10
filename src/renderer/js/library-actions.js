/* ============================================================
 * library-actions.js — import / export / remove / AI hand-off,
 * shared by the dashboard and the course page.
 * ============================================================ */

import { h, icon } from './core/dom.js';
import { t } from './core/i18n.js';
import { toast, dialog, confirm } from './core/ui.js';
import { bus, state, dropCourse, loadInfo } from './core/store.js';
import { go } from './core/router.js';
import { generatePrompt, exportPrompt } from './ai.js';

async function resolveConflict(r) {
  const choice = await dialog({
    title: t('import.conflict.title', { title: r.title }),
    iconName: 'copy',
    body: h('p', t('import.conflict.body', { a: r.existingVersion, b: r.incomingVersion })),
    actions: [
      { label: t('cancel'), value: 'cancel' },
      { label: t('import.asCopy'), value: 'copy' },
      { label: t('import.update'), value: 'update', primary: true },
    ],
  });
  return window.vla.library.resolveImport(r.token, choice || 'cancel');
}

export async function importFiles(files) {
  const results = await window.vla.library.import(files);
  let lastId = null;
  for (let r of results) {
    if (r.error) { toast(`${t('import.failed')}: ${r.error}`, { type: 'err', timeout: 8000 }); continue; }
    if (r.conflict) r = await resolveConflict(r);
    if (!r || r.action === 'cancelled') continue;
    dropCourse(r.id);
    lastId = r.id;
    toast(r.action === 'updated' ? t('import.updated') : t('import.done'), {
      type: 'ok',
      actions: [{ label: t('open'), onClick: () => go(`/course/${r.id}`) }],
    });
    if (r.errors) toast(t('import.withErrors', { n: r.errors }), { type: 'err' });
  }
  bus.emit('library');
  return lastId;
}

export async function exportCourse(id) {
  const r = await window.vla.library.export(id, {});
  if (r) toast(t('export.done'), { type: 'ok', actions: [{ label: t('show'), onClick: () => window.vla.app.openPath(r.file.replace(/[\\/][^\\/]+$/, '')) }] });
}

function copyBlock(text) {
  return h('div.code-line', h('code', text), h('button.icon-btn.icon-btn-xs', {
    'data-tip': t('copy'),
    onClick: async () => { await window.vla.app.clipboard(text); toast(t('copied'), { type: 'ok', timeout: 1600 }); },
  }, icon('copy')));
}

export async function exportForAI(id) {
  const r = await window.vla.library.export(id, { forAI: true });
  if (!r) return;
  const info = await loadInfo();
  const prompt = exportPrompt({ workDir: info.paths.workDir, file: r.file, id });
  await dialog({
    title: t('exportAI.title'),
    iconName: 'sparkles',
    sub: t('exportAI.sub'),
    wide: true,
    body: h('div',
      h('ol.steps-list',
        h('li', t('exportAI.s1'), copyBlock(r.file)),
        h('li', t('exportAI.s2'), h('p', t('exportAI.s2b')), h('div.code-line', { style: { whiteSpace: 'pre-wrap', alignItems: 'flex-start' } },
          h('code', { style: { whiteSpace: 'pre-wrap' } }, prompt),
          h('button.icon-btn.icon-btn-xs', { onClick: async () => { await window.vla.app.clipboard(prompt); toast(t('copied'), { type: 'ok', timeout: 1600 }); } }, icon('copy')))),
        h('li', t('exportAI.s3'), h('p', t('exportAI.s3b'))))),
    actions: [
      { label: t('ai.workspace.open'), icon: 'folder-open', onClick: () => { window.vla.kit.open(); return false; } },
      { label: t('copyPrompt'), icon: 'copy', primary: true, onClick: async () => { await window.vla.app.clipboard(prompt); toast(t('copied'), { type: 'ok', timeout: 1600 }); } },
    ],
  });
}

export async function removeCourse(id, title) {
  const ok = await confirm({ title: t('remove.title', { title }), message: t('remove.body'), ok: t('remove'), danger: true });
  if (!ok) return false;
  await window.vla.library.remove(id);
  dropCourse(id);
  bus.emit('library');
  toast(t('remove.done'), { type: 'ok' });
  return true;
}

/* "Generate a course with AI" — explains the loop and hands over the prompt. */
export async function generateCourseDialog() {
  const dir = await window.vla.kit.prepare();
  const prompt = generatePrompt(dir);
  const s = await window.vla.ai.status();
  await dialog({
    title: t('gen.title'),
    sub: t('gen.sub'),
    iconName: 'wand-sparkles',
    wide: true,
    body: h('div',
      h('ol.steps-list',
        h('li', t('gen.s1'), h('p', t('gen.s1b')), copyBlock(dir)),
        h('li', t('gen.s2'), h('p', t('gen.s2b')), copyBlock(prompt)),
        h('li', t('gen.s3'), h('p', t('gen.s3b'))))),
    actions: [
      { label: t('ai.workspace.open'), icon: 'folder-open', onClick: () => { window.vla.kit.open(); return false; } },
      s.interactive ? { label: t('gen.launch'), icon: 'terminal', onClick: () => { state.agentLaunch = { mode: 'kit', prompt }; go('/agent'); } } : null,
      { label: t('copyPrompt'), icon: 'copy', primary: true, onClick: async () => { await window.vla.app.clipboard(prompt); toast(t('copied'), { type: 'ok', timeout: 1600 }); return false; } },
    ].filter(Boolean),
  });
}
