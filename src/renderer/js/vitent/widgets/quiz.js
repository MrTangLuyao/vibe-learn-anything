/* Assessment widgets: quiz, cloze, parsons, flashcards. */
import { h, icon } from '../../core/dom.js';
import { t } from '../../core/i18n.js';
import { fencesIn, yamlBody } from '../../../../shared/vitent-parse.mjs';
import { loadSortable } from '../../lib/lazy.js';

function seeded(str) {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
  return () => {
    x += 0x6d2b79f5;
    let r = Math.imul(x ^ (x >>> 15), 1 | x);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, seed) {
  const rnd = seeded(seed);
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function childBlocks(node, name) {
  return node.children.filter(c => c.type === 'container' && c.name === name);
}

function mdText(node) {
  return node.children.filter(c => c.type === 'md').map(c => c.text).join('\n');
}

function explainBox(nodes, rctx, kind) {
  if (!nodes.length) return null;
  const box = h(`div.quiz-explain${kind === 'hint' ? '.is-hint' : ''}`, h('div.qe-title', t(kind === 'hint' ? 'quiz.hint' : 'quiz.explain')));
  for (const n of nodes) rctx.children(n.children, box);
  return box;
}

function feedback(kind, text) {
  const ic = kind === 'ok' ? 'circle-check' : kind === 'bad' ? 'circle-x' : 'info';
  return h(`div.quiz-feedback.is-${kind}`, icon(ic), h('span', text));
}

function normalize(s, match) {
  const v = String(s ?? '').trim();
  return match === 'exact' ? v : v.toLowerCase().replace(/\s+/g, ' ');
}

function textMatches(value, answer, match, tolerance) {
  const alts = String(answer ?? '').split('|').map(x => x.trim());
  if (match === 'regex') return alts.some(a => { try { return new RegExp(a, 'i').test(value.trim()); } catch { return false; } });
  if (match === 'number') {
    const v = Number(String(value).trim().replace(',', '.'));
    return alts.some(a => Math.abs(v - Number(a)) <= Number(tolerance || 0) + 1e-12);
  }
  return alts.some(a => normalize(a, match) === normalize(value, match));
}

/* ─── quiz ─── */

function parseQuiz(node) {
  const lines = mdText(node).split(/\r?\n/);
  const q = [];
  const options = [];
  let cur = null;
  for (const line of lines) {
    const m = /^\s*[-*]\s+\[([ xX])\]\s?(.*)$/.exec(line);
    if (m) { cur = { right: m[1] !== ' ', text: m[2] }; options.push(cur); continue; }
    if (cur && /^\s{2,}\S/.test(line)) { cur.text += `\n${line.trim()}`; continue; }
    if (line.trim()) cur = null;
    q.push(line);
  }
  return { question: q.join('\n').trim(), options };
}

export const quiz = {
  label: node => parseQuiz(node).question.slice(0, 80),
  render(node, rctx, id) {
    const { question, options } = parseQuiz(node);
    const a = node.attrs;
    const rights = options.filter(o => o.right).length;
    const type = a.type || (options.length ? (rights > 1 ? 'multiple' : 'single') : (a.answer != null ? 'text' : 'open'));
    const survey = type === 'survey' || type === 'poll';
    const open = type === 'open';
    const reveal = Number(a.reveal ?? 2);
    if (!survey) rctx.counts.quiz++;
    const order = a.shuffle ? shuffle(options.map((o, i) => i), id) : options.map((o, i) => i);
    const saved = rctx.saved('quiz', id) || {};
    let picked = new Set(saved.answer && Array.isArray(saved.answer) ? saved.answer : []);
    let attempts = saved.attempts || 0;
    let solved = !!saved.correct;

    const el = h('div.vx-box.vx-quiz');
    const headLabel = t(`quiz.type.${type}`) || type;
    el.append(h('div.vx-box-head', icon(survey ? 'clipboard-list' : 'circle-help'), h('span', t('quiz')), h('span', '·'), h('span', headLabel), h('span.grow'),
      a.points ? h('span', `${a.points} ${t('quiz.points')}`) : null));
    const body = h('div.vx-box-body');
    body.append(h('div.quiz-q', rctx.md(question)));
    const foot = h('div.vx-foot', { 'data-vh-skip': '' });
    const expl = explainBox(childBlocks(node, 'explain'), rctx, 'explain');
    const hint = explainBox(childBlocks(node, 'hint'), rctx, 'hint');
    let shownExtra = null;
    const showBox = box => { if (shownExtra) shownExtra.remove(); shownExtra = box; if (box) el.append(box); };

    let optEls = [];
    let input = null;

    const setState = (state, msg) => {
      el.classList.toggle('is-correct', state === 'ok');
      el.classList.toggle('is-wrong', state === 'bad');
      foot.querySelector('.quiz-feedback')?.remove();
      if (msg) foot.append(feedback(state, msg));
    };

    const markAnswers = () => {
      optEls.forEach(({ btn, i }) => {
        btn.classList.toggle('is-right', options[i].right);
        btn.classList.toggle('is-bad', !options[i].right && picked.has(i));
        btn.classList.remove('is-picked');
      });
    };

    if (options.length) {
      const list = h('div.quiz-opts');
      optEls = order.map(i => {
        const btn = h(`button.quiz-opt${type === 'multiple' ? '.is-multi' : ''}`, {
          onClick: () => {
            if (solved && !survey) return;
            if (type === 'multiple') { if (picked.has(i)) picked.delete(i); else picked.add(i); }
            else picked = new Set([i]);
            optEls.forEach(o => { o.btn.classList.toggle('is-picked', picked.has(o.i)); o.btn.classList.remove('is-right', 'is-bad'); });
            setState(null);
            if (type === 'single' && !survey) check();
          },
        }, h('span.qo-mark', icon('check')), h('span.qo-text', { html: rctx.inline(options[i].text) }));
        if (picked.has(i)) btn.classList.add('is-picked');
        list.append(btn);
        return { btn, i };
      });
      body.append(list);
    } else {
      input = open
        ? h('textarea.textarea', { rows: 4, placeholder: t('quiz.open.ph'), value: saved.answer || '' })
        : h('input.input', { placeholder: t('quiz.text.ph'), value: saved.answer || '', onKeydown: e => { if (e.key === 'Enter') check(); } });
      body.append(h('div.quiz-input', input));
    }
    el.append(body, foot);

    function check() {
      if (survey) {
        rctx.report('quiz', id, { answer: [...picked], correct: true, survey: true, attempts: attempts + 1, at: new Date().toISOString() });
        setState('info', t('quiz.recorded'));
        return;
      }
      if (open) {
        const v = input.value.trim();
        if (!v) return;
        rctx.report('quiz', id, { answer: v, correct: true, open: true, attempts: attempts + 1, at: new Date().toISOString() });
        setState('ok', t('quiz.saved'));
        return;
      }
      let ok;
      let answer;
      if (options.length) {
        if (!picked.size) return;
        answer = [...picked].sort();
        ok = options.every((o, i) => o.right === picked.has(i));
      } else {
        answer = input.value;
        if (!answer.trim()) return;
        ok = textMatches(answer, a.answer, a.match || (type === 'number' ? 'number' : undefined), a.tolerance);
      }
      attempts++;
      solved = ok;
      rctx.report('quiz', id, { answer, correct: ok, attempts, at: new Date().toISOString() });
      if (ok) {
        if (options.length) markAnswers();
        input?.classList.add('is-right');
        setState('ok', t('quiz.correct'));
        showBox(expl);
      } else {
        setState('bad', attempts >= reveal ? t('quiz.wrongReveal') : t('quiz.wrong'));
        showBox(hint);
        if (attempts >= reveal) renderReveal();
      }
    }

    function renderReveal() {
      if (foot.querySelector('.q-reveal')) return;
      foot.append(h('button.btn.btn-sm.q-reveal', {
        onClick: () => {
          if (options.length) markAnswers();
          else if (input) { input.value = String(a.answer).split('|')[0]; }
          showBox(expl);
        },
      }, icon('eye'), h('span', t('quiz.showAnswer'))));
    }

    const checkLabel = survey ? t('quiz.submit') : open ? t('quiz.save') : t('quiz.check');
    if (type !== 'single' || survey) foot.append(h('button.btn.btn-primary.btn-sm', { onClick: check }, icon('check'), h('span', checkLabel)));
    if (open) {
      foot.append(h('button.btn.btn-sm', {
        onClick: () => rctx.page.lesson?.ask(`${t('quiz.open.review')}\n\n${question}\n\n${t('quiz.open.mine')}\n${input.value}`, { anchor: el }),
      }, icon('sparkles'), h('span', t('quiz.open.ai'))));
    }
    if (saved.attempts) {
      if (saved.correct && !saved.survey && !saved.open) {
        if (options.length) markAnswers();
        setState('ok', t('quiz.correct'));
        showBox(expl);
      } else if (saved.survey || saved.open) setState('info', t('quiz.recorded'));
      else {
        setState('bad', t('quiz.triedN', { n: saved.attempts }));
        if (saved.attempts >= reveal) renderReveal();
      }
    }
    return el;
  },
};

/* ─── cloze ─── */

export const cloze = {
  render(node, rctx, id) {
    rctx.counts.quiz++;
    const blanks = [];
    const marker = n => `⁣CLOZE${n}⁣`;
    const text = mdText(node).replace(/\[\[([^\]]+)\]\]/g, (m, inner) => { blanks.push(inner.split('|').map(s => s.trim())); return marker(blanks.length - 1); });
    const frag = rctx.md(text);
    const inputs = [];
    const walker = document.createTreeWalker(frag, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue.includes('⁣CLOZE')) texts.push(walker.currentNode);
    const saved = rctx.saved('quiz', id) || {};
    for (const tn of texts) {
      const parts = tn.nodeValue.split(/⁣CLOZE(\d+)⁣/);
      const out = [];
      parts.forEach((p, i) => {
        if (i % 2 === 0) { if (p) out.push(document.createTextNode(p)); return; }
        const n = Number(p);
        const longest = Math.max(...blanks[n].map(s => s.length), 3);
        const inp = h('input.cloze-blank', { style: { '--w': `${Math.min(28, longest + 3)}ch` }, value: saved.answer?.[n] || '', 'aria-label': `blank ${n + 1}`, spellcheck: false });
        inputs[n] = inp;
        out.push(inp);
      });
      tn.replaceWith(...out);
    }
    const el = h('div.vx-box.vx-quiz');
    const foot = h('div.vx-foot', { 'data-vh-skip': '' });
    const expl = explainBox(childBlocks(node, 'explain'), rctx, 'explain');
    let attempts = saved.attempts || 0;
    const check = () => {
      let all = true;
      inputs.forEach((inp, n) => {
        const ok = blanks[n].some(b => normalize(b, node.attrs.match) === normalize(inp.value, node.attrs.match));
        inp.classList.toggle('is-right', ok);
        inp.classList.toggle('is-bad', !ok);
        if (!ok) all = false;
      });
      attempts++;
      rctx.report('quiz', id, { answer: inputs.map(i => i.value), correct: all, attempts, at: new Date().toISOString() });
      foot.querySelector('.quiz-feedback')?.remove();
      foot.append(feedback(all ? 'ok' : 'bad', all ? t('quiz.correct') : t('cloze.some')));
      el.classList.toggle('is-correct', all);
      el.classList.toggle('is-wrong', !all);
      if (all && expl && !expl.isConnected) el.append(expl);
      if (!all && attempts >= 2 && !foot.querySelector('.q-reveal')) {
        foot.append(h('button.btn.btn-sm.q-reveal', { onClick: () => inputs.forEach((inp, n) => { inp.value = blanks[n][0]; }) }, icon('eye'), h('span', t('quiz.showAnswer'))));
      }
    };
    foot.append(h('button.btn.btn-primary.btn-sm', { onClick: check }, icon('check'), h('span', t('quiz.check'))));
    el.append(h('div.vx-box-head', icon('text-cursor-input'), h('span', t('cloze'))), h('div.vx-box-body', frag), foot);
    for (const inp of inputs) inp?.addEventListener('keydown', e => { if (e.key === 'Enter') check(); });
    if (saved.correct) { inputs.forEach(i => i?.classList.add('is-right')); el.classList.add('is-correct'); }
    return el;
  },
};

/* ─── parsons ─── */

export const parsons = {
  render(node, rctx, id) {
    rctx.counts.quiz++;
    const fence = fencesIn(node.raw)[0];
    const lines = (fence?.code || '').split('\n').filter(l => l.trim());
    const intro = node.children.filter(c => c.type === 'md').map(c => c.text.replace(/```[\s\S]*?```/g, '')).join('\n').trim();
    const saved = rctx.saved('quiz', id) || {};
    let order = saved.order && saved.order.length === lines.length ? saved.order : shuffle(lines.map((_, i) => i), id);
    if (!saved.order && lines.length > 1 && order.every((v, i) => v === i)) order = [...order.slice(1), order[0]];
    const list = h('div.parsons-list', { 'data-vh-skip': '' });
    const items = order.map(i => h('div.parsons-line', { dataset: { i: String(i) } }, h('span.grip', icon('grip-vertical')), h('span', lines[i])));
    list.append(...items);
    loadSortable().then(Sortable => {
      const s = Sortable.create(list, { animation: 160, onEnd: () => list.querySelectorAll('.parsons-line').forEach(l => l.classList.remove('is-right', 'is-bad')) });
      rctx.onDispose(() => s.destroy());
    });
    const foot = h('div.vx-foot', { 'data-vh-skip': '' });
    const el = h('div.vx-box.vx-quiz');
    const expl = explainBox(childBlocks(node, 'explain'), rctx, 'explain');
    let attempts = saved.attempts || 0;
    foot.append(h('button.btn.btn-primary.btn-sm', {
      onClick: () => {
        const now = [...list.querySelectorAll('.parsons-line')].map(l => Number(l.dataset.i));
        let all = true;
        [...list.children].forEach((l, pos) => {
          const ok = lines[now[pos]] === lines[pos];
          l.classList.toggle('is-right', ok);
          l.classList.toggle('is-bad', !ok);
          if (!ok) all = false;
        });
        attempts++;
        rctx.report('quiz', id, { order: now, correct: all, attempts, at: new Date().toISOString() });
        foot.querySelector('.quiz-feedback')?.remove();
        foot.append(feedback(all ? 'ok' : 'bad', all ? t('quiz.correct') : t('parsons.wrong')));
        el.classList.toggle('is-correct', all);
        el.classList.toggle('is-wrong', !all);
        if (all && expl && !expl.isConnected) el.append(expl);
      },
    }, icon('check'), h('span', t('quiz.check'))));
    el.append(h('div.vx-box-head', icon('list-ordered'), h('span', t('parsons'))),
      h('div.vx-box-body', intro ? rctx.md(intro) : null, list), foot);
    if (saved.correct) el.classList.add('is-correct');
    return el;
  },
};

/* ─── flashcards ─── */

export const flashcards = {
  render(node, rctx, id) {
    let cards = [];
    try { cards = yamlBody(node.raw) || []; } catch (e) { return h('div.vx-error', `flashcards: ${e.message}`); }
    cards = (Array.isArray(cards) ? cards : []).map(c => ({ q: String(c.q ?? c.front ?? ''), a: String(c.a ?? c.back ?? '') }));
    if (node.attrs.shuffle) cards = shuffle(cards, id);
    let i = 0;
    const saved = rctx.saved('widgets', id) || {};
    const seen = new Set(saved.seen || []);
    const card = h('div.fc-card');
    const counter = h('span.slides-count');
    const show = () => {
      const c = cards[i];
      card.classList.remove('is-flipped');
      card.replaceChildren(
        h('div.fc-face.fc-front', h('small', t('fc.front')), rctx.md(c?.q || '')),
        h('div.fc-face.fc-back', h('small', t('fc.back')), rctx.md(c?.a || '')));
      counter.textContent = `${i + 1} / ${cards.length}`;
    };
    card.addEventListener('click', () => {
      if (document.body.classList.contains('hl-mode')) return;
      card.classList.toggle('is-flipped');
      seen.add(i);
      rctx.report('widgets', id, { seen: [...seen] });
    });
    const el = h('div.vx-box',
      h('div.vx-box-head', icon('layers'), h('span', t('fc')), h('span.grow'), h('span', t('fc.tap'))),
      h('div.vx-box-body', h('div.fc-stage', card)),
      h('div.vx-foot', { 'data-vh-skip': '' },
        h('button.icon-btn.icon-btn-sm', { onClick: () => { i = (i - 1 + cards.length) % cards.length; show(); }, 'aria-label': t('lb.prev') }, icon('chevron-left')),
        counter,
        h('button.icon-btn.icon-btn-sm', { onClick: () => { i = (i + 1) % cards.length; show(); }, 'aria-label': t('lb.next') }, icon('chevron-right')),
        h('span.grow'),
        h('button.btn.btn-sm', { onClick: () => { cards = shuffle(cards, `${id}${Date.now()}`); i = 0; show(); } }, icon('shuffle'), h('span', t('fc.shuffle')))));
    if (cards.length) show();
    return el;
  },
};
