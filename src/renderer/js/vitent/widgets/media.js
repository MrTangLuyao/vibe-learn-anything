/* Media widgets: pdf, video, audio, image, embed, html, doc, file. */
import { h, icon } from '../../core/dom.js';
import { t } from '../../core/i18n.js';
import { toast } from '../../core/ui.js';
import { resolvedTheme } from '../../core/theme.js';
import { bus } from '../../core/store.js';
import { loadPdf, loadMammoth } from '../../lib/lazy.js';
import { sanitize } from '../markdown.js';
import { baseName } from '../../paths.js';

function scopeReady(rctx, scope, el) {
  rctx.article?.dispatchEvent(new CustomEvent('vh:scope', { detail: { scope, el } }));
}

/* ─── PDF (pdf.js viewer with a text layer, so PDF text can be highlighted) ─── */
export const pdf = {
  label: node => baseName(node.attrs.src),
  render(node, rctx, id) {
    const a = node.attrs;
    const rel = rctx.rel(a.src);
    const pageInput = h('input', { value: String(a.page || 1), 'aria-label': 'page' });
    const total = h('span', '/ …');
    const zoomLabel = h('span.pdf-zoom', '—');
    const container = h('div', { style: { position: 'absolute', inset: '0', overflow: 'auto' } }, h('div.pdfViewer'));
    const loading = h('div.pdf-loading', h('span.spinner'), t('pdf.loading'));
    const scroll = h('div.pdf-scroll', { style: { '--pdf-h': a.height ? (/^\d+$/.test(String(a.height)) ? `${a.height}px` : a.height) : null } }, container, loading);
    let viewer = null;
    const zoom = f => { if (viewer) viewer.currentScale = Math.max(0.3, Math.min(4, viewer.currentScale * f)); };
    const bar = h('div.pdf-bar', { 'data-vh-skip': '' },
      icon('file-text', { width: 16, height: 16 }),
      h('span.pdf-name', a.title || node.label || baseName(a.src)),
      h('span.grow'),
      h('span.pdf-page', pageInput, total),
      h('button.icon-btn.icon-btn-xs', { onClick: () => zoom(1 / 1.15), 'data-tip': t('pdf.zoomOut') }, icon('minus')),
      zoomLabel,
      h('button.icon-btn.icon-btn-xs', { onClick: () => zoom(1.15), 'data-tip': t('pdf.zoomIn') }, icon('plus')),
      h('button.icon-btn.icon-btn-xs', { onClick: () => { if (viewer) viewer.currentScaleValue = 'page-width'; }, 'data-tip': t('pdf.fit') }, icon('move-horizontal')),
      h('button.icon-btn.icon-btn-xs', { onClick: () => window.vla.course.openFile(rctx.courseId, rel), 'data-tip': t('openExternal') }, icon('external-link')),
      h('button.icon-btn.icon-btn-xs', { onClick: () => window.vla.course.saveFileAs(rctx.courseId, rel), 'data-tip': t('download') }, icon('download')));
    const el = h('div.vx-pdf', bar, scroll);

    rctx.lazy(el, async () => {
      try {
        const { lib, viewer: V } = await loadPdf();
        const data = await window.vla.course.readBinary(rctx.courseId, rel);
        const doc = await lib.getDocument({
          data: new Uint8Array(data),
          cMapUrl: new URL('vendor/pdfjs/cmaps/', location.href).href,
          cMapPacked: true,
          standardFontDataUrl: new URL('vendor/pdfjs/standard_fonts/', location.href).href,
        }).promise;
        const eventBus = new V.EventBus();
        const linkService = new V.PDFLinkService({ eventBus });
        viewer = new V.PDFViewer({ container, eventBus, linkService, textLayerMode: 1, removePageBorders: true });
        linkService.setViewer(viewer);
        linkService.setDocument(doc);
        viewer.setDocument(doc);
        total.textContent = `/ ${doc.numPages}`;
        eventBus.on('pagesinit', () => {
          viewer.currentScaleValue = 'page-width';
          if (a.page) viewer.currentPageNumber = Math.min(doc.numPages, Number(a.page));
          loading.remove();
        });
        eventBus.on('pagechanging', e => {
          pageInput.value = String(e.pageNumber);
          rctx.report('widgets', id, { page: e.pageNumber, pages: doc.numPages });
        });
        eventBus.on('scalechanging', e => { zoomLabel.textContent = `${Math.round(e.scale * 100)}%`; });
        eventBus.on('textlayerrendered', e => {
          const layer = e.source?.div?.querySelector('.textLayer');
          if (!layer) return;
          layer.dataset.vhScope = `${id}:p${e.pageNumber}`;
          scopeReady(rctx, layer.dataset.vhScope, layer);
        });
        pageInput.addEventListener('change', () => {
          const n = Number(pageInput.value);
          if (n >= 1 && n <= doc.numPages) viewer.currentPageNumber = n;
        });
        el._vhDetail = () => ({ page: viewer.currentPageNumber, pages: doc.numPages, file: a.src });
        rctx.onDispose(() => { try { viewer.cleanup(); doc.destroy(); } catch { /* gone */ } });
      } catch (e) {
        loading.replaceChildren(h('div.vx-error', `PDF: ${e.message}`));
      }
    });
    return el;
  },
};

