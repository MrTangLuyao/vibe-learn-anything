import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import {
  packVla, extractVla, validateCourseDir, normalizeCourse, mergeAnnotations, sanitizeId, pageKey, safeJoin, unzipToDir,
} from '../src/shared/vla-core.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vla-test-'));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

function makeCourse(dir) {
  write(path.join(dir, 'course.json'), JSON.stringify({
    vla: 1, id: 'demo', title: 'Demo',
    units: [{ id: 'u', title: 'U', chapters: [{ id: 'c', title: 'C', pages: ['content/a.vitent', { src: 'content/b.vitent', title: 'B' }] }] }],
  }));
  write(path.join(dir, 'content/a.vitent/index.md'), '---\ntitle: A\n---\n![x](assets/x.svg)\n');
  write(path.join(dir, 'content/a.vitent/assets/x.svg'), '<svg/>');
  write(path.join(dir, 'content/b.vitent/index.md'), '---\ntitle: B\n---\nhello\n');
  write(path.join(dir, 'learner/workspaces/k/w/main.exe'), 'binary');
  write(path.join(dir, 'learner/workspaces/k/w/main.c'), 'int main(){}');
}

test('pack → extract round trip nests and expands .vitent', () => {
  const src = tmp();
  makeCourse(src);
  assert.deepEqual(validateCourseDir(src).filter(i => i.level === 'error'), []);
  const out = path.join(tmp(), 'demo.vla');
  packVla(src, out);
  const dest = tmp();
  extractVla(out, dest);
  assert.ok(fs.statSync(path.join(dest, 'content/a.vitent')).isDirectory());
  assert.equal(fs.readFileSync(path.join(dest, 'content/a.vitent/assets/x.svg'), 'utf8'), '<svg/>');
  assert.ok(fs.existsSync(path.join(dest, 'learner/workspaces/k/w/main.c')));
  assert.ok(!fs.existsSync(path.join(dest, 'learner/workspaces/k/w/main.exe')), 'learner binaries are not packed');
});

test('validation reports missing pages and assets', () => {
  const src = tmp();
  makeCourse(src);
  fs.rmSync(path.join(src, 'content/a.vitent/assets/x.svg'));
  fs.rmSync(path.join(src, 'content/b.vitent'), { recursive: true });
  const errors = validateCourseDir(src).filter(i => i.level === 'error').map(i => i.msg).join('\n');
  assert.match(errors, /"assets\/x.svg" not found/);
  assert.match(errors, /page not found/);
});

test('zip slip is refused', () => {
  const evil = zipSync({ '../evil.txt': strToU8('x') });
  const dest = tmp();
  assert.throws(() => unzipToDir(evil, path.join(dest, 'inner')), /escapes/);
  assert.throws(() => safeJoin(dest, '../../etc/passwd'), /escapes/);
});

test('course normalisation', () => {
  const c = normalizeCourse({ title: 'My Course!', chapters: [{ title: 'x', pages: ['a.vitent'] }] });
  assert.equal(c.id, 'my-course');
  assert.equal(c.units.length, 1);
  assert.equal(c.units[0].chapters[0].pages[0].src, 'a.vitent');
  assert.equal(sanitizeId('C++ Basics 2026'), 'c-basics-2026');
  assert.equal(pageKey('content/w1/intro.vitent'), 'content__w1__intro');
});

test('annotations merge keeps both sides and newest highlight', () => {
  const local = { highlights: [{ id: 'h1', kind: 'ask', updated: '2026-01-02', status: 'open', comments: [{ id: 'c1', author: 'learner', text: 'q' }, { id: 'c3', author: 'learner', text: 'local only' }] }] };
  const incoming = { highlights: [
    { id: 'h1', kind: 'ask', updated: '2026-01-03', status: 'answered', comments: [{ id: 'c1', author: 'learner', text: 'q' }, { id: 'c2', author: 'answer', text: 'a' }] },
    { id: 'h2', kind: 'yellow', comments: [] },
  ] };
  const m = mergeAnnotations(local, incoming);
  const h1 = m.highlights.find(h => h.id === 'h1');
  assert.equal(h1.status, 'answered');
  assert.deepEqual(h1.comments.map(c => c.id).sort(), ['c1', 'c2', 'c3']);
  assert.ok(m.highlights.find(h => h.id === 'h2'));
});

test('the example course validates', () => {
  const dir = path.resolve('examples/vla-tour');
  const errors = validateCourseDir(dir).filter(i => i.level === 'error');
  assert.deepEqual(errors, []);
});
