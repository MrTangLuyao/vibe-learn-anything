/* ============================================================
 * highlight/store.js — a course's annotations.json in memory,
 * with change events and debounced saving.
 *
 * Highlight: { id, kind, page, targets[], status, created, updated, comments[] }
 * Comment:   { id, author: "learner" | "answer", text, created, updated? }
 * Comments added in the app are always "learner"; AI replies are "answer".
 * ============================================================ */

import { debounce, uid, nowIso } from '../core/dom.js';

const stores = new Map();

export const KINDS = ['yellow', 'green', 'blue', 'pink', 'ask', 'revise'];
export const AI_KINDS = new Set(['ask', 'revise']);

export function kindColor(kind) {
  return `var(--hl-${KINDS.includes(kind) ? kind : 'yellow'}-solid)`;
}

export function kindIcon(kind) {
  return kind === 'ask' ? 'sparkles' : kind === 'revise' ? 'wand-sparkles' : 'highlighter';
}

class AnnotationStore {
  constructor(courseId, data, state) {
    this.courseId = courseId;
    this.data = data || { vla_annotations: 1, highlights: [] };
    this.state = state || { seen: [] };
    this.listeners = new Set();
    this.saveNow = debounce(() => window.vla.course.saveAnnotations(this.courseId, this.data), 250);
    this.saveState = debounce(() => window.vla.course.saveState(this.courseId, this.state), 400);
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(change) { for (const fn of [...this.listeners]) fn(change); }

  get all() { return this.data.highlights; }

  forPage(src) { return this.data.highlights.filter(h => h.page === src); }

  get(id) { return this.data.highlights.find(h => h.id === id); }

  replace(data, state) {
    this.data = data;
    if (state) this.state = state;
    this.emit({ type: 'reset' });
  }

  add(h) {
    const now = nowIso();
    const full = { id: uid('h'), status: 'open', created: now, updated: now, comments: [], targets: [], ...h };
    this.data.highlights.push(full);
    this.saveNow();
    this.emit({ type: 'add', id: full.id });
    return full;
  }

  update(id, patch) {
    const h = this.get(id);
    if (!h) return null;
    Object.assign(h, typeof patch === 'function' ? patch(h) || {} : patch, { updated: nowIso() });
    this.saveNow();
    this.emit({ type: 'update', id });
    return h;
  }

  remove(id) {
    const i = this.data.highlights.findIndex(h => h.id === id);
    if (i < 0) return;
    this.data.highlights.splice(i, 1);
    this.saveNow();
    this.emit({ type: 'remove', id });
  }

  addComment(id, author, text, extra = {}) {
    const c = { id: uid('c'), author: author === 'answer' ? 'answer' : 'learner', text: String(text), created: nowIso(), ...extra };
    this.update(id, h => { h.comments.push(c); });
    if (author === 'answer') this.markSeen([c.id]);
    return c;
  }

  markSeen(ids) {
    const seen = new Set(this.state.seen || []);
    let changed = false;
    for (const id of ids) if (!seen.has(id)) { seen.add(id); changed = true; }
    if (changed) { this.state.seen = [...seen]; this.saveState(); this.emit({ type: 'seen' }); }
  }

  unseen(h) {
    const seen = new Set(this.state.seen || []);
    return h.comments.filter(c => c.author === 'answer' && !seen.has(c.id)).length;
  }
}

export function storeFor(courseId, data, state) {
  let s = stores.get(courseId);
  if (!s) { s = new AnnotationStore(courseId, data, state); stores.set(courseId, s); }
  else if (data) s.replace(data, state);
  return s;
}

export function existingStore(courseId) {
  return stores.get(courseId) || null;
}
