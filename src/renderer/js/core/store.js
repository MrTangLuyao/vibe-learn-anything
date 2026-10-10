/* ============================================================
 * core/store.js — app-wide state + a small event bus.
 * ============================================================ */

const listeners = new Map();

export const bus = {
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type)?.delete(fn);
  },
  emit(type, payload) {
    for (const fn of [...(listeners.get(type) || [])]) {
      try { fn(payload); } catch (e) { console.error(`[bus:${type}]`, e); }
    }
  },
};

export const state = {
  settings: null,
  info: null,
  courses: new Map(),
};

export async function loadSettings() {
  state.settings = await window.vla.settings.get();
  return state.settings;
}

export async function saveSettings(patch) {
  state.settings = await window.vla.settings.set(patch);
  bus.emit('settings', state.settings);
  return state.settings;
}

export async function loadInfo() {
  state.info = await window.vla.app.info();
  return state.info;
}

/* Course data (course.json + metas + progress + annotations + state). */
export async function getCourse(id, { force = false } = {}) {
  if (!force && state.courses.has(id)) return state.courses.get(id);
  const data = await window.vla.course.get(id);
  state.courses.set(id, data);
  return data;
}

export function dropCourse(id) {
  state.courses.delete(id);
}
