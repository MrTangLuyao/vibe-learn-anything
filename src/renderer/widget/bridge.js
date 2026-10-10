/* ============================================================
 * Vibe Learn widget bridge — include in a course HTML widget:
 *   <script src="vla://_/bridge.js"></script>
 *
 *   await vla.ready()            → { theme, tokens, lang, state, page, course }
 *   await vla.getState()         / vla.setState(obj)   persisted per learner
 *   vla.complete()               mark the page complete
 *   await vla.run('actionId')    run a course/page action → { ok, stdout, … }
 *   vla.ask('question')          open "Ask AI" with a question
 *   vla.resize(px)               set the widget height (auto by default)
 *   vla.toast('text', 'ok')      show a toast in the app
 *   addEventListener('vla:theme', e => …)   theme changed
 * The app's colours are applied as CSS variables: var(--bg), var(--text),
 * var(--accent), var(--surface), var(--border), var(--muted), var(--font)…
 * ============================================================ */
(function () {
  'use strict';
  var pending = {};
  var seq = 0;
  function call(method) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending[id] = { resolve: resolve, reject: reject };
      parent.postMessage({ vla: 'call', id: id, method: method, args: args }, '*');
    });
  }
  var hashTheme = /vla-theme=(dark|light)/.exec(location.hash);
  if (hashTheme) document.documentElement.style.colorScheme = hashTheme[1];
  function applyTheme(info) {
    if (!info) return;
    var root = document.documentElement;
    root.setAttribute('data-theme', info.theme);
    root.style.colorScheme = info.theme;
    var tokens = info.tokens || {};
    Object.keys(tokens).forEach(function (k) { if (tokens[k]) root.style.setProperty(k, tokens[k]); });
  }
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || e.source !== parent) return;
    if (d.vla === 'event') {
      if (d.type === 'theme') applyTheme(d.payload);
      window.dispatchEvent(new CustomEvent('vla:' + d.type, { detail: d.payload }));
      return;
    }
    if (d.vla !== 'reply' || !pending[d.id]) return;
    var p = pending[d.id];
    delete pending[d.id];
    if (d.error) p.reject(new Error(d.error)); else p.resolve(d.result);
  });
  var readyPromise = null;
  window.vla = {
    ready: function () {
      if (!readyPromise) readyPromise = call('ready').then(function (info) { applyTheme(info); return info; });
      return readyPromise;
    },
    getState: function () { return call('getState'); },
    setState: function (s) { return call('setState', s); },
    complete: function () { return call('complete'); },
    run: function (id) { return call('run', id); },
    ask: function (q) { return call('ask', q); },
    resize: function (px) { return call('resize', px); },
    openUrl: function (u) { return call('openUrl', u); },
    toast: function (text, type) { return call('toast', text, type); },
  };
  window.vla.ready();
  var last = 0;
  function autoSize() {
    var b = document.body;
    if (!b) return;
    var cs = getComputedStyle(b);
    var hgt = Math.ceil(b.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom));
    if (Math.abs(hgt - last) > 2) { last = hgt; window.vla.resize(hgt); }
  }
  if (window.ResizeObserver) document.addEventListener('DOMContentLoaded', function () { new ResizeObserver(autoSize).observe(document.body); });
  window.addEventListener('load', autoSize);
})();
