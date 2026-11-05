import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rename, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { TagsStore, FileChangedError, parseTags, splitLabels } from '../src/storage/tags-store.ts';
import { readRetry, writeRetry, clearRetry } from '../src/storage/retry-cache.ts';

async function setup(t, initial) {
  const root = path.resolve('artifacts');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'tags-test-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(`${root}${path.sep}`), 'test cleanup must remain inside artifacts');
    return rm(resolved, { recursive: true, force: true });
  });
  const filename = path.join(directory, 'tags.json');
  if (initial !== undefined) await writeFile(filename, initial, 'utf8');
  const read = async () => { try { return await readFile(filename, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  const io = { read, async write(text, expected) {
    if (await read() !== expected) throw new FileChangedError('changed');
    const temporary = `${filename}.tmp`;
    await writeFile(temporary, text, 'utf8');
    // Windows scanners/watchers can briefly hold the replaced file. Keep this
    // fixture adapter's atomic commit bounded and never fall back to deletion.
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, filename); break; }
      catch (error) {
        if (!['EPERM', 'EBUSY'].includes(error.code) || attempt >= 4) throw error;
        await delay(10 * (attempt + 1));
      }
    }
  } };
  const updates = [];
  const states = [];
  const store = new TagsStore(io, value => updates.push(value), state => states.push(state), 20);
  t.after(() => store.dispose());
  return { store, io, filename, updates, states, read };
}

test('commas, Chinese commas, Unicode and duplicate/empty labels', () => {
  assert.deepEqual(splitLabels(' 白鹭, sparrow， 白鹭, , '), ['白鹭', 'sparrow']);
  assert.deepEqual(splitLabels('，,'), []);
});

test('creates tags.json and persists the requested filename-to-array format', async t => {
  const { store, read } = await setup(t);
  await store.open();
  assert.deepEqual(JSON.parse(await read()), {});
  store.set('DSC02730.JPG', ['白鹭']);
  store.set('DSC02731.JPG', ['麻雀', 'sparrow']);
  await store.flush();
  assert.deepEqual(JSON.parse(await read()), { 'DSC02730.JPG': ['白鹭'], 'DSC02731.JPG': ['麻雀', 'sparrow'] });
  assert.equal(store.hasPending, false);
});

test('auto-save flushes edits without an explicit save action', async t => {
  const { store, read } = await setup(t, '{}');
  await store.open();
  store.set('DSC02732.JPG', ['翠鸟']);
  for (let i = 0; i < 30 && !(await read()).includes('翠鸟'); i++) await delay(10);
  assert.deepEqual(JSON.parse(await read()), { 'DSC02732.JPG': ['翠鸟'] });
});

test('loads UTF-8 BOM JSON, preserves case and safely handles special object keys', async t => {
  const { store } = await setup(t, '\uFEFF{"__proto__":["标签"],"DSC.JPG":["白鹭"]}');
  await store.open();
  assert.deepEqual(store.snapshot['__proto__'], ['标签']);
  assert.deepEqual(store.snapshot['DSC.JPG'], ['白鹭']);
});

test('external updates and removals refresh the frontend snapshot', async t => {
  const { store, filename, updates } = await setup(t, '{"a.jpg":["旧标签"]}');
  await store.open();
  await writeFile(filename, '{"b.jpg":["新的外部标签"]}', 'utf8');
  await store.refresh();
  assert.equal(store.snapshot['a.jpg'], undefined);
  assert.deepEqual(updates.at(-1)['b.jpg'], ['新的外部标签']);
});

test('read-modify-write preserves other filenames added by an external writer', async t => {
  const { store, filename, read } = await setup(t, '{"a.jpg":["原标签"]}');
  await store.open();
  store.set('a.jpg', ['本地修改']);
  await writeFile(filename, '{"a.jpg":["原标签"],"outside.jpg":["外部新增"]}', 'utf8');
  await store.flush();
  assert.deepEqual(JSON.parse(await read()), { 'a.jpg': ['本地修改'], 'outside.jpg': ['外部新增'] });
});

