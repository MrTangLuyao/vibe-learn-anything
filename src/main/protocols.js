/* ============================================================
 * src/main/protocols.js
 *   app://ui/…          the app itself (dist/renderer)
 *   vla://<course>/…    files of an imported course (library/<id>/…)
 *   vla://_/…           helper files for course widgets (bridge.js)
 * Both serve byte ranges so <video>/<audio> can seek.
 * ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { P } from './paths.js';
import { safeJoin, sanitizeId } from '../shared/vla-core.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.map': 'application/json', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.bmp': 'image/bmp', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.ogv': 'video/ogg', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm', '.vtt': 'text/vtt',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
    { scheme: 'vla', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  ]);
}

function notFound() {
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

function serveFile(file, request, extraHeaders = {}) {
  let st;
  try { st = fs.statSync(file); } catch { return notFound(); }
  if (st.isDirectory()) {
    const index = path.join(file, 'index.html');
    if (fs.existsSync(index)) return serveFile(index, request, extraHeaders);
    return notFound();
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'access-control-allow-origin': '*',
    'cache-control': 'no-cache',
    ...extraHeaders,
  };
  const range = request.headers.get('range');
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m && st.size > 0) {
    let start = m[1] === '' ? Math.max(0, st.size - Number(m[2])) : Number(m[1]);
    let end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : st.size - 1;
    end = Math.min(end, st.size - 1);
    if (start > end || start >= st.size) {
      return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${st.size}` } });
    }
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end }));
    return new Response(stream, {
      status: 206,
      headers: { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), {
    status: 200, headers: { ...headers, 'content-length': String(st.size) },
  });
}

function relPath(url) {
  try { return decodeURIComponent(url.pathname).replace(/^\/+/, ''); } catch { return null; }
}

export function handleProtocols() {
  protocol.handle('app', request => {
    const url = new URL(request.url);
    const rel = relPath(url);
    if (rel == null) return notFound();
    try { return serveFile(safeJoin(P.renderer, rel || 'index.html'), request); } catch { return notFound(); }
  });

  protocol.handle('vla', request => {
    const url = new URL(request.url);
    const rel = relPath(url);
    if (rel == null) return notFound();
    const host = url.hostname;
    try {
      if (host === '_') return serveFile(safeJoin(path.join(P.renderer, 'widget'), rel), request);
      const id = sanitizeId(host);
      if (!id || id !== host) return notFound();
      const file = safeJoin(path.join(P.library, id), rel);
      /* Course HTML widgets run in an opaque-origin sandbox; keep them away
         from the network unless the course really links out. */
      const extra = /\.html?$/i.test(file)
        ? { 'content-security-policy': "default-src 'self' vla: data: blob: 'unsafe-inline' 'unsafe-eval'; img-src * data: blob:; media-src * data: blob:; connect-src vla: https: data: blob:; frame-ancestors app: vla:" }
        : {};
      return serveFile(file, request, extra);
    } catch {
      return notFound();
    }
  });
}
