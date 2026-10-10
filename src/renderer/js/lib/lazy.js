/* Heavy libraries, loaded on first use. */
import { resolvedTheme } from '../core/theme.js';

let pdf = null;
export function loadPdf() {
  if (!pdf) {
    pdf = (async () => {
      const lib = await import('pdfjs-dist');
      lib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', location.href).href;
      globalThis.pdfjsLib = lib;
      const viewer = await import('pdfjs-dist/web/pdf_viewer.mjs');
      return { lib, viewer };
    })();
  }
  return pdf;
}

let mermaidP = null;
let mermaidTheme = null;
export async function loadMermaid() {
  if (!mermaidP) mermaidP = import('mermaid').then(m => m.default);
  const mermaid = await mermaidP;
  const theme = resolvedTheme();
  if (mermaidTheme !== theme) {
    mermaidTheme = theme;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme === 'dark' ? 'dark' : 'neutral',
      fontFamily: "'JetBrains Mono', 'Microsoft YaHei', sans-serif",
      themeVariables: theme === 'dark'
        ? { primaryColor: '#333332', primaryBorderColor: '#d97757', lineColor: '#a1a1a0', primaryTextColor: '#e8e8e8', background: '#2a2a29' }
        : { primaryColor: '#faf5eb', primaryBorderColor: '#895718', lineColor: '#564f44', primaryTextColor: '#2a2722' },
    });
  }
  return mermaid;
}

let mammothP = null;
export function loadMammoth() {
  if (!mammothP) mammothP = import('mammoth').then(m => m.default || m);
  return mammothP;
}

let sortableP = null;
export function loadSortable() {
  if (!sortableP) sortableP = import('sortablejs').then(m => m.default || m.Sortable || m);
  return sortableP;
}
