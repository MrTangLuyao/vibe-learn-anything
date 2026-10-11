/* ============================================================
 * chat.js — the AI side panel (the ✦ AI button in the title bar).
 * It always knows where the learner is (page, selected text, the code
 * in a workspace) and keeps one conversation per course. With Claude
 * Code it can also change the course: pages update live while it
 * works, and every turn can be undone.
 * ============================================================ */

import { h, icon, storageGet, storageSet, dragResize } from './core/dom.js';
import { t, getLang } from './core/i18n.js';
import { state, bus, saveSettings } from './core/store.js';
import { toast, spinner, dialog } from './core/ui.js';
import { go } from './core/router.js';
import { renderHtml } from './vitent/markdown.js';
import { status as aiStatus, cachedStatus, pickProvider, turn, slash } from './ai.js';
import { currentContext, flushLive } from './ai-context.js';
import { TermSession } from './lib/term.js';

const pageKey = src => String(src || '').replace(/\\/g, '/').replace(/\.vitent$/i, '').replace(/[/]+/g, '__').replace(/[^\w.-]+/g, '-');
const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n)}\n…(truncated)` : s || '');
const base = p => String(p || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';

/* ─── tool steps ─── */

const MCP_PREFIX = 'mcp__vibe-learn__';

function toolStep(name, input = {}) {
  const file = base(input.file_path || input.path || input.page || '');
  if (name.startsWith(MCP_PREFIX)) {
    const n = name.slice(MCP_PREFIX.length);
    const target = input.page ? base(input.page).replace(/\.vitent$/i, '') : input.name || input.highlight_id || input.path || '';
    const key = `tool.${n}`;
    return { icon: { get_current_context: 'map-pin', read_page: 'file-text', write_page: 'file-pen', edit_page: 'file-pen', create_page: 'file-plus', list_annotations: 'notebook-pen', reply_annotation: 'message-square-reply', validate_course: 'shield-check', get_course: 'list-tree', list_courses: 'library', list_files: 'folder-tree', read_file: 'file', write_file: 'file-pen' }[n] || 'plug', label: t(key) === key ? n : t(key), detail: target };
  }
  switch (name) {
    case 'Read': return { icon: 'file-text', label: t('tool.read'), detail: file };
    case 'Edit': case 'MultiEdit': return { icon: 'file-pen', label: t('tool.edit'), detail: file };
    case 'Write': return { icon: 'file-plus', label: t('tool.write'), detail: file };
    case 'Glob': case 'Grep': return { icon: 'search', label: t('tool.search'), detail: input.pattern || '' };
    case 'WebSearch': return { icon: 'globe', label: t('tool.web'), detail: input.query || '' };
    case 'WebFetch': return { icon: 'globe', label: t('tool.fetch'), detail: input.url || '' };
    case 'TodoWrite': return { icon: 'list-checks', label: t('tool.plan'), detail: '' };
    case 'Bash': return { icon: 'square-terminal', label: t('tool.bash'), detail: input.command || '' };
    default: return { icon: 'wrench', label: name, detail: file };
  }
}

/* ─── prompts ─── */

function where(ctx) {
  const en = getLang() === 'en';
  if (!ctx.courseId) return en ? 'The learner is on the course library page.' : '学习者在课程库首页。';
  const lines = [`${en ? 'Course' : '课程'}: ${ctx.courseTitle}${ctx.courseCode ? ` (${ctx.courseCode})` : ''} — id ${ctx.courseId}`];
  if (ctx.chapterTitle) lines.push(`${en ? 'Chapter' : '章节'}: ${ctx.chapterTitle}`);
  if (ctx.page) lines.push(`${en ? 'Page' : '页面'}: ${ctx.pageTitle} (${en ? 'page' : '第'} ${ctx.pageIndex}/${ctx.pageCount}${en ? '' : ' 页'}; ${en ? 'file' : '文件'} ${ctx.page}/index.md)`);
  else if (ctx.view === 'course') lines.push(en ? 'View: the course overview (chapter list).' : '视图：课程目录（章节列表）。');
  return lines.join('\n');
}

function attachments(use) {
  const en = getLang() === 'en';
  const out = [];
  if (use.selection) out.push(`${en ? '[Text the learner selected]' : '【学习者选中的内容】'}\n> ${clip(use.selection, 4000).replace(/\n/g, '\n> ')}`);
  if (use.code) {
    const c = use.code;
    const lines = c.lines ? `${en ? 'lines' : '第'} ${c.lines[0]}–${c.lines[1]}${en ? '' : ' 行'}` : '';
    const rel = `learner/workspaces/${pageKey(c.page)}/${c.wsId}/${c.file}`;
    out.push(`${en ? `[The learner's code] ${c.file}` : `【学习者的代码】${c.file}`}${c.title ? ` (${c.title})` : ''}${lines ? ` — ${lines}` : ''}
