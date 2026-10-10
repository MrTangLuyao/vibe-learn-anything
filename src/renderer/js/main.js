/* ============================================================
 * Vibe Learn Anything — renderer entry.
 * ============================================================ */

import { bindRipples, h, icon, installNullSafeDom } from './core/dom.js';
import { bindTooltips, toast } from './core/ui.js';
import { loadSettings, loadInfo, state } from './core/store.js';
import { setLang, t } from './core/i18n.js';
import { applyTheme } from './core/theme.js';
import { route, startRouter } from './core/router.js';
import { importFiles } from './library-actions.js';

function setupDropImport() {
  let depth = 0;
  let zone = null;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', e => {
    if (!hasFiles(e)) return;
    depth++;
    if (!zone) {
      zone = h('div.dropzone', icon('package-open'), h('div', t('drop.vla')));
      document.body.append(zone);
    }
  });
  window.addEventListener('dragleave', e => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) { zone?.remove(); zone = null; }
  });
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    zone?.remove();
    zone = null;
    const files = [...e.dataTransfer.files]
      .map(f => window.vla.app.pathForFile(f))
      .filter(p => p && p.toLowerCase().endsWith('.vla'));
    if (files.length) importFiles(files);
    else toast(t('drop.notVla'), { type: 'err' });
  });
}

async function boot() {
  installNullSafeDom();
  await Promise.all([loadSettings(), loadInfo()]);
  setLang(state.settings.lang);
  document.documentElement.dataset.platform = state.info.platform;
  document.documentElement.style.setProperty('--content-size', `${state.settings.fontSize || 15}px`);
  applyTheme();
  bindRipples();
  bindTooltips();

  route('/', () => import('./views/dashboard.js'));
  route('/course/:id', () => import('./views/course.js'));
  route('/learn/:id/:chapter/:page?', () => import('./views/lesson.js'));
  route('/settings', () => import('./views/settings.js'));
  route('/help/:doc?', () => import('./views/help.js'));
  route('/agent', () => import('./views/agent.js'));

  setupDropImport();
  window.vla.app.onOpenFiles(files => importFiles(files));
  window.vla.kit.onVla(({ file, name }) => toast(t('kit.vlaReady', { name }), {
    iconName: 'sparkles',
    timeout: 20000,
    actions: [{ label: t('import'), onClick: () => importFiles([file]) }],
  }));
  window.vla.kit.watch();
  startRouter();
}

boot().catch(e => {
  console.error(e);
  document.getElementById('view').append(h('div.vx-error', String(e?.stack || e)));
});
