const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createBookmarkIndex,
  getDescendantItems,
  getFallbackTitle,
  isPublicFaviconUrl
} = require('../bookmarks.js');
const { prepareSearchItem, searchAndRank } = require('../search.js');

function createTree() {
  return [{
    id: '0', title: '浏览器根容器', children: [
      {
        id: 'work', title: '工作', children: [
          { id: 'first', title: '目标文档', url: 'https://docs.github.com/first' },
          {
            id: 'nested', title: '  ', children: [
              { id: 'second', title: '深层目标', url: 'https://github.com/second' },
              { id: 'untitled', title: '', url: 'https://developer.mozilla.org/docs' }
            ]
          },
          { id: 'empty', title: '', children: [] }
        ]
      },
      { id: 'other', title: '生活', children: [{ id: 'third', title: '目标旅行', url: 'https://travel.example.com/' }] }
    ]
  }];
}

test('根容器只展开子项，不作为文件夹或路径的一部分', () => {
  const index = createBookmarkIndex(createTree());
  assert.equal(index.itemsById.has('0'), false);
  assert.equal(index.foldersById.has('0'), false);
  assert.deepEqual(index.itemsByParentId.get('__root__').map(item => item.id), ['work', 'other']);
  assert.equal(index.itemsById.get('work').parentId, null);
  assert.equal(index.itemsById.get('first').path, '工作');
  assert.equal(index.items.some(item => item.path.includes('浏览器根容器')), false);
});

test('无标题书签保留为可搜索项目，并用域名或网址路径作为名称', () => {
  const index = createBookmarkIndex(createTree(), prepareSearchItem);
  assert.equal(index.itemsById.get('untitled').title, 'developer.mozilla.org');
  assert.deepEqual(searchAndRank(index.items, 'mozilla').map(item => item.id), ['untitled']);
  assert.equal(getFallbackTitle('file:///documents/reference.pdf'), '/documents/reference.pdf');
  assert.equal(getFallbackTitle('mailto:hello@example.com'), 'hello@example.com');
  assert.equal(getFallbackTitle('invalid-url'), 'invalid-url');
  assert.equal(getFallbackTitle(''), '未命名书签');
});

test('无标题文件夹和空文件夹保留，深层路径沿用回退名称', () => {
  const index = createBookmarkIndex(createTree());
  assert.equal(index.foldersById.get('nested').title, '未命名文件夹');
  assert.equal(index.foldersById.get('empty').title, '未命名文件夹');
  assert.equal(index.foldersById.get('empty').childCount, 0);
  assert.equal(index.itemsById.get('second').path, '工作 / 未命名文件夹');
  assert.equal(index.itemsById.get('second').parentId, 'nested');
});

test('文件夹数量递归统计书签，包含深层子项但不计入文件夹本身', () => {
  const index = createBookmarkIndex(createTree());
  assert.equal(index.bookmarks.length, 4);
  assert.equal(index.foldersById.get('work').childCount, 3);
  assert.equal(index.foldersById.get('nested').childCount, 2);
  assert.equal(index.foldersById.get('other').childCount, 1);
  assert.equal(index.itemsById.get('work'), index.foldersById.get('work'));
  assert.equal(index.itemsByParentId.get('work')[0], index.itemsById.get('first'));
});

test('文件夹搜索域包括所有后代，排除自身和其他顶层目录', () => {
  const index = createBookmarkIndex(createTree(), prepareSearchItem);
  const descendants = getDescendantItems('work', index.itemsByParentId);
  assert.deepEqual(descendants.map(item => item.id).sort(), ['empty', 'first', 'nested', 'second', 'untitled']);
  assert.deepEqual(searchAndRank(descendants, '目标').map(item => item.id).sort(), ['first', 'second']);
  assert.deepEqual(searchAndRank(index.items, '目标').map(item => item.id).sort(), ['first', 'second', 'third']);
  assert.deepEqual(getDescendantItems('missing', index.itemsByParentId), []);
  assert.deepEqual(getDescendantItems('empty', index.itemsByParentId), []);
});

test('空树返回空索引，数字 ID 统一为字符串', () => {
  assert.equal(createBookmarkIndex().items.length, 0);
  assert.equal(createBookmarkIndex([]).bookmarks.length, 0);
  const index = createBookmarkIndex([{ id: 0, children: [{ id: 1, title: '目录', children: [{ id: 2, title: '资料', url: 'https://github.com' }] }] }]);
  assert.deepEqual(getDescendantItems(1, index.itemsByParentId).map(item => item.id), ['2']);
  assert.equal(index.itemsById.get('2').parentId, '1');
});

test('外部 HTTP(S) 域名允许在线图标，包括端口、子域、IDN 和标准尾点', () => {
  for (const url of [
    'https://github.com', 'http://docs.github.com:8080/a?b=c',
    'https://GITHUB.COM./', 'https://例子.中国/',
    'https://localhost.com/', 'https://locality.com/', 'https://testament.org/'
  ]) {
    assert.equal(isPublicFaviconUrl(url), true, url);
  }
});

test('本机、内网及保留后缀不向外部图标服务发出请求', () => {
  for (const host of [
    'localhost', 'printer', 'localhost.', 'localhost..',
    'dev.localhost', 'machine.local', 'vault.internal', 'wiki.intranet',
    'router.lan', 'nas.home', 'nas.home.arpa', 'app.corp', 'app.private', 'app.office', 'app.test', 'app.example',
    'app.invalid', 'hidden.onion', 'APP.LOCAL.', 'app.local..'
  ]) {
    assert.equal(isPublicFaviconUrl(`https://${host}/`), false, host);
  }
  for (const url of ['https://foo..com/', 'https://.foo.com/']) {
    assert.equal(isPublicFaviconUrl(url), false, url);
  }
});

test('IPv4、IPv6 及 IPv4 等价表示均使用离线图标', () => {
  for (const host of [
    '127.0.0.1', '192.168.1.2', '10.0.0.1', '172.16.0.1', '169.254.1.2',
    '8.8.8.8', '127.1', '2130706433', '0x7f000001', '017700000001',
    '[::1]', '[fe80::1]', '[2001:4860:4860::8888]', '[::ffff:127.0.0.1]'
  ]) {
    assert.equal(isPublicFaviconUrl(`http://${host}/`), false, host);
  }
});

test('非 HTTP(S) 协议及无法解析的网址不请求在线图标', () => {
  for (const url of [
    'ftp://github.com/a', 'file:///tmp/a.html', 'chrome://bookmarks',
    'chrome-extension://abc/index.html', 'mailto:hi@github.com',
    'data:text/plain,hi', 'javascript:alert(1)', 'wss://github.com',
    '', 'not a URL', null, undefined
  ]) {
    assert.equal(isPublicFaviconUrl(url), false, String(url));
  }
});