${c.selection ? `${en ? 'Selected:' : '选中的部分：'}\n\`\`\`${c.language || ''}\n${clip(c.selection, 4000)}\n\`\`\`\n` : ''}${en ? 'Whole file' : '完整文件'} (${rel}):
\`\`\`${c.language || ''}
${clip(c.code, 12000)}
\`\`\``);
  }
  if (use.extra) out.push(use.extra);
  return out.join('\n\n');
}

function rules({ edit, provider }) {
  const en = getLang() === 'en';
  const kit = slash(state.info?.paths?.workDir || '');
  const common = en
    ? `You are "answer", the AI tutor inside the learning app Vibe Learn Anything. You are talking to the learner in the app's side panel.
- Reply in English, in Markdown ($…$ for math, fenced code with a language). Be accurate, friendly and step by step.
- For exercises, give hints and reasoning first; only give a full solution when the learner asks for it.`
    : `你是学习软件 Vibe Learn Anything 里的 AI 助教 answer，正在软件右侧的对话面板里和学习者交流。
- 用中文回答，使用 Markdown（数学用 $…$，代码用带语言标注的代码块）。准确、友好、循序渐进。
- 遇到练习题，先给思路和提示；学习者明确要答案时才给完整解答。`;
  if (provider !== 'claude') return common;
  const tools = en
    ? `- The vibe-learn MCP tools know the app: get_current_context (what the learner is looking at right now), read_page, get_course, list_annotations, validate_course …`
    : `- vibe-learn MCP 工具连着这个软件：get_current_context（学习者此刻在看哪里）、read_page、get_course、list_annotations、validate_course 等。`;
  const editing = edit
    ? (en
      ? `- You MAY change the course. The current directory is the course folder (course.json, content/**/*.vitent/index.md); edit files directly or use edit_page / write_page / create_page. The learner sees every change live.
- Vitent syntax: ${kit}/ai_manual/02-vitent-format.md and 03-vitent-blocks.md — read them before writing new blocks. After changing pages call validate_course and fix errors.
- Change only what the learner asked for. Never delete or rewrite learner comments in annotations.json; leave learner/ alone (learner/workspaces/* is the learner's own code — edit it only when asked).
- When you changed something, finish with one or two sentences saying what changed.`
      : `- 你可以修改课程。当前目录就是课程文件夹（course.json、content/**/*.vitent/index.md），可以直接改文件，也可以用 edit_page / write_page / create_page。学习者会实时看到改动。
- Vitent 语法见 ${kit}/ai_manual/02-vitent-format.md 和 03-vitent-blocks.md，写新组件前先看。改完页面调用 validate_course 校验并修复错误。
- 只改学习者要求的内容。不要删除或改写 annotations.json 里 learner 的评论；不要动 learner/ 里的学习记录（learner/workspaces/* 是学习者自己的代码，只有他要求时才改）。
- 改完用一两句话告诉学习者改了什么。`)
    : (en
      ? '- This turn is read-only: do not modify files. If the learner wants the course changed, tell them to switch on "Allow changes" below the input box.'
      : '- 这一轮只能阅读，不能修改任何文件。如果学习者想改课程，请他打开输入框下方的「允许修改课程」。');
  return `${common}\n${tools}\n${editing}`;
}

