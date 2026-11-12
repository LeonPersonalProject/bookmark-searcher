// ==================== 全局状态 ====================
let allBookmarks = [];
let allItems = [];
let itemsByParentId = new Map();
let foldersById = new Map();
let itemsById = new Map();
let selectedIndex = -1;
let commandOptions = [];
let commandBusy = false;
const commands = [
  { name: 'clear', usage: '/clear [all]', description: '清空搜索历史；all 同时清空最近使用和使用统计', args: ['', 'all'] },
  { name: 'help', usage: '/help', description: '命令说明与现有快捷键', args: [''] },
  { name: 'settings', usage: '/settings', description: '打开设置', args: [''] },
  { name: 'home', usage: '/home', description: '返回根目录', args: [''] },
  { name: 'back', usage: '/back', description: '返回上级目录', args: [''] },
  { name: 'theme', usage: '/theme system|light|dark', description: '设置外观模式', args: ['system', 'light', 'dark'] },
  { name: 'fuzzy', usage: '/fuzzy on|off', description: '开关模糊搜索', args: ['on', 'off'] },
  { name: 'favicon', usage: '/favicon on|off', description: '开关网站图标', args: ['on', 'off'] }
];
let currentFolderId = null;
let searchTimeout = null;
let isSearchComposing = false;
let bookmarkRefreshTimeout = null;
let toastTimeout = null;
let settingsPanelAnimation = null;
let settingsDrawerAnimation = null;
let settingsAnimationGeneration = 0;
let historySelectedIndex = -1;
let recentBookmarks = [];
let searchHistory = [];
let usageStats = {};
let lastFocusedElement = null;
let confirmLastFocusedElement = null;
let confirmResolver = null;
let activeActionBookmark = null;
let actionMenuLastFocusedElement = null;
let editingBookmarkId = null;
let bookmarkEditorReturnFocus = null;
let shortcutHelpLastFocusedElement = null;
let historySaveQueue = Promise.resolve();
let settingsSaveQueue = Promise.resolve();
const faviconUrlCache = new Map();
const failedFaviconDomains = new Set();
const displayUrlCache = new Map();
const MAX_RENDERED_RESULTS = 300;
const MAX_FAVICON_CACHE = 512;
const MAX_DISPLAY_URL_CACHE = 2048;
let renderAllResults = false;
let highlightRegexCacheKey = '';
let highlightRegexCache = null;
const allowedBookmarkProtocols = new Set([
  'http:',
  'https:',
  'ftp:',
  'file:',
  'mailto:',
  'chrome:',
  'chrome-extension:'
]);
let settings = {
  themeMode: 'system',
  colorTheme: 'classic',
  showFavicon: true,
  fuzzySearch: false
};

const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const {
  parseSearchQuery,
  prepareSearchItem,
  searchAndRank
} = window.BookmarkSearchCore;
const { getShortcutIntent } = window.BookmarkKeyboardCore;

// ==================== DOM 元素引用 ====================
const searchInput = document.getElementById('searchInput');
const searchShortcut = document.getElementById('searchShortcut');
const clearSearchButton = document.getElementById('clearSearchButton');
const searchHistoryEl = document.getElementById('searchHistory');
const breadcrumb = document.getElementById('breadcrumb');
const resultCount = document.getElementById('resultCount');
const contentArea = document.getElementById('contentArea');
const recentSection = document.getElementById('recentSection');
const recentBookmarksEl = document.getElementById('recentBookmarks');
const recentCount = document.getElementById('recentCount');
const loadingState = document.getElementById('loadingState');
const resultsSection = document.getElementById('resultsSection');
const resultsTitle = document.getElementById('resultsTitle');
const resultsMeta = document.getElementById('resultsMeta');
const resultsContainer = document.getElementById('results');
const resultsMore = document.getElementById('resultsMore');
const emptyState = document.getElementById('emptyState');
const errorToast = document.getElementById('errorToast');
const settingsButton = document.getElementById('settingsButton');
const settingsPanel = document.getElementById('settingsPanel');
const settingsContent = settingsPanel.querySelector('.settings-content');
const closeSettings = document.getElementById('closeSettings');
const themeModeInputs = document.querySelectorAll('input[name="themeMode"]');
const colorThemeInputs = document.querySelectorAll('input[name="colorTheme"]');
const showFaviconToggle = document.getElementById('showFaviconToggle');
const fuzzySearchToggle = document.getElementById('fuzzySearchToggle');
const clearHistoryButton = document.getElementById('clearHistoryButton');
const confirmDialog = document.getElementById('confirmDialog');
const confirmTitle = document.getElementById('confirmTitle');
const confirmMessage = document.getElementById('confirmMessage');
const confirmCancelButton = document.getElementById('confirmCancelButton');
const confirmActionButton = document.getElementById('confirmActionButton');
const bookmarkActions = document.getElementById('bookmarkActions');
const bookmarkActionsTitle = document.getElementById('bookmarkActionsTitle');
const bookmarkEditor = document.getElementById('bookmarkEditor');
const bookmarkEditorForm = document.getElementById('bookmarkEditorForm');
const closeBookmarkEditor = document.getElementById('closeBookmarkEditor');
const cancelBookmarkEditor = document.getElementById('cancelBookmarkEditor');
const saveBookmarkEditor = document.getElementById('saveBookmarkEditor');
const bookmarkTitleInput = document.getElementById('bookmarkTitleInput');
const bookmarkUrlInput = document.getElementById('bookmarkUrlInput');
const bookmarkEditorError = document.getElementById('bookmarkEditorError');
const backgroundShortcutLabels = document.querySelectorAll('[data-background-shortcut]');
const primaryShortcutLabels = document.querySelectorAll('[data-primary-shortcut]');
const shortcutHelpButton = document.getElementById('shortcutHelpButton');
const shortcutHelp = document.getElementById('shortcutHelp');
const closeShortcutHelp = document.getElementById('closeShortcutHelp');
const enterActionLabel = document.getElementById('enterActionLabel');

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
  bindEventListeners();
  updateShortcutLabel();
  showLoading(true);
  searchInput.focus();

  try {
    const storageResults = await Promise.allSettled([loadSettings(), loadHistory()]);
    showFaviconToggle.checked = settings.showFavicon;
    fuzzySearchToggle.checked = settings.fuzzySearch;
    applyTheme();
    await loadBookmarks();
    if (pruneHistoryAgainstBookmarks()) {
      await saveHistory();
    }
    displayRecentBookmarks();
    showLoading(false);
    updateView();

    if (storageResults.some(result => result.status === 'rejected')) {
      console.warn('部分本地设置读取失败:', storageResults);
      showError('部分偏好未能读取，本次将使用默认设置');
    }
  } catch (error) {
    console.error('初始化失败:', error);
    showLoading(false);
    showError('初始化失败，请重新打开弹窗');
  }
});

function bindEventListeners() {
  searchInput.addEventListener('input', handleSearchWithDebounce);
  searchInput.addEventListener('compositionstart', () => {
    isSearchComposing = true;
    clearTimeout(searchTimeout);
    searchTimeout = null;
  });
  searchInput.addEventListener('compositionend', () => {
    isSearchComposing = false;
    handleSearchWithDebounce();
  });
  searchInput.addEventListener('focus', showSearchHistory);
  searchInput.addEventListener('click', showSearchHistory);
  searchInput.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.activeElement !== searchInput && !searchHistoryEl.contains(document.activeElement)) {
        hideSearchHistory();
      }
    }, 140);
  });
  searchInput.addEventListener('keydown', handleKeyNavigation);
  searchHistoryEl.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!searchHistoryEl.contains(document.activeElement) && document.activeElement !== searchInput) {
        hideSearchHistory();
      }
    }, 0);
  });
  clearSearchButton.addEventListener('click', clearSearch);
  resultsContainer.addEventListener('click', handleResultsClick);
  resultsContainer.addEventListener('contextmenu', handleResultsContextMenu);
  resultsContainer.addEventListener('focusin', handleResultsFocus);
  resultsContainer.addEventListener('error', handleFaviconError, true);
  recentBookmarksEl.addEventListener('error', handleFaviconError, true);

  settingsButton.addEventListener('click', openSettings);
  closeSettings.addEventListener('click', closeSettingsPanel);
  settingsPanel.addEventListener('click', (event) => {
    if (event.target === settingsPanel) {
      closeSettingsPanel();
    }
  });
  settingsPanel.addEventListener('keydown', handleSettingsKeydown);

  themeModeInputs.forEach(input => {
    input.addEventListener('change', changeThemeMode);
  });
  colorThemeInputs.forEach(input => {
    input.addEventListener('change', changeColorTheme);
  });
  showFaviconToggle.addEventListener('change', toggleFavicon);
  fuzzySearchToggle.addEventListener('change', toggleFuzzySearch);
  clearHistoryButton.addEventListener('click', clearHistory);
  confirmCancelButton.addEventListener('click', () => closeConfirmation(false));
  confirmActionButton.addEventListener('click', () => closeConfirmation(true));
  confirmDialog.addEventListener('click', event => {
    if (event.target === confirmDialog) {
      closeConfirmation(false);
    }
  });
  confirmDialog.addEventListener('keydown', handleConfirmationKeydown);
  bookmarkActions.addEventListener('click', handleBookmarkAction);
  bookmarkActions.addEventListener('keydown', handleBookmarkActionsKeydown);
  bookmarkEditorForm.addEventListener('submit', saveBookmarkChanges);
  bookmarkEditor.addEventListener('keydown', handleBookmarkEditorKeydown);
  closeBookmarkEditor.addEventListener('click', () => closeBookmarkEditorDialog());
  cancelBookmarkEditor.addEventListener('click', () => closeBookmarkEditorDialog());
  bookmarkEditor.addEventListener('click', event => {
    if (event.target === bookmarkEditor) {
      closeBookmarkEditorDialog();
    }
  });
  shortcutHelpButton.addEventListener('click', openShortcutHelp);
  closeShortcutHelp.addEventListener('click', () => closeShortcutHelpDialog());
  shortcutHelp.addEventListener('click', event => {
    if (event.target === shortcutHelp) {
      closeShortcutHelpDialog();
    }
  });
  shortcutHelp.addEventListener('keydown', handleShortcutHelpKeydown);
  document.addEventListener('keydown', handleGlobalKeyboardShortcuts);
  document.addEventListener('pointerdown', event => {
    if (!bookmarkActions.hidden
      && !bookmarkActions.contains(event.target)
      && (!(event.target instanceof Element) || !event.target.closest('.bookmark-action-trigger'))) {
      closeBookmarkActions(false);
    }
  });
  contentArea.addEventListener('scroll', () => closeBookmarkActions(false), { passive: true });
  window.addEventListener('resize', () => closeBookmarkActions(false));
  systemThemeQuery.addEventListener('change', () => {
    if (settings.themeMode === 'system') {
      applyTheme();
    }
  });
  bindBookmarkChangeListeners();
}

