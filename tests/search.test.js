const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fuzzyMatch,
  getUsageScore,
  parseSearchQuery,
  prepareSearchItem,
  searchAndRank
} = require('../search.js');

const items = [
  prepareSearchItem({
    id: '1',
    type: 'bookmark',
    title: 'GitHub Documentation',
    url: 'https://docs.github.com/actions',
    path: '开发工具'
  }),
  prepareSearchItem({
    id: '2',
    type: 'bookmark',
    title: 'GitLab CI',
    url: 'https://docs.gitlab.com/ci',
    path: '开发工具'
  }),
  prepareSearchItem({
    id: '3',
    type: 'bookmark',
    title: '设计资料',
    url: 'https://design.example.com/candy',
    path: '灵感收藏'
  })
];

test('解析多关键词、短语和域名过滤器', () => {
  assert.deepEqual(parseSearchQuery('  "GitHub Docs" actions domain:www.github.com  '), {
    text: '"GitHub Docs" actions domain:www.github.com',
    terms: ['github docs', 'actions'],
    domains: ['github.com'],
    isEmpty: false
  });
});

test('多关键词采用 AND 匹配，可跨标题、网址和路径', () => {
  const results = searchAndRank(items, 'github 开发');
  assert.deepEqual(results.map(item => item.id), ['1']);
});

test('domain: 只保留对应域名', () => {
  const results = searchAndRank(items, 'docs domain:gitlab.com');
  assert.deepEqual(results.map(item => item.id), ['2']);
});

test('模糊搜索关闭时不接受非连续关键词', () => {
  assert.equal(searchAndRank(items, 'gthbdc').length, 0);
  assert.deepEqual(
    searchAndRank(items, 'gthbdc', { fuzzySearch: true }).map(item => item.id),
    ['1']
  );
});

test('连续字符获得更高模糊匹配分数', () => {
  assert.ok(fuzzyMatch('github documentation', 'github') > fuzzyMatch('git hub', 'github'));
});

test('模糊匹配公开 API 仍会规范化输入文本', () => {
  assert.equal(
    fuzzyMatch('  ＧＩＴＨＵＢ 文档  ', 'ＧＩＴ'),
    fuzzyMatch('github 文档', 'git')
  );
});

test('完全标题匹配优先于高频但较弱的 URL 匹配', () => {
  const rankedItems = [
    prepareSearchItem({
      id: 'exact',
      type: 'bookmark',
      title: 'GitHub',
      url: 'https://example.com',
      path: '根目录'
    }),
    prepareSearchItem({
      id: 'frequent',
      type: 'bookmark',
      title: '代码托管',
      url: 'https://github.com',
      path: '根目录'
    })
  ];
  const results = searchAndRank(rankedItems, 'github', {
    usageStats: {
      frequent: { count: 999, lastUsed: Date.now() }
    }
  });

  assert.deepEqual(results.map(item => item.id), ['exact', 'frequent']);
});

test('损坏的使用记录不会影响搜索排序', () => {
  assert.equal(getUsageScore(null), 0);
  assert.doesNotThrow(() => searchAndRank(items, 'github', {
    usageStats: { 1: null }
  }));
});