/* ─── the panel ─── */

class ChatPanel {
  constructor(host) {
    this.host = host;
    this.threads = new Map();
    this.job = null;
    this.dismissed = { page: false, selection: null, code: null };
    this.allowEdits = state.settings?.ai?.claude?.allowEdits !== false;
    this.ctx = currentContext();

    this.list = h('div.chat-list');
    this.banner = h('div.chat-banner', { hidden: true });
    this.providerBadge = h('span.chat-provider');
    this.chips = h('div.chat-chips');
    this.input = h('textarea.chat-input', {
      rows: 1,
      placeholder: t('chat.placeholder'),
      onInput: () => this.autosize(),
      onKeydown: e => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); }
        if (e.key === 'Escape' && this.job) this.stop();
      },
    });
    this.sendBtn = h('button.icon-btn.icon-btn-sm.chat-send', { 'data-tip': t('chat.send'), onClick: () => (this.job ? this.stop() : this.send()) }, icon('arrow-up'));
    this.editToggle = h('label.chat-edit', { 'data-tip': t('chat.allowEditsTip') },
      h('input', { type: 'checkbox', checked: this.allowEdits, onChange: e => { this.allowEdits = e.target.checked; saveSettings({ ai: { claude: { allowEdits: this.allowEdits } } }); this.renderFoot(); } }),
      h('span.track'), h('span.lbl', t('chat.allowEdits')));
    this.footNote = h('span.chat-foot-note');
    const handle = h('div.resize-handle-v.chat-resize');
    let startW = 0;
    handle.addEventListener('pointerdown', () => { startW = this.el.offsetWidth; });
    dragResize(handle, {
      axis: 'x',
      onMove: dx => { this.el.style.setProperty('--chat-w', `${Math.max(320, Math.min(760, startW - dx))}px`); },
      onEnd: () => { storageSet('vla.chatW', this.el.offsetWidth); syncSpace(); },
    });

    this.el = h('aside.chat-panel', { style: { '--chat-w': `${storageGet('vla.chatW', 420)}px` } },
      handle,
      h('div.chat-head',
        h('span.chat-logo', icon('sparkles')),
        h('b', t('chat.title')),
        this.providerBadge,
        h('span.grow'),
        h('button.icon-btn.icon-btn-sm', { 'data-tip': t('chat.new'), onClick: () => this.reset() }, icon('square-pen')),
        h('button.icon-btn.icon-btn-sm', { 'data-tip': t('settings'), onClick: () => go('/settings') }, icon('settings-2')),
        h('button.icon-btn.icon-btn-sm', { 'data-tip': t('close'), onClick: () => toggleChat(false) }, icon('x'))),
      this.banner,
      this.list,
      h('div.chat-compose',
        this.chips,
        h('div.chat-box', this.input, this.sendBtn),
        h('div.chat-foot', this.editToggle, h('span.grow'), this.footNote)));
    host.replaceChildren(this.el);

    this.offCtx = bus.on('ai:context', c => { this.ctx = c; this.onContext(); });
    this.offSettings = bus.on('settings', () => this.renderFoot());
    this.onContext();
    this.refreshStatus();
  }

  key(ctx = this.ctx) {
    return ctx.courseId || '_home';
  }

  thread(ctx = this.ctx) {
    const k = this.key(ctx);
    if (!this.threads.has(k)) this.threads.set(k, { items: [], sessionId: null, lastWhere: null });
    return this.threads.get(k);
  }

  autosize() {
    this.input.style.height = 'auto';
    this.input.style.height = `${Math.min(220, this.input.scrollHeight)}px`;
  }

  /* ─── status / provider ─── */

  async refreshStatus(fresh = false) {
    const s = cachedStatus();
    if (s && !fresh) this.applyStatus(s);
    try { this.applyStatus(await aiStatus({ fresh })); } catch { /* keep the old one */ }
  }

  applyStatus(s) {
    this.status = s;
    this.provider = pickProvider(s);
    const names = { claude: 'Claude Code', http: t('set.ai.http.short'), agent: t('set.ai.agent.short') };
    this.providerBadge.textContent = this.provider ? names[this.provider] : '';
    this.providerBadge.hidden = !this.provider;
    const c = s.claude;
    if (!this.provider) this.showBanner('plug-zap', t('chat.noAi'), t('chat.noAiBody'), [{ label: t('settings'), onClick: () => go('/settings') }]);
    else if (this.provider === 'claude' && c?.loggedIn === false) this.showBanner('log-in', t('chat.notLoggedIn'), t('chat.notLoggedInBody'), [{ label: t('chat.login'), primary: true, onClick: () => loginClaude().then(() => this.refreshStatus(true)) }]);
    else this.banner.hidden = true;
    this.renderFoot();
  }

  showBanner(ic, title, body, actions = []) {
    this.banner.hidden = false;
    this.banner.replaceChildren(icon(ic), h('div.grow', h('b', title), body ? h('p', body) : null),
      h('div.cb-actions', actions.map(a => h(`button.btn.btn-sm${a.primary ? '.btn-primary' : '.btn-tonal'}`, { onClick: a.onClick }, a.label))));
  }

  canEdit() {
    return this.provider === 'claude' && !!this.ctx.courseId;
  }

  renderFoot() {
    this.editToggle.hidden = !this.canEdit();
    const input = this.editToggle.querySelector('input');
    if (input) input.checked = this.allowEdits;
    this.footNote.textContent = this.canEdit() ? (this.allowEdits ? t('chat.editsOn') : t('chat.readOnly')) : '';
    this.input.placeholder = this.canEdit() && this.allowEdits ? t('chat.placeholderEdit') : t('chat.placeholder');
  }

  /* ─── context chips ─── */

  onContext() {
    const c = this.ctx;
    if (this.dismissed.selection && this.dismissed.selection !== (c.selection || '')) this.dismissed.selection = null;
    const codeSig = c.code ? `${c.code.file}|${c.code.selection || ''}` : '';
    if (this.dismissed.code && this.dismissed.code !== codeSig) this.dismissed.code = null;
    if (this.shownKey !== this.key()) { this.shownKey = this.key(); this.renderList(); }
    this.renderChips();
    this.renderFoot();
  }

  using() {
    const c = this.ctx;
    const codeSig = c.code ? `${c.code.file}|${c.code.selection || ''}` : '';
    return {
      where: !this.dismissed.page,
      selection: c.selection && this.dismissed.selection !== c.selection ? c.selection : null,
      code: c.code && this.dismissed.code !== codeSig ? c.code : null,
    };
  }

  renderChips() {
    const c = this.ctx;
    const use = this.using();
    const chips = [];
    const chip = (ic, label, title, onRemove, cls = '') => h(`span.chat-chip${cls}`, { title },
      icon(ic, { width: 13, height: 13 }), h('span.ellipsis', label),
      onRemove ? h('button.chat-chip-x', { 'aria-label': t('chat.removeChip'), 'data-tip': t('chat.removeChip'), onClick: onRemove }, icon('x', { width: 12, height: 12 })) : null);
    if (c.courseId) {
      const label = c.pageTitle || c.courseTitle;
      chips.push(use.where
        ? chip('map-pin', label, t('chat.whereTip'), () => { this.dismissed.page = true; this.renderChips(); })
        : h('button.chat-chip.is-off', { onClick: () => { this.dismissed.page = false; this.renderChips(); } }, icon('map-pin', { width: 13, height: 13 }), h('span', t('chat.addWhere'))));
    }
    if (use.selection) chips.push(chip('text-quote', `“${use.selection.replace(/\s+/g, ' ').slice(0, 40)}”`, use.selection.slice(0, 400), () => { this.dismissed.selection = c.selection; this.renderChips(); }));
    if (use.code) {
      const cc = use.code;
      const lines = cc.lines ? ` · L${cc.lines[0]}${cc.lines[1] !== cc.lines[0] ? `-${cc.lines[1]}` : ''}` : '';
      chips.push(chip('code-xml', `${cc.file}${lines}`, t('chat.codeTip'), () => { this.dismissed.code = `${cc.file}|${cc.selection || ''}`; this.renderChips(); }));
    }
    this.chips.replaceChildren(...chips);
    this.chips.hidden = !chips.length;
  }

  /* ─── messages ─── */

  suggestions() {
    const c = this.ctx;
    if (c.code) return ['chat.s.codeHint', 'chat.s.codeExplain', 'chat.s.codeIdea'];
    if (c.page) return this.canEdit() ? ['chat.s.simpler', 'chat.s.keyPoints', 'chat.s.quiz', 'chat.s.rewrite'] : ['chat.s.simpler', 'chat.s.keyPoints', 'chat.s.quiz'];
    if (c.courseId) return ['chat.s.plan', 'chat.s.summary'];
    return ['chat.s.newTopic', 'chat.s.howto'];
  }

  renderList() {
    const th = this.thread();
    if (!th.items.length) {
      this.list.replaceChildren(h('div.chat-empty',
        h('div.ce-mark', icon('sparkles')),
        h('b', t('chat.emptyTitle')),
        h('p', this.ctx.courseId ? t('chat.emptyBody') : t('chat.emptyHome')),
        h('div.ce-suggest', this.suggestions().map(k => h('button.chat-suggest', { onClick: () => this.send(t(k)) }, t(k))))));
      return;
    }
    this.list.replaceChildren(...th.items.map(it => this.renderItem(it)));
    this.scroll(true);
  }

  scroll(force = false) {
    const nearBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 120;
    if (force || nearBottom) this.list.scrollTop = this.list.scrollHeight;
  }

  renderItem(it) {
    if (it.role === 'user') {
      return h('div.cm.cm-user',
        it.tags?.length ? h('div.cm-tags', it.tags.map(tag => h('span', icon(tag.icon, { width: 12, height: 12 }), tag.label))) : null,
        h('div.cm-bubble', it.text));
    }
    const dom = { steps: h('div.cm-steps'), text: h('div.cm-text.vt-article'), foot: h('div.cm-foot') };
    it.dom = dom;
    const el = h('div.cm.cm-ai', h('div.cm-who', icon('sparkles', { width: 14, height: 14 }), h('span', 'answer')), dom.steps, dom.text, dom.foot);
    for (const s of it.steps) dom.steps.append(this.stepEl(s));
    this.paintText(it);
    this.paintFoot(it);
    return el;
  }

  stepEl(s) {
    const st = s.kind === 'note' ? null : toolStep(s.name, s.input);
    s.el = s.kind === 'note'
      ? h('div.cm-step.is-note', icon('message-square', { width: 13, height: 13 }), h('span.ellipsis', s.text))
      : h(`div.cm-step${s.status === 'err' ? '.is-err' : ''}`,
        s.status === 'run' ? spinner() : icon(s.status === 'err' ? 'circle-x' : st.icon, { width: 13, height: 13 }),
        h('span.cs-label', st.label), st.detail ? h('span.cs-detail.ellipsis', st.detail) : null);
    return s.el;
  }

  updateStep(it, s) {
    const old = s.el;
    const el = this.stepEl(s);
    if (old?.isConnected) old.replaceWith(el);
    else it.dom?.steps.append(el);
  }

  paintText(it) {
    if (!it.dom) return;
    if (!it.text && !it.done) { it.dom.text.replaceChildren(h('div.ai-streaming', spinner(), h('span', it.steps.length ? t('chat.working') : t('ai.thinking')))); return; }
    it.dom.text.innerHTML = renderHtml(it.text || '');
  }

  paintFoot(it) {
    const f = it.dom?.foot;
    if (!f) return;
    const parts = [];
    if (it.error) {
      parts.push(h('div.cm-error', icon('circle-alert', { width: 14, height: 14 }), h('span', it.error)));
      const acts = [];
      if (it.errorCode === 'NO_LOGIN') acts.push(h('button.btn.btn-sm.btn-primary', { onClick: () => loginClaude().then(() => this.refreshStatus(true)) }, icon('log-in'), h('span', t('chat.login'))));
      if (it.errorCode === 'NO_AI' || it.errorCode === 'NO_CLAUDE') acts.push(h('button.btn.btn-sm.btn-tonal', { onClick: () => go('/settings') }, icon('settings'), h('span', t('settings'))));
      if (it.retry) acts.push(h('button.btn.btn-sm', { onClick: () => this.send(it.retry, { retry: true }) }, icon('rotate-ccw'), h('span', t('chat.retry'))));
      if (acts.length) parts.push(h('div.row', acts));
    }
    if (it.aborted) parts.push(h('span.faint', t('chat.stopped')));
    const ch = it.changes;
    const n = ch ? ch.changed.length + ch.added.length + ch.removed.length : 0;
    if (n) {
      const files = [...ch.changed.map(f => ['file-pen', f]), ...ch.added.map(f => ['file-plus', f]), ...ch.removed.map(f => ['file-x', f])];
      parts.push(h('details.cm-changes',
        h('summary', icon('git-compare', { width: 14, height: 14 }), h('span', it.undone ? t('chat.undone') : t('chat.changed', { n })),
          !it.undone ? h('button.btn.btn-sm.btn-tonal.cm-undo', { onClick: e => { e.preventDefault(); this.undo(it); } }, icon('undo-2'), h('span', t('chat.undo'))) : null),
        h('div.cm-files', files.map(([ic, f]) => h('div', icon(ic, { width: 12, height: 12 }), h('span.ellipsis', f))))));
    }
    if (it.done && !it.error && (it.ms || it.cost)) {
      parts.push(h('span.cm-meta', [it.ms ? `${Math.round(it.ms / 100) / 10}s` : '', it.cost ? `$${it.cost.toFixed(3)}` : ''].filter(Boolean).join(' · ')));
    }
    f.replaceChildren(...parts);
  }

  /* ─── sending ─── */

  async send(text, { retry = false, extra = null } = {}) {
    text = String(text ?? this.input.value).trim();
    if (!text || this.job) return;
    if (!retry) { this.input.value = ''; this.autosize(); }
    const ctx = currentContext();
    this.ctx = ctx;
    const th = this.thread(ctx);
    const use = this.using();
    use.extra = extra;
    const tags = [];
    if (ctx.courseId && use.where) tags.push({ icon: 'map-pin', label: ctx.pageTitle || ctx.courseTitle });
    if (use.selection) tags.push({ icon: 'text-quote', label: t('chat.tagSel') });
    if (use.code) tags.push({ icon: 'code-xml', label: use.code.file });
    th.items.push({ role: 'user', text, tags });
    const it = { role: 'assistant', steps: [], text: '', done: false };
    th.items.push(it);
    this.renderList();
    this.dismissed.selection = ctx.selection || null;
    this.renderChips();

    let s = this.status;
    if (!s) { await this.refreshStatus(); s = this.status; }
    const provider = this.provider;
    if (!provider) { this.fail(it, t('chat.noAiBody'), 'NO_AI', text); return; }
    const edit = provider === 'claude' && !!ctx.courseId && this.allowEdits;

    const whereNow = ctx.courseId && use.where ? where(ctx) : (ctx.courseId ? '' : where(ctx));
    const att = attachments(use);
    const en = getLang() === 'en';
    const block = (title, body) => (body ? `${title}\n${body}\n\n` : '');
    const firstPrompt = `${rules({ edit, provider })}\n\n${block(en ? '[Where the learner is]' : '【学习者现在的位置】', whereNow)}${att ? `${att}\n\n` : ''}${en ? '[Learner]' : '【学习者】'}\n${text}`;
    const followUp = `${whereNow && whereNow !== th.lastWhere ? block(en ? '[The learner moved to]' : '【学习者现在的位置】', whereNow) : ''}${att ? `${att}\n\n` : ''}${edit ? '' : `${en ? '(read-only turn)' : '（这一轮只读，不要修改文件）'}\n`}${text}`;
    th.lastWhere = whereNow || th.lastWhere;

    let messages = null;
    if (provider === 'http') {
      const hist = th.items.slice(0, -2).filter(x => (x.role === 'user' || x.done) && (x.text || '').trim()).slice(-12)
        .map(x => ({ role: x.role === 'user' ? 'user' : 'assistant', content: x.text }));
      messages = [{ role: 'system', content: rules({ edit: false, provider }) }, ...hist,
        { role: 'user', content: `${block(en ? '[Where the learner is]' : '【学习者现在的位置】', whereNow)}${att ? `${att}\n\n` : ''}${text}` }];
    }

    let snap = null;
    if (edit) { try { snap = await window.vla.ai.snapshot(ctx.courseId); } catch { snap = null; } }
    await flushLive();
    const t0 = Date.now();
    const setBusy = on => {
      this.sendBtn.replaceChildren(icon(on ? 'square' : 'arrow-up'));
      this.sendBtn.dataset.tip = on ? t('chat.stop') : t('chat.send');
      this.sendBtn.classList.toggle('is-busy', on);
    };
    setBusy(true);
    let raf = 0;
    const paint = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; this.paintText(it); this.scroll(); }); };
    const byId = new Map();
    try {
      this.job = turn(provider, {
        prompt: provider === 'claude' && th.sessionId ? followUp : firstPrompt,
        firstPrompt,
        messages,
        courseId: ctx.courseId || null,
        mode: edit ? 'edit' : 'ask',
        sessionId: provider === 'claude' ? th.sessionId : null,
      }, {
        onText: full => { it.text = full; paint(); },
        onEvent: e => {
          if (e.kind === 'init' && e.sessionId) th.sessionId = e.sessionId;
          if (e.kind === 'text-start' && it.text.trim()) {
            const note = { kind: 'note', text: it.text.trim().split('\n')[0].slice(0, 120) };
            it.steps.push(note);
            this.updateStep(it, note);
          }
          if (e.kind === 'tool-start' || e.kind === 'tool') {
            let st = byId.get(e.id);
            if (!st) { st = { id: e.id, name: e.name, input: e.input || {}, status: 'run' }; byId.set(e.id, st); it.steps.push(st); }
            else if (e.input) st.input = e.input;
            this.updateStep(it, st);
            this.scroll();
          }
          if (e.kind === 'tool-result') {
            const st = byId.get(e.id);
            if (st) { st.status = e.isError ? 'err' : 'ok'; this.updateStep(it, st); }
          }
        },
      });
      const r = await this.job.promise;
      if (r?.sessionId) th.sessionId = r.sessionId;
      it.text = (r?.text || it.text || '').trim();
      it.aborted = !!r?.aborted;
      it.cost = r?.cost || 0;
      it.ms = r?.ms || (Date.now() - t0);
    } catch (e) {
      it.error = e.code === 'NO_LOGIN' ? t('chat.loginNeeded') : e.message;
      it.errorCode = e.code;
      it.retry = text;
    } finally {
      this.job = null;
      setBusy(false);
      it.done = true;
      for (const st of it.steps) if (st.status === 'run') { st.status = 'ok'; this.updateStep(it, st); }
      if (snap) {
        try {
          const d = await window.vla.ai.snapshotDiff(snap);
          if (d && d.changed.length + d.added.length + d.removed.length) { it.changes = d; it.snap = snap; bus.emit('ai:changed', { courseId: ctx.courseId, ...d }); }
        } catch { /* nothing to show */ }
      }
      this.paintText(it);
      this.paintFoot(it);
      this.scroll();
    }
  }

  fail(it, message, code, retry) {
    it.done = true;
    it.error = message;
    it.errorCode = code;
    it.retry = retry;
    this.paintText(it);
    this.paintFoot(it);
  }

  stop() {
    this.job?.abort();
  }

  async undo(it) {
    if (!it.snap || it.undone) return;
    try {
      await window.vla.ai.snapshotRestore(it.snap);
      it.undone = true;
      this.paintFoot(it);
      toast(t('chat.undone'), { type: 'ok' });
    } catch (e) {
      toast(`${t('chat.undoFailed')}: ${e.message}`, { type: 'err' });
    }
  }

  reset() {
    if (this.job) this.stop();
    this.threads.delete(this.key());
    this.renderList();
    this.input.focus();
  }

  focus() {
    setTimeout(() => this.input.focus(), 30);
  }

  destroy() {
    this.offCtx();
    this.offSettings();
  }
}

