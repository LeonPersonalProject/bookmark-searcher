const test = require('node:test');
const assert = require('node:assert/strict');
const { createPopup } = require('./helpers/popup.js');

const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
const rowIds = popup => popup.rows().map(row => row.dataset.itemId).sort();

function createNestedPopup() {
  return createPopup([
    { id: 'work', type: 'folder', title: 'Work', childCount: 2 },
    { id: 'nested', type: 'folder', title: 'Nested', parentId: 'work', path: 'Work', childCount: 1 },
    { id: 'direct', title: 'Needle direct', url: 'https://direct.example/', parentId: 'work', path: 'Work' },
    { id: 'leaf', title: 'Needle leaf', url: 'https://leaf.example/', parentId: 'nested', path: 'Work / Nested' },
    { id: 'outside', title: 'Needle outside', url: 'https://outside.example/' }
  ]);
}

test('文件夹搜索递归包含子目录，范围按钮切换全部后可切回', () => {
  const popup = createNestedPopup();
  popup.run("navigateToFolder('work')");
  popup.type('Needle');
  popup.flush();

  assert.deepEqual(rowIds(popup), ['direct', 'leaf']);
  assert.equal(popup.elements.get('searchScopeButton').hidden, false);
  assert.equal(popup.elements.get('searchScopeButton').getAttribute('aria-pressed'), 'false');

  popup.elements.get('searchScopeButton').click();
  assert.deepEqual(rowIds(popup), ['direct', 'leaf', 'outside']);
  assert.equal(popup.run('currentFolderId'), 'work');
  assert.equal(popup.input.value, 'Needle');
  assert.equal(popup.elements.get('searchScopeButton').getAttribute('aria-pressed'), 'true');

  popup.elements.get('searchScopeButton').click();
  assert.deepEqual(rowIds(popup), ['direct', 'leaf']);
  assert.equal(popup.run('searchScope'), 'folder');
});

test('逐层返回恢复原查询、搜索范围、选中项和滚动位置', () => {
  const popup = createNestedPopup();
  popup.type('Work');
  popup.flush();
  popup.run(`
    searchScope = 'all';
    setSelectedIndex([...resultsContainer.querySelectorAll('.bookmark-item')]
      .findIndex(element => element.dataset.itemId === 'work'));
    contentArea.scrollTop = 147;
  `);
  popup.key('Enter');
  assert.equal(popup.run('currentFolderId'), 'work');
  assert.equal(popup.input.value, '');

  popup.type('Needle');
  popup.flush();
  popup.elements.get('searchScopeButton').click();
  popup.run(`
    setSelectedIndex([...resultsContainer.querySelectorAll('.bookmark-item')]
      .findIndex(element => element.dataset.itemId === 'leaf'));
    contentArea.scrollTop = 72;
    navigateToFolder('nested');
  `);

  popup.run('handleBack()');
  assert.equal(popup.run('currentFolderId'), 'work');
  assert.equal(popup.input.value, 'Needle');
  assert.equal(popup.run('searchScope'), 'all');
  assert.equal(popup.selected().dataset.itemId, 'leaf');
  assert.equal(popup.input.getAttribute('aria-activedescendant'), popup.selected().id);
  assert.equal(popup.elements.get('contentArea').scrollTop, 72);

  popup.run('handleBack()');
  assert.equal(popup.run('currentFolderId'), null);
  assert.equal(popup.input.value, 'Work');
  assert.equal(popup.run('searchScope'), 'all');
  assert.equal(popup.selected().dataset.itemId, 'work');
  assert.equal(popup.input.getAttribute('aria-activedescendant'), popup.selected().id);
  assert.equal(popup.elements.get('contentArea').scrollTop, 147);
  assert.equal(popup.run('navigationStack.length'), 0);
});

test('分批从 300 追加到 600，保留首批 DOM、选中项和滚动位置', () => {
  const popup = createPopup(Array.from({ length: 650 }, (_, index) => ({
    id: String(index),
    title: `Atlas ${String(index).padStart(4, '0')}`,
    url: `https://atlas.example/${index}`
  })));
  const firstBatch = popup.rows();
  assert.equal(firstBatch.length, 300);
  popup.run('setSelectedIndex(5); contentArea.scrollTop = 1234;');

  popup.elements.get('resultsMore').children[0].click();
  assert.equal(popup.rows().length, 600);
  assert.equal(popup.rows()[0], firstBatch[0]);
  assert.equal(popup.rows()[299], firstBatch[299]);
  assert.equal(new Set(popup.rows().map(row => row.id)).size, 600);
  assert.equal(popup.selected().dataset.itemId, '5');
  assert.equal(popup.elements.get('contentArea').scrollTop, 1234);

  popup.elements.get('resultsMore').children[0].click();
  assert.equal(popup.rows().length, 650);
  assert.equal(popup.rows()[0], firstBatch[0]);
  assert.equal(popup.elements.get('resultsMore').hidden, true);
});