/* ─── video / audio ─── */
function embedUrl(src) {
  const s = String(src);
  let m = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/.exec(s);
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  m = /bilibili\.com\/video\/(BV[\w]+)/i.exec(s);
  if (m) return `https://player.bilibili.com/player.html?bvid=${m[1]}&autoplay=0`;
  m = /vimeo\.com\/(\d+)/.exec(s);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  return null;
}

export const video = {
  label: node => node.label || baseName(node.attrs.src),
  render(node, rctx, id) {
    const a = node.attrs;
    const el = h('figure.vx-media');
    const ext = embedUrl(a.src);
    if (ext) {
      el.append(h('iframe.embed-video', { src: ext, allow: 'fullscreen; picture-in-picture; encrypted-media', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' }));
    } else {
      const v = h('video', { controls: true, preload: 'metadata', src: rctx.url(a.src), poster: a.poster ? rctx.url(a.poster) : null });
      const saved = rctx.saved('widgets', id);
      v.addEventListener('loadedmetadata', () => { const at = Number(a.start || saved?.at || 0); if (at) v.currentTime = at; });
      let last = 0;
      v.addEventListener('timeupdate', () => {
        if (Math.abs(v.currentTime - last) < 5) return;
        last = v.currentTime;
        rctx.report('widgets', id, { at: Math.floor(v.currentTime), duration: Math.floor(v.duration || 0), done: v.duration && v.currentTime > v.duration * 0.9 });
      });
      el._vhDetail = () => ({ time: Math.floor(v.currentTime) });
      el.append(v);
    }
    if (node.label) el.append(h('figcaption', { html: rctx.inline(node.label) }));
    return el;
  },
};

export const audio = {
  label: node => node.label || baseName(node.attrs.src),
  render(node, rctx) {
    const el = h('figure.vx-media', h('audio', { controls: true, preload: 'metadata', src: rctx.url(node.attrs.src) }));
    if (node.label) el.append(h('figcaption', { html: rctx.inline(node.label) }));
    return el;
  },
};

export const image = {
  label: node => node.attrs.caption || node.label || baseName(node.attrs.src),
  render(node, rctx) {
    const a = node.attrs;
    const img = h('img', { src: rctx.url(a.src), alt: a.alt || node.label || '', loading: 'lazy', style: { width: a.width ? (/^\d+$/.test(String(a.width)) ? `${a.width}px` : a.width) : null } });
    img.addEventListener('click', () => {
      if (document.body.classList.contains('hl-mode')) return;
      const box = h('div.lightbox', { onClick: () => box.remove() }, h('img', { src: img.src }));
      document.body.append(box);
    });
    const cap = a.caption || node.label;
    return h('figure.vx-figure', img, cap ? h('figcaption', { html: rctx.inline(cap) }) : null);
  },
};

/* ─── external page ─── */
export const embed = {
  label: node => node.label || node.attrs.src,
  render(node, rctx) {
    const a = node.attrs;
    const ext = embedUrl(a.src);
    const src = ext || (/^https?:/i.test(a.src) ? a.src : rctx.url(a.src));
    return h('div.vx-embed', { style: { '--embed-h': a.height ? `${a.height}px` : null } },
      h('div.embed-bar', { 'data-vh-skip': '' }, icon('globe', { width: 15, height: 15 }), h('span.grow', node.label || a.src),
        /^https?:/i.test(a.src) ? h('button.icon-btn.icon-btn-xs', { onClick: () => window.vla.app.openExternal(a.src), 'data-tip': t('openExternal') }, icon('external-link')) : null),
      h('iframe', { src, sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-presentation', allow: 'fullscreen; clipboard-write', loading: 'lazy', referrerpolicy: 'no-referrer' }));
  },
};

/* ─── custom HTML widget with the vla bridge (widget/bridge.js) ─── */
function themeTokens() {
  const cs = getComputedStyle(document.documentElement);
  const keys = ['bg', 'surface', 'surface-high', 'border', 'text', 'muted', 'accent', 'accent-on', 'ok', 'err', 'warn', 'info', 'font', 'font-mono', 'code-bg'];
  return Object.fromEntries(keys.map(k => [`--${k}`, cs.getPropertyValue(`--${k}`).trim()]));
}

export const html = {
  label: node => node.label || baseName(node.attrs.src),
  render(node, rctx, id) {
    const a = node.attrs;
    const frame = h('iframe', {
      src: `${rctx.url(a.src)}#vla-theme=${resolvedTheme()}`,
      sandbox: 'allow-scripts allow-forms allow-modals allow-popups allow-downloads',
      allow: 'fullscreen; clipboard-write',
      title: node.label || a.src,
    });
    const el = h('div.vx-embed.is-widget', { style: { '--embed-h': a.height ? `${a.height}px` : '420px' } }, frame);
    const post = msg => frame.contentWindow?.postMessage(msg, '*');
    const onMessage = async e => {
      if (e.source !== frame.contentWindow || !e.data || e.data.vla !== 'call') return;
      const { id: callId, method, args = [] } = e.data;
      const reply = (result, error) => post({ vla: 'reply', id: callId, result, error });
      try {
        switch (method) {
          case 'ready': reply({ theme: resolvedTheme(), tokens: themeTokens(), lang: rctx.lang, state: rctx.saved('widgets', id)?.state ?? null, page: rctx.src, course: rctx.course.title }); break;
          case 'getState': reply(rctx.saved('widgets', id)?.state ?? null); break;
          case 'setState': rctx.report('widgets', id, { state: args[0] }); reply(true); break;
          case 'complete': rctx.page.lesson?.complete(); reply(true); break;
          case 'run': {
            const r = await rctx.page.lesson?.runAction(args[0], { anchor: el, quiet: true });
            reply(r ? { ok: r.ok, code: r.code, stdout: r.stdout, stderr: r.stderr, status: r.status, text: r.text } : null);
            break;
          }
          case 'ask': rctx.page.lesson?.ask(String(args[0] || ''), { anchor: el }); reply(true); break;
          case 'resize': { const hgt = Math.max(80, Math.min(4000, Number(args[0]) || 0)); el.style.setProperty('--embed-h', `${hgt}px`); reply(true); break; }
          case 'openUrl': window.vla.app.openExternal(String(args[0])); reply(true); break;
          case 'toast': toast(String(args[0] || ''), { type: args[1] || 'info' }); reply(true); break;
          default: reply(null, `unknown method ${method}`);
        }
      } catch (err) { reply(null, err.message); }
    };
    window.addEventListener('message', onMessage);
    const off = bus.on('theme', th => post({ vla: 'event', type: 'theme', payload: { theme: th, tokens: themeTokens() } }));
    rctx.onDispose(() => { window.removeEventListener('message', onMessage); off(); });
    return el;
  },
};

/* ─── Word documents (rendered as real, highlightable text) ─── */
export const doc = {
  label: node => node.label || baseName(node.attrs.src),
  render(node, rctx, id) {
    const rel = rctx.rel(node.attrs.src);
    const body = h('div.doc-body', { dataset: { vhScope: id } }, h('div.reader-loading', h('span.spinner')));
    const el = h('div.vx-box.vx-doc',
      h('div.vx-box-head', { 'data-vh-skip': '' }, icon('file-text'), h('span', node.label || baseName(node.attrs.src)), h('span.grow'),
        h('button.icon-btn.icon-btn-xs', { onClick: () => window.vla.course.openFile(rctx.courseId, rel), 'data-tip': t('openExternal') }, icon('external-link'))),
      body);
    rctx.lazy(el, async () => {
      try {
        const mammoth = await loadMammoth();
        const data = await window.vla.course.readBinary(rctx.courseId, rel);
        const r = await mammoth.convertToHtml({ arrayBuffer: data });
        body.innerHTML = sanitize(r.value);
        scopeReady(rctx, id, body);
      } catch (e) {
        body.replaceChildren(h('div.vx-error', `docx: ${e.message}`));
      }
    });
    return el;
  },
};

/* ─── attachments ─── */
const FILE_ICONS = { pdf: 'file-text', doc: 'file-text', docx: 'file-text', ppt: 'presentation', pptx: 'presentation', xls: 'sheet', xlsx: 'sheet', csv: 'sheet', zip: 'file-archive', png: 'image', jpg: 'image', jpeg: 'image', mp4: 'film', mp3: 'music' };

export const file = {
  label: node => node.label || baseName(node.attrs.src),
  render(node, rctx) {
    const rel = rctx.rel(node.attrs.src);
    const name = baseName(node.attrs.src);
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    return h('div.vx-file',
      h('div.f-icon', icon(FILE_ICONS[ext] || 'file')),
      h('div.f-main', h('div.f-name', node.label || name), h('div.f-sub', ext.toUpperCase() || t('file'))),
      h('div.row', { 'data-vh-skip': '' },
        h('button.btn.btn-sm.btn-tonal', { onClick: async () => { const r = await window.vla.course.openFile(rctx.courseId, rel); if (r) toast(r, { type: 'err' }); } }, icon('external-link'), h('span', t('open'))),
        h('button.icon-btn.icon-btn-sm', { onClick: () => window.vla.course.saveFileAs(rctx.courseId, rel), 'data-tip': t('saveAs') }, icon('download')),
        h('button.icon-btn.icon-btn-sm', { onClick: () => window.vla.course.revealFile(rctx.courseId, rel), 'data-tip': t('showFolder') }, icon('folder-open'))));
  },
};
