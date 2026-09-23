const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeView, normalizeRecord, decode, createStore, LIMIT } = require('../saved-views.js');

function record(id = 'test-view') {
  return { id, title: 'Patient 04 · Frame 12', note: 'Tumour visibility', createdAt: 1788800000000,
    viewMode: 'compare', comparison: 42,
    view: { version: 1, caseKey: 'p4video', frame: 12, mode: 'reg', opacity: 65,
      layers: { liver: true, tumour: true, points: false }, fog: true, spin: false, speed: 1,
      camera: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], target: [0, 0, -1], zoom: 1 } } };
}
function storage(initial = null) {
  let value = initial;
  return { getItem: () => value, setItem: (_, next) => { value = next; }, value: () => value };
}

test('the saved-view codec preserves the complete view while excluding edits and images', () => {
  const input = record();
  input.view.frameDeltas = { 12: 'registration changes must not be saved' };
  input.view.screenshot = 'data:image/png;base64,large';
  input.extra = 'not part of this format';
  const normalized = normalizeRecord(input);
  assert.deepEqual(normalized, record());
  input.view.camera.position[0] = 999;
  assert.equal(normalized.view.camera.position[0], 0, 'Camera arrays are independent of the live viewer');
});

test('invalid camera, layer, frame and comparison data are rejected', () => {
  const bad = [
    { ...record().view, caseKey: 123 },
    { ...record().view, frame: -1 },
    { ...record().view, frame: 1.5 },
    { ...record().view, opacity: Infinity },
    { ...record().view, layers: { liver: 'true' } },
    { ...record().view, layers: JSON.parse('{"__proto__":true}') },
    { ...record().view, camera: { ...record().view.camera, position: [0, NaN, 0] } },
    { ...record().view, camera: { ...record().view.camera, zoom: 0 } }
  ];
  bad.forEach(candidate => assert.equal(normalizeView(candidate), null));
  assert.equal(normalizeRecord({ ...record(), comparison: 101 }), null);
  assert.equal(normalizeRecord({ ...record(), viewMode: 'explore' }), null);
  assert.equal(normalizeRecord({ ...record(), createdAt: 1e20 }), null);
});

test('a partly damaged library retains valid views and rejects duplicate IDs', () => {
  const result = decode(JSON.stringify({ version: 1, items: [record('one'), { broken: true }, record('two'), record('one')] }));
  assert.deepEqual(result.items.map(item => item.id), ['one', 'two']);
  assert.equal(result.damaged, true);
  assert.throws(() => decode('{broken'));
  assert.throws(() => decode(JSON.stringify({ version: 2, items: [] })));
  assert.throws(() => decode('x'.repeat(256001)));
});

test('quota failures keep changes for the session and clearly report non-persistence', () => {
  const previous = JSON.stringify({ version: 1, items: [record('old')] });
  const store = createStore({ getItem: () => previous, setItem: () => { throw Error('QuotaExceededError'); } });
  assert.equal(store.add(record('new')), false);
  assert.deepEqual(store.items.map(item => item.id), ['new', 'old']);
  assert.match(store.notice, /session only/);
  const removed = store.remove('new');
  assert.equal(removed.record.id, 'new');
  store.add(removed.record, removed.position);
  assert.deepEqual(store.items.map(item => item.id), ['new', 'old']);
});

test('external storage updates cannot discard session-only saves or undo local removals', () => {
  let disk = JSON.stringify({ version: 1, items: [record('old')] });
  let fail = true;
  const store = createStore({ getItem: () => disk, setItem: (_, next) => {
    if (fail) throw Error('QuotaExceededError');
    disk = next;
  } });
  store.add(record('session-only'));
  store.remove('old');
  disk = JSON.stringify({ version: 1, items: [record('other-tab'), record('old')] });
  store.reload();
  assert.deepEqual(store.items.map(item => item.id), ['session-only'],
    'An external storage event must neither discard the unsaved view nor resurrect a removed one');
  assert.match(store.notice, /session only/);
  disk = null; store.reload();
  assert.deepEqual(store.items.map(item => item.id), ['session-only'],
    'Another tab removing its library also leaves this tab’s pending changes intact');
  fail = false;
  assert.equal(store.add(record('after-recovery')), true);
  assert.deepEqual(decode(disk).items.map(item => item.id), ['after-recovery', 'session-only']);
  assert.equal(store.notice, '');
  disk = JSON.stringify({ version: 1, items: [record('synced-again')] });
  store.reload();
  assert.deepEqual(store.items.map(item => item.id), ['synced-again'],
    'External updates resume once the pending session has been persisted successfully');
});

test('the capacity limit never silently replaces an existing view; deletion can be undone', () => {
  const backend = storage(); const store = createStore(backend);
  for (let i = 0; i < LIMIT; i++) store.add(record('view-' + i));
  const before = store.items.map(item => item.id);
  assert.throws(() => store.add(record('overflow')), /24 views/);
  assert.deepEqual(store.items.map(item => item.id), before);
  const removed = store.remove('view-8');
  assert.equal(store.items.length, 23);
  store.add(removed.record, removed.position);
  assert.deepEqual(store.items.map(item => item.id), before);
  assert.deepEqual(decode(backend.value()).items.map(item => item.id), before);
});

test('blocked reads and malformed storage are recoverable without crashing the viewer', () => {
  const blocked = createStore({ getItem: () => { throw Error('SecurityError'); }, setItem: () => { throw Error('SecurityError'); } });
  assert.equal(blocked.items.length, 0); assert.match(blocked.notice, /session only/);
  blocked.add(record()); assert.equal(blocked.items.length, 1);
  const backend = storage('not JSON'); const corrupted = createStore(backend);
  assert.match(corrupted.notice, /could not be read/);
  assert.equal(corrupted.add(record()), true);
  assert.equal(corrupted.notice, '');
  assert.equal(decode(backend.value()).items.length, 1);
});