function updateShortcutLabel() {
  const isMac = navigator.platform.toLowerCase().includes('mac');
  const primaryKeyLabel = isMac ? '⌘' : 'Ctrl';
  searchShortcut.textContent = isMac ? '⌘ ⇧ K' : 'Ctrl ⇧ K';
  backgroundShortcutLabels.forEach(label => {
    label.textContent = isMac ? '⌘ Enter' : 'Ctrl Enter';
  });
  primaryShortcutLabels.forEach(label => {
    const shortcutLabels = {
      folders: `${primaryKeyLabel} ↑ / ↓`,
      bounds: `${primaryKeyLabel} Home / End`,
      enter: `${primaryKeyLabel} Enter`,
      search: `${primaryKeyLabel} F`,
      help: `${primaryKeyLabel} /`
    };
    label.textContent = shortcutLabels[label.dataset.primaryShortcut] || label.textContent;
  });
}

// ==================== 书签数据 ====================
async function loadBookmarks() {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.getTree(bookmarkTreeNodes => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }

      try {
        allItems = [];
        itemsByParentId = new Map();
        foldersById = new Map();
        itemsById = new Map();
        flattenBookmarks(bookmarkTreeNodes, '', null, allItems);
        allItems.forEach(item => itemsById.set(String(item.id), item));
        allBookmarks = allItems.filter(item => item.type === 'bookmark');
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

function flattenBookmarks(nodes, path = '', parentId = null, items = []) {
  let bookmarkCount = 0;
  nodes.forEach(node => {
    if (!node.title) {
      if (node.children) {
        bookmarkCount += flattenBookmarks(node.children, path, parentId, items);
      }
      return;
    }

    const currentPath = path ? `${path} > ${node.title}` : node.title;

    if (node.url) {
      const item = prepareSearchItem({
        id: node.id,
        type: 'bookmark',
        title: node.title,
        url: node.url,
        path: path || '根目录',
        parentId
      });
      item.displayUrl = getDisplayUrl(item.url);
      items.push(item);
      addItemToParentIndex(item);
      bookmarkCount += 1;
    } else if (node.children) {
      const folder = prepareSearchItem({
        id: node.id,
        type: 'folder',
        title: node.title,
        path: path || '根目录',
        parentId,
        childCount: 0
      });
      items.push(folder);
      foldersById.set(String(folder.id), folder);
      addItemToParentIndex(folder);
      folder.childCount = flattenBookmarks(node.children, currentPath, node.id, items);
      bookmarkCount += folder.childCount;
    }
  });

  return bookmarkCount;
}

function addItemToParentIndex(item) {
  const key = item.parentId === null ? '__root__' : String(item.parentId);
  const siblings = itemsByParentId.get(key) || [];
  siblings.push(item);
  itemsByParentId.set(key, siblings);
}

function getItemsForParent(parentId) {
  return itemsByParentId.get(parentId === null ? '__root__' : String(parentId)) || [];
}

function bindBookmarkChangeListeners() {
  const bookmarkEvents = ['onCreated', 'onChanged', 'onMoved', 'onRemoved', 'onImportEnded'];
  bookmarkEvents.forEach(eventName => {
    const event = chrome.bookmarks?.[eventName];
    if (event?.addListener) {
      event.addListener(scheduleBookmarkRefresh);
    }
  });
}

function scheduleBookmarkRefresh() {
  clearTimeout(bookmarkRefreshTimeout);
  bookmarkRefreshTimeout = setTimeout(refreshBookmarks, 80);
}

async function refreshBookmarks() {
  const previousFolderId = currentFolderId;
  try {
    await loadBookmarks();
    if (previousFolderId !== null && !foldersById.has(String(previousFolderId))) {
      currentFolderId = null;
    }
    const historyChanged = pruneHistoryAgainstBookmarks();
    if (historyChanged) {
      await saveHistory();
    }
    closeBookmarkActions(false);
    displayRecentBookmarks();
    updateView();
  } catch (error) {
    console.error('刷新书签失败:', error);
    showError('书签列表刷新失败，请重新打开弹窗');
  }
}

function pruneHistoryAgainstBookmarks() {
  const bookmarkMap = new Map(allBookmarks.map(item => [String(item.id), item]));
  let changed = false;
  const nextRecentBookmarks = recentBookmarks
    .map(recent => {
      const current = bookmarkMap.get(String(recent.id));
      if (!current) {
        changed = true;
        return null;
      }
      if (recent.title !== current.title
        || recent.url !== current.url
        || recent.path !== current.path
        || String(recent.parentId) !== String(current.parentId)) {
        changed = true;
      }
      return {
        id: current.id,
        type: 'bookmark',
        title: current.title,
        url: current.url,
        path: current.path,
        parentId: current.parentId
      };
    })
    .filter(Boolean);

  const nextUsageStats = Object.fromEntries(
    Object.entries(usageStats).filter(([id]) => bookmarkMap.has(String(id)))
  );
  if (Object.keys(nextUsageStats).length !== Object.keys(usageStats).length) {
    changed = true;
  }

  recentBookmarks = nextRecentBookmarks.slice(0, 4);
  usageStats = nextUsageStats;
  return changed;
}

function isCommandMode() {
  return searchInput.value.startsWith('/') && !searchInput.value.startsWith('//');
}

function getSearchText() {
  return searchInput.value.startsWith('//') ? searchInput.value.slice(1) : searchInput.value;
}

function renderCommands() {
  hideSearchHistory();
  resultsContainer.innerHTML = '';
  resultsMore.innerHTML = '';
  resultsMore.hidden = true;
  recentSection.hidden = true;
  emptyState.hidden = true;
  resultsSection.hidden = false;
  resultsTitle.textContent = '命令';
  resultsContainer.setAttribute('aria-label', '命令列表');
  const text = searchInput.value.slice(1).trim().toLowerCase();
  const [name] = text.split(/\s+/);
  const exact = commands.find(command => command.name === name);
  commandOptions = exact ? [exact] : commands.filter(command => command.name.startsWith(text));
  resultsMeta.textContent = commandOptions.length ? 'Enter 或点击执行 · Esc 退出' : '未知命令，请输入 /help';
  resultCount.textContent = `${commandOptions.length} 个命令`;
  commandOptions.forEach((command, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bookmark-item';
    button.id = `command-item-${index}`;
    button.dataset.index = index;
    button.dataset.command = command.name;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', 'false');
    button.innerHTML = `<span class="item-icon">${iconSvg('chevron-right')}</span><span class="item-copy"><span class="bookmark-title">${escapeHtml(command.usage)}</span><span class="bookmark-meta">${escapeHtml(command.description)}</span></span>`;
    resultsContainer.appendChild(button);
  });
  setSelectedIndex(commandOptions.length && !isSearchComposing ? 0 : -1);
  enterActionLabel.textContent = '执行';
  updateNavigation();
  syncSearchExpandedState();
  contentArea.scrollTop = 0;
}

async function executeCommand(name = commandOptions[selectedIndex]?.name) {
  if (!isCommandMode() || isSearchComposing || commandBusy) return;
  const text = searchInput.value.slice(1).trim().toLowerCase();
  const parts = text.split(/\s+/);
  const exact = commands.find(command => command.name === parts[0]);
  const command = exact || commands.find(item => item.name === name);
  if (!command) {
    showError('未知命令，请输入 /help');
    return;
  }
  const argument = parts.slice(1).join(' ');
  if (!command.args.includes(argument)) {
    showError(`参数错误，用法：${command.usage}`);
    return;
  }
  commandBusy = true;
  try {
    // Leave command mode before opening a modal so its focus restoration is safe.
    clearSearch();
    hideSearchHistory();
    switch (command.name) {
      case 'clear':
        await (argument === 'all' ? clearHistory() : clearSearchHistory());
        break;
      case 'help': openShortcutHelp(); break;
      case 'settings': openSettings(); break;
      case 'home': navigateToFolder(null); break;
      case 'back': handleBack(); break;
      case 'theme': changeThemeMode({ target: { value: argument } }); break;
      case 'fuzzy':
        fuzzySearchToggle.checked = argument === 'on';
        toggleFuzzySearch();
        break;
      case 'favicon':
        showFaviconToggle.checked = argument === 'on';
        toggleFavicon();
        break;
    }
  } catch (error) {
    console.error('执行命令失败:', error);
    showError('命令执行失败，请稍后重试');
  } finally {
    commandBusy = false;
  }
}

function handleCommandKeyboard(event) {
  if (!isCommandMode()) return false;
  if (isComposingKey(event)) return true;
  flushPendingSearch();
  if (event.key === 'Escape') {
    event.preventDefault();
    clearSearch();
    hideSearchHistory();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    executeCommand();
  } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp')
    && !event.ctrlKey && !event.metaKey && !event.altKey && commandOptions.length) {
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    setSelectedIndex((selectedIndex + direction + commandOptions.length) % commandOptions.length);
    scrollToSelected({ behavior: 'auto' });
  }
  return true;
}

// ==================== 搜索与排序 ====================
function handleSearchWithDebounce() {
  clearTimeout(searchTimeout);
  searchTimeout = null;
  toggleClearButton();
  hideSearchHistory();
  if (isCommandMode()) {
    updateView();
  } else if (!isSearchComposing) {
    searchTimeout = setTimeout(updateView, 140);
  }
}

function flushPendingSearch() {
  if (searchTimeout !== null) {
    updateView();
  }
}

function toggleClearButton() {
  const hasKeyword = Boolean(searchInput.value.trim());
  clearSearchButton.hidden = !hasKeyword;
  searchShortcut.hidden = hasKeyword;
}

function clearSearch() {
  clearTimeout(searchTimeout);
  searchInput.value = '';
  toggleClearButton();
  updateView();
  searchInput.focus();
  showSearchHistory();
}

function updateView() {
  clearTimeout(searchTimeout);
  searchTimeout = null;
  // A view refresh can detach the element that opened the action menu. Close
  // it before replacing result rows so stale actions cannot remain actionable.
  closeBookmarkActions(false);
  if (isCommandMode()) {
    renderCommands();
    return;
  }
  commandOptions = [];
  resultsContainer.setAttribute('aria-label', '书签结果');
  const query = parseSearchQuery(getSearchText());
  const sourceItems = currentFolderId === null
    ? (query.isEmpty ? getItemsForParent(null) : allItems)
    : getItemsForParent(currentFolderId);
  let itemsToDisplay = query.isEmpty
    ? [...sourceItems]
    : searchAndRank(sourceItems, query, {
        fuzzySearch: settings.fuzzySearch,
        usageStats
      });

  if (query.isEmpty) {
    itemsToDisplay.sort(compareItems);
  }

  renderAllResults = false;
  displayItems(itemsToDisplay, query, renderAllResults);
  updateStats(itemsToDisplay.length, query);
  updateNavigation();
  syncSearchExpandedState();
  contentArea.scrollTop = 0;
}

function compareItems(first, second) {
  if (first.type !== second.type) {
    return first.type === 'folder' ? -1 : 1;
  }

  return first.title.localeCompare(second.title, 'zh-CN', { sensitivity: 'base' });
}

// ==================== 结果渲染 ====================
function displayItems(items, query = parseSearchQuery(''), renderAll = false) {
  // This also covers the "show more" refresh path, which can otherwise leave
  // a menu anchored to a row that is about to be removed.
  closeBookmarkActions(false);
  const previousSelectionId = renderAll ? getSelectedResultContext()?.item.id : null;
  resultsContainer.innerHTML = '';
  resultsMore.innerHTML = '';
  resultsMore.hidden = true;
  const visibleItems = renderAll ? items : items.slice(0, MAX_RENDERED_RESULTS);

  const showRecent = query.isEmpty && currentFolderId === null && recentBookmarks.length > 0;
  recentSection.hidden = !showRecent;
  emptyState.hidden = items.length > 0;
  resultsSection.hidden = items.length === 0;

  if (!query.isEmpty) {
    resultsTitle.textContent = '搜索结果';
    if (query.domains.length > 0) {
      resultsMeta.textContent = '域名筛选';
    } else if (query.terms.length > 1) {
      resultsMeta.textContent = `${query.terms.length} 个关键词`;
    } else {
      resultsMeta.textContent = settings.fuzzySearch ? '模糊匹配' : '标题、网址与路径';
    }
    if (items.length > visibleItems.length) {
      resultsMeta.textContent += ` · 显示 ${visibleItems.length}/${items.length}`;
    }
  } else if (currentFolderId === null) {
    resultsTitle.textContent = '浏览';
    resultsMeta.textContent = '文件夹优先';
  } else {
    resultsTitle.textContent = '当前文件夹';
    resultsMeta.textContent = items.length > visibleItems.length
      ? `显示 ${visibleItems.length}/${items.length} 项`
      : `${items.length} 项`;
  }

  const fragment = document.createDocumentFragment();
  visibleItems.forEach((item, index) => {
    fragment.appendChild(createItemElement(item, query, index));
  });
  resultsContainer.appendChild(fragment);

  if (items.length > visibleItems.length) {
    const moreButton = document.createElement('button');
    moreButton.type = 'button';
    moreButton.className = 'results-more-button';
    moreButton.textContent = `显示其余 ${items.length - visibleItems.length} 项`;
    moreButton.addEventListener('click', () => {
      renderAllResults = true;
      displayItems(items, query, true);
      updateStats(items.length, query);
      if (!query.isEmpty) searchInput.focus();
    });
    resultsMore.appendChild(moreButton);
    resultsMore.hidden = false;
  }

  const previousIndex = previousSelectionId === null || previousSelectionId === undefined
    ? -1
    : visibleItems.findIndex(item => item.id === previousSelectionId);
  const initialIndex = !query.isEmpty && !isSearchComposing && visibleItems.length > 0 ? 0 : -1;
  setSelectedIndex(previousIndex >= 0 ? previousIndex : initialIndex);
}

function createItemElement(item, query, index) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = item.type === 'folder' ? 'bookmark-item folder-item' : 'bookmark-item';
  button.setAttribute('role', 'option');
  button.setAttribute('aria-selected', 'false');
  button.dataset.index = index;
  button.dataset.itemId = item.id;
  button.dataset.itemType = item.type;
  button.id = `result-item-${index}`;

  const highlightedTitle = highlightText(item.title, query.terms);

  if (item.type === 'folder') {
    button.setAttribute('aria-label', `进入文件夹 ${item.title}，包含 ${item.childCount} 个书签`);
    button.innerHTML = `
      <span class="item-icon">${iconSvg('folder')}</span>
      <span class="item-copy">
        <span class="bookmark-title">${highlightedTitle}</span>
        <span class="bookmark-meta">${escapeHtml(item.path)}</span>
      </span>
      <span class="item-trailing">
        <span>${item.childCount}</span>
        ${iconSvg('chevron-right')}
      </span>
      <span class="item-enter-hint" aria-hidden="true">↵ 进入</span>
    `;

  } else {
    const displayUrl = item.displayUrl || getDisplayUrl(item.url);
    const faviconDomain = getFaviconDomain(item.url);
    const faviconUrl = settings.showFavicon ? getFaviconUrl(item.url, faviconDomain) : '';
    const iconContent = faviconUrl
      ? `<img src="${escapeHtml(faviconUrl)}" class="bookmark-favicon" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-favicon-domain="${escapeHtml(faviconDomain)}" alt="">`
      : iconSvg('globe');

    button.title = item.url;
    button.setAttribute('aria-label', `打开书签 ${item.title}，${displayUrl}`);
    button.innerHTML = `
      <span class="item-icon">${iconContent}</span>
      <span class="item-copy">
        <span class="bookmark-title">${highlightedTitle}</span>
        <span class="bookmark-meta">${highlightText(displayUrl, query.terms)} · ${escapeHtml(item.path)}</span>
      </span>
      <span class="item-enter-hint" aria-hidden="true">↵ 打开</span>
    `;

    const row = document.createElement('div');
    row.className = 'bookmark-row';
    row.setAttribute('role', 'presentation');
    row.appendChild(button);

    const actionTrigger = document.createElement('button');
    actionTrigger.type = 'button';
    actionTrigger.className = 'bookmark-action-trigger';
    actionTrigger.tabIndex = -1;
    actionTrigger.title = '更多操作';
    actionTrigger.setAttribute('aria-label', `${item.title} 的更多操作`);
    actionTrigger.setAttribute('aria-haspopup', 'menu');
    actionTrigger.setAttribute('aria-expanded', 'false');
    actionTrigger.setAttribute('aria-controls', 'bookmarkActions');
    actionTrigger.innerHTML = iconSvg('more');
    row.appendChild(actionTrigger);

    return row;
  }

  return button;
}

