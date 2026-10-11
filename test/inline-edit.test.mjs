import { test } from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import {
  SourceDoc, HB, atomChar, restoreAtoms, linePrefix, contPrefix, isBlank, escapeLineStart, escapeHeadingEnd,
  codeSpan, wrapDelim, finalizeBlock, finalizeHeading, finalizeCell, spliceUnit, insertUnit, spliceRow, parseRow,
  paraSpec, listItemSpec, listExitSpec, respawnSpec, lastContentLine,
} from '../src/renderer/js/inline-edit-core.js';

const doc = (...lines) => new SourceDoc(lines.join('\n'));

test('SourceDoc keeps CRLF, LF, BOM and the missing final newline', () => {
  const crlf = new SourceDoc('a\r\nb\r\nc\r\n');
  assert.equal(crlf.eol, '\r\n');
  assert.deepEqual(crlf.lines, ['a', 'b', 'c', '']);
  crlf.replace(1, 2, ['B1', 'B2']);
  assert.equal(crlf.text, 'a\r\nB1\r\nB2\r\nc\r\n');

  const lf = new SourceDoc('\uFEFFx\ny');
  lf.replace(2, 2, ['z']);
  assert.equal(lf.text, '\uFEFFx\ny\nz');
  lf.replace(1, 3, []);
  assert.equal(lf.text, '\uFEFFx');

  const mixed = new SourceDoc('a\r\nb\nc\r\n');
  mixed.replace(1, 2, ['b!']);
  assert.equal(mixed.text, 'a\r\nb!\r\nc\r\n');
});

test('line prefixes: lists, task boxes, quotes, continuation', () => {
  assert.equal(linePrefix('- foo', { lead: true }), '- ');
  assert.equal(linePrefix('  1. foo', { lead: true }), '  1. ');
  assert.equal(linePrefix('- [ ] foo', { lead: true, task: true }), '- [ ] ');
  assert.equal(linePrefix('- [x] foo', { lead: true }), '- ');
  assert.equal(linePrefix('> > quote', {}), '> > ');
  assert.equal(linePrefix('> - item', { lead: true }), '> - ');
  assert.equal(linePrefix('- > quoted item', { lead: true }), '- > ');
  assert.equal(linePrefix('- - nested', { lead: true }), '- - ');
  assert.equal(linePrefix('**bold** text', { lead: true }), '');
  assert.equal(linePrefix('2. not a list here', {}), '');
  assert.equal(linePrefix('   continued', {}), '   ');
  assert.equal(contPrefix('- [ ] '), '      ');
  assert.equal(contPrefix('> 1. '), '>    ');
  assert.ok(isBlank('') && isBlank('  >  ') && isBlank('> >') && !isBlank('> a'));
});

test('escaping only what would change the structure', () => {
  assert.equal(escapeLineStart('# not a heading'), '\\# not a heading');
  assert.equal(escapeLineStart('- not a list'), '\\- not a list');
  assert.equal(escapeLineStart('+ x'), '\\+ x');
  assert.equal(escapeLineStart('> nope'), '\\> nope');
  assert.equal(escapeLineStart('1. one'), '1\\. one');
  assert.equal(escapeLineStart('2019) year'), '2019\\) year');
  assert.equal(escapeLineStart(':::tip'), '\\:::tip');
  assert.equal(escapeLineStart('::pdf{src=x}'), '\\::pdf{src=x}');
  assert.equal(escapeLineStart('```js'), '\\```js');
  assert.equal(escapeLineStart('---'), '\\---');
  assert.equal(escapeLineStart('* * *'), '\\* * *');
  assert.equal(escapeLineStart('==='), '\\===');
  assert.equal(escapeLineStart('$$x$$'), '\\$$x$$');
  assert.equal(escapeLineStart('[ref]: http://x'), '\\[ref]: http://x');
  assert.equal(escapeLineStart('<div>'), '\\<div>');
  for (const s of ['**bold** start', '*em*', '-dash', '#tag', '1.5 apples', '[link](u)', ':kbd[x]', 'plain']) assert.equal(escapeLineStart(s), s);
  assert.equal(escapeHeadingEnd('Title #'), 'Title \\#');
  assert.equal(escapeHeadingEnd('C#'), 'C#');
  assert.equal(escapeHeadingEnd('#'), '\\#');
});

