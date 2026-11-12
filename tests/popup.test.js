const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const searchCore = require('../search.js');
const keyboardCore = require('../keyboard.js');

const popupSource = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');

// Exercise the popup's real rendering, delegated clicks and keyboard handlers.
// This small DOM records selection and focus; it does not emulate CSS or layout.
function createPopup(items = [
  { id: '1', title: 'Atlas A', url: 'https://atlas-a.example/' },
  { id: '2', title: 'Atlas B', url: 'https://atlas-b.example/' },
  { id: '3', title: 'Beta', url: 'https://beta.example/' }
]) {
  let document;
  class Element {
    constructor(tagName = 'div') {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.parentElement = null;
      this.attributes = new Map();
      this.dataset = {};
      this.listeners = new Map();
      this.className = '';
      this.value = '';
      this.hidden = true;
      this.clientHeight = 590;
      this.style = {};
      this.classList = {
        contains: name => this.className.split(/\s+/).includes(name),
        add: name => {
          if (!this.classList.contains(name)) this.className += ` ${name}`;
        },
        remove: name => {
          this.className = this.className.split(/\s+/).filter(item => item !== name).join(' ');
        },
        toggle: (name, force) => {
          const add = force === undefined ? !this.classList.contains(name) : force;
          this.classList[add ? 'add' : 'remove'](name);
        }
      };
    }

    set innerHTML(value) {
      this.children.forEach(child => { child.parentElement = null; });
      this.children = [];
      this.markup = value;
    }

    get innerHTML() {
      return this.markup || String(this.textContent || '').replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    }

    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(callback);
    }

    appendChild(child) {
      if (child.tagName === '#FRAGMENT') {
        [...child.children].forEach(item => this.appendChild(item));
        child.children = [];
      } else {
        child.parentElement = this;
        this.children.push(child);
      }
      return child;
    }

    contains(target) {
      return target === this || this.children.some(child => child.contains(target));
    }

    matches(selector) {
      const excluded = selector.match(/:not\(([^)]+)\)/)?.[1];
      if (excluded && this.matches(excluded)) return false;
      const basic = selector.replace(/:not\([^)]+\)/g, '');
      const tag = basic.match(/^[a-z]+/i)?.[0];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      return [...basic.matchAll(/\.([\w-]+)/g)]
        .every(match => this.classList.contains(match[1]));
    }

    querySelectorAll(selector) {
      return this.children.flatMap(child => [
        ...(child.matches(selector) ? [child] : []),
        ...child.querySelectorAll(selector)
      ]);
    }

    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) {
      return this.matches(selector) ? this : this.parentElement?.closest(selector) || null;
    }

    dispatch(type, properties = {}) {
      const event = {
        type, target: this, key: '', ctrlKey: false, metaKey: false,
        shiftKey: false, altKey: false, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        ...properties
      };
      for (let current = this; current; current = current.parentElement) {
        event.currentTarget = current;
        (current.listeners.get(type) || []).forEach(callback => callback(event));
        if (event.propagationStopped) break;
      }
      return event;
    }

    click() { return this.dispatch('click'); }
    focus() {
      this.focusCalls = (this.focusCalls || 0) + 1;
      if (document.activeElement !== this) {
        document.activeElement = this;
        this.dispatch('focus');
      }
    }
    select() {}
    scrollIntoView() {}
  }

  document = new Element('#document');
  const elements = new Map();
  for (const [, id] of popupHtml.matchAll(/\bid="([^"]+)"/g)) {
    const element = new Element(id === 'searchInput' ? 'input' : 'div');
    element.id = id;
    elements.set(id, element);
    document.appendChild(element);
  }
  document.getElementById = id => elements.get(id);
  document.createElement = tag => new Element(tag);
  document.createDocumentFragment = () => new Element('#fragment');
  // The popup's theme and platform shortcut controls are unrelated to selection.
  document.querySelectorAll = () => [];

  let nextTimer = 0;
  const timers = new Map();
  const opened = [];
  const context = vm.createContext({
    console, URL, Element, HTMLElement: Element, HTMLImageElement: Element,
    document, navigator: { platform: 'Linux' },
    chrome: { bookmarks: {} },
    window: {
      BookmarkSearchCore: searchCore,
      BookmarkKeyboardCore: keyboardCore,
      matchMedia: () => ({ matches: false, addEventListener() {} }),
      addEventListener() {}, close() {}
    },
    setTimeout: callback => {
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: id => timers.delete(id),
    queueMicrotask: callback => callback(),
    recordOpen: (url, bookmark, disposition) => opened.push({ url, id: bookmark.id, disposition })
  });
  const run = source => vm.runInContext(source, context);
  run(popupSource);
  run(`
    openBookmark = (url, bookmark, disposition = 'foreground') => {
      recordOpen(url, bookmark, disposition);
      return Promise.resolve();
    };
    saveHistory = () => Promise.resolve();
    allItems = ${JSON.stringify(items)}.map(item => prepareSearchItem({
      type: 'bookmark', path: '根目录', parentId: null, ...item
    }));
    allBookmarks = allItems.filter(item => item.type === 'bookmark');
    allItems.forEach(item => {
      itemsById.set(String(item.id), item);
      addItemToParentIndex(item);
      if (item.type === 'folder') foldersById.set(String(item.id), item);
    });
    bindEventListeners();
    searchInput.focus();
    updateView();
  `);

  const input = elements.get('searchInput');
  return {
    run, input, opened, document, elements,
    key: (key, modifiers = {}) => input.dispatch('keydown', { key, ...modifiers }),
    type(value) {
      input.value = value;
      input.dispatch('input');
    },
    flush() {
      const pending = [...timers];
      pending.forEach(([id, callback]) => {
        if (timers.delete(id)) callback();
      });
    },
    selected: () => elements.get('results').querySelector('.bookmark-item.selected'),
    rows: () => elements.get('results').querySelectorAll('.bookmark-item')
  };
}