function handleResultsFocus(event) {
  const itemElement = event.target instanceof Element
    ? event.target.closest('.bookmark-item')
    : null;
  if (!itemElement || !resultsContainer.contains(itemElement)) return;
  setSelectedIndex(Number(itemElement.dataset.index));
}

function handleResultsClick(event) {
  if (isCommandMode()) {
    const button = event.target instanceof Element ? event.target.closest('.bookmark-item') : null;
    if (button && resultsContainer.contains(button) && button.dataset.command) {
      executeCommand(button.dataset.command);
    }
    return;
  }
  const actionTrigger = event.target instanceof Element
    ? event.target.closest('.bookmark-action-trigger')
    : null;
  if (actionTrigger && resultsContainer.contains(actionTrigger)) {
    event.stopPropagation();
    const row = actionTrigger.closest('.bookmark-row');
    const itemElement = row?.querySelector('.bookmark-item');
    const item = itemElement ? itemsById.get(String(itemElement.dataset.itemId)) : null;
    if (item) openBookmarkActions(item, { anchor: actionTrigger });
    return;
  }

  const itemElement = event.target instanceof Element
    ? event.target.closest('.bookmark-item')
    : null;
  if (!itemElement || !resultsContainer.contains(itemElement)) return;
  const item = itemsById.get(String(itemElement.dataset.itemId));
  if (!item) return;

  if (item.type === 'folder') {
    recordSearchKeyword();
    enterFolder(item.id);
  } else {
    recordSearchKeyword({ persist: false });
    openBookmark(item.url, item);
  }
}

