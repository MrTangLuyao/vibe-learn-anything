/* App settings (settings.json in the profile folder). The API key is
   stored encrypted with safeStorage and never sent back to the page. */
import { safeStorage } from 'electron';
import { P } from './paths.js';
import { readJson, writeJson } from '../shared/vla-core.mjs';

const DEFAULTS = {
  theme: 'dark',
  lang: 'zh',
  fontSize: 15,
  editorFontSize: 14,
  shell: '',
  python: '',
  workDir: '',
  ai: {
    http: { baseUrl: '', model: '', key: '', temperature: 0.3, maxTokens: 2048 },
    agent: { command: '', interactive: '', stdin: true },
    /* The learner's Claude Code CLI: found automatically unless path is set. */
    claude: { path: '', model: '', userMcp: false, allowEdits: true },
    prefer: 'auto',
  },
  /* source: the pencil opens the Markdown source editor instead of in-place text editing. */
  editor: { source: false },
  trust: {},
};

let cache = null;

function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null ? merge(base[k], v) : v;
  }
  return out;
}

export function load() {
  if (!cache) cache = merge(DEFAULTS, readJson(P.settings, {}));
  return cache;
}

function save() {
  writeJson(P.settings, cache);
}

export function get(path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), load());
}

export function apiKey() {
  const enc = load().ai.http.key;
  if (!enc) return '';
  try {
    if (enc.startsWith('enc:') && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(enc.slice(4), 'base64'));
    }
    if (enc.startsWith('raw:')) return Buffer.from(enc.slice(4), 'base64').toString('utf8');
  } catch { /* unreadable key: treat as missing */ }
  return '';
}

/* What the page may see: everything except secrets. */
export function publicSettings() {
  const s = structuredClone(load());
  s.ai.http.hasKey = !!s.ai.http.key;
  delete s.ai.http.key;
  return s;
}

export function update(patch) {
  load();
  const p = structuredClone(patch || {});
  if (p.ai?.http && 'key' in p.ai.http) {
    const k = String(p.ai.http.key || '');
    p.ai.http.key = !k ? '' : safeStorage.isEncryptionAvailable()
      ? 'enc:' + safeStorage.encryptString(k).toString('base64')
      : 'raw:' + Buffer.from(k).toString('base64');
  }
  delete p.trust;
  cache = merge(cache, p);
  save();
  return publicSettings();
}

export function isTrusted(courseId) {
  return !!load().trust[courseId];
}

export function setTrusted(courseId, value) {
  load();
  if (value) cache.trust[courseId] = true;
  else delete cache.trust[courseId];
  save();
}
