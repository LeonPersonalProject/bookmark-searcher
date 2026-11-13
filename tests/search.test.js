const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fuzzyMatch,
  getMatchDetails,
  getUsageScore,
  matchesDomain,
  parseSearchQuery,
  prepareSearchItem,
  searchAndRank
} = require('../search.js');
const pinyin = require('../pinyin.js');

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

test('完整域名过滤只匹配本域和真实子域，拒绝相似域名', () => {
  const domains = ['github.com', 'docs.github.com', 'notgithub.com', 'github.com.example.net'];
  const domainItems = domains.map((domain, index) => prepareSearchItem({
    id: String(index), type: 'bookmark', title: domain, url: `https://${domain}/`, path: 'root'
  }));
  assert.deepEqual(searchAndRank(domainItems, 'domain:github.com').map(item => item.id).sort(), ['0', '1']);
  assert.equal(matchesDomain('DOCS.GITHUB.COM.', 'github.com'), true);
  assert.equal(matchesDomain('github.com', ''), false);
});

test('离线字表覆盖完整 Unihan kMandarin 数据，包括罕见字和扩展区汉字', () => {
  assert.equal(pinyin.characterCount, 44348);
  const index = pinyin.createIndex('齉龘𠀀');
  assert.equal(index.full, 'nangdahe');
  assert.equal(index.initials, 'ndh');
  assert.deepEqual(pinyin.findMatches(index, 'he')[0].ranges, [{ start: 2, end: 4 }]);
});

test('中文书签默认支持全拼、部分全拼和首字母，无须开启模糊搜索', () => {
  const chinese = prepareSearchItem({ id: 'cn', type: 'bookmark', title: '中文文档', url: 'https://example.com/', path: '开发工具' });
  for (const query of ['zhongwen', 'zhongw', 'zwwd', 'kfgj', 'kaifagongju']) {
    assert.deepEqual(searchAndRank([chinese], query).map(item => item.id), ['cn'], query);
  }
  assert.equal(searchAndRank([chinese], 'z').length, 0);
  assert.equal(searchAndRank([chinese], 'hongwen').length, 0);
});

test('常见多音词使用词组读音，兼容简繁体', () => {
  for (const [title, full, initials] of [
    ['重庆银行音乐长沙', 'chongqingyinhangyinyuechangsha', 'cqyhyycs'],
    ['重慶銀行音樂長沙', 'chongqingyinhangyinyuechangsha', 'cqyhyycs'],
    ['快乐成长了解厦门', 'kuailechengzhangliaojiexiamen', 'klczljxm'],
    ['数据调试角色收藏', 'shujutiaoshijueseshoucang', 'sjtsjssc']
  ]) {
    const index = pinyin.createIndex(title);
    assert.equal(index.full, full);
    assert.equal(index.initials, initials);
  }
});

test('拼音支持 ü/v/u: 和带调输入，支持中英文混合标题', () => {
  const mixed = prepareSearchItem({ id: 'mixed', type: 'bookmark', title: 'Vue女绿略', url: 'https://example.com/', path: 'root' });
  for (const query of ['vuenvlv', 'nv', 'nü', 'nǚ', 'nu:', 'lv', 'lve']) {
    assert.deepEqual(searchAndRank([mixed], query).map(item => item.id), ['mixed'], query);
  }
  const embedded = { id: 'embedded', title: '关ithub', url: 'https://example.com/', path: 'root', type: 'bookmark' };
  assert.deepEqual(searchAndRank([embedded], 'guanithub').map(item => item.id), ['embedded']);
});

test('原文精确标题优先于高频拼音和首字母匹配', () => {
  const rankedItems = [
    prepareSearchItem({ id: 'literal', type: 'bookmark', title: 'yinyue', url: 'https://literal.example/', path: 'root' }),
    prepareSearchItem({ id: 'pinyin', type: 'bookmark', title: '音乐', url: 'https://music.example/', path: 'root' })
  ];
  const results = searchAndRank(rankedItems, 'yinyue', { usageStats: { pinyin: { count: 999, lastUsed: Date.now() } } });
  assert.deepEqual(results.map(item => item.id), ['literal', 'pinyin']);
});

test('命中详情为多字段连续匹配返回原文 UTF-16 半开区间', () => {
  const item = { title: 'GitHub Documentation', url: 'https://docs.github.com/actions', path: '开发工具' };
  const details = getMatchDetails(item, 'github actions 开发');
  assert.equal(details.matched, true);
  assert.deepEqual(details.fields.title, [{ start: 0, end: 6 }]);
  assert.deepEqual(details.fields.path, [{ start: 0, end: 2 }]);
  assert.deepEqual(details.fields.url.map(range => item.url.slice(range.start, range.end)), ['github', 'actions']);
  assert.equal(details.primaryField, 'title');
});