test('escaped lines render as the literal text, not as structure', () => {
  const md = new MarkdownIt({ html: true, linkify: true });
  const lines = ['# hash', '- dash', '+ plus', '> gt', '1. one', '2) two', ':::tip', '```js', '---', '* * *', '===', '[r]: http://x', '<div>', '$$'];
  for (const line of lines) {
    const html = md.render(`para\n${escapeLineStart(line)}\n`);
    assert.match(html, /^<p>para\n[^\n]*<\/p>\n$/, `${line} → ${html}`);
    const text = html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    assert.equal(text, `para\n${line}\n`, line);
  }
  assert.equal(md.renderInline(codeSpan('a``b`')), '<code>a``b`</code>');
  assert.equal(md.renderInline(codeSpan('`x`')), '<code>`x`</code>');
  assert.equal(md.render(`## ${escapeHeadingEnd('C# and #')}`), '<h2>C# and #</h2>\n');
  const cellDoc = doc('| h |', '| - |', '| x |');
  spliceRow(cellDoc, 2, [{ raw: `a | ${atomChar(0)}`, atoms: ['`p|q`'] }]);
  assert.match(md.render(cellDoc.text), /<td>a \| <code>p\|q<\/code><\/td>/);
});

test('code spans, delimiters, atoms and hard breaks', () => {
  assert.equal(codeSpan('x'), '`x`');
  assert.equal(codeSpan('a`b'), '``a`b``');
  assert.equal(codeSpan('`tick'), '`` `tick ``');
  assert.equal(codeSpan(' a '), '`  a  `');
  assert.equal(codeSpan(''), '');
  assert.equal(wrapDelim('**', ' bold '), ' **bold** ');
  assert.equal(wrapDelim('*', '  '), '  ');
  const atoms = [':kbd[Ctrl]', '$x$'];
  const raw = `press ${atomChar(0)} and ${atomChar(1)}`;
  assert.equal(restoreAtoms(raw, atoms), 'press :kbd[Ctrl] and $x$');
  assert.equal(finalizeBlock(`a${HB}\nb${HB}\n${HB}\n`), 'a\\\nb');
  assert.equal(finalizeBlock(`  two\u00A0 spaces  \n\n- next\n${atomChar(0)} first`, ['- atom']), 'two  spaces\n\\- next\n- atom first');
  assert.equal(finalizeBlock('ends with \\\nnext'), 'ends with \\\\\nnext');
  assert.equal(finalizeHeading(`Title${HB}\nmore #`), 'Title more \\#');
  assert.equal(finalizeHeading('- item', [], { setext: true }), '\\- item');
  assert.equal(finalizeCell(`a\nb ${atomChar(0)}`, ['$x|y$']), 'a b $x|y$');
});

test('paragraph splice keeps prefixes and moves later lines', () => {
  const d = doc('> first line', '> second', '', 'after');
  const r = spliceUnit(d, { kind: 'block', start: 0, end: 2 }, 'first line\nsecond\nthird');
  assert.deepEqual(d.lines, ['> first line', '> second', '> third', '', 'after']);
  assert.deepEqual([r.start, r.end, r.at, r.delta], [0, 3, 2, 1]);

  const li = doc('- [ ] task one', '- item');
  spliceUnit(li, { kind: 'block', start: 0, end: 1, lead: true, task: true }, '# task **one**');
  assert.deepEqual(li.lines, ['- [ ] \\# task **one**', '- item']);

  const nested = doc('1. a', '   - b', '     wrapped');
  spliceUnit(nested, { kind: 'block', start: 1, end: 3, lead: true }, 'B\nWRAPPED\nthird');
  assert.deepEqual(nested.lines, ['1. a', '   - B', '     WRAPPED', '     third']);

  const one = doc('* only', 'x');
  spliceUnit(one, { kind: 'block', start: 0, end: 1, lead: true }, `l1${HB}\nl2`);
  assert.deepEqual(one.lines, ['* l1\\', '  l2', 'x']);
});

test('headings: ATX with closing hashes, setext, list items', () => {
  const d = doc('## Old ##', '', 'Setext', '======', '- # In list');
  spliceUnit(d, { kind: 'heading', start: 0, end: 1 }, 'New title');
  spliceUnit(d, { kind: 'heading', start: 2, end: 4 }, 'Still setext');
  spliceUnit(d, { kind: 'heading', start: 4, end: 5, lead: true }, 'Changed');
  assert.deepEqual(d.lines, ['## New title ##', '', 'Still setext', '======', '- # Changed']);
  assert.equal(spliceUnit(doc('not a heading'), { kind: 'heading', start: 0, end: 1 }, 'x'), null);
});