test('命令列出、过滤、键盘选择和点击执行，不记录搜索历史', () => {
  const popup = createPopup();
  popup.run("clearSearchHistory = () => { searchHistory = []; return Promise.resolve(); };");
  popup.type('/');
  assert.equal(popup.rows().length, 8);
  assert.equal(popup.selected().dataset.command, 'clear');
  popup.key('ArrowUp');
  assert.equal(popup.selected().dataset.command, 'favicon');
  popup.key('ArrowDown');
  assert.equal(popup.selected().dataset.command, 'clear');
  popup.type('/hom');
  assert.equal(popup.rows().length, 1);
  assert.equal(popup.input.getAttribute('aria-activedescendant'), 'command-item-0');
  popup.rows()[0].click();
  assert.equal(popup.input.value, '');
  assert.equal(popup.run('searchHistory.length'), 0);
  assert.deepEqual(popup.opened, []);
});

test('未知命令、错误参数与书签快捷键不会落到旧书签', () => {
  for (const text of ['/unknown', '/clear nope', '/theme', '/theme dark extra', '/help extra']) {
    const popup = createPopup();
    popup.type('Atlas');
    popup.flush();
    popup.type(text);
    for (const key of ['F2', 'Delete', 'ContextMenu', 'ArrowRight']) popup.key(key);
    popup.key('Enter', { ctrlKey: true });
    assert.deepEqual(popup.opened, []);
    assert.equal(popup.input.value, text);
    assert.match(popup.elements.get('errorToast').textContent, /未知命令|参数错误/);
    assert.equal(popup.elements.get('bookmarkEditor').hidden, true);
    popup.run('recordSearchKeyword()');
    assert.equal(popup.run('searchHistory.length'), 0);
    popup.key('Escape');
    assert.equal(popup.input.value, '');
  }
});

test('命令 IME 确认不执行，独立快速 Enter 执行最新参数', () => {
  const popup = createPopup();
  popup.run('persistSettings = () => {};');
  popup.type('/fuzzy off');
  popup.input.dispatch('compositionstart');
  popup.type('/fuzzy on');
  popup.key('Enter');
  assert.equal(popup.run('settings.fuzzySearch'), false);
  popup.input.dispatch('compositionend');
  popup.key('Enter', { keyCode: 229 });
  assert.equal(popup.run('settings.fuzzySearch'), false);
  popup.key('Enter');
  assert.equal(popup.run('settings.fuzzySearch'), true);
  assert.equal(popup.input.value, '');
});

