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
      for (const theme of ['classic', 'candy', 'ocean', 'matcha', 'sunset', 'mono']) {
        for (const dark of [false, true]) {
          await page.evaluate(({ theme, dark }) => {
            document.body.dataset.colorTheme = theme;
            document.body.classList.toggle('dark-mode', dark);
          }, { theme, dark });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > 400), false);
          assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > 600), false);
          if (theme === 'candy') {
            assert.equal(await page.locator('body').evaluate(element => getComputedStyle(element).backgroundImage), 'none');
            await page.screenshot({ animations: 'disabled', path: path.join(output, `candy-${dark ? 'dark' : 'light'}.png`) });
          }
        }
      }
      await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
      assert.equal(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), true);
      await page.screenshot({ path: path.join(output, 'forced-colors.png') });
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
    assert.deepEqual(errors, [], '浏览器不应出现未捕获的运行时错误');
    console.log(`浏览器检查全部通过。截图：${output}`);
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png') });
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
