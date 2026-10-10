import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitFrontmatter, parseAttrs, scanDirective, parseBlocks, parseFenceInfo, fencesIn, yamlBody, slugify,
} from '../src/shared/vitent-parse.mjs';
import { validateVitentText, collectRefs } from '../src/shared/directives.mjs';
import { runnerFor, platformCommand, langOfFile } from '../src/shared/runners.mjs';

test('frontmatter is split and parsed', () => {
  const r = splitFrontmatter('---\ntitle: Hi\nkind: quiz\n---\n# Body\n');
  assert.deepEqual(r.data, { title: 'Hi', kind: 'quiz' });
  assert.equal(r.body, '# Body\n');
  assert.equal(r.offset, 4);
  assert.equal(splitFrontmatter('no frontmatter').body, 'no frontmatter');
  assert.ok(splitFrontmatter('---\n: [\n---\n').error);
});

test('attributes: id, class, quoted, bare, flags, numbers', () => {
  assert.deepEqual(parseAttrs('#q1 .big type=single answer="a b" n=3 t=true flag msg=\'x\\ny\''), {
    id: 'q1', type: 'single', answer: 'a b', n: 3, t: true, flag: true, msg: 'x\ny', class: 'big',
  });
});

test('directive scanner handles labels with brackets and braces in quotes', () => {
  const d = scanDirective('ask[why [really]?]{prompt="a {b}"} tail', 0);
  assert.equal(d.name, 'ask');
  assert.equal(d.label, 'why [really]?');
  assert.deepEqual(d.attrs, { prompt: 'a {b}' });
});

test('block tree: nesting, leaves, fences are opaque', () => {
  const tree = parseBlocks([
    ':::tabs',
    '::::tab[C]',
    '```c',
    ':::',
    '::pdf{src="x"}',
    '```',
    '::::',
    '::::tab[Py]',
    'text',
    '::::',
    ':::',
    '::pdf{src="a.pdf" page=2}',
    'after',
  ].join('\n'));
  assert.equal(tree.children.length, 3);
  const [tabs, pdf, md] = tree.children;
  assert.equal(tabs.name, 'tabs');
  assert.equal(tabs.children.length, 2);
  assert.match(tabs.children[0].children[0].text, /::pdf\{src="x"\}/);
  assert.deepEqual(pdf.attrs, { src: 'a.pdf', page: 2 });
  assert.equal(md.text, 'after');
});

test('same-length nesting closes innermost first; unclosed is flagged', () => {
  const t1 = parseBlocks(':::a\n:::b\nx\n:::\n:::');
  assert.equal(t1.children[0].children[0].name, 'b');
  const t2 = parseBlocks(':::a\nx');
  assert.equal(t2.children[0].unclosed, true);
});

test('fence info and fence extraction', () => {
  assert.deepEqual(parseFenceInfo('c {title="m.c" run}'), { lang: 'c', attrs: { title: 'm.c', run: true } });
  assert.deepEqual(parseFenceInfo('js file=main.js'), { lang: 'js', attrs: { file: 'main.js' } });
  const f = fencesIn('intro\n```js file=a.js\nconsole.log(1)\n```\n````md\n```\ninner\n```\n````');
  assert.equal(f.length, 2);
  assert.equal(f[0].code, 'console.log(1)');
  assert.equal(f[1].code, '```\ninner\n```');
});

test('yaml bodies may be raw or fenced', () => {
  assert.deepEqual(yamlBody('- q: a\n  a: b'), [{ q: 'a', a: 'b' }]);
  assert.deepEqual(yamlBody('```yaml\n- name: t\n  expect: "1"\n```'), [{ name: 't', expect: '1' }]);
});

test('slugify keeps CJK', () => {
  assert.equal(slugify('折叠 details'), '折叠-details');
  assert.equal(slugify('Hello, World!'), 'hello-world');
});

test('validator catches common authoring mistakes', () => {
  const bad = [
    '---', 'title: T', '---',
    ':::quiz{id="q1"}', 'Q?', '- [ ] a', '- [ ] b', ':::',
    ':::quiz{id="q1"}', 'Q2?', '- [x] a', ':::',
    '::::tab[x]', 'loose', '::::',
    ':::cloze', 'no blanks', ':::',
    '::pdf',
    ':::workspace{id="w"}', 'nothing', ':::',
    ':::flashcards', '- q: [unclosed', ':::',
    ':::tip',
  ].join('\n');
  const msgs = validateVitentText(bad).map(i => `${i.level}:${i.msg}`).join('\n');
  assert.match(msgs, /none is marked correct/);
  assert.match(msgs, /duplicate id "q1"/);
  assert.match(msgs, /"tab" must be inside :::tabs/);
  assert.match(msgs, /cloze needs at least one/);
  assert.match(msgs, /"pdf" needs src/);
  assert.match(msgs, /workspace has no/);
  assert.match(msgs, /YAML body does not parse/);
  assert.match(msgs, /never closed/);
  const good = '---\ntitle: T\n---\n:::quiz{id="q"}\nQ\n- [x] a\n- [ ] b\n:::\n';
  assert.equal(validateVitentText(good).length, 0);
});

test('asset references are collected (relative only)', () => {
  const refs = collectRefs('![i](assets/a.png)\n::pdf{src="@/x.pdf"}\n[w](https://x.y)\n:file[f]{src="b.zip"}');
  assert.deepEqual(refs.map(r => r.src).sort(), ['@/x.pdf', 'assets/a.png', 'b.zip']);
});

test('runner presets and overrides', () => {
  assert.equal(runnerFor('py').id, 'python');
  assert.equal(runnerFor('c', { c: { build: 'cc x' } }).build, 'cc x');
  assert.equal(runnerFor('nope'), null);
  assert.equal(platformCommand({ win: 'a', posix: 'b' }, 'win32'), 'a');
  assert.equal(platformCommand({ win: 'a', posix: 'b' }, 'linux'), 'b');
  assert.equal(langOfFile('src/Main.java'), 'java');
});
