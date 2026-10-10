/* ============================================================
 * lib/term.js — xterm.js terminals wired to main-process PTYs.
 *   const s = new TermSession(host, { spec })   // spec → pty:start
 *   s.start() / s.restart(spec) / s.write() / s.dispose()
 * ============================================================ */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { bus } from '../core/store.js';
import { resolvedTheme } from '../core/theme.js';
import { t } from '../core/i18n.js';

const THEMES = {
  dark: {
    background: '#191918', foreground: '#e8e8e8', cursor: '#ffb49d', cursorAccent: '#191918',
    selectionBackground: '#d9775766', black: '#2a2a29', red: '#e07c76', green: '#6dc198', yellow: '#e0b35a',
    blue: '#7fb0e6', magenta: '#c9a0e8', cyan: '#7ec8c8', white: '#e8e8e8', brightBlack: '#767675',
    brightRed: '#ff9b94', brightGreen: '#8fdcb4', brightYellow: '#f2cd7c', brightBlue: '#a3c8f2',
    brightMagenta: '#dcbaf2', brightCyan: '#a0e0e0', brightWhite: '#ffffff',
  },
  light: {
    background: '#e7e0d4', foreground: '#2a2722', cursor: '#895718', cursorAccent: '#e7e0d4',
    selectionBackground: '#ca973d55', black: '#2a2722', red: '#b3443f', green: '#2f7d55', yellow: '#9a6a12',
    blue: '#2f6aa3', magenta: '#7b3fa8', cyan: '#2a7a7a', white: '#564f44', brightBlack: '#8a8172',
    brightRed: '#c9584f', brightGreen: '#3c9a62', brightYellow: '#b07f1c', brightBlue: '#3f7fc0',
    brightMagenta: '#9455c4', brightCyan: '#3a9494', brightWhite: '#2a2722',
  },
};

/* One listener pair for every session. */
const sessions = new Map();
let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  window.vla.pty.onData(({ id, data }) => sessions.get(id)?.onPtyData(data));
  window.vla.pty.onExit(({ id, code }) => sessions.get(id)?.onPtyExit(code));
}

export class TermSession {
  constructor(host, { spec = {}, onExit, onStart, fontSize = 13 } = {}) {
    wire();
    this.host = host;
    this.spec = spec;
    this.onExit = onExit;
    this.onStart = onStart;
    this.id = null;
    this.alive = false;
    this.gen = 0;
    this.term = new Terminal({
      fontFamily: "'JetBrains Mono', Consolas, 'Microsoft YaHei', monospace",
      fontSize,
      lineHeight: 1.25,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme: THEMES[resolvedTheme()],
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.open(host);
    this.term.onData(d => {
      if (this.alive && this.id != null) window.vla.pty.write(this.id, d);
      else if (!this.alive && (d === '\r' || d === ' ') && this.restartOnKey) this.restartOnKey();
    });
    this.term.onResize(({ cols, rows }) => { if (this.id != null && this.alive) window.vla.pty.resize(this.id, cols, rows); });
    this.ro = new ResizeObserver(() => this.refit());
    this.ro.observe(host);
    this.offTheme = bus.on('theme', th => { this.term.options.theme = THEMES[th]; });
    setTimeout(() => this.refit(), 0);
  }

  refit() {
    if (!this.host.isConnected || !this.host.offsetWidth || !this.host.offsetHeight) return;
    try { this.fit.fit(); } catch { /* not visible */ }
  }

  async start(spec = this.spec) {
    this.spec = spec;
    this.kill();
    const gen = ++this.gen;
    this.refit();
    const r = await window.vla.pty.start({ ...spec, cols: this.term.cols, rows: this.term.rows });
    /* A newer start() (or dispose) happened while this one was pending. */
    if (gen !== this.gen) { if (r?.id != null) window.vla.pty.kill(r.id); return null; }
    if (r?.denied) { this.term.writeln(`\x1b[33m${t('term.denied')}\x1b[0m`); return null; }
    if (r?.error) { this.term.writeln(`\x1b[31m${r.error}\x1b[0m`); return null; }
    this.id = r.id;
    this.alive = true;
    sessions.set(this.id, this);
    this.onStart?.(r);
    return r;
  }

  onPtyData(data) {
    this.term.write(data);
  }

  onPtyExit(code) {
    this.alive = false;
    sessions.delete(this.id);
    this.id = null;
    this.onExit?.(code);
  }

  write(text) {
    if (this.alive && this.id != null) window.vla.pty.write(this.id, text);
  }

  kill() {
    if (this.id != null) {
      window.vla.pty.kill(this.id);
      sessions.delete(this.id);
    }
    this.id = null;
    this.alive = false;
  }

  focus() {
    this.term.focus();
  }

  clear() {
    this.term.clear();
  }

  dispose() {
    this.gen++;
    this.kill();
    this.ro.disconnect();
    this.offTheme();
    this.term.dispose();
  }
}