test('固定写入使用真实存储适配器，失败回滚且允许重试', async () => {
  const popup = createPopup(undefined, { stubHistoryWrites: false });
  const chromeApi = popup.run('chrome');
  const writes = [];
  chromeApi.runtime = {};
  chromeApi.storage = {
    local: { set(snapshot, callback) { writes.push({ snapshot, callback }); } }
  };

  const first = popup.run("togglePinnedBookmark(itemsById.get('1'))");
  await nextTurn();
  assert.deepEqual(plain(writes[0].snapshot.pinnedBookmarkIds), ['1']);
  assert.equal(popup.run('pinWriteBusy'), true);
  await popup.run("togglePinnedBookmark(itemsById.get('2'))");
  assert.equal(writes.length, 1);

  chromeApi.runtime.lastError = { message: 'storage unavailable' };
  writes[0].callback();
  delete chromeApi.runtime.lastError;
  await first;
  assert.deepEqual(plain(popup.run('pinnedBookmarkIds')), []);
  assert.equal(popup.run('pinWriteBusy'), false);
  assert.match(popup.elements.get('errorToast').textContent, /固定状态未能保存/);

  const retry = popup.run("togglePinnedBookmark(itemsById.get('1'))");
  await nextTurn();
  assert.equal(writes.length, 2);
  writes[1].callback();
  await retry;
  assert.deepEqual(plain(popup.run('pinnedBookmarkIds')), ['1']);
  assert.deepEqual(plain(writes[1].snapshot.pinnedBookmarkIds), ['1']);
  assert.equal(popup.elements.get('pinnedBookmarks').children.length, 1);
  assert.equal(popup.elements.get('pinnedSection').hidden, false);
});

test('点击固定卡片的取消按钮直接取消固定，不打开或删除书签', async () => {
  const popup = createPopup();
  popup.run("pinnedBookmarkIds = ['1', '2']; displayPinnedBookmarks(); updateView();");
  const container = popup.elements.get('pinnedBookmarks');
  const firstCard = container.querySelector('.pinned-bookmark-row');
  const unpinButton = firstCard.querySelector('.unpin-bookmark-button');
  assert.ok(unpinButton, '固定卡片应提供直接取消固定的按钮');
  assert.match(unpinButton.getAttribute('aria-label'), /取消固定.*Atlas A/);

  unpinButton.focus();
  unpinButton.click();
  await nextTurn();

  assert.deepEqual(plain(popup.run('pinnedBookmarkIds')), ['2']);
  assert.equal(container.querySelectorAll('.pinned-bookmark-item').length, 1);
  assert.match(container.querySelector('.pinned-bookmark-item').getAttribute('aria-label'), /Atlas B/);
  assert.equal(popup.elements.get('pinnedSection').hidden, false);
  assert.equal(popup.run("itemsById.has('1')"), true);
  assert.equal(popup.run('allBookmarks.length'), 3);
  assert.deepEqual(popup.opened, []);
  assert.equal(popup.document.activeElement, container.querySelector('.unpin-bookmark-button'));
});

test('固定区取消固定存储失败后保留卡片，可从同一入口重试', async () => {
  const popup = createPopup(undefined, { stubHistoryWrites: false });
  const chromeApi = popup.run('chrome');
  const writes = [];
  chromeApi.runtime = {};
  chromeApi.storage = {
    local: { set(snapshot, callback) { writes.push({ snapshot, callback }); } }
  };
  popup.run("pinnedBookmarkIds = ['1', '2']; displayPinnedBookmarks(); updateView();");
  const container = popup.elements.get('pinnedBookmarks');
  const getFirstUnpinButton = () => container.querySelector('.pinned-bookmark-row')
    .querySelector('.unpin-bookmark-button');

  getFirstUnpinButton().focus();
  getFirstUnpinButton().click();
  await nextTurn();
  assert.equal(writes.length, 1);
  assert.deepEqual(plain(writes[0].snapshot.pinnedBookmarkIds), ['2']);
  assert.equal(getFirstUnpinButton().disabled, true);
  getFirstUnpinButton().click();
  container.querySelectorAll('.unpin-bookmark-button')[1].click();
  await nextTurn();
  assert.equal(writes.length, 1, '等待存储时重复点击不应重复写入或取消其他固定');
  chromeApi.runtime.lastError = { message: 'storage unavailable' };
  writes[0].callback();
  delete chromeApi.runtime.lastError;
  await nextTurn();

  assert.deepEqual(plain(popup.run('pinnedBookmarkIds')), ['1', '2']);
  assert.equal(container.querySelectorAll('.pinned-bookmark-item').length, 2);
  assert.equal(popup.elements.get('pinnedSection').hidden, false);
  assert.ok(!getFirstUnpinButton().disabled, '保存失败后取消按钮应可重试');
  assert.match(popup.elements.get('errorToast').textContent, /固定状态未能保存/);
  assert.deepEqual(popup.opened, []);

  getFirstUnpinButton().click();
  await nextTurn();
  assert.equal(writes.length, 2);
  assert.deepEqual(plain(writes[1].snapshot.pinnedBookmarkIds), ['2']);
  writes[1].callback();
  await nextTurn();

  assert.deepEqual(plain(popup.run('pinnedBookmarkIds')), ['2']);
  assert.equal(container.querySelectorAll('.pinned-bookmark-item').length, 1);
  assert.match(container.querySelector('.pinned-bookmark-item').getAttribute('aria-label'), /Atlas B/);
  assert.deepEqual(popup.opened, []);
});

