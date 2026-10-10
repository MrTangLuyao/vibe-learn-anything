/* ============================================================
 * buttons.js — extensible buttons.
 * Resolution order (later wins, matched by id):
 *   built-in  →  course.json "buttons"  →  page frontmatter "buttons"
 * A button with hidden: true removes that id; "hide: [ids]" too.
 * ============================================================ */

import { h, icon, anyIcon } from './core/dom.js';
import { t, tl } from './core/i18n.js';

export function builtinButtons() {
  return [
    { id: 'back', slot: 'lessonbar.left', icon: 'chevron-left', label: t('lb.course'), style: 'text', order: 0, action: { type: 'ui', command: 'course' } },
    { id: 'focus', slot: 'lessonbar.left', icon: 'maximize-2', label: t('lb.focus'), style: 'icon', order: 10, action: { type: 'ui', command: 'focus' } },
    { id: 'prev', slot: 'lessonbar.left', icon: 'arrow-left', label: t('lb.prev'), style: 'text', order: 20, action: { type: 'ui', command: 'prev' } },
    { id: 'next', slot: 'lessonbar.left', icon: 'arrow-right', label: t('lb.next'), style: 'text', iconAfter: true, order: 30, action: { type: 'ui', command: 'next' } },
    { id: 'highlight', slot: 'lessonbar.right', icon: 'highlighter', label: t('lb.highlight'), style: 'both', order: 80, action: { type: 'ui', command: 'highlight' } },
    { id: 'edit', slot: 'lessonbar.right', icon: 'pencil-line', label: t('lb.edit'), style: 'icon', order: 90, action: { type: 'ui', command: 'edit' } },
    { id: 'sidebar', slot: 'topbar.right', icon: 'panel-left', label: t('lb.pages'), style: 'icon', order: 10, action: { type: 'ui', command: 'toggle-sidebar' } },
    { id: 'notes', slot: 'topbar.right', icon: 'notebook-pen', label: t('notes'), style: 'icon', order: 20, action: { type: 'ui', command: 'toggle-notes' } },
    { id: 'terminal', slot: 'topbar.right', icon: 'square-terminal', label: t('terminal'), style: 'icon', order: 30, action: { type: 'ui', command: 'toggle-terminal' } },
  ].map(b => ({ ...b, builtin: true }));
}

export function resolveButtons(course, fm) {
  const map = new Map(builtinButtons().map(b => [b.id, b]));
  const apply = (list, source) => {
    for (const b of Array.isArray(list) ? list : []) {
      if (!b || !b.id) continue;
      if (b.hidden) { map.delete(b.id); continue; }
      const prev = map.get(b.id);
      map.set(b.id, { ...(prev || { style: 'icon', order: 50 }), ...b, source, builtin: prev?.builtin && !b.action ? true : false });
    }
  };
  apply(course?.buttons, 'course');
  for (const id of course?.hide || []) map.delete(id);
  apply(fm?.buttons, 'page');
  for (const id of fm?.hide || []) map.delete(id);
  const bySlot = {};
  for (const b of map.values()) (bySlot[b.slot] ||= []).push(b);
  for (const list of Object.values(bySlot)) list.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  return bySlot;
}

/* Render one button. `active` and `disabled` come from the lesson state. */
export function renderButton(b, { onRun, resolveUrl, state = {} } = {}) {
  const label = tl(b.label) || b.id;
  const tip = tl(b.tooltip) || label;
  const ic = b.icon ? anyIcon(b.icon, resolveUrl) : null;
  const style = b.style || (b.icon ? 'icon' : 'text');
  const cls = style === 'icon' ? 'button.icon-btn.icon-btn-sm' : 'button.chip-btn';
  const el = h(cls, {
    'data-tip': style === 'icon' ? tip : (b.tooltip ? tip : null),
    'aria-label': label,
    disabled: !!state.disabled,
    dataset: { buttonId: b.id },
    onClick: e => onRun?.(b, e),
  },
  style !== 'icon' && b.iconAfter ? null : ic,
  style === 'icon' ? null : h('span', label),
  style !== 'icon' && b.iconAfter ? ic : null);
  if (state.active) el.classList.add('is-active');
  if (state.dot) el.append(h('span.dot'));
  return el;
}

