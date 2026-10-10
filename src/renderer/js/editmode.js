/* ============================================================
 * editmode.js — edit the text of any .vitent page in place:
 * Monaco (markdown) on the left, live preview on the right,
 * Vitent validation as editor markers.
 * ============================================================ */

import { h, icon, debounce } from './core/dom.js';
import { t } from './core/i18n.js';
import { toast, dialog } from './core/ui.js';
import { createEditor, loadMonaco } from './lib/monaco.js';
import { validateVitentText } from '../../shared/directives.mjs';

export class EditMode {
  /* opts: { courseId, src, text, renderPreview(text, scrollRoot) → Promise<{ el, dispose }>, onSaved(text), onExit() } */
  constructor(opts) {
    Object.assign(this, opts);
    this.saved = opts.text;
    this.preview = null;
    this.issuesEl = h('div.es-issues', { hidden: true });
    this.state = h('span', t('edit.saved'));
    this.host = h('div.es-host');
    this.previewInner = h('div.reader-inner');
    this.previewEl = h('div.es-preview', this.previewInner);
    this.el = h('div.editor-split',
      h('div.es-code',
        h('div.es-bar',
          icon('file-pen-line', { width: 15, height: 15 }),
          h('span.ellipsis', `${this.src}/index.md`),
          h('span.grow'),
          this.state,
          h('button.btn.btn-sm', { onClick: () => this.save() }, icon('save'), h('span', t('save'))),
          h('button.btn.btn-sm.btn-primary', { onClick: () => this.exit() }, icon('check'), h('span', t('edit.done')))),
        this.host,
        this.issuesEl),
      this.previewEl);
    this.refresh = debounce(() => this.renderPreview$(), 450);
  }

  get dirty() {
    return this.editor ? this.editor.getValue() !== this.saved : false;
  }

  async mount() {
    const monaco = await loadMonaco();
    this.monaco = monaco;
    this.editor = await createEditor(this.host, { value: this.text, language: 'markdown', wordWrap: 'on', lineNumbers: 'on', minimap: { enabled: false }, tabSize: 2 });
    this.editor.onDidChangeModelContent(() => { this.state.textContent = this.dirty ? t('edit.unsaved') : t('edit.saved'); this.refresh(); });
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => this.save());
    this.editor.focus();
    await this.renderPreview$();
  }

  async renderPreview$() {
    const text = this.editor ? this.editor.getValue() : this.text;
    const issues = validateVitentText(text);
    this.issuesEl.hidden = !issues.length;
    this.issuesEl.replaceChildren(...issues.map(i => h(`div.is-${i.level}`, {
      style: { cursor: 'pointer' },
      onClick: () => { this.editor.revealLineInCenter(i.line); this.editor.setPosition({ lineNumber: i.line, column: 1 }); this.editor.focus(); },
    }, h('b', `${i.line}`), h('span', i.msg))));
    if (this.monaco && this.editor) {
      this.monaco.editor.setModelMarkers(this.editor.getModel(), 'vitent', issues.map(i => ({
        startLineNumber: i.line, endLineNumber: i.line, startColumn: 1, endColumn: 200,
        message: i.msg, severity: i.level === 'error' ? this.monaco.MarkerSeverity.Error : this.monaco.MarkerSeverity.Warning,
      })));
    }
    const top = this.previewEl.scrollTop;
    try {
      const r = await this.renderPreview(text, this.previewEl);
      this.preview?.dispose();
      this.preview = r;
      this.previewInner.replaceChildren(r.el);
      this.previewEl.scrollTop = top;
    } catch (e) {
      this.previewInner.replaceChildren(h('div.vx-error', e.message));
    }
  }

  async save() {
    if (!this.editor) return;
    const text = this.editor.getValue();
    await window.vla.course.savePage(this.courseId, this.src, text);
    this.saved = text;
    this.state.textContent = t('edit.saved');
    toast(t('edit.savedToast'), { type: 'ok', timeout: 1500 });
    this.onSaved?.(text);
  }

  async confirmLeave() {
    if (!this.dirty) return true;
    const r = await dialog({
      title: t('edit.leaveQ'),
      iconName: 'save',
      body: h('p', t('edit.leaveBody')),
      actions: [{ label: t('cancel'), value: 'cancel' }, { label: t('edit.discard'), value: 'discard', danger: true }, { label: t('save'), value: 'save', primary: true }],
    });
    if (r === 'save') { await this.save(); return true; }
    return r === 'discard';
  }

  async exit() {
    if (!(await this.confirmLeave())) return;
    this.onExit?.(this.saved);
  }

  destroy() {
    this.refresh.cancel();
    this.preview?.dispose();
    this.editor?.dispose();
    this.el.remove();
  }
}