test('取消最后一张固定卡片后隐藏固定区，保留原始书签', async () => {
  const popup = createPopup();
  popup.run("pinnedBookmarkIds = ['1']; displayPinnedBookmarks(); updateView();");
  const container = popup.elements.get('pinnedBookmarks');
  assert.equal(popup.elements.get('pinnedSection').hidden, false);

  container.querySelector('.unpin-bookmark-button').focus();
  container.querySelector('.unpin-bookmark-button').click();
  await nextTurn();

  assert.deepEqual(plain(popup.run('pinnedBookmarkIds')), []);
  assert.equal(container.querySelectorAll('.pinned-bookmark-item').length, 0);
  assert.equal(popup.elements.get('pinnedSection').hidden, true);
  assert.equal(popup.run("itemsById.has('1')"), true);
  assert.equal(popup.run('allBookmarks.length'), 3);
  assert.deepEqual(popup.opened, []);
  assert.equal(popup.document.activeElement, popup.input);
});

test('取消固定按钮获得焦点时，书签快捷键不会作用于旧结果选中项', () => {
  const popup = createPopup();
  popup.run("pinnedBookmarkIds = ['1', '2']; displayPinnedBookmarks(); updateView(); setSelectedIndex(0);");
  const target = popup.elements.get('pinnedBookmarks').querySelectorAll('.unpin-bookmark-button')[1];
  target.focus();

  for (const [key, modifiers] of [
    ['Delete', {}],
    ['F2', {}],
    ['Enter', { ctrlKey: true }]
  ]) {
    target.dispatch('keydown', { key, ...modifiers });
    assert.equal(popup.elements.get('confirmDialog').hidden, true);
    assert.equal(popup.elements.get('bookmarkEditor').hidden, true);
    assert.deepEqual(popup.opened, []);
  }
  assert.deepEqual(plain(popup.run('pinnedBookmarkIds')), ['1', '2']);
});

test('旧刷新晚失败不会覆盖新刷新成功的数据和错误状态', async () => {
  const popup = createPopup();
  const chromeApi = popup.run('chrome');
  const callbacks = [];
  chromeApi.runtime = {};
  chromeApi.bookmarks.getTree = callback => callbacks.push(callback);

  const oldRefresh = popup.run('reloadBookmarkView({ preserveContext: true })');
  const newRefresh = popup.run('reloadBookmarkView({ preserveContext: true })');
  assert.equal(callbacks.length, 2);
  callbacks[1]([{ id: '0', children: [
    { id: 'fresh', title: 'Fresh bookmark', url: 'https://fresh.example/' }
  ] }]);
  assert.equal(await newRefresh, true);
  assert.deepEqual(rowIds(popup), ['fresh']);

  chromeApi.runtime.lastError = { message: 'old request failed' };
  callbacks[0]([]);
  delete chromeApi.runtime.lastError;
  assert.equal(await oldRefresh, false);
  assert.deepEqual(rowIds(popup), ['fresh']);
  assert.equal(popup.elements.get('loadErrorState').hidden, true);
  assert.equal(popup.elements.get('retryLoadButton').disabled, false);
});