function handleResultsContextMenu(event) {
  const itemElement = event.target instanceof Element
    ? event.target.closest('.bookmark-item')
    : null;
  if (!itemElement || !resultsContainer.contains(itemElement)) return;
  const item = itemsById.get(String(itemElement.dataset.itemId));
  if (!item || item.type !== 'bookmark') return;
  event.preventDefault();
  showContextMenu(event, item);
}

function handleFaviconError(event) {
  const favicon = event.target;
  if (!(favicon instanceof HTMLImageElement) || !favicon.classList.contains('bookmark-favicon')) return;
  if (favicon.dataset.faviconDomain) {
    failedFaviconDomains.add(favicon.dataset.faviconDomain);
  }
  if (favicon.dataset.fallback) {
    favicon.parentElement.textContent = favicon.dataset.fallback;
  } else {
    favicon.parentElement.innerHTML = iconSvg('globe');
  }
}

function getFaviconUrl(url, knownDomain = '') {
  try {
    const domain = knownDomain || getFaviconDomain(url);
    if (!domain) return '';
    if (failedFaviconDomains.has(domain)) return '';
    if (faviconUrlCache.has(domain)) {
      const cachedUrl = faviconUrlCache.get(domain);
      faviconUrlCache.delete(domain);
      faviconUrlCache.set(domain, cachedUrl);
      return cachedUrl;
    }
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
    if (faviconUrlCache.size >= MAX_FAVICON_CACHE) {
      faviconUrlCache.delete(faviconUrlCache.keys().next().value);
    }
    faviconUrlCache.set(domain, faviconUrl);
    return faviconUrl;
  } catch {
    return '';
  }
}

function getFaviconDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function getDisplayUrl(url) {
  if (displayUrlCache.has(url)) {
    const cachedDisplayUrl = displayUrlCache.get(url);
    displayUrlCache.delete(url);
    displayUrlCache.set(url, cachedDisplayUrl);
    return cachedDisplayUrl;
  }
  try {
    const parsedUrl = new URL(url);
    const path = parsedUrl.pathname === '/' ? '' : parsedUrl.pathname;
    const displayUrl = `${parsedUrl.hostname}${path}`;
    if (displayUrlCache.size >= MAX_DISPLAY_URL_CACHE) {
      displayUrlCache.delete(displayUrlCache.keys().next().value);
    }
    displayUrlCache.set(url, displayUrl);
    return displayUrl;
  } catch {
    return url;
  }
}

function getSiteInitial(bookmark) {
  const source = getDisplayUrl(bookmark.url || '') || bookmark.title || '?';
  return source.charAt(0).toUpperCase();
}

