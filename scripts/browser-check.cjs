#!/usr/bin/env node
// Optional development check: the extension itself has no runtime dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let chromium;
try {
  ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright'));
} catch {
  console.error('浏览器检查需要 Playwright。安装开发工具后运行，或用 PLAYWRIGHT_MODULE 指向现有 playwright 模块。');
  process.exit(1);
}

const project = path.resolve(__dirname, '..');
const output = process.env.BROWSER_CHECK_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'bookmark-browser-check-'));
fs.mkdirSync(output, { recursive: true });

function installFixture(failures = {}) {
  const initial = {
    settings: { themeMode: 'light', colorTheme: 'candy', showFavicon: false, fuzzySearch: false },
    searchHistory: ['设计', '开发'],
    recentBookmarks: [0, 1, 2, 3].map(index => ({
      id: `bulk-${index}`, title: `条目 ${String(index).padStart(3, '0')}`,
      url: `https://www.example.net/item-${index}`, path: '书签栏 / 大量书签', parentId: 'bulk'
    })),
    pinnedBookmarkIds: ['pinyin', 'domain', 'fallback'],
    usageStats: {}
  };
  const tree = [{
    id: '0', title: '', children: [{
      id: 'bar', title: '书签栏', children: [
        { id: 'design', title: '设计与开发', children: [
          { id: 'nested', title: '参考资料', children: [
            { id: 'pinyin', title: '开发文档', url: 'https://developer.mozilla.org/zh-CN/' }
          ] },
          { id: 'long', title: 'Figma — 团队产品设计资源、交互组件和界面规范资料库', url: 'https://figma.com/a-very-long-workspace-path' }
        ] },
        { id: 'bulk', title: '大量书签', children: Array.from({ length: 650 }, (_, index) => ({
          id: `bulk-${index}`, title: `条目 ${String(index).padStart(3, '0')}`, url: `https://www.example.net/item-${index}`
        })) },
        { id: 'deep-1', title: '一级目录', children: [
          { id: 'deep-2', title: '二级目录', children: [
            { id: 'deep-3', title: '三级目录', children: [
              { id: 'deep-4', title: '四级目录', children: [
                { id: 'deep-item', title: '深层资料', url: 'https://deep.example.com/' }
              ] }
            ] }
          ] }
        ] },
        { id: 'domain', title: '域名大小写与端口', url: 'https://EXAMPLE.com:8080/path?secret-token=yes' },
        { id: 'subdomain', title: '子域', url: 'https://docs.example.com/' },
        { id: 'bad-domain', title: '相似域名', url: 'https://notexample.com/' },
        { id: 'fallback', title: '', url: 'https://fallback.example.com/reference' },
        { id: 'internal', title: '内网', url: 'https://wiki.corp/' }
      ]
    }]
  }];
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem('bookmark-check-storage')); } catch {}
  const data = saved || initial;
  window.__fixture = { data, tree, failures, opened: [], writes: 0 };
  const runtime = {};
  const respond = (callback, value, error) => {
    queueMicrotask(() => {
      if (error) runtime.lastError = { message: error };
      try { callback?.(value); } finally { delete runtime.lastError; }
    });
  };
  const area = {
    get(keys, callback) {
      const value = Object.fromEntries(keys.filter(key => key in data).map(key => [key, data[key]]));
      respond(callback, value, window.__fixture.failures.get ? 'fixture storage read failure' : null);
    },
    set(value, callback) {
      if (window.__fixture.failures.set) return respond(callback, undefined, 'fixture storage write failure');
      Object.assign(data, structuredClone(value));
      window.__fixture.writes += 1;
      sessionStorage.setItem('bookmark-check-storage', JSON.stringify(data));
      respond(callback);
    }
  };
  const find = (id, nodes = tree) => {
    for (const node of nodes) {
      if (node.id === id) return node;
      const child = node.children && find(id, node.children);
      if (child) return child;
    }
  };
  const remove = (id, nodes = tree) => {
    const index = nodes.findIndex(node => node.id === id);
    if (index >= 0) return nodes.splice(index, 1);
    nodes.forEach(node => node.children && remove(id, node.children));
  };
  window.chrome = {
    runtime, storage: { local: area, sync: area },
    bookmarks: {
      getTree(callback) {
        respond(callback, structuredClone(tree), window.__fixture.failures.tree ? 'fixture bookmark read failure' : null);
      },
      update(id, changes, callback) {
        if (window.__fixture.failures.update) return respond(callback, undefined, 'fixture bookmark update failure');
        Object.assign(find(id), changes);
        respond(callback, structuredClone(find(id)));
      },
      remove(id, callback) {
        if (window.__fixture.failures.remove) return respond(callback, undefined, 'fixture bookmark removal failure');
        remove(id);
        respond(callback);
      }
    },
    tabs: {
      create(options, callback) { window.__fixture.opened.push(options); respond(callback); },
      update(options, callback) { window.__fixture.opened.push(options); respond(callback); }
    }
  };
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
    args: ['--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 400, height: 600 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(installFixture);
  const input = page.locator('#searchInput');
  const rows = page.locator('#results .bookmark-item');
  const check = async (name, action) => { await action(); console.log(`✓ ${name}`); };
  const search = async text => {
    await input.fill(text);
    await page.evaluate(() => flushPendingSearch());
  };
  const home = () => page.evaluate(() => navigateToFolder(null, { remember: false }));
  const menu = async id => {
    await page.locator(`.bookmark-row:has([data-item-id="${id}"]) .bookmark-action-trigger`).click();
    await page.locator('#bookmarkActions').waitFor({ state: 'visible' });
  };
  try {
    await page.goto(pathToFileURL(path.join(project, 'popup.html')).href);
    await page.locator('[data-item-id="bar"]').waitFor();
    await check('窄初始视口按内容自动定尺寸，六主题均保持 popup 固有宽度', async () => {
      const sizingPage = await browser.newPage({ viewport: { width: 120, height: 600 }, reducedMotion: 'reduce' });
      sizingPage.on('pageerror', error => errors.push(error.message));
      await sizingPage.addInitScript(installFixture);
      try {
        await sizingPage.goto(pathToFileURL(path.join(project, 'popup.html')).href);
        await sizingPage.locator('[data-item-id="bar"]').waitFor();
        for (const theme of ['classic', 'candy', 'ocean', 'matcha', 'sunset', 'mono']) {
          for (const dark of [false, true]) {
            await sizingPage.setViewportSize({ width: 120, height: 600 });
            await sizingPage.evaluate(({ theme, dark }) => {
              settings.colorTheme = theme;
              settings.themeMode = dark ? 'dark' : 'light';
              applyTheme();
            }, { theme, dark });
            // Model the host sizing from content, rather than supplying the expected width.
            const width = await sizingPage.locator('body').evaluate(element => element.getBoundingClientRect().width);
            assert.equal(width, 400, `${theme}/${dark}: narrow startup must request 400px`);
            await sizingPage.setViewportSize({ width, height: 600 });
            assert.equal(await sizingPage.locator('.container').evaluate(element => element.getBoundingClientRect().width), 400);
            assert.ok(await sizingPage.locator('[data-item-id="bar"] .item-copy').evaluate(element => element.getBoundingClientRect().width) > 200);
            assert.equal(await sizingPage.locator('.shortcut-footer').evaluate(element => element.scrollWidth > element.clientWidth), false);
          }
        }
      } finally {
        await sizingPage.close();
      }
    });
    await check('启动、空标题备用名称、最近与固定列表默认收起', async () => {
      assert.equal(await page.locator('#pinnedBookmarks .pinned-bookmark-item').count(), 2);
      assert.equal(await page.locator('#recentBookmarks button').count(), 2);
      await page.locator('#toggleRecentButton').click();
      assert.equal(await page.locator('#recentBookmarks button').count(), 4);
      await page.locator('#togglePinnedButton').click();
      assert.equal(await page.locator('#pinnedBookmarks .pinned-bookmark-item').count(), 3);
      await search('fallback.example');
      assert.match(await rows.first().textContent(), /fallback\.example/);
    });

    await check('命令参数提示、Tab 补全、Enter 执行', async () => {
      await search('/theme');
      await input.press('Enter');
      assert.equal(await rows.count(), 3);
      await input.press('ArrowDown');
      await input.press('Tab');
      assert.equal(await input.inputValue(), '/theme light');
      await input.press('Enter');
      assert.equal(await input.inputValue(), '');
      assert.equal(await page.evaluate(() => __fixture.data.settings.themeMode), 'light');
    });

    await check('/clear 首次 Enter 只打开确认，默认清空，Esc/Tab/第二次 Enter 正确', async () => {
      await search('/clear');
      await input.press('Enter');
      await page.locator('#confirmDialog').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => document.activeElement.id), 'confirmActionButton');
      assert.equal(await page.evaluate(() => __fixture.data.searchHistory.length), 2);
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'confirmCancelButton');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'confirmActionButton');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => __fixture.data.searchHistory.length), 2);
      await search('/clear');
      await input.press('Enter');
      await page.keyboard.press('Enter');
      await page.locator('#confirmDialog').waitFor({ state: 'hidden' });
      assert.deepEqual(await page.evaluate(() => __fixture.data.searchHistory), []);
    });

    await check('当前文件夹递归搜索、全库范围切换与拼音高亮', async () => {
      await page.evaluate(() => navigateToFolder('design'));
      await search('kaifa');
      assert.equal(await page.locator('[data-item-id="pinyin"]').count(), 1);
      assert.match(await page.locator('[data-item-id="pinyin"] .bookmark-title mark').textContent(), /开发/);
      assert.match(await page.locator('[data-item-id="pinyin"]').textContent(), /拼音匹配/);
      await search('域名');
      assert.equal(await rows.count(), 0);
      await page.locator('#emptyScopeButton').click();
      assert.equal(await page.locator('[data-item-id="domain"]').count(), 1);
      assert.equal(await page.locator('#searchScopeButton').textContent(), '全部书签');
      await page.locator('#searchScopeButton').click();
      assert.equal(await rows.count(), 0);
    });

    await check('域名边界过滤、大小写端口高亮与隐藏网址命中说明', async () => {
      await home();
      await search('domain:example.com');
      const ids = await rows.evaluateAll(elements => elements.map(element => element.dataset.itemId));
      assert.ok(ids.includes('domain'));
      assert.ok(ids.includes('subdomain'));
      assert.ok(!ids.includes('bad-domain'));
      await search('EXAMPLE.com:8080');
      assert.match(await page.locator('[data-item-id="domain"] .bookmark-domain mark').textContent(), /example\.com:8080/i);
      await search('secret-token');
      assert.match(await rows.first().textContent(), /网址匹配/);
    });

    await check('分批追加 300→600→650，节点、选择与滚动不跳动', async () => {
      await page.evaluate(() => navigateToFolder('bulk'));
      assert.equal(await rows.count(), 300);
      await page.evaluate(() => {
        window.__firstRow = resultsContainer.firstElementChild;
        setSelectedIndex(25);
        contentArea.scrollTop = 560;
        window.__previousScroll = contentArea.scrollTop;
        resultsMore.querySelector('button').click();
      });
      assert.equal(await rows.count(), 600);
      assert.equal(await page.evaluate(() => resultsContainer.firstElementChild === __firstRow), true);
      assert.equal(await page.evaluate(() => selectedIndex), 25);
      assert.equal(await page.evaluate(() => contentArea.scrollTop), await page.evaluate(() => __previousScroll));
      await page.evaluate(() => resultsMore.querySelector('button').click());
      assert.equal(await rows.count(), 650);
      assert.equal(await page.locator('#resultsMore').isVisible(), false);
    });

    await check('从搜索结果进入目录再返回，恢复查询、选择和滚动', async () => {
      await home();
      await search('目录');
      await page.evaluate(() => {
        const index = [...resultsContainer.querySelectorAll('.bookmark-item')].findIndex(element => element.dataset.itemId === 'deep-4');
        setSelectedIndex(index);
        contentArea.scrollTop = 80;
        window.__navigationState = captureViewState();
      });
      await input.press('Enter');
      assert.equal(await input.inputValue(), '');
      await input.press('ArrowLeft');
      assert.equal(await input.inputValue(), '目录');
      assert.equal(await page.evaluate(() => getSelectedResultContext().item.id), 'deep-4');
      assert.equal(await page.evaluate(() => contentArea.scrollTop), await page.evaluate(() => __navigationState.scrollTop));
    });

    await check('固定/取消固定持久化，复制网址与定位第 600 项后的书签', async () => {
      await home();
      await search('条目 649');
      await menu('bulk-649');
      await page.locator('[data-action="pin"]').click();
      await page.waitForFunction(() => __fixture.data.pinnedBookmarkIds.includes('bulk-649'));
      await page.reload();
      await page.locator('[data-item-id="bar"]').waitFor();
      assert.ok(await page.evaluate(() => pinnedBookmarkIds.includes('bulk-649')));
      await search('条目 649');
      await menu('bulk-649');
      await page.locator('[data-action="copy-url"]').click();
      await page.waitForFunction(() => !errorToast.hidden && /已复制/.test(errorToast.textContent));
      await menu('bulk-649');
      await page.locator('[data-action="reveal-folder"]').click();
      assert.equal(await rows.count(), 650);
      assert.equal(await page.evaluate(() => getSelectedResultContext().item.id), 'bulk-649');
      await input.press('Shift+F10');
      await page.locator('[data-action="pin"]').click();
      assert.ok(!(await page.evaluate(() => __fixture.data.pinnedBookmarkIds)).includes('bulk-649'));
    });

    await check('固定卡片直接取消、失败可重试、键盘连续取消及重开持久化', async () => {
      await home();
      const originalIds = await page.evaluate(() => [...pinnedBookmarkIds]);
      const openedCount = await page.evaluate(() => __fixture.opened.length);
      const unpin = id => page.locator(`.pinned-bookmark-row[data-bookmark-id="${id}"] .unpin-bookmark-button`);
      await unpin('pinyin').click();
      await page.waitForFunction(() => !__fixture.data.pinnedBookmarkIds.includes('pinyin'));
      assert.equal(await page.locator('.pinned-bookmark-row[data-bookmark-id="pinyin"]').count(), 0);
      assert.equal(await page.evaluate(() => document.activeElement.closest('.pinned-bookmark-row')?.dataset.bookmarkId), 'domain');
      assert.equal(await page.evaluate(() => __fixture.opened.length), openedCount);
      await page.reload();
      await page.locator('[data-item-id="bar"]').waitFor();
      assert.ok(!(await page.evaluate(() => pinnedBookmarkIds)).includes('pinyin'));

      await page.evaluate(() => { __fixture.failures.set = true; });
      await unpin('domain').click();
      await page.waitForFunction(() => /固定状态未能保存/.test(errorToast.textContent));
      assert.ok(await page.evaluate(() => pinnedBookmarkIds.includes('domain')));
      assert.equal(await unpin('domain').isEnabled(), true);
      assert.equal(await page.evaluate(() => document.activeElement.classList.contains('unpin-bookmark-button')), true);
      await page.evaluate(() => { __fixture.failures.set = false; });
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !pinnedBookmarkIds.includes('domain') && !pinWriteBusy);
      assert.equal(await page.evaluate(() => document.activeElement.closest('.pinned-bookmark-row')?.dataset.bookmarkId), 'fallback');

      await page.keyboard.press('Enter');
      await page.locator('#pinnedSection').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => document.activeElement.id), 'searchInput');
      assert.equal(await page.evaluate(() => allBookmarks.some(item => item.id === 'fallback')), true);
      assert.equal(await page.evaluate(() => __fixture.opened.length), 0);
      await page.reload();
      await page.locator('[data-item-id="bar"]').waitFor();
      assert.deepEqual(await page.evaluate(() => pinnedBookmarkIds), []);
      await page.evaluate(async ids => {
        pinnedBookmarkIds = ids;
        await saveHistory();
        displayPinnedBookmarks();
        updateView({ preserveContext: true });
      }, originalIds);
    });

    await check('深层面包屑折叠、菜单与快捷键帮助可键盘操作', async () => {
      await page.evaluate(() => navigateToFolder('deep-4'));
      const overflow = page.locator('.breadcrumb-overflow');
      assert.equal(await overflow.count(), 1);
      await overflow.locator('summary').click();
      assert.equal(await overflow.getAttribute('open'), '');
      await page.keyboard.press('Escape');
      assert.equal(await overflow.getAttribute('open'), null);
      await page.locator('#shortcutHelpButton').click();
      assert.equal(await page.evaluate(() => document.activeElement.id), 'shortcutHelpBody');
      await page.keyboard.press('PageDown');
      await page.waitForFunction(() => shortcutHelpBody.scrollTop > 0);
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'closeShortcutHelp');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'shortcutHelpBody');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#shortcutHelp').isVisible(), false);
    });

    await check('刷新失败保留列表，重试恢复，辅助写入失败不掩盖编辑成功', async () => {
      await page.evaluate(async () => { __fixture.failures.tree = true; await refreshBookmarks(); });
      assert.equal(await page.locator('#loadErrorState').isVisible(), true);
      assert.equal(await rows.count(), 1);
      await page.evaluate(() => { __fixture.failures.tree = false; });
      await page.locator('#retryLoadButton').click();
      await page.locator('#loadErrorState').waitFor({ state: 'hidden' });
      await home();
      await search('域名');
      await input.press('F2');
      await page.locator('#bookmarkTitleInput').fill('域名编辑成功');
      await page.evaluate(() => { __fixture.failures.set = true; });
      await page.locator('#saveBookmarkEditor').click();
      await page.locator('#bookmarkEditor').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => /书签已更新/.test(errorToast.textContent));
      assert.match(await rows.first().textContent(), /域名编辑成功/);
      assert.match(await page.locator('#errorToast').textContent(), /使用记录未能保存/);
      await page.evaluate(() => { __fixture.failures.set = false; });
    });

    await check('设置保持搜索上下文、Tab 焦点循环与嵌套确认恢复', async () => {
      await home();
      await search('开发');
      await page.locator('#settingsButton').click();
      await page.locator('#settingsPanel').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => document.activeElement.id), 'closeSettings');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'clearHistoryButton');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'closeSettings');
      await page.locator('#clearHistoryButton').click();
      assert.equal(await page.evaluate(() => document.activeElement.id), 'confirmCancelButton');
      assert.equal(await page.evaluate(() => settingsPanel.inert), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'clearHistoryButton');
      assert.equal(await page.evaluate(() => settingsPanel.inert), false);
      await page.keyboard.press('Escape');
      await page.locator('#settingsPanel').waitFor({ state: 'hidden' });
      assert.equal(await input.inputValue(), '开发');
      assert.equal(await page.locator('[data-item-id="pinyin"]').count(), 1);
    });

    await check('12 套明暗主题不溢出、糖果色纯色、减少动画与强制色模式', async () => {
      await home();
      await page.evaluate(() => {
        settings.recentExpanded = false;
        settings.pinnedExpanded = false;
        displayRecentBookmarks();
        displayPinnedBookmarks();
        clearTimeout(toastTimeout);
        errorToast.hidden = true;
        searchInput.blur();
        hideSearchHistory();
      });
      await page.evaluate(() => navigateToFolder('bar', { remember: false }));
      const settingsSilhouettes = new Set();
      for (const theme of ['classic', 'candy', 'ocean', 'matcha', 'sunset', 'mono']) {
        for (const dark of [false, true]) {
          await page.evaluate(({ theme, dark }) => {
            settings.colorTheme = theme;
            settings.themeMode = dark ? 'dark' : 'light';
            applyTheme();
          }, { theme, dark });
          await page.waitForTimeout(250);
          settingsSilhouettes.add(await page.locator('#settingsButton svg').innerHTML());
          assert.equal(await page.locator('#results svg:not([data-icon])').count(), 0);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > 400), false);
          assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > 600), false);
          if (theme === 'candy') {
            assert.equal(await page.locator('body').evaluate(element => getComputedStyle(element).backgroundImage), 'none');
          }
          if (theme === 'ocean') {
            await page.evaluate(() => setSelectedIndex(0));
            await input.focus();
            await page.waitForTimeout(250);
            const glow = await page.evaluate(() => {
              const style = selector => getComputedStyle(document.querySelector(selector));
              return {
                title: style('.brand-name').textShadow,
                search: style('.search-box').boxShadow,
                clip: style('.search-box').clipPath,
                icon: style('.search-icon').filter,
                selected: style('.bookmark-item.selected').boxShadow,
                text: style('.bookmark-item.selected .bookmark-title').textShadow,
                favicon: document.querySelector('.bookmark-favicon') ? style('.bookmark-favicon').filter : 'none',
                brandOverflow: style('.brand-mark').overflow
              };
            });
            assert.equal(glow.title, 'none');
            assert.notEqual(glow.search, 'none');
            assert.doesNotMatch(glow.search, /rgba\(0, 0, 0, 0\)/);
            assert.equal(glow.clip, 'none');
            assert.match(glow.icon, /drop-shadow/);
            assert.match(glow.selected, /inset/);
            assert.equal(glow.text, 'none');
            assert.equal(glow.favicon, 'none');
            assert.equal(glow.brandOverflow, 'hidden');
            console.log(`Ocean ${dark ? 'dark' : 'light'} computed glow: ${JSON.stringify(glow)}`);
            await page.evaluate(() => hideSearchHistory());
            await input.blur();
          }
          const names = { classic: '像素街机', ocean: '赛博朋克', matcha: '黑客终端', mono: '瑞士极简', sunset: '复古纸张', candy: '软糖乐园' };
          await page.screenshot({ animations: 'disabled', path: path.join(output, `${names[theme]}-${dark ? 'dark' : 'light'}.png`) });
          await page.locator('#settingsButton').click();
          await page.screenshot({ animations: 'disabled', path: path.join(output, `${names[theme]}-${dark ? 'dark' : 'light'}-settings.png`) });
          await page.keyboard.press('Escape');
          await page.locator('#settingsPanel').waitFor({ state: 'hidden' });
        }
      }
      assert.equal(settingsSilhouettes.size, 6);
      await page.locator('#settingsButton').click();
      assert.equal(await page.locator('.palette-preview').count(), 6);
      await page.screenshot({ path: path.join(output, '六风格选择器.png') });
      await page.keyboard.press('Escape');
      await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
      assert.equal(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), true);
      await page.screenshot({ path: path.join(output, 'forced-colors.png') });
    });

    await check('真实计算样式：六主题明暗文字、占位符与交叉状态对比度', async () => {
      await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'reduce' });
      const failures = [];
      let samples = 0;
      let minimum = 21;
      let minimumText = 21;
      const audit = async (theme, state, root) => {
        await page.waitForTimeout(250);
        const readings = await page.evaluate(root => {
          const canvas = document.createElement('canvas').getContext('2d');
          const rgba = value => {
            canvas.clearRect(0, 0, 1, 1);
            canvas.fillStyle = value;
            canvas.fillRect(0, 0, 1, 1);
            return [...canvas.getImageData(0, 0, 1, 1).data].map((v, i) => i === 3 ? v / 255 : v);
          };
          const over = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3])).concat(1);
          const luminance = color => color.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
          const background = element => {
            const chain = [];
            for (let node = element; node; node = node.parentElement) chain.unshift(node);
            return chain.reduce((bg, node) => over(rgba(getComputedStyle(node).backgroundColor), bg), [255, 255, 255, 1]);
          };
          const readings = [];
          const inspect = (element, pseudo = null, threshold = 4.5) => {
            if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || element.closest('[hidden], .visually-hidden, .palette-preview')) return;
            const style = getComputedStyle(element, pseudo);
            const bg = background(element);
            let fg = rgba(style.color);
            fg[3] *= Number(style.opacity);
            fg = over(fg, bg);
            const a = luminance(fg), b = luminance(bg);
            readings.push({ selector: element.id || element.className.baseVal || element.className || element.tagName, pseudo, foreground: style.color, background: bg, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), threshold });
          };
          for (const element of document.querySelector(root).querySelectorAll('*')) {
            if ([...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) inspect(element);
            if (element.matches('input:not([type=radio]):not([type=checkbox])')) {
              inspect(element);
              if (element.placeholder) inspect(element, '::placeholder');
            }
            if (element.matches('svg[data-icon]')) inspect(element, null, 3);
          }
          return readings;
        }, root);
        samples += readings.length;
        for (const reading of readings) {
          minimum = Math.min(minimum, reading.ratio);
          if (reading.threshold === 4.5) minimumText = Math.min(minimumText, reading.ratio);
          if (reading.ratio < reading.threshold) failures.push({ theme, state, ...reading });
        }
      };
      for (const theme of ['classic', 'candy', 'ocean', 'matcha', 'sunset', 'mono']) {
        for (const mode of ['dark', 'light']) {
          const name = `${theme}/${mode}`;
          await page.evaluate(({ theme, mode }) => {
            settings.colorTheme = theme; settings.themeMode = mode; applyTheme();
            searchHistory = ['开发', '设计'];
            closeSettingsPanel(); closeShortcutHelpDialog(); closeBookmarkEditorDialog(); closeConfirmation(false);
            navigateToFolder(null, { remember: false });
          }, { theme, mode });
          await page.mouse.move(0, 0);
          await audit(name, 'home', '.container');
          await input.focus();
          await page.evaluate(() => showSearchHistory());
          await audit(name, 'history', '#searchHistory');
          await page.evaluate(() => setHistorySelectedIndex(0));
          await page.locator('.history-item').first().hover({ force: true });
          await audit(name, 'history selected+hover', '#searchHistory');
          await search('开发');
          for (const state of ['normal', 'hover', 'selected+hover+focus']) {
            await page.evaluate(state => setSelectedIndex(state === 'selected+hover+focus' ? 0 : -1), state);
            if (state !== 'normal') await rows.first().hover();
            if (state.includes('focus')) await rows.first().focus();
            await audit(name, `result ${state}`, '.container');
          }
          await search('example');
          await audit(name, 'domain highlight', '#results');
          await search('参考');
          await audit(name, 'path highlight', '#results');
          await search('/');
          await audit(name, 'commands', '.container');
          await search('域名');
          await menu('domain');
          await audit(name, 'menu', '#bookmarkActions');
          for (const button of await page.locator('#bookmarkActions button').all()) {
            await button.hover(); await button.focus();
            await audit(name, 'menu hover+focus', '#bookmarkActions');
          }
          await page.keyboard.press('Escape');
          await page.evaluate(() => openBookmarkEditor(itemsById.get('domain')));
          await audit(name, 'editor', '#bookmarkEditor');
          await page.locator('#saveBookmarkEditor').hover();
          await audit(name, 'editor save hover', '#bookmarkEditor');
          await page.evaluate(() => closeBookmarkEditorDialog());
          await page.locator('#settingsButton').click();
          await audit(name, 'settings', '#settingsPanel');
          for (const item of await page.locator('.setting-item, .palette-option, .theme-option, #clearHistoryButton').all()) {
            await item.hover();
            const control = item.locator('input');
            if (await control.count()) await control.focus(); else await item.focus();
            await audit(name, 'settings hover+focus', '#settingsPanel');
          }
          await page.locator('#clearHistoryButton').click();
          await audit(name, 'confirmation', '#confirmDialog');
          await page.locator('#confirmActionButton').hover();
          await audit(name, 'confirmation hover', '#confirmDialog');
          await page.keyboard.press('Escape');
          await page.keyboard.press('Escape');
          await page.locator('#shortcutHelpButton').click();
          await audit(name, 'help', '#shortcutHelp');
          await page.keyboard.press('Escape');
          await search('no-such-bookmark');
          await audit(name, 'empty', '.container');
          await page.evaluate(() => { showError('Contrast error'); });
          await audit(name, 'error toast', '.container');
          await page.evaluate(() => { showError('Contrast success', 'success'); });
          await audit(name, 'success toast', '.container');
        }
      }
      console.log(`Computed contrast: ${samples} samples; minimum ${minimum.toFixed(3)}:1; text minimum ${minimumText.toFixed(3)}:1; failures ${failures.length}`);
      console.log(JSON.stringify(failures, null, 2));
      assert.deepEqual(failures, [], 'Actual rendered text must reach 4.5:1 and icons 3:1');
      await home();
    });

    await check('首次书签读取失败可重试，偏好读取失败不阻断启动', async () => {
      const failedPage = await browser.newPage({ viewport: { width: 400, height: 600 } });
      failedPage.on('pageerror', error => errors.push(error.message));
      await failedPage.addInitScript(installFixture, { tree: true, get: true });
      await failedPage.goto(pathToFileURL(path.join(project, 'popup.html')).href);
      await failedPage.locator('#loadErrorState').waitFor({ state: 'visible' });
      await failedPage.evaluate(() => { __fixture.failures.tree = false; });
      await failedPage.locator('#retryLoadButton').click();
      await failedPage.locator('[data-item-id="bar"]').waitFor();
      await failedPage.close();
    });
    await check('参考内容夹具：六主题明暗弹窗及设置实际截图', async () => {
      const visualPage = await browser.newPage({ viewport: { width: 400, height: 600 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      await visualPage.addInitScript(installFixture);
      await visualPage.goto(pathToFileURL(path.join(project, 'popup.html')).href);
      await visualPage.locator('[data-item-id="bar"]').waitFor();
      await visualPage.evaluate(async () => {
        const nodes = [
          { id: 'tools', title: '开发工具', children: [{ id: 'mdn', title: 'MDN Web Docs', url: 'https://developer.mozilla.org/' }] },
          { id: 'resources', title: '设计资源', children: [{ id: 'figma', title: 'Figma', url: 'https://figma.com/' }] },
          { id: 'github', title: 'GitHub', url: 'https://github.com/' },
          { id: 'notion', title: 'Notion', url: 'https://notion.so/' },
          { id: 'dribbble', title: 'Dribbble', url: 'https://dribbble.com/' }
        ];
        __fixture.tree.splice(0, __fixture.tree.length, { id: '0', title: '', children: nodes });
        pinnedBookmarkIds = ['github', 'figma'];
        recentBookmarks = [{ id: 'mdn', title: 'MDN Web Docs', url: 'https://developer.mozilla.org/', parentId: 'tools', path: '开发工具' }];
        settings.showFavicon = false;
        await refreshBookmarks();
        displayPinnedBookmarks(); displayRecentBookmarks();
        navigateToFolder(null, { remember: false });
        clearTimeout(toastTimeout); errorToast.hidden = true; searchInput.blur(); hideSearchHistory();
      });
      for (const theme of ['classic', 'ocean', 'matcha', 'mono', 'sunset', 'candy']) {
        for (const mode of ['light', 'dark']) {
          await visualPage.evaluate(({ theme, mode }) => { settings.colorTheme = theme; settings.themeMode = mode; applyTheme(); }, { theme, mode });
          await visualPage.screenshot({ animations: 'disabled', path: path.join(output, `reference-${theme}-${mode}-popup.png`) });
          await visualPage.locator('#settingsButton').click();
          await visualPage.screenshot({ animations: 'disabled', path: path.join(output, `reference-${theme}-${mode}-settings.png`) });
          await visualPage.keyboard.press('Escape');
          await visualPage.locator('#settingsPanel').waitFor({ state: 'hidden' });
        }
      }
      await visualPage.close();
    });
    assert.deepEqual(errors, [], '浏览器不应出现未捕获的运行时错误');
    console.log(`浏览器检查全部通过。截图：${output}`);
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png') });
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
