const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createStorageAdapter } = require('../storage.js');

function createChrome() {
  const calls = [];
  const chromeApi = { runtime: {}, storage: {} };
  for (const areaName of ['sync', 'local']) {
    chromeApi.storage[areaName] = {
      get(keys, callback) { calls.push({ areaName, operation: 'get', keys, callback }); },
      set(snapshot, callback) { calls.push({ areaName, operation: 'set', snapshot, callback }); }
    };
  }
  return { chromeApi, calls, adapter: createStorageAdapter(chromeApi) };
}

const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('存储核心可作为浏览器全局加载，无需 Chrome 或 Node API', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'storage.js'), 'utf8'), context);
  assert.equal(typeof context.BookmarkStorageCore.createStorageAdapter, 'function');
});

test('设置使用 sync，历史和固定书签使用 local，缺失结果返回空对象', async () => {
  const { adapter, calls } = createChrome();
  const settings = adapter.getSettings();
  const history = adapter.getHistory();
  assert.equal(calls[0].areaName, 'sync');
  assert.deepEqual(calls[0].keys, ['settings']);
  assert.equal(calls[1].areaName, 'local');
  assert.deepEqual(calls[1].keys, ['recentBookmarks', 'searchHistory', 'usageStats', 'pinnedBookmarkIds']);
  calls[0].callback({ settings: { colorTheme: 'candy' } });
  calls[1].callback();
  assert.deepEqual(await settings, { settings: { colorTheme: 'candy' } });
  assert.deepEqual(await history, {});
});

test('历史读取保留原始数据，交由调用方清洗', async () => {
  const { adapter, calls } = createChrome();
  const value = { recentBookmarks: [], searchHistory: ['Atlas'], usageStats: {}, pinnedBookmarkIds: ['42'] };
  const pending = adapter.getHistory();
  calls[0].callback(value);
  assert.deepEqual(await pending, value);
});

test('Chrome API 缺失时以明确错误拒绝，各方法均返回 Promise', async () => {
  const adapter = createStorageAdapter(undefined);
  await assert.rejects(adapter.getSettings(), /chrome\.storage\.sync\.get/);
  await assert.rejects(adapter.getHistory(), /chrome\.storage\.local\.get/);
  await assert.rejects(adapter.saveSettings({ settings: {} }), /chrome\.storage\.sync\.set/);
  await assert.rejects(adapter.saveHistory({ searchHistory: [] }), /chrome\.storage\.local\.set/);
});

test('API 同步抛出的异常也会变成 Promise 拒绝', async () => {
  const chromeApi = {
    storage: { sync: { get() { throw new Error('context invalidated'); } } }
  };
  await assert.rejects(createStorageAdapter(chromeApi).getSettings(), /context invalidated/);
});

test('仅读取 API 回调期间的 runtime.lastError，并保留错误信息', async () => {
  const { adapter, chromeApi, calls } = createChrome();
  let inCallback = false;
  Object.defineProperty(chromeApi.runtime, 'lastError', {
    get() {
      assert.equal(inCallback, true, 'lastError 只能在 API 回调中读取');
      return { message: 'storage unavailable' };
    }
  });
  const read = adapter.getSettings();
  const rejection = assert.rejects(read, /storage unavailable/);
  inCallback = true;
  calls[0].callback({ settings: {} });
  inCallback = false;
  await rejection;
});

test('同一区域写入保持顺序，并保存调用时快照', async () => {
  const { adapter, calls } = createChrome();
  const value = { searchHistory: ['Atlas'], usageStats: { 1: { count: 1 } } };
  const first = adapter.saveHistory(value);
  value.searchHistory.push('Beta');
  value.usageStats[1].count = 2;
  const second = adapter.saveHistory(value);
  await nextTurn();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].areaName, 'local');
  assert.deepEqual(calls[0].snapshot, { searchHistory: ['Atlas'], usageStats: { 1: { count: 1 } } });
  calls[0].callback();
  await first;
  await nextTurn();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].snapshot, { searchHistory: ['Atlas', 'Beta'], usageStats: { 1: { count: 2 } } });
  calls[1].callback();
  await second;
});

test('sync 与 local 写入队列独立，不因另一存储区域等待而阻塞', async () => {
  const { adapter, calls } = createChrome();
  const settings = adapter.saveSettings({ settings: { themeMode: 'dark' } });
  const history = adapter.saveHistory({ pinnedBookmarkIds: ['42'] });
  await nextTurn();
  assert.deepEqual(calls.map(call => call.areaName), ['sync', 'local']);
  calls[1].callback();
  await history;
  calls[0].callback();
  await settings;
});

test('一次写入失败不会阻塞队列中后续写入', async () => {
  const { adapter, chromeApi, calls } = createChrome();
  const first = adapter.saveSettings({ settings: { themeMode: 'light' } });
  const rejection = assert.rejects(first, /quota exceeded/);
  const second = adapter.saveSettings({ settings: { themeMode: 'dark' } });
  await nextTurn();
  chromeApi.runtime.lastError = { message: 'quota exceeded' };
  calls[0].callback();
  delete chromeApi.runtime.lastError;
  await rejection;
  await nextTurn();
  assert.equal(calls.length, 2);
  calls[1].callback();
  await second;
});

test('无法序列化或不合法的快照以 Promise 拒绝，后续写入仍可执行', async () => {
  const { adapter, calls } = createChrome();
  await assert.rejects(adapter.saveHistory(null), /存储快照必须是对象/);
  const circular = {};
  circular.self = circular;
  await assert.rejects(adapter.saveHistory(circular), /circular/i);
  const valid = adapter.saveHistory({ searchHistory: [] });
  await nextTurn();
  calls[0].callback();
  await valid;
});