for (const action of ['edit', 'delete']) {
  for (const failedStep of ['history', 'reload']) {
    test(`${action} 主操作成功但 ${failedStep} 失败时保留结果并明确反馈`, async () => {
      const popup = createPopup();
      const chromeApi = popup.run('chrome');
      let tree = plain(popup.run('allBookmarks'));
      let mutations = 0;
      chromeApi.runtime = {};
      chromeApi.bookmarks.update = (id, changes, callback) => {
        mutations++;
        tree = tree.map(item => item.id === id ? { ...item, ...changes } : item);
        callback(tree.find(item => item.id === id));
      };
      chromeApi.bookmarks.remove = (id, callback) => {
        mutations++;
        tree = tree.filter(item => item.id !== id);
        callback();
      };
      chromeApi.bookmarks.getTree = callback => {
        if (failedStep === 'reload') {
          chromeApi.runtime.lastError = { message: 'refresh unavailable' };
          callback([]);
          delete chromeApi.runtime.lastError;
        } else {
          callback([{ id: '0', children: tree }]);
        }
      };
      if (failedStep === 'history') {
        popup.run("saveHistory = () => Promise.reject(new Error('storage unavailable'));");
      }

      if (action === 'edit') {
        popup.run(`
          editingBookmarkId = '1';
          bookmarkEditor.hidden = false;
          bookmarkTitleInput.value = 'Updated title';
          bookmarkUrlInput.value = 'https://updated.example/';
        `);
        await popup.run('saveBookmarkChanges({ preventDefault() {} })');
        assert.equal(popup.run("itemsById.get('1').title"), 'Updated title');
        assert.equal(popup.run("itemsById.get('1').url"), 'https://updated.example/');
        assert.equal(popup.elements.get('bookmarkEditor').hidden, true);
      } else {
        popup.run(`
          requestConfirmation = () => Promise.resolve(true);
          recentBookmarks = [{ ...itemsById.get('1') }];
          pinnedBookmarkIds = ['1'];
          usageStats = { '1': { count: 2 } };
        `);
        await popup.run("deleteBookmarkWithConfirmation(itemsById.get('1'))");
        assert.equal(popup.run("itemsById.has('1')"), false);
        assert.equal(popup.run('recentBookmarks.length'), 0);
        assert.equal(popup.run('pinnedBookmarkIds.length'), 0);
        assert.equal(popup.run('Object.keys(usageStats).length'), 0);
      }

      assert.equal(mutations, 1);
      const message = popup.elements.get('errorToast').textContent;
      assert.match(message, action === 'edit' ? /书签已更新/ : /书签已删除/);
      assert.match(message, failedStep === 'history' ? /使用记录未能保存/ : /重试刷新列表/);
      assert.doesNotMatch(message, /保存失败|删除失败/);
      assert.equal(popup.elements.get('loadErrorState').hidden, failedStep !== 'reload');
    });
  }
}

test('网址范围投影保留大写域名及端口命中，隐藏查询和片段命中', () => {
  const popup = createPopup();
  const url = 'https://EXAMPLE.com:8443/Path?needle=secret#fragment';
  const display = popup.run(`getDisplayUrl(${JSON.stringify(url)})`);
  assert.equal(display, 'example.com:8443/Path');
  const ranges = ['EXAMPLE.com', '8443', 'Path', 'secret', 'fragment'].map(value => ({
    start: url.indexOf(value), end: url.indexOf(value) + value.length
  }));
  const projected = popup.run(`getDisplayUrlRanges(${JSON.stringify(url)}, ${JSON.stringify(display)}, ${JSON.stringify(ranges)})`);
  assert.deepEqual(plain(projected), [
    { start: 0, end: 11 },
    { start: 12, end: 16 },
    { start: 17, end: 21 }
  ]);

  for (const suffix of ['secret', 'fragment']) {
    const result = createPopup([{ id: 'url', title: 'Unrelated title', url }]);
    result.type(suffix);
    result.flush();
    assert.equal(result.rows().length, 1);
    assert.match(result.rows()[0].innerHTML, /网址匹配/);
    assert.doesNotMatch(result.rows()[0].innerHTML, /<mark[^>]*>(?:secret|fragment)<\/mark>/);
  }
});

test('网址移除默认端口后仍可投影域名和路径命中', () => {
  const popup = createPopup();
  const url = 'https://EXAMPLE.com:443/Path';
  const display = popup.run(`getDisplayUrl(${JSON.stringify(url)})`);
  assert.equal(display, 'example.com/Path');
  const ranges = ['EXAMPLE.com', 'Path'].map(value => ({
    start: url.indexOf(value), end: url.indexOf(value) + value.length
  }));
  assert.deepEqual(plain(popup.run(`getDisplayUrlRanges(${JSON.stringify(url)}, ${JSON.stringify(display)}, ${JSON.stringify(ranges)})`)), [
    { start: 0, end: 11 },
    { start: 12, end: 16 }
  ]);
});

test('斜杠后有空白的非法命令不会打开确认或清空历史', () => {
  const popup = createPopup();
  popup.run("searchHistory = ['Atlas'];");
  popup.type('/ clear');
  popup.key('Enter');
  assert.equal(popup.elements.get('confirmDialog').hidden, true);
  assert.equal(popup.run('searchHistory.length'), 1);
  assert.equal(popup.input.value, '/ clear');
  assert.match(popup.elements.get('errorToast').textContent, /未知命令/);
  assert.deepEqual(popup.opened, []);
});