/* ─── signing in to Claude Code (its own `auth login`, in a terminal) ─── */

export async function loginClaude() {
  const host = h('div.term-host', { style: { height: '340px', padding: '6px 0 4px 10px', background: 'var(--bg-deep)', borderRadius: 'var(--r-md)' } });
  let session = null;
  await dialog({
    title: t('chat.loginTitle'),
    sub: t('chat.loginSub'),
    iconName: 'log-in',
    wide: true,
    body: host,
    actions: [{ label: t('done'), primary: true, value: true }],
    onOpen: () => {
      session = new TermSession(host, { onExit: () => session?.term.writeln(`\r\n\x1b[2m${t('chat.loginExited')}\x1b[0m`) });
      setTimeout(() => { session.start({ claudeLogin: true }); session.focus(); }, 60);
    },
  });
  session?.dispose();
  const s = await aiStatus({ fresh: true });
  if (s.claude?.loggedIn) toast(t('chat.loginOk'), { type: 'ok' });
  return s;
}

/* ─── public API ─── */

let panel = null;

/* Room the panel takes on the right; maximized widgets stop short of it. */
function syncSpace() {
  const host = hostEl();
  const w = host && !host.hidden && panel ? panel.el.offsetWidth : 0;
  document.documentElement.style.setProperty('--chat-space', `${w}px`);
}

function hostEl() {
  return document.getElementById('chat');
}

export function isChatOpen() {
  return !!panel && !hostEl()?.hidden;
}

export function toggleChat(force) {
  const host = hostEl();
  if (!host) return false;
  const open = force ?? host.hidden;
  if (open && !panel) panel = new ChatPanel(host);
  host.hidden = !open;
  storageSet('vla.chatOpen', open);
  syncSpace();
  if (open) panel.focus();
  bus.emit('chat:toggle', open);
  return open;
}

/* opts: { prefill, send, edit, extra, focus } */
export function openChat(opts = {}) {
  toggleChat(true);
  if (opts.edit != null && panel.canEdit()) { panel.allowEdits = !!opts.edit; panel.renderFoot(); }
  if (opts.send) { panel.send(opts.send, { extra: opts.extra || null }); return; }
  if (opts.prefill != null) { panel.input.value = opts.prefill; panel.autosize(); }
  panel.focus();
}

export function restoreChat() {
  if (storageGet('vla.chatOpen', false)) toggleChat(true);
}