test('设置命令复用持久化，导航和帮助复用既有入口', async () => {
  const popup = createPopup([
    { id: 'folder', type: 'folder', title: 'Work', childCount: 1 },
    { id: 'child', title: 'Child', url: 'https://child.example/', parentId: 'folder' }
  ]);
  popup.document.body = popup.document;
  popup.run(`
    let savedSettings = [];
    chrome.runtime = {};
    chrome.storage = { sync: { set: (snapshot, callback) => {
      savedSettings.push(snapshot.settings); callback();
    } } };
  `);
  for (const text of ['/theme dark', '/theme light', '/theme system', '/fuzzy on', '/fuzzy off', '/favicon off', '/favicon on']) {
    popup.type(text);
    popup.key('Enter');
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(popup.run('savedSettings.length'), 7);
  assert.equal(popup.run('savedSettings[0].themeMode'), 'dark');
  assert.equal(popup.run('savedSettings[5].showFavicon'), false);
  popup.run("navigateToFolder('folder')");
  popup.type('/back');
  popup.key('Enter');
  assert.equal(popup.run('currentFolderId'), null);
  popup.run("navigateToFolder('folder')");
  popup.type('/home');
  popup.key('Enter');
  assert.equal(popup.run('currentFolderId'), null);
  popup.run('let openedPanel = ""; openSettings = () => { openedPanel = "settings"; }; openShortcutHelp = () => { openedPanel = "help"; };');
  for (const name of ['settings', 'help']) {
    popup.type(`/${name}`);
    popup.key('Enter');
    assert.equal(popup.run('openedPanel'), name);
  }
});

test('设置保存失败显示现有错误提示', async () => {
  const popup = createPopup();
  popup.run('saveSettings = () => Promise.reject(new Error("storage unavailable"));');
  popup.type('/fuzzy on');
  popup.key('Enter');
  await new Promise(resolve => setImmediate(resolve));
  assert.match(popup.elements.get('errorToast').textContent, /设置未能保存/);
});

test('// 搜索字面斜杠，仍能打开书签与重放历史', () => {
  const popup = createPopup([{ id: 'slash', title: '/Atlas', url: 'https://atlas.example/' }]);
  popup.type('//Atlas');
  popup.key('Enter');
  assert.equal(popup.opened[0].id, 'slash');
  assert.equal(popup.run('searchHistory[0]'), '//Atlas');
});

test('/clear 和 /clear all 确认、取消及清理范围', async () => {
  for (const command of ['/clear', '/clear all']) {
    const popup = createPopup();
    popup.run("searchHistory = ['Atlas']; recentBookmarks = [{ id: '1' }]; usageStats = { '1': { count: 2 } };");
    popup.type(command);
    assert.equal(popup.run('searchHistory.length'), 1);
    popup.key('Enter');
    assert.equal(popup.elements.get('confirmDialog').hidden, false);
    popup.run('closeConfirmation(false)');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(popup.run('searchHistory.length'), 1);
    popup.type(command);
    popup.key('Enter');
    popup.run('closeConfirmation(true)');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(popup.run('searchHistory.length'), 0);
    assert.equal(popup.run('recentBookmarks.length'), command === '/clear' ? 1 : 0);
    assert.equal(popup.run('Object.keys(usageStats).length'), command === '/clear' ? 1 : 0);
    assert.equal(popup.run('allBookmarks.length'), 3);
    assert.equal(popup.run('settings.themeMode'), 'system');
  }
});

test('搜索自动选中首项且保留输入焦点，上下键从首项切换并循环', () => {
  const popup = createPopup();
  assert.equal(popup.selected(), null);
  popup.type('Atlas');
  popup.flush();
  assert.equal(popup.selected().dataset.itemId, '1');
  assert.equal(popup.selected().getAttribute('aria-selected'), 'true');
  assert.equal(popup.input.getAttribute('aria-activedescendant'), popup.selected().id);
  assert.equal(popup.document.activeElement, popup.input);

  popup.key('ArrowDown');
  assert.equal(popup.selected().dataset.itemId, '2');
  popup.key('ArrowUp');
  assert.equal(popup.selected().dataset.itemId, '1');
  popup.key('ArrowUp');
  assert.equal(popup.selected().dataset.itemId, '2');
  popup.key('Enter');
  assert.equal(popup.opened[0].id, '2');
});

test('更换关键词重新选择首项，清空搜索和无结果时取消选择', () => {
  const popup = createPopup();
  popup.type('Atlas');
  popup.flush();
  popup.key('ArrowDown');
  popup.type('Beta');
  popup.flush();
  assert.equal(popup.selected().dataset.itemId, '3');

  popup.type('no-such-bookmark');
  popup.flush();
  assert.equal(popup.rows().length, 0);
  assert.equal(popup.selected(), null);
  assert.equal(popup.input.getAttribute('aria-activedescendant'), null);
  popup.key('Enter');
  assert.deepEqual(popup.opened, []);

  popup.run('clearSearch()');
  assert.equal(popup.input.value, '');
  assert.equal(popup.selected(), null);
  assert.equal(popup.document.activeElement, popup.input);
});

test('快速输入后直接确认，所有打开方式均使用最新查询', () => {
  for (const [modifiers, disposition] of [
    [{}, 'foreground'], [{ ctrlKey: true }, 'background'],
    [{ metaKey: true }, 'background'], [{ shiftKey: true }, 'current']
  ]) {
    const popup = createPopup();
    popup.type('Atlas');
    popup.flush();
    popup.key('ArrowDown');
    popup.type('Beta');
    popup.key('Enter', modifiers);
    assert.deepEqual(popup.opened, [{ url: 'https://beta.example/', id: '3', disposition }]);
    popup.flush();
    assert.equal(popup.opened.length, 1);
  }
});

test('最新查询没有结果时，快速 Enter 或组合键不会打开旧结果', () => {
  for (const modifiers of [{}, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
    const popup = createPopup();
    popup.type('Atlas');
    popup.flush();
    popup.type('no-such-bookmark');
    popup.key('Enter', modifiers);
    assert.equal(popup.rows().length, 0);
    assert.deepEqual(popup.opened, []);
  }
});

test('防抖期间按下方向键会先刷新结果，再从默认首项切换', () => {
  const popup = createPopup();
  popup.type('Beta');
  popup.flush();
  popup.type('Atlas');
  popup.key('ArrowDown');
  assert.equal(popup.selected().dataset.itemId, '2');
  popup.flush();
  assert.equal(popup.selected().dataset.itemId, '2');
});

test('输入法组合期间的 Enter、方向键和增强快捷键由输入法处理', () => {
  const popup = createPopup();
  popup.type('Atlas');
  popup.flush();
  popup.input.dispatch('compositionstart');
  for (const [key, modifiers] of [
    ['Enter', {}], ['ArrowDown', {}], ['ArrowUp', {}],
    ['Enter', { ctrlKey: true }], ['End', { ctrlKey: true }]
  ]) {
    const event = popup.key(key, modifiers);
    assert.equal(event.defaultPrevented, false);
    assert.equal(popup.selected().dataset.itemId, '1');
  }
  assert.deepEqual(popup.opened, []);
  popup.input.dispatch('compositionend');
  popup.flush();
  popup.key('Enter');
  assert.equal(popup.opened[0].id, '1');
});

test('isComposing 和 229 兼容事件不会确认结果或移动选择', () => {
  for (const flags of [{ isComposing: true }, { keyCode: 229 }]) {
    const popup = createPopup();
    popup.type('Atlas');
    popup.flush();
    for (const key of ['Enter', 'ArrowDown', 'ArrowUp']) {
      const event = popup.key(key, flags);
      assert.equal(event.defaultPrevented, false);
      assert.equal(popup.selected().dataset.itemId, '1');
    }
    assert.deepEqual(popup.opened, []);
  }
});

test('中文候选确认不打开书签，下一次独立 Enter 使用最终输入文字', () => {
  const popup = createPopup([
    { id: '1', title: 'Atlas', url: 'https://atlas.example/' },
    { id: '2', title: '网易邮箱', url: 'https://mail.163.com/' }
  ]);
  popup.type('Atlas');
  popup.flush();
  popup.input.dispatch('compositionstart');
  popup.type('网易');
  popup.flush();
  assert.equal(popup.rows()[0].dataset.itemId, '1');
  popup.input.dispatch('compositionend');
  const confirmation = popup.key('Enter', { keyCode: 229 });
  assert.equal(confirmation.defaultPrevented, false);
  assert.deepEqual(popup.opened, []);
  popup.key('Enter');
  assert.deepEqual(popup.opened, [
    { url: 'https://mail.163.com/', id: '2', disposition: 'foreground' }
  ]);
});

test('文件夹默认选中，Enter 进入后恢复空搜索浏览', () => {
  for (const modifiers of [{}, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
    const popup = createPopup([
      { id: 'folder', type: 'folder', title: 'Work', childCount: 1 },
      { id: 'child', title: 'Child', url: 'https://child.example/', parentId: 'folder' }
    ]);
    popup.type('Work');
    popup.flush();
    assert.equal(popup.selected().dataset.itemType, 'folder');
    assert.equal(popup.elements.get('enterActionLabel').textContent, '进入');
    popup.key('Enter', modifiers);
    assert.equal(popup.run('currentFolderId'), 'folder');
    assert.equal(popup.input.value, '');
    assert.equal(popup.rows()[0].dataset.itemId, 'child');
    assert.equal(popup.selected(), null);
    assert.equal(popup.elements.get('enterActionLabel').textContent, '打开');
    assert.deepEqual(popup.opened, []);
  }
});

test('空搜索的历史选择保留先选历史再确认的行为', () => {
  const popup = createPopup();
  popup.run("searchHistory = ['Beta']; showSearchHistory();");
  assert.equal(popup.elements.get('searchHistory').hidden, false);
  popup.key('Enter');
  assert.deepEqual(popup.opened, []);
  assert.equal(popup.input.value, '');
  popup.key('ArrowDown');
  assert.equal(popup.run('historySelectedIndex'), 0);
  popup.key('Enter');
  assert.equal(popup.input.value, 'Beta');
  assert.equal(popup.selected().dataset.itemId, '3');
  assert.deepEqual(popup.opened, []);
  popup.key('Enter');
  assert.equal(popup.opened[0].id, '3');
});

test('展开更多结果保留手动选择，并将输入焦点留在搜索框', () => {
  const popup = createPopup(Array.from({ length: 302 }, (_, index) => ({
    id: String(index), title: `Atlas ${String(index).padStart(3, '0')}`,
    url: `https://atlas-${index}.example/`
  })));
  popup.type('Atlas');
  popup.flush();
  assert.equal(popup.rows().length, 300);
  popup.key('ArrowDown');
  assert.equal(popup.selected().dataset.itemId, '1');
  popup.elements.get('resultsMore').querySelector('button').click();
  assert.equal(popup.rows().length, 302);
  assert.equal(popup.selected().dataset.itemId, '1');
  assert.equal(popup.document.activeElement, popup.input);
});

test('搜索框短暂失焦又返回时，延迟关闭历史不会清除活动结果', () => {
  const popup = createPopup();
  popup.type('Atlas');
  popup.flush();
  const activeResultId = popup.input.getAttribute('aria-activedescendant');
  popup.input.dispatch('blur');
  popup.elements.get('settingsButton').focus();
  popup.input.focus();
  popup.flush();
  assert.equal(popup.document.activeElement, popup.input);
  assert.equal(popup.input.getAttribute('aria-activedescendant'), activeResultId);
  assert.equal(popup.selected().id, activeResultId);
});

test('空搜索展开更多不会抢回输入焦点或显示搜索历史', () => {
  const popup = createPopup(Array.from({ length: 302 }, (_, index) => ({
    id: String(index), title: `Bookmark ${index}`, url: `https://bookmark-${index}.example/`
  })));
  popup.run("searchHistory = ['Beta'];");
  const moreButton = popup.elements.get('resultsMore').querySelector('button');
  moreButton.focus();
  const inputFocusCalls = popup.input.focusCalls;
  moreButton.click();
  assert.equal(popup.rows().length, 302);
  assert.equal(popup.input.focusCalls, inputFocusCalls);
  assert.notEqual(popup.document.activeElement, popup.input);
  assert.equal(popup.elements.get('searchHistory').hidden, true);
  assert.equal(popup.selected(), null);
});