test('emptying a unit removes it with one blank neighbour', () => {
  const d = doc('a', '', 'b', '', 'c');
  const r = spliceUnit(d, { kind: 'block', start: 2, end: 3 }, ` ${HB}\n `);
  assert.ok(r.removed);
  assert.deepEqual(d.lines, ['a', '', 'c']);
  assert.deepEqual([r.start, r.at, r.delta], [2, 4, -2]);
  const last = doc('a', '', 'b');
  spliceUnit(last, { kind: 'block', start: 2, end: 3 }, '');
  assert.deepEqual(last.lines, ['a']);
  const keep = doc('- text', '  - child');
  spliceUnit(keep, { kind: 'block', start: 0, end: 1, lead: true, keepEmpty: true }, '');
  assert.deepEqual(keep.lines, ['-', '  - child']);
});

test('inserting paragraphs and list items', () => {
  const d = doc('para', '', '## next');
  let r = insertUnit(d, 1, paraSpec(d, { start: 0 }), 'new **one**');
  assert.deepEqual(d.lines, ['para', '', 'new **one**', '', '## next']);
  assert.deepEqual([r.start, r.end, r.delta], [2, 3, 2]);

  const q = doc('> quote', '', 'text');
  insertUnit(q, 1, paraSpec(q, { start: 0 }), 'more');
  assert.deepEqual(q.lines, ['> quote', '>', '> more', '', 'text']);

  const end = new SourceDoc('last');
  insertUnit(end, 1, paraSpec(end, { start: 0 }), 'appended');
  assert.equal(end.text, 'last\n\nappended');

  const before = doc('', 'para');
  insertUnit(before, 1, paraSpec(before, { start: 1 }), 'above');
  assert.deepEqual(before.lines, ['', 'above', '', 'para']);

  const list = doc('1. one', '2. two', '', 'after');
  const spec = listItemSpec(list, 1, { task: false });
  assert.deepEqual(spec, { kind: 'li', marker: '3. ', cont: '   ' });
  insertUnit(list, lastContentLine(list, 1, 3) + 1, spec, 'three');
  assert.deepEqual(list.lines, ['1. one', '2. two', '3. three', '', 'after']);

  const tasks = doc('> - [x] done');
  insertUnit(tasks, 1, listItemSpec(tasks, 0, { task: true }), 'todo');
  assert.deepEqual(tasks.lines, ['> - [x] done', '> - [ ] todo']);

  assert.deepEqual(listExitSpec(doc('  - inner'), 0), { kind: 'para', prefix: '  ' });
  assert.deepEqual(respawnSpec(doc('- [ ] x'), { kind: 'block', start: 0, lead: true, task: true }), { kind: 'li', marker: '- [ ] ', cont: '      ' });
  const h = doc('### Head');
  const hs = respawnSpec(h, { kind: 'heading', start: 0 });
  h.replace(0, 1, []);
  insertUnit(h, 0, hs, 'Back');
  assert.deepEqual(h.lines, ['### Back']);
  assert.equal(insertUnit(doc('x'), 1, paraSpec(doc('x'), { start: 0 }), ` ${HB}\n`), null);
});

test('table rows: unchanged cells verbatim, pipes escaped, padding kept', () => {
  assert.deepEqual(parseRow('| a | b \\| c |'), { prefix: '', leadPipe: true, trailPipe: true, tail: '', cells: [' a ', ' b \\| c '] });
  const d = doc('| 操作 | 数组 |', '| --- | :---: |', '| 按下标访问 | $O(1)$ |', '|x|y|', 'a | b');
  let r = spliceRow(d, 2, [{ raw: '按下标 | 访问', atoms: [] }, null]);
  assert.equal(d.line(2), '| 按下标 \\| 访问 | $O(1)$ |');
  assert.deepEqual(r.mds, ['按下标 | 访问']);
  spliceRow(d, 3, [null, { raw: `${atomChar(0)}`, atoms: ['$a|b$'] }]);
  assert.equal(d.line(3), '|x|$a\\|b$|');
  spliceRow(d, 4, [null, null, { raw: 'c', atoms: [] }]);
  assert.equal(d.line(4), 'a | b| c ');
  r = spliceRow(d, 0, [{ raw: '', atoms: [] }, null]);
  assert.equal(d.line(0), '| | 数组 |');
  assert.equal(r.delta, 0);
  const q = doc('> | a | b |');
  spliceRow(q, 0, [{ raw: 'A', atoms: [] }, null]);
  assert.equal(q.line(0), '> | A | b |');
});
