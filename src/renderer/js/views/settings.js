/* ============================================================
 * views/settings.js
 * ============================================================ */

import { h, icon } from '../core/dom.js';
import { t, getLang } from '../core/i18n.js';
import { state, saveSettings, loadInfo } from '../core/store.js';
import { toast, spinner } from '../core/ui.js';
import { setAppbar } from '../appbar.js';
import { turn, status as aiStatus } from '../ai.js';
import { loginClaude } from '../chat.js';

function row(title, desc, control, stacked = false) {
  return h(`div.setting-row${stacked ? '.is-stacked' : ''}`, h('div.sr-text', h('b', title), desc ? h('small', desc) : null), h('div.sr-control', control));
}

function segmented(options, value, onChange) {
  const el = h('div.segmented');
  const draw = v => el.replaceChildren(...options.map(([k, label]) => h(`button${k === v ? '.is-on' : ''}`, { onClick: () => { draw(k); onChange(k); } }, label)));
  draw(value);
  return el;
}

function toggle(checked, onChange) {
  const input = h('input', { type: 'checkbox', checked, onChange: () => onChange(input.checked) });
  return h('label.switch', input, h('span.track'));
}

function field(label, input, hint) {
  return h('div.field', h('label', label), input, hint ? h('div.field-hint', hint) : null);
}