function highlightText(text, keywords) {
  const value = String(text);
  const normalizedKeywords = [...new Set(
    (Array.isArray(keywords) ? keywords : [keywords])
      .map(keyword => String(keyword || '').trim())
      .filter(Boolean)
  )].sort((first, second) => second.length - first.length);
  if (normalizedKeywords.length === 0) return escapeHtml(value);

  const cacheKey = normalizedKeywords.join('\u0000');
  if (cacheKey !== highlightRegexCacheKey) {
    highlightRegexCacheKey = cacheKey;
    highlightRegexCache = new RegExp(`(${normalizedKeywords.map(escapeRegExp).join('|')})`, 'gi');
  }
  return value.split(highlightRegexCache).map((part, index) => {
    const escapedPart = escapeHtml(part);
    return index % 2 === 1 ? `<mark class="highlight">${escapedPart}</mark>` : escapedPart;
  }).join('');
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function iconSvg(name) {
  const paths = {
    folder: '<path d="M3 7.5h6l2 2H21v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5Z"></path><path d="M3 7.5V5a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v2.5"></path>',
    globe: '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3c2.2 2.5 3.3 5.5 3.3 9S14.2 18.5 12 21c-2.2-2.5-3.3-5.5-3.3-9S9.8 5.5 12 3Z"></path>',
    'chevron-right': '<path d="m9 18 6-6-6-6"></path>',
    'external-link': '<path d="M14 4h6v6M20 4l-9 9"></path><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"></path>',
    history: '<path d="M4.5 9A8 8 0 1 1 4 15"></path><path d="M4 4v5h5M12 8v4l3 2"></path>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path>',
    more: '<circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle>'
  };

  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ''}</svg>`;
}

// ==================== 键盘导航 ====================
function isComposingKey(event) {
  // Some IMEs finish composition before dispatching their confirming keydown.
  return isSearchComposing || event.isComposing || event.keyCode === 229;
}

function handleKeyNavigation(event) {
  if (isComposingKey(event) || isKeyboardLayerOpen()) return;
  if (handleCommandKeyboard(event)) return;
  if (handleEnhancedKeyboardShortcut(event)) return;

  const hasNavigationModifier = event.altKey || event.ctrlKey || event.metaKey;
  if (!searchHistoryEl.hidden) {
    const historyItems = searchHistoryEl.querySelectorAll('.history-item:not(.clear-history-item)');

    if (event.key === 'ArrowDown' && !hasNavigationModifier && historyItems.length > 0) {
      event.preventDefault();
      setHistorySelectedIndex((historySelectedIndex + 1) % historyItems.length);
      return;
    }

    if (event.key === 'ArrowUp' && !hasNavigationModifier && historyItems.length > 0) {
      event.preventDefault();
      setHistorySelectedIndex((historySelectedIndex - 1 + historyItems.length) % historyItems.length);
      return;
    }

    if (event.key === 'Enter' && !hasNavigationModifier && !event.shiftKey) {
      event.preventDefault();
      if (historySelectedIndex >= 0) {
        historyItems[historySelectedIndex].click();
      }
      return;
    }
  }

  const bookmarkItems = resultsContainer.querySelectorAll('.bookmark-item');
  const totalItems = bookmarkItems.length;

  if (event.key === 'Escape') {
    event.preventDefault();
    handleEscapeNavigation();
    return;
  }

  if (totalItems === 0) return;

  switch (event.key) {
    case 'ArrowDown':
      if (hasNavigationModifier) break;
      event.preventDefault();
      setSelectedIndex((selectedIndex + 1) % totalItems);
      scrollToSelected({ behavior: 'auto' });
      break;

    case 'ArrowUp':
      if (hasNavigationModifier) break;
      event.preventDefault();
      setSelectedIndex((selectedIndex - 1 + totalItems) % totalItems);
      scrollToSelected({ behavior: 'auto' });
      break;

    case 'Enter':
      event.preventDefault();
      {
        const selectedItem = bookmarkItems[selectedIndex >= 0 ? selectedIndex : 0];
        const item = itemsById.get(String(selectedItem.dataset.itemId));
        const openInBackground = (event.ctrlKey || event.metaKey) && item?.type === 'bookmark';
        const openInCurrentTab = event.shiftKey && item?.type === 'bookmark';

        if (openInBackground || openInCurrentTab) {
          recordSearchKeyword({ persist: false });
          openBookmark(item.url, item, openInCurrentTab ? 'current' : 'background');
        } else {
          selectedItem.click();
        }
      }
      break;
  }
}

function handleGlobalKeyboardShortcuts(event) {
  if (event.defaultPrevented || isKeyboardLayerOpen() || isComposingKey(event)) return;
  if (handleCommandKeyboard(event)) return;
  if (handleEnhancedKeyboardShortcut(event)) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    handleEscapeNavigation();
    return;
  }

  const focusedResult = document.activeElement instanceof Element
    ? document.activeElement.closest('.bookmark-item')
    : null;
  if (focusedResult && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault();
    moveFocusedResultSelection(event.key === 'ArrowDown' ? 1 : -1);
  }
}

function handleEscapeNavigation() {
  if (!searchHistoryEl.hidden) {
    hideSearchHistory();
  } else if (searchInput.value) {
    clearSearch();
  } else if (currentFolderId !== null) {
    handleBack();
  } else if (document.activeElement !== searchInput) {
    searchInput.focus();
  } else {
    window.close();
  }
}

function isKeyboardLayerOpen() {
  return !settingsPanel.hidden
    || !confirmDialog.hidden
    || !bookmarkActions.hidden
    || !bookmarkEditor.hidden
    || !shortcutHelp.hidden;
}

function handleEnhancedKeyboardShortcut(event) {
  if (isComposingKey(event) || isCommandMode()) return false;
  if (['Enter', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End',
    'PageDown', 'PageUp', 'F2', 'F10', 'ContextMenu'].includes(event.key)) {
    flushPendingSearch();
  }
  const selection = getSelectedResultContext();
  const intent = getShortcutIntent(event, {
    hasSelection: Boolean(selection),
    inFolder: currentFolderId !== null,
    isInputFocused: document.activeElement === searchInput,
    searchEmpty: searchInput.value.length === 0,
    selectedType: selection?.item.type || null
  });
  if (!intent) return false;

  event.preventDefault();
  executeShortcutIntent(intent, selection);
  return true;
}

function executeShortcutIntent(intent, selection) {
  switch (intent) {
    case 'focus-search':
      searchInput.focus();
      searchInput.select();
      if (!searchInput.value) showSearchHistory();
      break;
    case 'show-shortcuts':
      openShortcutHelp();
      break;
    case 'parent-folder':
      handleBack();
      break;
    case 'enter-folder':
      activateSelectedFolder(selection);
      break;
    case 'next-folder':
      selectAdjacentFolder(1);
      break;
    case 'previous-folder':
      selectAdjacentFolder(-1);
      break;
    case 'first-result':
      selectResultBoundary('first');
      break;
    case 'last-result':
      selectResultBoundary('last');
      break;
    case 'page-down':
      moveSelectionByPage(1);
      break;
    case 'page-up':
      moveSelectionByPage(-1);
      break;
    case 'bookmark-actions':
      openSelectedBookmarkActions(selection);
      break;
    case 'open-background':
      recordSearchKeyword({ persist: false });
      openBookmark(selection.item.url, selection.item, 'background');
      break;
    case 'open-current':
      recordSearchKeyword({ persist: false });
      openBookmark(selection.item.url, selection.item, 'current');
      break;
    case 'edit-bookmark':
      openBookmarkEditor(selection.item, selection.element);
      break;
    case 'delete-bookmark':
      deleteBookmarkWithConfirmation(selection.item);
      break;
  }
}

function getSelectedResultContext() {
  const resultItems = [...resultsContainer.querySelectorAll('.bookmark-item')];
  let element = resultsContainer.querySelector('.bookmark-item.selected');

  if (!element && document.activeElement instanceof Element) {
    const focusedItem = document.activeElement.closest('.bookmark-item');
    if (focusedItem && resultsContainer.contains(focusedItem)) {
      element = focusedItem;
    }
  }

  if (!element) return null;
  const index = resultItems.indexOf(element);
  const item = itemsById.get(String(element.dataset.itemId));
  return item ? { element, index, item } : null;
}

function selectAdjacentFolder(direction) {
  hideSearchHistory();
  const resultItems = [...resultsContainer.querySelectorAll('.bookmark-item')];
  if (resultItems.length === 0) return;

  const startIndex = selectedIndex >= 0
    ? selectedIndex
    : direction > 0 ? -1 : 0;

  for (let offset = 1; offset <= resultItems.length; offset++) {
    const index = (startIndex + direction * offset + resultItems.length) % resultItems.length;
    if (resultItems[index].dataset.itemType === 'folder') {
      setSelectedIndex(index);
      scrollToSelected({ behavior: 'auto' });
      syncFocusedResultToSelection();
      return;
    }
  }

  showError('当前列表中没有文件夹');
}

function activateSelectedFolder(selection = getSelectedResultContext()) {
  if (selection?.item.type === 'folder') {
    selection.element.click();
    return;
  }

  selectAdjacentFolder(1);
}

function selectResultBoundary(position) {
  hideSearchHistory();
  const resultItems = resultsContainer.querySelectorAll('.bookmark-item');
  if (resultItems.length === 0) return;

  setSelectedIndex(position === 'first' ? 0 : resultItems.length - 1);
  scrollToSelected();
  syncFocusedResultToSelection();
}

function moveSelectionByPage(direction) {
  hideSearchHistory();
  const resultItems = resultsContainer.querySelectorAll('.bookmark-item');
  if (resultItems.length === 0) return;

  const visibleItemCount = Math.max(1, Math.floor(contentArea.clientHeight / 59));
  const startIndex = selectedIndex >= 0
    ? selectedIndex
    : direction > 0 ? -1 : resultItems.length;
  const nextIndex = Math.max(
    0,
    Math.min(resultItems.length - 1, startIndex + direction * visibleItemCount)
  );
  setSelectedIndex(nextIndex);
  scrollToSelected();
  syncFocusedResultToSelection();
}

function moveFocusedResultSelection(direction) {
  const resultItems = [...resultsContainer.querySelectorAll('.bookmark-item')];
  if (resultItems.length === 0) return;

  const currentSelection = getSelectedResultContext();
  const currentIndex = currentSelection?.index ?? (direction > 0 ? -1 : 0);
  const nextIndex = (currentIndex + direction + resultItems.length) % resultItems.length;
  setSelectedIndex(nextIndex);
  resultItems[nextIndex].focus({ preventScroll: true });
  scrollToSelected({ behavior: 'auto' });
}

function syncFocusedResultToSelection() {
  if (!(document.activeElement instanceof Element)
    || !resultsContainer.contains(document.activeElement)) return;

  resultsContainer.querySelector('.bookmark-item.selected')?.focus({ preventScroll: true });
}

function openSelectedBookmarkActions(selection = getSelectedResultContext()) {
  if (!selection || selection.item.type !== 'bookmark') return;

  const actionTrigger = selection.element
    .closest('.bookmark-row')
    ?.querySelector('.bookmark-action-trigger');
  openBookmarkActions(selection.item, { anchor: actionTrigger || selection.element });
}

function setSelectedIndex(index) {
  const bookmarkItems = resultsContainer.querySelectorAll('.bookmark-item');
  bookmarkItems.forEach(item => {
    item.classList.remove('selected');
    item.setAttribute('aria-selected', 'false');
  });

  if (index >= 0 && index < bookmarkItems.length) {
    selectedIndex = index;
    bookmarkItems[index].classList.add('selected');
    bookmarkItems[index].setAttribute('aria-selected', 'true');
    searchInput.setAttribute('aria-activedescendant', bookmarkItems[index].id);
  } else {
    selectedIndex = -1;
    searchInput.removeAttribute('aria-activedescendant');
  }

  const target = bookmarkItems[selectedIndex >= 0 ? selectedIndex : 0];
  enterActionLabel.textContent = isCommandMode() ? '执行'
    : target?.dataset.itemType === 'folder' ? '进入' : '打开';
}

function scrollToSelected({ behavior = 'smooth' } = {}) {
  const selectedItem = resultsContainer.querySelector('.bookmark-item.selected');
  if (selectedItem) {
    selectedItem.scrollIntoView({
      behavior: reducedMotionQuery.matches ? 'auto' : behavior,
      block: 'nearest'
    });
  }
}

// ==================== 文件夹导航 ====================
function updateNavigation() {
  breadcrumb.innerHTML = '';
  const chain = getFolderChain(currentFolderId);
  const crumbs = [{ id: null, title: '全部书签' }, ...chain];

  crumbs.forEach((crumb, index) => {
    if (index > 0) {
      const separator = document.createElement('span');
      separator.className = 'breadcrumb-separator';
      separator.textContent = '/';
      separator.setAttribute('aria-hidden', 'true');
      breadcrumb.appendChild(separator);
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'breadcrumb-item';
    button.textContent = crumb.title;
    button.title = crumb.title;

    if (index === crumbs.length - 1) {
      button.setAttribute('aria-current', 'page');
    } else {
      button.addEventListener('click', () => navigateToFolder(crumb.id));
    }

    breadcrumb.appendChild(button);
  });
}

function getFolderChain(folderId) {
  const chain = [];
  let activeFolder = foldersById.get(String(folderId));

  while (activeFolder) {
    chain.unshift({ id: activeFolder.id, title: activeFolder.title });
    activeFolder = foldersById.get(String(activeFolder.parentId));
  }

  return chain;
}

function navigateToFolder(folderId) {
  currentFolderId = folderId;
  searchInput.value = '';
  toggleClearButton();
  updateView();
  searchInput.focus();
  hideSearchHistory();
}

function handleBack() {
  if (currentFolderId === null) return;

  const previousFolderId = currentFolderId;
  const currentFolder = foldersById.get(String(currentFolderId));
  navigateToFolder(currentFolder ? currentFolder.parentId : null);

  const previousFolderIndex = [...resultsContainer.querySelectorAll('.bookmark-item')]
    .findIndex(item => item.dataset.itemId === previousFolderId);
  if (previousFolderIndex >= 0) {
    setSelectedIndex(previousFolderIndex);
    scrollToSelected();
  }
}

function enterFolder(folderId) {
  navigateToFolder(folderId);
}

function updateStats(displayedCount, query) {
  if (!query.isEmpty) {
    resultCount.textContent = `${displayedCount} 项`;
  } else if (currentFolderId === null) {
    resultCount.textContent = `${getItemsForParent(null).length} 个顶层项目（全库 ${allBookmarks.length} 个书签）`;
  } else {
    resultCount.textContent = `${displayedCount} 项`;
  }
}

// ==================== 最近使用 ====================
async function openBookmark(url, bookmark, disposition = 'foreground') {
  if (!isAllowedBookmarkUrl(url)) {
    showError('此书签使用了不受支持的网址协议');
    return;
  }

  const historyPromise = addToRecentBookmarks(bookmark).catch(error => {
    console.error('保存使用记录失败:', error);
  });

  try {
    await openBookmarkTab(url, disposition);
  } catch (error) {
    console.error('打开书签失败:', error);
    showError('无法打开此书签，请检查网址');
  }

  await historyPromise;
}

function openBookmarkTab(url, disposition) {
  return new Promise((resolve, reject) => {
    const callback = () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    };

    try {
      if (disposition === 'current') {
        chrome.tabs.update({ url }, callback);
      } else {
        chrome.tabs.create({ url, active: disposition !== 'background' }, callback);
      }
    } catch (error) {
      reject(error);
    }
  });
}

async function addToRecentBookmarks(bookmark) {
  const previousUsage = usageStats[bookmark.id] || {};
  usageStats[bookmark.id] = {
    count: (Number(previousUsage.count) || 0) + 1,
    lastUsed: Date.now()
  };

  const recentBookmark = {
    id: bookmark.id,
    type: 'bookmark',
    title: bookmark.title,
    url: bookmark.url,
    path: bookmark.path,
    parentId: bookmark.parentId
  };
  recentBookmarks = recentBookmarks.filter(item => item.id !== bookmark.id);
  recentBookmarks.unshift(recentBookmark);
  recentBookmarks = recentBookmarks.slice(0, 4);
  await saveHistory();
  displayRecentBookmarks();
}

function displayRecentBookmarks() {
  recentBookmarksEl.innerHTML = '';
  const visibleBookmarks = recentBookmarks.slice(0, 4);
  recentCount.textContent = `${visibleBookmarks.length} 项`;

  visibleBookmarks.forEach(bookmark => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recent-bookmark-item';
    button.title = bookmark.url;
    button.setAttribute('aria-label', `打开最近使用的书签 ${bookmark.title}，${getDisplayUrl(bookmark.url)}`);

    const faviconDomain = getFaviconDomain(bookmark.url);
    const faviconUrl = settings.showFavicon ? getFaviconUrl(bookmark.url, faviconDomain) : '';
    const iconContent = faviconUrl
      ? `<img src="${escapeHtml(faviconUrl)}" class="bookmark-favicon" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-favicon-domain="${escapeHtml(faviconDomain)}" data-fallback="${escapeHtml(getSiteInitial(bookmark))}" alt="">`
      : escapeHtml(getSiteInitial(bookmark));

    button.innerHTML = `
      <span class="recent-favicon">${iconContent}</span>
      <span class="recent-copy">
        <span class="recent-title">${escapeHtml(bookmark.title)}</span>
        <span class="recent-domain">${escapeHtml(getDisplayUrl(bookmark.url))}</span>
      </span>
    `;

    button.addEventListener('click', () => openBookmark(bookmark.url, bookmark));
    button.addEventListener('contextmenu', event => {
      event.preventDefault();
      showContextMenu(event, bookmark);
    });
    recentBookmarksEl.appendChild(button);
  });
}

// ==================== 搜索历史 ====================
function recordSearchKeyword({ persist = true } = {}) {
  const keyword = searchInput.value.trim();
  if (!keyword || isCommandMode()) return;

  searchHistory = searchHistory.filter(item => item.toLowerCase() !== keyword.toLowerCase());
  searchHistory.unshift(keyword);
  searchHistory = searchHistory.slice(0, 8);
  if (persist) {
    saveHistory().catch(error => {
      console.error('保存搜索历史失败:', error);
    });
  }
}

function showSearchHistory() {
  if (searchInput.value.trim() || searchHistory.length === 0 || !settingsPanel.hidden) return;

  searchHistoryEl.innerHTML = '';
  historySelectedIndex = -1;
  // The same combobox owns both the history popup and the results listbox.
  // Never leave an old result id in aria-activedescendant while history is open.
  searchInput.removeAttribute('aria-activedescendant');

  const label = document.createElement('span');
  label.className = 'history-label';
  label.setAttribute('role', 'presentation');
  label.textContent = '最近搜索';
  searchHistoryEl.appendChild(label);

  searchHistory.slice(0, 8).forEach((keyword, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-item';
    button.id = `history-item-${index}`;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', 'false');
    button.innerHTML = iconSvg('history');

    const text = document.createElement('span');
    text.className = 'history-text';
    text.textContent = keyword;
    button.appendChild(text);

    button.addEventListener('click', () => {
      searchInput.value = keyword;
      toggleClearButton();
      hideSearchHistory();
      updateView();
      searchInput.focus();
    });
    searchHistoryEl.appendChild(button);
  });

  const divider = document.createElement('div');
  divider.className = 'history-divider';
  divider.setAttribute('role', 'presentation');
  searchHistoryEl.appendChild(divider);

  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'history-item clear-history-item';
  clearButton.setAttribute('role', 'option');
  clearButton.setAttribute('aria-selected', 'false');
  clearButton.setAttribute('aria-label', '清空搜索历史');
  clearButton.innerHTML = `${iconSvg('trash')}<span>清空搜索历史</span>`;
  clearButton.addEventListener('click', clearSearchHistory);
  searchHistoryEl.appendChild(clearButton);

  searchHistoryEl.hidden = false;
  syncSearchExpandedState();
}

function hideSearchHistory() {
  searchHistoryEl.hidden = true;
  historySelectedIndex = -1;
  searchInput.removeAttribute('aria-activedescendant');
  syncSearchExpandedState();
}

function syncSearchExpandedState() {
  searchInput.setAttribute('aria-expanded', String(!resultsSection.hidden || !searchHistoryEl.hidden));
}

function setHistorySelectedIndex(index) {
  const historyItems = searchHistoryEl.querySelectorAll('.history-item:not(.clear-history-item)');
  historySelectedIndex = -1;
  historyItems.forEach(item => {
    item.classList.remove('selected');
    item.setAttribute('aria-selected', 'false');
  });

  if (index >= 0 && index < historyItems.length) {
    historySelectedIndex = index;
    historyItems[index].classList.add('selected');
    historyItems[index].setAttribute('aria-selected', 'true');
    searchInput.setAttribute('aria-activedescendant', historyItems[index].id);
  } else {
    searchInput.removeAttribute('aria-activedescendant');
  }
}

async function clearSearchHistory() {
  hideSearchHistory();
  const confirmed = await requestConfirmation({
    title: '清空搜索历史？',
    message: '保存的搜索关键词将被移除，此操作无法撤销。',
    confirmLabel: '清空'
  });
  if (!confirmed) return;

  searchHistory = [];
  try {
    await saveHistory();
    hideSearchHistory();
    showError('搜索历史已清空', 'success');
  } catch (error) {
    console.error('清空搜索历史失败:', error);
    showError('清空失败，请稍后重试');
  }
}

// ==================== 书签操作与编辑 ====================
function openBookmarkActions(bookmark, { anchor = null, clientX = null, clientY = null } = {}) {
  closeBookmarkActions(false);
  hideSearchHistory();
  activeActionBookmark = bookmark;
  actionMenuLastFocusedElement = anchor || document.activeElement;
  if (actionMenuLastFocusedElement instanceof HTMLElement
    && actionMenuLastFocusedElement.classList.contains('bookmark-action-trigger')) {
    actionMenuLastFocusedElement.setAttribute('aria-expanded', 'true');
  }
  bookmarkActionsTitle.textContent = bookmark.title;
  bookmarkActions.hidden = false;
  bookmarkActions.setAttribute('aria-hidden', 'false');

  const menuRect = bookmarkActions.getBoundingClientRect();
  const viewportPadding = 8;
  let left;
  let top;

  if (anchor) {
    const anchorRect = anchor.getBoundingClientRect();
    left = anchorRect.right - menuRect.width;
    top = anchorRect.bottom + 6;
    if (top + menuRect.height > window.innerHeight - viewportPadding) {
      top = anchorRect.top - menuRect.height - 6;
    }
  } else {
    left = Number.isFinite(clientX) ? clientX : viewportPadding;
    top = Number.isFinite(clientY) ? clientY : viewportPadding;
    if (top + menuRect.height > window.innerHeight - viewportPadding) {
      top -= menuRect.height;
    }
  }

  bookmarkActions.style.left = `${Math.max(viewportPadding, Math.min(left, window.innerWidth - menuRect.width - viewportPadding))}px`;
  bookmarkActions.style.top = `${Math.max(viewportPadding, Math.min(top, window.innerHeight - menuRect.height - viewportPadding))}px`;
  bookmarkActions.querySelector('[role="menuitem"]')?.focus();
}

function closeBookmarkActions(restoreFocus = true) {
  if (bookmarkActions.hidden) return;

  const focusTarget = actionMenuLastFocusedElement;
  if (focusTarget instanceof HTMLElement
    && focusTarget.classList.contains('bookmark-action-trigger')) {
    focusTarget.setAttribute('aria-expanded', 'false');
  }
  bookmarkActions.hidden = true;
  bookmarkActions.setAttribute('aria-hidden', 'true');
  activeActionBookmark = null;
  actionMenuLastFocusedElement = null;

  if (restoreFocus && focusTarget instanceof HTMLElement && document.contains(focusTarget)) {
    focusTarget.focus();
  }
}

async function handleBookmarkAction(event) {
  const actionButton = event.target.closest('[data-action]');
  if (!actionButton || !activeActionBookmark) return;

  const action = actionButton.dataset.action;
  const bookmark = activeActionBookmark;
  const returnFocus = actionMenuLastFocusedElement;
  closeBookmarkActions(false);

  if (action === 'open-background') {
    recordSearchKeyword({ persist: false });
    await openBookmark(bookmark.url, bookmark, 'background');
    if (returnFocus instanceof HTMLElement && document.contains(returnFocus)) {
      returnFocus.focus();
    } else {
      searchInput.focus();
    }
  } else if (action === 'edit') {
    openBookmarkEditor(bookmark, returnFocus);
  } else if (action === 'delete') {
    if (returnFocus instanceof HTMLElement && document.contains(returnFocus)) {
      returnFocus.focus();
    }
    await deleteBookmarkWithConfirmation(bookmark);
  }
}

function handleBookmarkActionsKeydown(event) {
  const menuItems = [...bookmarkActions.querySelectorAll('[role="menuitem"]')];
  const currentIndex = menuItems.indexOf(document.activeElement);

  if (event.key === 'Escape') {
    event.preventDefault();
    closeBookmarkActions();
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    menuItems[(currentIndex + 1) % menuItems.length]?.focus();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    menuItems[(currentIndex - 1 + menuItems.length) % menuItems.length]?.focus();
  } else if (event.key === 'Home') {
    event.preventDefault();
    menuItems[0]?.focus();
  } else if (event.key === 'End') {
    event.preventDefault();
    menuItems[menuItems.length - 1]?.focus();
  } else if (event.key === 'Tab') {
    closeBookmarkActions(false);
  }
}

function showContextMenu(event, bookmark) {
  openBookmarkActions(bookmark, {
    clientX: event.clientX,
    clientY: event.clientY
  });
}

function openBookmarkEditor(bookmark, returnFocus = null) {
  editingBookmarkId = bookmark.id;
  bookmarkEditorReturnFocus = returnFocus;
  bookmarkTitleInput.value = bookmark.title;
  bookmarkUrlInput.value = bookmark.url;
  bookmarkEditorError.hidden = true;
  bookmarkEditorError.textContent = '';
  saveBookmarkEditor.disabled = false;
  saveBookmarkEditor.textContent = '保存修改';
  bookmarkEditor.hidden = false;
  bookmarkEditor.setAttribute('aria-hidden', 'false');

  queueMicrotask(() => {
    bookmarkTitleInput.focus();
    bookmarkTitleInput.select();
  });
}

function closeBookmarkEditorDialog(restoreFocus = true) {
  if (bookmarkEditor.hidden) return;

  const focusTarget = bookmarkEditorReturnFocus;
  bookmarkEditor.hidden = true;
  bookmarkEditor.setAttribute('aria-hidden', 'true');
  editingBookmarkId = null;
  bookmarkEditorReturnFocus = null;

  if (restoreFocus && focusTarget instanceof HTMLElement && document.contains(focusTarget)) {
    focusTarget.focus();
  } else if (restoreFocus) {
    searchInput.focus();
  }
}

function handleBookmarkEditorKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeBookmarkEditorDialog();
    return;
  }

  if (event.key !== 'Tab') return;

  const focusableElements = bookmarkEditor.querySelectorAll('button:not([disabled]), input:not([disabled])');
  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  if (event.shiftKey && document.activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
  } else if (!event.shiftKey && document.activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
}

async function saveBookmarkChanges(event) {
  event.preventDefault();
  const title = bookmarkTitleInput.value.trim();
  const url = bookmarkUrlInput.value.trim();

  if (!title) {
    showBookmarkEditorError('请输入书签名称。');
    bookmarkTitleInput.focus();
    return;
  }

  if (!isAllowedBookmarkUrl(url)) {
    showBookmarkEditorError('请输入受支持的网址，例如 https://example.com。');
    bookmarkUrlInput.focus();
    return;
  }

  saveBookmarkEditor.disabled = true;
  saveBookmarkEditor.textContent = '保存中…';

  try {
    const updatedBookmark = await updateBookmarkById(editingBookmarkId, { title, url });
    recentBookmarks = recentBookmarks.map(bookmark => (
      bookmark.id === updatedBookmark.id
        ? { ...bookmark, title: updatedBookmark.title, url: updatedBookmark.url }
        : bookmark
    ));
    await Promise.all([saveHistory(), loadBookmarks()]);
    closeBookmarkEditorDialog(false);
    updateView();
    searchInput.focus();
    showError('书签已更新', 'success');
  } catch (error) {
    console.error('更新书签失败:', error);
    showBookmarkEditorError('保存失败，请稍后重试。');
    saveBookmarkEditor.disabled = false;
    saveBookmarkEditor.textContent = '保存修改';
  }
}

function isAllowedBookmarkUrl(url) {
  try {
    const parsedUrl = new URL(url);
    if (!allowedBookmarkProtocols.has(parsedUrl.protocol)) return false;
    if (['http:', 'https:', 'ftp:'].includes(parsedUrl.protocol) && !parsedUrl.hostname) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function showBookmarkEditorError(message) {
  bookmarkEditorError.textContent = message;
  bookmarkEditorError.hidden = false;
}

function updateBookmarkById(bookmarkId, changes) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.update(bookmarkId, changes, updatedBookmark => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(updatedBookmark);
      }
    });
  });
}

async function deleteBookmarkWithConfirmation(bookmark) {
  const confirmed = await requestConfirmation({
    title: '删除这个书签？',
    message: `“${bookmark.title}”将从浏览器书签中移除，此操作无法撤销。`,
    confirmLabel: '删除'
  });
  if (!confirmed) return;

  try {
    await removeBookmarkById(bookmark.id);
    recentBookmarks = recentBookmarks.filter(item => item.id !== bookmark.id);
    delete usageStats[bookmark.id];
    await Promise.all([saveHistory(), loadBookmarks()]);
    displayRecentBookmarks();
    updateView();
    showError('书签已删除', 'success');
  } catch (error) {
    console.error('删除书签失败:', error);
    showError('删除失败，请稍后重试');
  }
}

function removeBookmarkById(bookmarkId) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.remove(bookmarkId, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

// ==================== 快捷键说明 ====================
function openShortcutHelp() {
  if (!shortcutHelp.hidden) return;

  closeBookmarkActions(false);
  hideSearchHistory();
  shortcutHelpLastFocusedElement = document.activeElement;
  shortcutHelp.hidden = false;
  shortcutHelp.setAttribute('aria-hidden', 'false');
  closeShortcutHelp.focus();
}

function closeShortcutHelpDialog(restoreFocus = true) {
  if (shortcutHelp.hidden) return;

  const focusTarget = shortcutHelpLastFocusedElement;
  shortcutHelp.hidden = true;
  shortcutHelp.setAttribute('aria-hidden', 'true');
  shortcutHelpLastFocusedElement = null;

  if (restoreFocus && focusTarget instanceof HTMLElement && document.contains(focusTarget)) {
    focusTarget.focus();
  } else if (restoreFocus) {
    searchInput.focus();
  }
}

function handleShortcutHelpKeydown(event) {
  if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key === '/')) {
    event.preventDefault();
    closeShortcutHelpDialog();
    return;
  }

  if (event.key !== 'Tab') return;

  const focusableElements = shortcutHelp.querySelectorAll('button:not([disabled])');
  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  if (event.shiftKey && document.activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
  } else if (!event.shiftKey && document.activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
}

// ==================== 设置面板 ====================
function openSettings() {
  if (!settingsPanel.hidden && !settingsPanel.classList.contains('is-closing')) return;

  const generation = ++settingsAnimationGeneration;
  cancelSettingsAnimations();
  closeBookmarkActions(false);
  hideSearchHistory();
  lastFocusedElement = document.activeElement;
  settingsPanel.hidden = false;
  settingsPanel.setAttribute('aria-hidden', 'false');
  settingsPanel.classList.remove('is-closing');
  closeSettings.focus();

  const reducedMotion = reducedMotionQuery.matches;
  settingsPanelAnimation = settingsPanel.animate(
    [{ opacity: 0 }, { opacity: 1 }],
    {
      duration: reducedMotion ? 1 : 180,
      easing: 'ease-out',
      fill: 'both'
    }
  );
  settingsDrawerAnimation = settingsContent.animate(
    reducedMotion
      ? [{ opacity: 0.65 }, { opacity: 1 }]
      : [
          { opacity: 0.35, transform: 'translateX(100%)' },
          { opacity: 1, transform: 'translateX(0)' }
        ],
    {
      duration: reducedMotion ? 1 : 260,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'both'
    }
  );

  Promise.allSettled([
    settingsPanelAnimation.finished,
    settingsDrawerAnimation.finished
  ]).then(() => {
    if (generation === settingsAnimationGeneration && !settingsPanel.classList.contains('is-closing')) {
      cancelSettingsAnimations();
    }
  });
}

function closeSettingsPanel() {
  if (settingsPanel.hidden || settingsPanel.classList.contains('is-closing')) return;

  const generation = ++settingsAnimationGeneration;
  const panelOpacity = getComputedStyle(settingsPanel).opacity;
  const drawerStyles = getComputedStyle(settingsContent);
  const drawerOpacity = drawerStyles.opacity;
  const drawerTransform = drawerStyles.transform === 'none'
    ? 'translateX(0)'
    : drawerStyles.transform;

  cancelSettingsAnimations();
  settingsPanel.classList.add('is-closing');
  const reducedMotion = reducedMotionQuery.matches;
  settingsPanelAnimation = settingsPanel.animate(
    [{ opacity: panelOpacity }, { opacity: 0 }],
    {
      duration: reducedMotion ? 1 : 160,
      easing: 'ease-in',
      fill: 'both'
    }
  );
  settingsDrawerAnimation = settingsContent.animate(
    reducedMotion
      ? [{ opacity: drawerOpacity }, { opacity: 0 }]
      : [
          { opacity: drawerOpacity, transform: drawerTransform },
          { opacity: 0.25, transform: 'translateX(100%)' }
        ],
    {
      duration: reducedMotion ? 1 : 220,
      easing: 'cubic-bezier(0.4, 0, 1, 1)',
      fill: 'both'
    }
  );

  Promise.allSettled([
    settingsPanelAnimation.finished,
    settingsDrawerAnimation.finished
  ]).then(() => {
    if (generation === settingsAnimationGeneration) {
      finishClosingSettings();
    }
  });
}

function finishClosingSettings() {
  cancelSettingsAnimations();
  settingsPanel.hidden = true;
  settingsPanel.setAttribute('aria-hidden', 'true');
  settingsPanel.classList.remove('is-closing');

  if (lastFocusedElement instanceof HTMLElement) {
    lastFocusedElement.focus();
  }
  hideSearchHistory();
}

function cancelSettingsAnimations() {
  settingsPanelAnimation?.cancel();
  settingsDrawerAnimation?.cancel();
  settingsPanelAnimation = null;
  settingsDrawerAnimation = null;
}

function handleSettingsKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeSettingsPanel();
    return;
  }

  if (event.key !== 'Tab') return;

  const focusableElements = settingsPanel.querySelectorAll('button, input:not([disabled])');
  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  if (event.shiftKey && document.activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
  } else if (!event.shiftKey && document.activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
}

function changeThemeMode(event) {
  settings.themeMode = event.target.value;
  applyTheme();
  persistSettings();
}

function changeColorTheme(event) {
  settings.colorTheme = event.target.value;
  applyTheme();
  persistSettings();
}

function applyTheme() {
  const useDarkTheme = settings.themeMode === 'dark'
    || (settings.themeMode === 'system' && systemThemeQuery.matches);

  document.body.classList.toggle('dark-mode', useDarkTheme);
  document.body.dataset.theme = settings.themeMode;
  document.body.dataset.colorTheme = settings.colorTheme;
  themeModeInputs.forEach(input => {
    input.checked = input.value === settings.themeMode;
  });
  colorThemeInputs.forEach(input => {
    input.checked = input.value === settings.colorTheme;
  });
}

function toggleFavicon() {
  settings.showFavicon = showFaviconToggle.checked;
  persistSettings();
  displayRecentBookmarks();
  updateView();
}

function toggleFuzzySearch() {
  settings.fuzzySearch = fuzzySearchToggle.checked;
  persistSettings();
  updateView();
}

async function clearHistory() {
  const confirmed = await requestConfirmation({
    title: '清除全部历史？',
    message: '最近使用的书签和搜索关键词都会被移除，此操作无法撤销。',
    confirmLabel: '全部清除'
  });
  if (!confirmed) return;

  recentBookmarks = [];
  searchHistory = [];
  usageStats = {};
  try {
    await saveHistory();
    displayRecentBookmarks();
    updateView();
    showError('历史记录已清除', 'success');
  } catch (error) {
    console.error('清除历史记录失败:', error);
    showError('清除失败，请稍后重试');
  }
}

// ==================== 设置与历史存储 ====================
async function loadSettings() {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(['settings'], result => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const savedSettings = result.settings && typeof result.settings === 'object'
        ? result.settings
        : {};
      const migratedTheme = ['system', 'light', 'dark'].includes(savedSettings.themeMode)
        ? savedSettings.themeMode
        : typeof savedSettings.darkMode === 'boolean'
          ? (savedSettings.darkMode ? 'dark' : 'light')
          : 'system';
      const availableColorThemes = ['classic', 'candy', 'ocean', 'matcha', 'sunset', 'mono'];
      const migratedColorTheme = availableColorThemes.includes(savedSettings.colorTheme)
        ? savedSettings.colorTheme
        : 'classic';

      settings = {
        ...settings,
        themeMode: migratedTheme,
        colorTheme: migratedColorTheme,
        showFavicon: typeof savedSettings.showFavicon === 'boolean'
          ? savedSettings.showFavicon
          : settings.showFavicon,
        fuzzySearch: typeof savedSettings.fuzzySearch === 'boolean'
          ? savedSettings.fuzzySearch
          : settings.fuzzySearch
      };
      delete settings.darkMode;

      showFaviconToggle.checked = settings.showFavicon;
      fuzzySearchToggle.checked = settings.fuzzySearch;
      applyTheme();
      resolve();
    });
  });
}

async function saveSettings() {
  const snapshot = {
    settings: {
      themeMode: settings.themeMode,
      colorTheme: settings.colorTheme,
      showFavicon: settings.showFavicon,
      fuzzySearch: settings.fuzzySearch
    }
  };
  settingsSaveQueue = settingsSaveQueue.catch(() => {}).then(() => new Promise((resolve, reject) => {
    chrome.storage.sync.set(snapshot, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  }));
  return settingsSaveQueue;
}

function persistSettings() {
  saveSettings().catch(error => {
    console.error('保存设置失败:', error);
    showError('设置未能保存，请稍后重试');
  });
}

async function loadHistory() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['recentBookmarks', 'searchHistory', 'usageStats'], result => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      recentBookmarks = sanitizeRecentBookmarks(result.recentBookmarks);
      searchHistory = sanitizeSearchHistory(result.searchHistory);
      usageStats = sanitizeUsageStats(result.usageStats);
      resolve();
    });
  });
}

function sanitizeRecentBookmarks(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && (typeof item.id === 'string' || typeof item.id === 'number'))
    .map(item => ({
      id: String(item.id),
      type: 'bookmark',
      title: String(item.title || '').slice(0, 255),
      url: String(item.url || '').slice(0, 4096),
      path: String(item.path || '根目录').slice(0, 2048),
      parentId: item.parentId === null || item.parentId === undefined ? null : String(item.parentId)
    }))
    .filter(item => item.title && item.url && isAllowedBookmarkUrl(item.url))
    .slice(0, 4);
}

function sanitizeSearchHistory(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map(item => String(item || '').trim().slice(0, 200))
    .filter(item => {
      const key = item.toLocaleLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function sanitizeUsageStats(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([id, usage]) => {
        if (!id || !usage || typeof usage !== 'object') return false;
        const count = Number(usage.count);
        const lastUsed = Number(usage.lastUsed);
        return Number.isFinite(count) && count >= 0 && Number.isFinite(lastUsed) && lastUsed >= 0;
      })
      .map(([id, usage]) => [String(id), {
        count: Math.min(1000000, Math.floor(Number(usage.count))),
        lastUsed: Math.min(Date.now(), Number(usage.lastUsed))
      }])
      .sort((first, second) => second[1].lastUsed - first[1].lastUsed)
      .slice(0, 250)
  );
}

function saveHistory() {
  recentBookmarks = sanitizeRecentBookmarks(recentBookmarks);
  searchHistory = sanitizeSearchHistory(searchHistory);
  usageStats = sanitizeUsageStats(usageStats);
  const snapshot = {
    recentBookmarks: recentBookmarks.map(item => ({ ...item })),
    searchHistory: [...searchHistory],
    usageStats: Object.fromEntries(Object.entries(usageStats).map(([id, usage]) => [id, { ...usage }]))
  };

  historySaveQueue = historySaveQueue.catch(() => {}).then(() => new Promise((resolve, reject) => {
    chrome.storage.local.set(snapshot, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  }));
  return historySaveQueue;
}

// ==================== UI 辅助函数 ====================
function showLoading(show) {
  loadingState.hidden = !show;
  contentArea.setAttribute('aria-busy', String(show));

  if (show) {
    recentSection.hidden = true;
    resultsSection.hidden = true;
    emptyState.hidden = true;
  }
}

function showError(message, type = 'error') {
  clearTimeout(toastTimeout);
  errorToast.textContent = message;
  errorToast.classList.toggle('success', type === 'success');
  errorToast.hidden = false;

  toastTimeout = setTimeout(() => {
    errorToast.hidden = true;
  }, 2600);
}

// ==================== 自定义确认对话框 ====================
function requestConfirmation({ title, message, confirmLabel = '确认' }) {
  if (confirmResolver) {
    closeConfirmation(false);
  }

  confirmLastFocusedElement = document.activeElement;
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  confirmActionButton.textContent = confirmLabel;
  confirmDialog.hidden = false;
  confirmDialog.setAttribute('aria-hidden', 'false');
  confirmCancelButton.focus();

  return new Promise(resolve => {
    confirmResolver = resolve;
  });
}

function closeConfirmation(confirmed) {
  if (confirmDialog.hidden) return;

  confirmDialog.hidden = true;
  confirmDialog.setAttribute('aria-hidden', 'true');

  const resolve = confirmResolver;
  const focusTarget = confirmLastFocusedElement;
  confirmResolver = null;
  confirmLastFocusedElement = null;

  if (resolve) {
    resolve(confirmed);
  }

  queueMicrotask(() => {
    const targetIsVisible = focusTarget instanceof HTMLElement
      && document.contains(focusTarget)
      && !focusTarget.closest('[hidden]');
    (targetIsVisible ? focusTarget : searchInput).focus();
  });
}

function handleConfirmationKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeConfirmation(false);
    return;
  }

  if (event.key !== 'Tab') return;

  if (event.shiftKey && document.activeElement === confirmCancelButton) {
    event.preventDefault();
    confirmActionButton.focus();
  } else if (!event.shiftKey && document.activeElement === confirmActionButton) {
    event.preventDefault();
    confirmCancelButton.focus();
  }
}
