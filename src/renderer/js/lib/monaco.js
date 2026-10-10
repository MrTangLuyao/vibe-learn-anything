/* ============================================================
 * lib/monaco.js — the VS Code editor (Monaco, AMD build), lazy.
 * Themes follow the app palette and switch with it.
 * ============================================================ */

import { bus, state } from '../core/store.js';
import { resolvedTheme } from '../core/theme.js';

let ready = null;

function defineThemes(monaco) {
  monaco.editor.defineTheme('vla-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '7f7f7c', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'e08f6f' },
      { token: 'string', foreground: 'b6c98a' },
      { token: 'number', foreground: 'd8b56a' },
      { token: 'type', foreground: 'c9a0e8' },
      { token: 'delimiter', foreground: 'a1a1a0' },
    ],
    colors: {
      'editor.background': '#1f1f1e',
      'editor.foreground': '#e8e8e8',
      'editorLineNumber.foreground': '#5a5a59',
      'editorLineNumber.activeForeground': '#d97757',
      'editor.lineHighlightBackground': '#2a2a29',
      'editor.selectionBackground': '#d9775744',
      'editorCursor.foreground': '#ffb49d',
      'editorIndentGuide.background1': '#2f2f2e',
      'editorWidget.background': '#2a2a29',
      'editorWidget.border': '#3a3a39',
      'scrollbarSlider.background': '#d977573a',
      'scrollbarSlider.hoverBackground': '#d9775766',
      'minimap.background': '#1f1f1e',
    },
  });
  monaco.editor.defineTheme('vla-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8a8172', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'a2401d' },
      { token: 'string', foreground: '4f7a1f' },
      { token: 'number', foreground: '996a00' },
      { token: 'type', foreground: '7b3fa8' },
    ],
    colors: {
      'editor.background': '#fbf8f2',
      'editor.foreground': '#2a2722',
      'editorLineNumber.foreground': '#b3a891',
      'editorLineNumber.activeForeground': '#895718',
      'editor.lineHighlightBackground': '#f3ecdf',
      'editor.selectionBackground': '#ca973d40',
      'editorCursor.foreground': '#895718',
      'scrollbarSlider.background': '#89571830',
    },
  });
}

export function monacoTheme() {
  return resolvedTheme() === 'light' ? 'vla-light' : 'vla-dark';
}

export function loadMonaco() {
  if (window.monaco?.editor) return Promise.resolve(window.monaco);
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'vendor/monaco/vs/editor/editor.main.css';
    document.head.append(css);
    const s = document.createElement('script');
    s.src = 'vendor/monaco/vs/loader.js';
    s.onload = () => {
      const base = new URL('vendor/monaco/vs', location.href).href;
      window.require.config({ paths: { vs: base } });
      window.require(['vs/editor/editor.main'], () => {
        const monaco = window.monaco;
        defineThemes(monaco);
        monaco.editor.setTheme(monacoTheme());
        bus.on('theme', () => monaco.editor.setTheme(monacoTheme()));
        resolve(monaco);
      }, err => reject(err));
    };
    s.onerror = () => reject(new Error('cannot load the code editor'));
    document.head.append(s);
  });
  return ready;
}

export async function createEditor(host, opts = {}) {
  const monaco = await loadMonaco();
  return monaco.editor.create(host, {
    automaticLayout: true,
    theme: monacoTheme(),
    fontFamily: "'JetBrains Mono', Consolas, 'Microsoft YaHei', monospace",
    fontSize: state.settings?.editorFontSize || 14,
    lineHeight: 22,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'all',
    roundedSelection: true,
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    padding: { top: 12, bottom: 12 },
    tabSize: 4,
    fixedOverflowWidgets: true,
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    ...opts,
  });
}