export async function mount(el) {
  setAppbar({ crumbs: [{ label: t('settings') }] });
  const info = await loadInfo();
  const s = state.settings;
  const scroll = h('div.scroll-view');
  const page = h('div.page-narrow');
  scroll.append(page);
  el.append(scroll);

  /* ─── appearance ─── */
  const appearance = h('div.card.settings-card',
    row(t('set.theme'), t('set.themeDesc'), segmented([['dark', t('theme.dark')], ['light', t('theme.light')], ['system', t('theme.system')]], s.theme, v => saveSettings({ theme: v }))),
    row(t('set.lang'), null, segmented([['zh', '中文'], ['en', 'English']], s.lang, v => saveSettings({ lang: v }).then(() => location.reload()))),
    row(t('set.fontSize'), t('set.fontSizeDesc'), segmented([[14, 'S'], [15, 'M'], [17, 'L'], [19, 'XL']], s.fontSize, v => {
      saveSettings({ fontSize: v });
      document.documentElement.style.setProperty('--content-size', `${v}px`);
    })),
    row(t('set.editorFont'), null, segmented([[13, '13'], [14, '14'], [16, '16'], [18, '18']], s.editorFontSize, v => saveSettings({ editorFontSize: v }))),
    row(t('set.sourceEdit'), t('set.sourceEditDesc'), toggle(!!s.editor?.source, v => saveSettings({ editor: { source: v } }))));

  /* ─── AI ─── */
  const baseUrl = h('input.input.input-mono', { value: s.ai.http.baseUrl || '', placeholder: 'https://example.com/v1' });
  const model = h('input.input.input-mono', { value: s.ai.http.model || '', placeholder: 'model-name' });
  const key = h('input.input.input-mono', { type: 'password', placeholder: s.ai.http.hasKey ? t('set.keySaved') : 'sk-…', autocomplete: 'off' });
  const agentCmd = h('input.input.input-mono', { value: s.ai.agent.command || '', placeholder: 'your-agent -p' });
  const agentInteractive = h('input.input.input-mono', { value: s.ai.agent.interactive || '', placeholder: 'your-agent' });
  const testOut = h('div.field-hint');
  const saveAI = async () => {
    const patch = { ai: { http: { baseUrl: baseUrl.value.trim(), model: model.value.trim() }, agent: { command: agentCmd.value.trim(), interactive: agentInteractive.value.trim() } } };
    if (key.value) patch.ai.http.key = key.value.trim();
    await saveSettings(patch);
    key.value = '';
    key.placeholder = state.settings.ai.http.hasKey ? t('set.keySaved') : 'sk-…';
    toast(t('saved'), { type: 'ok', timeout: 1500 });
  };
  const testHttp = async () => {
    await saveAI();
    testOut.replaceChildren(spinner(), ' ', t('set.testing'));
    let acc = '';
    try {
      const job = turn('http', { messages: [{ role: 'user', content: getLang() === 'en' ? 'Reply with: OK' : '请只回复：好的' }] }, { onDelta: d => { acc += d; } });
      const r = await job.promise;
      testOut.replaceChildren(icon('circle-check', { width: 14, height: 14 }), ' ', `${t('set.testOk')}: ${(r.text || acc).slice(0, 120)}`);
    } catch (e) { testOut.replaceChildren(icon('circle-x', { width: 14, height: 14 }), ' ', e.message); }
  };
  const testAgent = async () => {
    await saveAI();
    testOut.replaceChildren(spinner(), ' ', t('set.testing'));
    let acc = '';
    try {
      const job = turn('agent', { prompt: getLang() === 'en' ? 'Reply with exactly: OK' : '请只回复两个字：好的' }, { onDelta: d => { acc += d; } });
      const r = await job.promise;
      testOut.replaceChildren(icon('circle-check', { width: 14, height: 14 }), ' ', `${t('set.testOk')}: ${(r.text || acc).trim().slice(0, 160)}`);
    } catch (e) { testOut.replaceChildren(icon('circle-x', { width: 14, height: 14 }), ' ', e.message); }
  };
  /* ─── Claude Code ─── */
  const claudeBox = h('div.cc-status', spinner(), h('span', t('set.cc.checking')));
  const claudePath = h('input.input.input-mono', { value: s.ai.claude?.path || '', placeholder: t('set.cc.pathPh') });
  const claudeOut = h('div.field-hint');
  const drawClaude = async (fresh = false) => {
    claudeBox.replaceChildren(spinner(), h('span', t('set.cc.checking')));
    let st;
    try { st = await aiStatus({ fresh }); } catch (e) { claudeBox.replaceChildren(icon('circle-x'), h('span', e.message)); return; }
    const c = st.claude || {};
    if (!c.found) {
      claudeBox.replaceChildren(
        h('div.cc-line', icon('circle-dashed', { style: 'color:var(--warn)' }), h('b', t('set.cc.notFound'))),
        h('p.cc-sub', t('set.cc.notFoundBody')),
        h('div.row',
          h('button.btn.btn-sm', { onClick: () => drawClaude(true) }, icon('refresh-cw'), h('span', t('set.cc.recheck')))));
      return;
    }
    const login = c.loggedIn === true
      ? h('span.badge.badge-ok', icon('circle-check'), t('set.cc.loggedIn'))
      : c.loggedIn === false ? h('span.badge.badge-warn', icon('log-in'), t('set.cc.loggedOut')) : h('span.badge.badge-muted', t('set.cc.loginUnknown'));
    claudeBox.replaceChildren(
      h('div.cc-line', icon('circle-check', { style: 'color:var(--ok)' }), h('b', `Claude Code ${c.version || ''}`), login,
        c.bundled ? h('span.badge.badge-muted', t('set.cc.bundled')) : null),
      h('code.cc-path', c.path),
      h('div.row',
        c.loggedIn !== true ? h('button.btn.btn-sm.btn-primary', { onClick: async () => { await loginClaude(); drawClaude(true); } }, icon('log-in'), h('span', t('chat.login'))) : null,
        h('button.btn.btn-sm.btn-outline', { onClick: testClaude }, icon('plug'), h('span', t('set.test'))),
        h('button.btn.btn-sm', { onClick: () => drawClaude(true) }, icon('refresh-cw'), h('span', t('set.cc.recheck')))));
  };
  const testClaude = async () => {
    claudeOut.replaceChildren(spinner(), ' ', t('set.testing'));
    let acc = '';
    try {
      const job = turn('claude', { prompt: getLang() === 'en' ? 'Reply with exactly: OK' : '请只回复两个字：好的', mode: 'ask' }, { onText: x => { acc = x; } });
      const r = await job.promise;
      claudeOut.replaceChildren(icon('circle-check', { width: 14, height: 14 }), ' ', `${t('set.testOk')}: ${(r.text || acc).trim().slice(0, 120)}`);
    } catch (e) {
      claudeOut.replaceChildren(icon('circle-x', { width: 14, height: 14 }), ' ', e.code === 'NO_LOGIN' ? t('chat.loginNeeded') : e.message);
      if (e.code === 'NO_LOGIN') drawClaude(true);
    }
  };
  drawClaude();
  const claude = h('div.card.settings-card',
    h('div.setting-row.is-stacked',
      h('div.sr-text', h('b', 'Claude Code'), h('small', t('set.cc.desc'))),
      claudeBox, claudeOut),
    row(t('set.cc.model'), t('set.cc.modelDesc'), segmented([['', t('set.cc.modelDefault')], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']], s.ai.claude?.model || '', v => saveSettings({ ai: { claude: { model: v } } }))),
    row(t('set.cc.allowEdits'), t('set.cc.allowEditsDesc'), toggle(s.ai.claude?.allowEdits !== false, v => saveSettings({ ai: { claude: { allowEdits: v } } }))),
    row(t('set.cc.userMcp'), t('set.cc.userMcpDesc'), toggle(!!s.ai.claude?.userMcp, v => saveSettings({ ai: { claude: { userMcp: v } } }))),
    h('div.setting-row.is-stacked',
      h('div.sr-text', h('b', t('set.cc.path')), h('small', t('set.cc.pathDesc'))),
      h('div.row', claudePath, h('button.btn.btn-sm.btn-outline', { onClick: async () => { await saveSettings({ ai: { claude: { path: claudePath.value.trim() } } }); drawClaude(true); } }, icon('save'), h('span', t('save'))))),
    row(t('set.ai.prefer'), t('set.ai.preferDesc'), segmented([['auto', t('set.ai.auto')], ['claude', 'Claude Code'], ['http', t('set.ai.http.short')], ['agent', t('set.ai.agent.short')]], s.ai.prefer || 'auto', v => saveSettings({ ai: { prefer: v } }))));

  /* ─── MCP ─── */
  const mcpBox = h('div.stack', spinner());
  const drawMcp = async () => {
    let st;
    try { st = await window.vla.mcp.status(); } catch (e) { mcpBox.replaceChildren(h('span.faint', e.message)); return; }
    const act = async (fn, okMsg) => {
      try { await fn(); toast(okMsg, { type: 'ok', timeout: 5000 }); } catch (e) { toast(e.message, { type: 'err', timeout: 8000 }); }
      drawMcp();
    };
    const line = (name, on, add, remove, hint) => h('div.mcp-row',
      icon(on ? 'circle-check' : 'circle-dashed', { width: 16, height: 16, style: `color:var(--${on ? 'ok' : 'faint'})` }),
      h('div.grow', h('b', name), h('small', on ? t('set.mcp.added') : hint || t('set.mcp.notAdded'))),
      on ? h('button.btn.btn-sm.btn-danger', { onClick: remove }, t('set.mcp.remove')) : h('button.btn.btn-sm.btn-tonal', { onClick: add }, icon('plus'), h('span', t('set.mcp.add'))));
    const json = JSON.stringify({ mcpServers: { 'vibe-learn': st.server } }, null, 2);
    mcpBox.replaceChildren(
      line('Claude Code', st.code,
        () => act(() => window.vla.mcp.install('code'), t('set.mcp.codeOk')),
        () => act(() => window.vla.mcp.remove('code'), t('set.mcp.removed'))),
      line(t('set.mcp.desktop'), st.desktop,
        () => act(() => window.vla.mcp.install('desktop'), t('set.mcp.desktopOk')),
        () => act(() => window.vla.mcp.remove('desktop'), t('set.mcp.removed')),
        st.desktopInstalled ? t('set.mcp.notAdded') : t('set.mcp.noDesktop')),
      h('details.mcp-json', h('summary', icon('braces', { width: 14, height: 14 }), h('span', t('set.mcp.json'))),
        h('pre', json),
        h('button.btn.btn-sm', { onClick: async () => { await window.vla.app.clipboard(json); toast(t('copied'), { type: 'ok', timeout: 1500 }); } }, icon('copy'), h('span', t('copy')))));
  };
  drawMcp();
  const mcp = h('div.card.settings-card',
    h('div.setting-row.is-stacked', h('div.sr-text', h('b', t('set.mcp.title')), h('small', t('set.mcp.desc'))), mcpBox));

  const ai = h('div.card.settings-card',
    h('div.setting-row.is-stacked',
      h('div.sr-text', h('b', t('set.ai.http')), h('small', t('set.ai.httpDesc'))),
      h('div.setting-grid', field('Base URL', baseUrl), field(t('set.ai.model'), model)),
      field('API Key', key, t('set.ai.keyHint')),
      h('div.row', h('button.btn.btn-sm.btn-outline', { onClick: testHttp }, icon('plug'), h('span', t('set.test'))),
        s.ai.http.hasKey ? h('button.btn.btn-sm.btn-danger', { onClick: async () => { await saveSettings({ ai: { http: { key: '' } } }); toast(t('set.keyCleared'), { type: 'ok' }); } }, icon('trash-2'), h('span', t('set.clearKey'))) : null)),
    h('div.setting-row.is-stacked',
      h('div.sr-text', h('b', t('set.ai.agent')), h('small', t('set.ai.agentDesc'))),
      field(t('set.ai.agentCmd'), agentCmd, t('set.ai.agentCmdHint')),
      field(t('set.ai.agentInteractive'), agentInteractive, t('set.ai.agentInteractiveHint')),
      h('div.row', h('span.grow', t('set.ai.stdin')), toggle(s.ai.agent.stdin !== false, v => saveSettings({ ai: { agent: { stdin: v } } }))),
      h('div.row', h('button.btn.btn-sm.btn-outline', { onClick: testAgent }, icon('bot'), h('span', t('set.test'))))),
    h('div.setting-row', testOut, h('span.grow'), h('button.btn.btn-primary.btn-sm', { onClick: saveAI }, icon('save'), h('span', t('save')))));

  /* ─── AI workspace ─── */
  const workDir = h('input.input.input-mono', { value: s.workDir || '', placeholder: info.paths.workDir });
  const workspace = h('div.card.settings-card',
    h('div.setting-row.is-stacked',
      h('div.sr-text', h('b', t('set.workDir')), h('small', t('set.workDirDesc'))),
      workDir,
      h('div.row',
        h('button.btn.btn-sm.btn-outline', { onClick: async () => { await saveSettings({ workDir: workDir.value.trim() }); const d = await window.vla.kit.prepare(); toast(t('set.kitReady', { dir: d }), { type: 'ok' }); } }, icon('refresh-cw'), h('span', t('set.kitPrepare'))),
        h('button.btn.btn-sm', { onClick: () => window.vla.kit.open() }, icon('folder-open'), h('span', t('ai.workspace.open'))))));

  /* ─── code ─── */
  const shell = h('input.input.input-mono', { value: s.shell || '', placeholder: info.platform === 'win32' ? 'powershell.exe -NoLogo' : '/bin/bash -l' });
  const python = h('input.input.input-mono', { value: s.python || '', placeholder: await window.vla.exec.python() });
  const tools = h('div.stack', { style: { gap: '4px', fontSize: '12.5px' } }, spinner());
  const code = h('div.card.settings-card',
    h('div.setting-row.is-stacked', h('div.sr-text', h('b', t('set.shell')), h('small', t('set.shellDesc'))), shell),
    h('div.setting-row.is-stacked', h('div.sr-text', h('b', 'Python'), h('small', t('set.pythonDesc'))), python),
    h('div.setting-row', h('div.grow'), h('button.btn.btn-primary.btn-sm', { onClick: async () => { await saveSettings({ shell: shell.value.trim(), python: python.value.trim() }); toast(t('saved'), { type: 'ok', timeout: 1500 }); } }, icon('save'), h('span', t('save')))),
    h('div.setting-row.is-stacked', h('div.sr-text', h('b', t('set.tools')), h('small', t('set.toolsDesc', { pty: info.hasPty ? 'node-pty ✓' : 'pipes' }))), tools));
  window.vla.exec.check(['node', 'python', 'gcc', 'g++', 'clang', 'java', 'javac', 'go', 'rustc', 'sqlite3', 'git', 'make']).then(found => {
    tools.replaceChildren(...Object.entries(found).map(([name, path]) => h('div.row',
      icon(path ? 'circle-check' : 'circle-dashed', { width: 14, height: 14, style: `color:var(--${path ? 'ok' : 'faint'})` }),
      h('code', { style: { minWidth: '70px' } }, name), h('span.faint.ellipsis', path || t('set.notFound')))));
  });

  /* ─── security ─── */
  const trustBox = h('div.stack');
  const drawTrust = async () => {
    const ids = await window.vla.settings.trusted();
    trustBox.replaceChildren(...(ids.length ? ids.map(id => h('div.row', icon('shield-check', { width: 15, height: 15 }), h('code.grow', id),
      h('button.btn.btn-sm.btn-danger', { onClick: async () => { await window.vla.settings.untrust(id); drawTrust(); } }, t('set.untrust')))) : [h('span.faint', t('set.noTrusted'))]));
  };
  drawTrust();
  const security = h('div.card.settings-card', h('div.setting-row.is-stacked', h('div.sr-text', h('b', t('set.trusted')), h('small', t('set.trustedDesc'))), trustBox));

  /* ─── about ─── */
  const about = h('div.card.settings-card',
    row('Vibe Learn Anything', `v${info.version} · ${info.platform}`, h('button.btn.btn-sm', { onClick: () => window.vla.app.openPath(info.paths.data) }, icon('folder-open'), h('span', t('set.dataFolder')))));

  page.append(
    h('h1.page-title', t('settings')),
    h('p.page-lead', t('set.lead')),
    h('section.settings-group', h('h3', t('set.appearance')), appearance),
    h('section.settings-group', { id: 'ai' }, h('h3', 'AI'), claude),
    h('section.settings-group', h('h3', 'MCP'), mcp),
    h('section.settings-group', h('h3', t('set.ai.others')), ai),
    h('section.settings-group', h('h3', t('set.workspace')), workspace),
    h('section.settings-group', h('h3', t('set.code')), code),
    h('section.settings-group', h('h3', t('set.security')), security),
    h('section.settings-group', h('h3', t('set.about')), about));
  return {};
}