test('NFKC、组合字符、大小写和重复命中仍映射到原始字符', () => {
  const item = { title: '  ＡＢＣ e\u0301 ﬃ ＡＢＣ  ', url: 'https://example.com/', path: '' };
  const details = getMatchDetails(item, 'abc é ffi');
  assert.equal(details.matched, true);
  assert.deepEqual(details.fields.title.map(range => item.title.slice(range.start, range.end)), ['ＡＢＣ', 'e\u0301', 'ﬃ', 'ＡＢＣ']);
  assert.equal(getMatchDetails({ title: 'ΟΣ', url: '', path: '' }, 'ος').matched, true);
  assert.deepEqual(getMatchDetails({ title: 'ΟΣ', url: '', path: '' }, 'ος').fields.title, [{ start: 0, end: 2 }]);
});

test('模糊匹配详情突出真实分散字符，严格模式不产生结果', () => {
  const item = { title: 'Git Hub', url: 'https://example.com/', path: 'root' };
  const details = getMatchDetails(item, 'gthb', { fuzzySearch: true });
  assert.equal(details.matched, true);
  assert.equal(details.primaryKind, 'fuzzy');
  assert.deepEqual(details.fields.title.map(range => item.title.slice(range.start, range.end)), ['G', 't', 'H', 'b']);
  assert.equal(getMatchDetails(item, 'gthb').matched, false);
});

test('拼音和首字母详情映射回对应中文片段及路径', () => {
  const item = { title: '📚重庆银行指南', url: 'https://example.com/', path: '工具 > 音乐资料' };
  const full = getMatchDetails(item, 'chongqing');
  assert.equal(full.primaryKind, 'pinyin');
  assert.deepEqual(full.fields.title, [{ start: 2, end: 4 }]);
  const initials = getMatchDetails(item, 'yhzn');
  assert.equal(initials.primaryKind, 'initials');
  assert.deepEqual(initials.fields.title, [{ start: 4, end: 8 }]);
  const path = getMatchDetails(item, 'yinyue');
  assert.equal(path.primaryField, 'path');
  assert.deepEqual(path.fields.path.map(range => item.path.slice(range.start, range.end)), ['音乐']);
});

test('域名过滤详情只标记 URL 主机而非路径中的相同文本', () => {
  const item = { title: 'Docs', url: 'https://user:pass@docs.github.com/github.com?q=github.com', path: 'root' };
  const details = getMatchDetails(item, 'domain:github.com');
  assert.equal(details.primaryField, 'domain');
  assert.deepEqual(details.fields.url.map(range => item.url.slice(range.start, range.end)), ['docs.github.com']);
  assert.equal(getMatchDetails(item, 'domain:example.com').matched, false);
});

test('空查询与无结果详情保持稳定格式，不返回无关高亮', () => {
  for (const query of ['', 'not-found']) {
    const details = getMatchDetails(items[0], query);
    assert.equal(details.matched, query === '');
    assert.deepEqual(details.fields, { title: [], url: [], path: [] });
    assert.deepEqual(details.matches, []);
    assert.equal(details.primaryKind, null);
  }
});

test('原地更新书签标题或路径后，拼音评分与高亮缓存同步失效', () => {
  const item = prepareSearchItem({ id: 'mutable', type: 'bookmark', title: '音乐', url: 'https://example.com/', path: '工具' });
  assert.equal(searchAndRank([item], 'yinyue').length, 1);
  assert.deepEqual(getMatchDetails(item, 'yinyue').fields.title, [{ start: 0, end: 2 }]);
  Object.assign(item, prepareSearchItem({ ...item, title: '银行', path: '开发' }));
  assert.equal(searchAndRank([item], 'yinyue').length, 0);
  assert.equal(getMatchDetails(item, 'yinyue').matched, false);
  assert.equal(searchAndRank([item], 'yinhang').length, 1);
  assert.deepEqual(getMatchDetails(item, 'yinhang').fields.title, [{ start: 0, end: 2 }]);
  assert.equal(searchAndRank([item], 'gongju').length, 0);
  assert.equal(searchAndRank([item], 'kaifa').length, 1);
  assert.deepEqual(getMatchDetails(item, 'kaifa').fields.path, [{ start: 0, end: 2 }]);
});
