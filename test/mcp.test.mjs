/* Drives `node tools/vla.mjs mcp` over stdio against a temp copy of the
   example course, the way an MCP client would. */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(root, 'tools', 'vla.mjs');
const TIMEOUT = 20000;

const EXPECTED_TOOLS = [
  'get_current_context', 'list_courses', 'get_course', 'read_page', 'write_page', 'edit_page', 'create_page',
  'list_annotations', 'reply_annotation', 'validate_course', 'list_files', 'read_file', 'write_file',
];
const READ_ONLY = ['get_current_context', 'list_courses', 'get_course', 'read_page', 'list_annotations', 'validate_course', 'list_files', 'read_file'];

/* Minimal newline-delimited JSON-RPC client. */
function startClient(dataDir) {
  const child = spawn(process.execPath, [CLI, 'mcp', '--data', dataDir], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buf = '';
  let stderr = '';
  let nextId = 1;
  const pending = new Map();
  const stray = [];
  const junk = [];
  const nullWaiters = [];
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', d => { stderr += d; });
  child.stdout.on('data', chunk => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { junk.push(line); continue; }
      if (msg.id === null && nullWaiters.length) { nullWaiters.shift()(msg); continue; }
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); p(msg); } else stray.push(msg);
    }
  });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const withTimeout = (promise, what) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${what}\nstderr:\n${stderr}`)), TIMEOUT);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
  return {
    child,
    stray,
    junk,
    get stderr() { return stderr; },
    exited,
    request(method, params) {
      const id = nextId++;
      const p = new Promise(resolve => pending.set(id, resolve));
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`);
      return withTimeout(p, method);
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })}\n`);
    },
    raw(line) {
      const p = new Promise(resolve => nullWaiters.push(resolve));
      child.stdin.write(`${line}\n`);
      return withTimeout(p, 'raw line reply');
    },
    async call(name, args) {
      const res = await this.request('tools/call', { name, arguments: args });
      assert.ok(res.result, `tools/call ${name} returned a JSON-RPC error: ${JSON.stringify(res.error)}`);
      const { content, isError } = res.result;
      assert.ok(Array.isArray(content) && content[0]?.type === 'text', `${name}: content must be [{type:"text"}]`);
      return { text: content.map(c => c.text).join('\n'), isError: !!isError };
    },
  };
}

const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const jsonPart = text => JSON.parse(text.split('\n\n===== ')[0]);

describe('MCP server (stdio)', { timeout: 120000 }, () => {
  let tmp;
  let data;
  let course;
  let client;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vla-mcp-'));
    data = path.join(tmp, 'data');
    course = path.join(data, 'library', 'vla-tour');
    fs.cpSync(path.join(root, 'examples', 'vla-tour'), course, { recursive: true });
    write(path.join(course, 'annotations.json'), JSON.stringify({
      vla_annotations: 1,
      highlights: [
        {
          id: 'h-ask1', kind: 'ask', page: 'content/w1/workspace.vitent', status: 'open',
          created: '2026-10-11T08:30:00.000Z', updated: '2026-10-11T08:31:12.000Z',
          targets: [{ type: 'text', exact: '实现二分查找', section: '练习：实现二分查找' }],
          comments: [{ id: 'c-l1', author: 'learner', text: '为什么要用 lo <= hi？', created: '2026-10-11T08:31:12.000Z' }],
        },
        {
          id: 'h-note', kind: 'yellow', page: 'content/w0/welcome.vitent', status: 'resolved',
          targets: [], comments: [{ id: 'c-l2', author: 'learner', text: '记住这个', created: '2026-10-11T08:00:00.000Z' }],
        },
      ],
    }, null, 2));
    write(path.join(course, 'learner', 'workspaces', 'content__w1__workspace', 'ws-bsearch', 'search.js'), 'function binarySearch(a, x) { return 0; }\n');
    write(path.join(course, 'learner', 'progress.json'), JSON.stringify({ vla_progress: 1, pages: {} }));
    write(path.join(data, 'live.json'), JSON.stringify({
      view: 'lesson',
      courseId: 'vla-tour',
      courseTitle: 'Vibe Learn 新手导览',
      chapterId: 'w1-workshop',
      chapterTitle: '代码工作区',
      page: 'content/w1/workspace.vitent',
      pageTitle: '代码工作区',
      pageIndex: 1,
      selection: { text: 'binarySearch', source: 'code' },
      workspace: { id: 'ws-bsearch', file: 'search.js', language: 'javascript', cursorLine: 1, selection: '', code: 'function binarySearch(a, x) { return 0; }\n' },
      updatedAt: new Date().toISOString(),
    }));
    client = startClient(data);
  });

  after(async () => {
    if (client) {
      client.child.stdin.end();
      const t = setTimeout(() => client.child.kill(), 3000);
      await client.exited;
      clearTimeout(t);
    }
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  test('initialize echoes the protocol version and names the server', async () => {
    const res = await client.request('initialize', {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test-client', version: '1.0.0' },
    });
    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.result.protocolVersion, '2025-03-26');
    assert.equal(res.result.serverInfo.name, 'vibe-learn');
    assert.equal(typeof res.result.serverInfo.version, 'string');
    assert.deepEqual(res.result.capabilities.tools, { listChanged: false });
    assert.match(res.result.instructions, /get_current_context/);
    client.notify('notifications/initialized');

    const res2 = await client.request('initialize', {});
    assert.equal(res2.result.protocolVersion, '2025-06-18');
  });

  test('ping returns an empty result; notifications get no reply', async () => {
    client.notify('notifications/cancelled', { requestId: 99 });
    const res = await client.request('ping');
    assert.deepEqual(res.result, {});
    assert.deepEqual(client.stray, [], 'no reply to notifications');
  });

  test('tools/list exposes every tool with a valid schema', async () => {
    const res = await client.request('tools/list', {});
    const tools = res.result.tools;
    assert.deepEqual(tools.map(t => t.name).sort(), [...EXPECTED_TOOLS].sort());
    for (const t of tools) {
      assert.ok(t.title && t.description, `${t.name} has title and description`);
      assert.equal(t.inputSchema.type, 'object', `${t.name} schema is an object`);
      assert.equal(typeof t.inputSchema.properties, 'object');
      for (const r of t.inputSchema.required || []) assert.ok(r in t.inputSchema.properties, `${t.name}: required "${r}" is a property`);
      for (const [k, p] of Object.entries(t.inputSchema.properties)) assert.ok(['string', 'boolean'].includes(p.type), `${t.name}.${k} has a type`);
      if (READ_ONLY.includes(t.name)) assert.equal(t.annotations?.readOnlyHint, true, `${t.name} is read-only`);
      else assert.notEqual(t.annotations?.readOnlyHint, true, `${t.name} is not read-only`);
    }
    const create = tools.find(t => t.name === 'create_page');
    assert.deepEqual(create.inputSchema.required, ['course_id', 'chapter_id', 'name', 'text']);
  });

  test('get_current_context merges live.json with page, highlights and workspace', async () => {
    const { text, isError } = await client.call('get_current_context', {});
    assert.equal(isError, false);
    const ctx = jsonPart(text);
    assert.equal(ctx.courseId, 'vla-tour');
    assert.equal(ctx.page, 'content/w1/workspace.vitent');
    assert.equal(ctx.selection.text, 'binarySearch');
    assert.equal(ctx.workspace.id, 'ws-bsearch');
    assert.deepEqual(ctx.openHighlights.map(h => h.id), ['h-ask1']);
    assert.equal(ctx.openHighlights[0].comments[0].author, 'learner');
    assert.equal(ctx.workspaceDir, 'learner/workspaces/content__w1__workspace');
    assert.ok(ctx.workspaceFiles.some(f => f.startsWith('ws-bsearch/search.js')));
    assert.match(text, /===== content\/w1\/workspace\.vitent\/index\.md =====/);
    assert.match(text, /:::workspace\{id="ws-bsearch"/);
  });

  test('list_courses and get_course', async () => {
    const list = JSON.parse((await client.call('list_courses', {})).text);
    const tour = list.courses.find(c => c.id === 'vla-tour');
    assert.ok(tour);
    assert.equal(tour.openAskRevise, 1);
    assert.ok(tour.pages >= 10);

    const { text, isError } = await client.call('get_course', { course_id: 'vla-tour' });
    assert.equal(isError, false);
    const outline = JSON.parse(text);
    assert.equal(outline.units.length, 3);
    const ch = outline.units[1].chapters.find(c => c.id === 'w1-workshop');
    assert.equal(ch.kind, 'code');
    const ws = ch.pages.find(p => p.src === 'content/w1/workspace.vitent');
    assert.equal(ws.title, '代码工作区');
    assert.equal(ws.kind, 'code');

    const missing = await client.call('get_course', { course_id: 'no-such-course' });
    assert.equal(missing.isError, true);
    assert.match(missing.text, /available: vla-tour/);
  });

  test('read_page returns index.md and the page folder files', async () => {
    const { text, isError } = await client.call('read_page', { course_id: 'vla-tour', page: 'content/w1/terminal-actions.vitent' });
    assert.equal(isError, false);
    const meta = jsonPart(text);
    assert.equal(meta.chapter, 'w1-workshop');
    assert.ok(meta.files.some(f => f.startsWith('scripts/check.js')));
    const disk = fs.readFileSync(path.join(course, 'content/w1/terminal-actions.vitent/index.md'), 'utf8');
    assert.ok(text.includes(disk), 'page text is returned verbatim');

    const bad = await client.call('read_page', { course_id: 'vla-tour', page: 'content/nope.vitent' });
    assert.equal(bad.isError, true);
    const escape = await client.call('read_page', { course_id: 'vla-tour', page: '../../outside.vitent' });
    assert.equal(escape.isError, true);
  });

  test('edit_page: unique replacement, not found, ambiguous, replace_all', async () => {
    const file = path.join(course, 'content/w0/welcome.vitent/index.md');
    const ok = await client.call('edit_page', {
      course_id: 'vla-tour', page: 'content/w0/welcome.vitent', old_text: '## 这门课怎么用', new_text: '## 这门课怎么用（已更新）',
    });
    assert.equal(ok.isError, false, ok.text);
    assert.match(fs.readFileSync(file, 'utf8'), /## 这门课怎么用（已更新）/);

    const notFound = await client.call('edit_page', {
      course_id: 'vla-tour', page: 'content/w0/welcome.vitent', old_text: 'this text is not on the page', new_text: 'x',
    });
    assert.equal(notFound.isError, true);
    assert.match(notFound.text, /not found/);

    const before = fs.readFileSync(file, 'utf8');
    const ambiguous = await client.call('edit_page', {
      course_id: 'vla-tour', page: 'content/w0/welcome.vitent', old_text: '.vitent', new_text: '.VITENT',
    });
    assert.equal(ambiguous.isError, true);
    assert.match(ambiguous.text, /occurs \d+ times/);
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'nothing written');

    const all = await client.call('edit_page', {
      course_id: 'vla-tour', page: 'content/w0/welcome.vitent', old_text: 'Vibe Learn Anything', new_text: 'VLA', replace_all: true,
    });
    assert.equal(all.isError, false, all.text);
    assert.ok(!fs.readFileSync(file, 'utf8').includes('Vibe Learn Anything'));

    const breaking = await client.call('edit_page', {
      course_id: 'vla-tour', page: 'content/w0/welcome.vitent', old_text: ':::tip[三种方式和 AI 互动]', new_text: ':::tip[三种方式和 AI 互动]\n:::note[x]',
    });
    assert.equal(breaking.isError, true, 'an edit that leaves a container unclosed is refused');
    assert.match(breaking.text, /never closed/);
  });

  test('edit_page keeps CRLF line endings', async () => {
    const file = path.join(course, 'content/w0/layout.vitent/index.md');
    const crlf = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    fs.writeFileSync(file, crlf);
    assert.ok(crlf.includes('## 提示框\r\n\r\n:::info'));
    const res = await client.call('edit_page', {
      course_id: 'vla-tour', page: 'content/w0/layout.vitent', old_text: '## 提示框\n\n:::info', new_text: '## 提示框\n\n额外的一段。\n\n:::info',
    });
    assert.equal(res.isError, false, res.text);
    const after = fs.readFileSync(file, 'utf8');
    assert.match(after, /额外的一段。/);
    assert.equal(after.replace(/\r\n/g, '').includes('\n'), false, 'no bare LF introduced');
  });

  test('write_page rejects invalid Vitent and writes valid pages', async () => {
    const file = path.join(course, 'content/w2/buttons.vitent/index.md');
    const before = fs.readFileSync(file, 'utf8');
    const bad = await client.call('write_page', {
      course_id: 'vla-tour', page: 'content/w2/buttons.vitent', text: '---\ntitle: 坏页面\n---\n\n:::tip[没有关闭]\n内容\n',
    });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /never closed/);
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'invalid page is not written');

    const good = await client.call('write_page', {
      course_id: 'vla-tour', page: 'content/w2/buttons.vitent', text: '---\ntitle: 按钮\n---\n\n![图](assets/missing.svg)\n\n:::tip\n好\n:::\n',
    });
    assert.equal(good.isError, false, good.text);
    assert.match(good.text, /missing\.svg/, 'missing assets are reported as warnings');
    assert.match(fs.readFileSync(file, 'utf8'), /title: 按钮/);

    const absent = await client.call('write_page', { course_id: 'vla-tour', page: 'content/w2/new.vitent', text: '---\ntitle: x\n---\n' });
    assert.equal(absent.isError, true);
    assert.match(absent.text, /create_page/);
  });

  test('create_page adds the folder and the course.json entry', async () => {
    const res = await client.call('create_page', {
      course_id: 'vla-tour', chapter_id: 'w1-workshop', name: 'extra-practice', title: '加练',
      text: '---\nkind: doc\n---\n\n# 加练\n\n多做几道题。\n', after: 'content/w1/snippets.vitent',
    });
    assert.equal(res.isError, false, res.text);
    const index = path.join(course, 'content/w1/extra-practice.vitent/index.md');
    assert.ok(fs.existsSync(index));
    assert.match(fs.readFileSync(index, 'utf8'), /title: "加练"/);
    const cj = JSON.parse(fs.readFileSync(path.join(course, 'course.json'), 'utf8'));
    const pages = cj.units[1].chapters[0].pages;
    assert.equal(pages[1], 'content/w1/extra-practice.vitent', 'inserted after snippets, as a plain string like its neighbours');
    assert.equal(pages.length, 5);

    const dup = await client.call('create_page', { course_id: 'vla-tour', chapter_id: 'w1-workshop', name: 'extra-practice', text: '---\ntitle: x\n---\n' });
    assert.equal(dup.isError, true);
    const badChapter = await client.call('create_page', { course_id: 'vla-tour', chapter_id: 'nope', name: 'x', text: '---\ntitle: x\n---\n' });
    assert.equal(badChapter.isError, true);
    const badName = await client.call('create_page', { course_id: 'vla-tour', chapter_id: 'w1-workshop', name: '../evil', text: '---\ntitle: x\n---\n' });
    assert.equal(badName.isError, true);
    const invalid = await client.call('create_page', { course_id: 'vla-tour', chapter_id: 'w1-workshop', name: 'broken', text: '---\ntitle: x\n---\n:::quiz{id="q"}\n2+2?\n- [ ] 3\n- [ ] 5\n:::\n' });
    assert.equal(invalid.isError, true);
    assert.ok(!fs.existsSync(path.join(course, 'content/w1/broken.vitent')));

    const validation = await client.call('validate_course', { course_id: 'vla-tour' });
    assert.equal(validation.isError, false);
    const errorLines = validation.text.split('\n').filter(l => l.trim().startsWith('error'));
    assert.deepEqual(errorLines.filter(l => l.includes('extra-practice') || l.includes('course.json')), []);
  });

  test('list_annotations and reply_annotation', async () => {
    const open = JSON.parse((await client.call('list_annotations', { course_id: 'vla-tour', status: 'open' })).text);
    assert.deepEqual(open.highlights.map(h => h.id), ['h-ask1']);
    const yellow = JSON.parse((await client.call('list_annotations', { course_id: 'vla-tour', kind: 'yellow' })).text);
    assert.deepEqual(yellow.highlights.map(h => h.id), ['h-note']);
    const byPage = await client.call('list_annotations', { course_id: 'vla-tour', page: 'content/w2/highlight.vitent' });
    assert.match(byPage.text, /No highlights/);

    const reply = await client.call('reply_annotation', { course_id: 'vla-tour', highlight_id: 'h-ask1', text: '因为 **lo == hi** 时还剩一个元素要检查。' });
    assert.equal(reply.isError, false, reply.text);
    assert.equal(JSON.parse(reply.text).status, 'answered');
    const ann = JSON.parse(fs.readFileSync(path.join(course, 'annotations.json'), 'utf8'));
    const h = ann.highlights.find(x => x.id === 'h-ask1');
    assert.equal(h.status, 'answered');
    assert.equal(h.comments.length, 2);
    assert.deepEqual(h.comments[0], { id: 'c-l1', author: 'learner', text: '为什么要用 lo <= hi？', created: '2026-10-11T08:31:12.000Z' });
    assert.equal(h.comments[1].author, 'answer');
    assert.match(h.comments[1].id, /^c-/);
    assert.notEqual(h.updated, '2026-10-11T08:31:12.000Z');

    const note = await client.call('reply_annotation', { course_id: 'vla-tour', highlight_id: 'h-note', text: '好的' });
    assert.equal(JSON.parse(note.text).status, 'resolved', 'status of a plain highlight is unchanged');
    const missing = await client.call('reply_annotation', { course_id: 'vla-tour', highlight_id: 'h-none', text: 'x' });
    assert.equal(missing.isError, true);
    const badStatus = await client.call('reply_annotation', { course_id: 'vla-tour', highlight_id: 'h-ask1', text: 'x', status: 'done' });
    assert.equal(badStatus.isError, true);
  });

  test('files: list, read, write, and the refusals', async () => {
    const listing = await client.call('list_files', { course_id: 'vla-tour', dir: 'content/w1' });
    assert.match(listing.text, /content\/w1\/workspace\.vitent\/index\.md {2}\(/);

    const w = await client.call('write_file', { course_id: 'vla-tour', path: 'content/w1/workspace.vitent/code/notes.txt', content: 'hello\n' });
    assert.equal(w.isError, false, w.text);
    assert.equal(fs.readFileSync(path.join(course, 'content/w1/workspace.vitent/code/notes.txt'), 'utf8'), 'hello\n');
    const r = await client.call('read_file', { course_id: 'vla-tour', path: 'content/w1/workspace.vitent/code/notes.txt' });
    assert.equal(r.text, 'hello\n');
    const learnerCode = await client.call('read_file', { course_id: 'vla-tour', path: 'learner/workspaces/content__w1__workspace/ws-bsearch/search.js' });
    assert.match(learnerCode.text, /binarySearch/, 'learner files are readable');

    const learner = await client.call('write_file', { course_id: 'vla-tour', path: 'learner/x', content: 'nope' });
    assert.equal(learner.isError, true);
    assert.ok(!fs.existsSync(path.join(course, 'learner/x')));
    const sneaky = await client.call('write_file', { course_id: 'vla-tour', path: 'content/../learner/progress.json', content: '{}' });
    assert.equal(sneaky.isError, true);
    const escape = await client.call('write_file', { course_id: 'vla-tour', path: '../escape', content: 'nope' });
    assert.equal(escape.isError, true);
    assert.ok(!fs.existsSync(path.join(data, 'library', 'escape')));
    const ann = await client.call('write_file', { course_id: 'vla-tour', path: 'annotations.json', content: '{}' });
    assert.equal(ann.isError, true);
    assert.match(ann.text, /reply_annotation/);
    const badJson = await client.call('write_file', { course_id: 'vla-tour', path: 'course.json', content: '{ nope' });
    assert.equal(badJson.isError, true);
    const badPage = await client.call('write_file', { course_id: 'vla-tour', path: 'content/w0/quizzes.vitent/index.md', content: ':::tip\nnever closed\n' });
    assert.equal(badPage.isError, true);

    const binary = await client.call('read_file', { course_id: 'vla-tour', path: 'content/w0/media.vitent/assets/chord.wav' });
    assert.equal(binary.isError, true);
    assert.match(binary.text, /binary/);
  });

  test('unknown tool, unknown method, malformed JSON', async () => {
    const unknown = await client.call('no_such_tool', {});
    assert.equal(unknown.isError, true);
    assert.match(unknown.text, /Unknown tool/);
    const missingArg = await client.call('read_page', { course_id: 'vla-tour' });
    assert.equal(missingArg.isError, true);
    assert.match(missingArg.text, /page/);

    const method = await client.request('resources/frobnicate', {});
    assert.equal(method.error.code, -32601);
    const parse = await client.raw('{ this is not json');
    assert.equal(parse.id, null);
    assert.equal(parse.error.code, -32700);
  });

  test('stdout carried only JSON-RPC messages', () => {
    assert.deepEqual(client.junk, []);
    assert.deepEqual(client.stray, []);
  });
});