test('invalid existing JSON is never overwritten and pending edits survive repair', async t => {
  const original = '{broken JSON';
  const { store, filename, read, states } = await setup(t, original);
  await assert.rejects(store.open(), /JSON/);
  store.set('a.jpg', ['白鹭']);
  await assert.rejects(store.flush(), /JSON/);
  assert.equal(await read(), original);
  assert.equal(store.hasPending, true);
  assert.ok(states.at(-1).error);
  await writeFile(filename, '{"b.jpg":["麻雀"]}', 'utf8');
  await store.refresh();
  assert.deepEqual(JSON.parse(await read()), { 'b.jpg': ['麻雀'], 'a.jpg': ['白鹭'] });
  assert.equal(states.at(-1).error, null);
});

test('malformed value types are rejected instead of being silently coerced', () => {
  for (const text of ['[]', 'null', '"text"', '{"a.jpg":"白鹭"}', '{"a.jpg":[1]}', '']) assert.throws(() => parseTags(text));
});

test('newer edits made while an older write is in flight are not lost', async t => {
  const fixture = await setup(t, '{}');
  let unblock;
  let started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { unblock = resolve; });
  const write = fixture.io.write;
  let count = 0;
  fixture.io.write = async (text, expected) => { if (++count === 1) { started(); await blocked; } await write(text, expected); };
  await fixture.store.open();
  fixture.store.set('a.jpg', ['旧标签']);
  const flushing = fixture.store.flush();
  await startedPromise;
  fixture.store.set('a.jpg', ['最新标签']);
  unblock();
  await flushing;
  assert.deepEqual(JSON.parse(await fixture.read()), { 'a.jpg': ['最新标签'] });
});

test('optimistic write conflicts re-read and merge the latest disk contents', async t => {
  const fixture = await setup(t, '{}');
  const write = fixture.io.write;
  let once = true;
  fixture.io.write = async (text, expected) => {
    if (once) { once = false; await writeFile(fixture.filename, '{"external.jpg":["外部标签"]}', 'utf8'); throw new FileChangedError('changed'); }
    await write(text, expected);
  };
  await fixture.store.open();
  fixture.store.set('a.jpg', ['本地标签']);
  await fixture.store.flush();
  assert.deepEqual(JSON.parse(await fixture.read()), { 'external.jpg': ['外部标签'], 'a.jpg': ['本地标签'] });
});

test('clearing a label saves an empty array; retry flags never enter tags.json', async t => {
  const { store, read } = await setup(t, '{"a.jpg":["白鹭"]}');
  await store.open();
  store.set('a.jpg', []);
  await store.flush();
  assert.deepEqual(JSON.parse(await read()), { 'a.jpg': [] });
});

test('read/write failures retain unsaved changes for an explicit retry', async t => {
  const fixture = await setup(t, '{}');
  const write = fixture.io.write;
  fixture.io.write = async () => { throw new Error('permission revoked'); };
  await fixture.store.open();
  fixture.store.set('a.jpg', ['白鹭']);
  await assert.rejects(fixture.store.flush(), /permission/);
  assert.equal(fixture.store.hasPending, true);
  fixture.io.write = write;
  await fixture.store.flush();
  assert.equal(fixture.store.hasPending, false);
});

test('separate physical directories can store the same photo filename independently', async t => {
  const a = await setup(t);
  const b = await setup(t);
  await Promise.all([a.store.open(), b.store.open()]);
  a.store.set('same.JPG', ['白鹭']);
  b.store.set('same.JPG', ['翠鸟']);
  await Promise.all([a.store.flush(), b.store.flush()]);
  assert.deepEqual(JSON.parse(await a.read()), { 'same.JPG': ['白鹭'] });
  assert.deepEqual(JSON.parse(await b.read()), { 'same.JPG': ['翠鸟'] });
});

test('retry selection is folder-scoped browser data and clears with the cache', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  writeRetry(storage, 'folder-a', ['a.jpg']);
  assert.deepEqual([...readRetry(storage, 'folder-a')], ['a.jpg']);
  assert.deepEqual([...readRetry(storage, 'folder-b')], []);
  clearRetry(storage);
  assert.deepEqual([...readRetry(storage, 'folder-a')], []);
  writeRetry(storage, 'folder-b', []);
  assert.deepEqual([...readRetry(storage, 'folder-a')], []);
});
