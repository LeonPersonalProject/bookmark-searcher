#!/usr/bin/env node

const { performance } = require('node:perf_hooks');
const { parseSearchQuery, prepareSearchItem, searchAndRank } = require('../search.js');
const { createBookmarkIndex } = require('../bookmarks.js');

const sizes = process.argv.length > 2
  ? process.argv.slice(2).map(Number)
  : [1000, 10000, 50000];

if (sizes.some(size => !Number.isInteger(size) || size < 1 || size > 100000)) {
  console.error('用法：node scripts/benchmark.cjs [书签数量…]，每个数量应在 1～100000 之间。');
  process.exitCode = 1;
} else {
  runBenchmark();
}

function createBookmarkTree(count) {
  const categories = ['开发工具', '设计灵感', '学习资料', '生活收藏'];
  const samples = [
    ['GitHub Actions 开发资料', 'docs.github.com/actions'],
    ['设计资源与配色指南', 'design.example.com/resources'],
    ['中文学习笔记', 'notes.example.com/study'],
    ['JavaScript Documentation', 'developer.example.com/javascript'],
    ['开发效率工具', 'tools.example.com/development'],
    ['阅读与生活收藏', 'reading.example.com/bookmarks']
  ];
  const root = { id: '0', title: '', children: [] };
  const folders = categories.map((title, index) => {
    const folder = { id: `category-${index}`, title, children: [] };
    root.children.push(folder);
    return folder;
  });

  let group;
  for (let index = 0; index < count; index++) {
    if (index % 100 === 0) {
      const groupIndex = Math.floor(index / 100);
      group = { id: `group-${groupIndex}`, title: `收藏 ${groupIndex + 1}`, children: [] };
      folders[groupIndex % folders.length].children.push(group);
    }
    const [title, hostAndPath] = samples[index % samples.length];
    group.children.push({
      id: `bookmark-${index}`,
      title: `${title} ${String(index).padStart(5, '0')}`,
      url: `https://${hostAndPath}/${index}`
    });
  }

  return [root];
}

function runBenchmark() {
  const queries = [
    { label: '多关键词', text: 'github actions' },
    { label: '中文', text: '开发' },
    { label: '拼音', text: 'kaifa' },
    { label: '首字母', text: 'kf' },
    { label: '域名', text: 'domain:github.com' },
    { label: '宽泛结果', text: '资料' },
    { label: '模糊', text: 'gthb', fuzzySearch: true }
  ];
  const runs = 5;
  console.log(`Node ${process.versions.node}，分别记录每个查询的首次耗时及随后 ${runs} 次耗时。`);
  console.log('仅生成合成数据；不读取浏览器书签、不写文件、不发网络请求。');
  console.log('预处理包含树遍历、路径/文件夹计数和搜索索引；不包含扩展启动、Chrome API、图标或 DOM 渲染。');

  for (const size of sizes) {
    const tree = createBookmarkTree(size);
    const start = performance.now();
    const { items } = createBookmarkIndex(tree, prepareSearchItem);
    const preparationMs = performance.now() - start;
    console.log(`\n${size.toLocaleString('en-US')} 个书签，${items.length - size} 个文件夹，首次索引 ${preparationMs.toFixed(2)} ms`);
    const rows = queries.map(({ label, text, fuzzySearch = false }) => {
      const query = parseSearchQuery(text);
      const options = { fuzzySearch, now: 0 };
      const firstStart = performance.now();
      searchAndRank(items, query, options);
      const firstMs = performance.now() - firstStart;
      const timings = [];
      let matches = 0;
      for (let run = 0; run < runs; run++) {
        const queryStart = performance.now();
        matches = searchAndRank(items, query, options).length;
        timings.push(performance.now() - queryStart);
      }
      timings.sort((first, second) => first - second);
      return {
        查询: label,
        输入: text,
        匹配数: matches,
        '首次 ms': firstMs.toFixed(2),
        '中位数 ms': timings[Math.floor(runs / 2)].toFixed(2),
        '最大值 ms': timings[runs - 1].toFixed(2)
      };
    });
    console.table(rows);
  }
}
