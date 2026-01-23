// ==================== 全局变量 ====================
let allBookmarks = []; // 存储所有书签的扁平化数组
let allItems = []; // 存储所有项目（书签 + 文件夹）
let selectedIndex = -1; // 当前选中的书签索引（-1 表示未选中）
let currentFolderId = null; // 当前所在文件夹的 ID（null 表示根目录）
let navigationStack = []; // 导航历史栈
let searchTimeout = null; // 搜索防抖定时器
let recentBookmarks = []; // 最近访问的书签
let searchHistory = []; // 搜索历史
let settings = {
  darkMode: false,
  showFavicon: true,
  fuzzySearch: false  // 默认关闭模糊搜索，使用精确搜索
}; // 用户设置

// ==================== DOM 元素引用 ====================
const searchInput = document.getElementById('searchInput');
const resultsContainer = document.getElementById('results');
const emptyState = document.getElementById('emptyState');
const resultCount = document.getElementById('resultCount');
const backButton = document.getElementById('backButton');
const currentPathDisplay = document.getElementById('currentPath');
const settingsButton = document.getElementById('settingsButton');
const settingsPanel = document.getElementById('settingsPanel');
const closeSettings = document.getElementById('closeSettings');
const darkModeToggle = document.getElementById('darkModeToggle');
const showFaviconToggle = document.getElementById('showFaviconToggle');
const fuzzySearchToggle = document.getElementById('fuzzySearchToggle');
const clearHistoryButton = document.getElementById('clearHistoryButton');
const searchHistoryEl = document.getElementById('searchHistory');
const recentSection = document.getElementById('recentSection');
const recentBookmarksEl = document.getElementById('recentBookmarks');
const loadingState = document.getElementById('loadingState');
const errorToast = document.getElementById('errorToast');
const clearSearchButton = document.getElementById('clearSearchButton');  // 新增清空按钮

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 显示加载状态
    showLoading(true);

    // 加载用户设置
    await loadSettings();

    // 加载历史记录
    await loadHistory();

    // 加载所有书签
    await loadBookmarks();

    // 隐藏加载状态
    showLoading(false);

    // 显示最近访问
    displayRecentBookmarks();

    // 监听搜索框输入事件（实时搜索 + 防抖）
    searchInput.addEventListener('input', handleSearchWithDebounce);

    // 监听搜索框输入事件（控制清空按钮显示）
    searchInput.addEventListener('input', toggleClearButton);

    // 监听清空按钮点击事件
    clearSearchButton.addEventListener('click', clearSearch);

    // 监听搜索框焦点事件（显示搜索历史）
    searchInput.addEventListener('focus', showSearchHistory);
    searchInput.addEventListener('blur', () => {
      setTimeout(() => hideSearchHistory(), 200);
    });

    // 监听键盘事件（导航和打开）
    searchInput.addEventListener('keydown', handleKeyNavigation);

    // 监听返回按钮点击事件
    backButton.addEventListener('click', handleBack);

    // 监听设置按钮
    settingsButton.addEventListener('click', openSettings);
    closeSettings.addEventListener('click', closeSettingsPanel);

    // 监听设置变更
    darkModeToggle.addEventListener('change', toggleDarkMode);
    showFaviconToggle.addEventListener('change', toggleFavicon);
    fuzzySearchToggle.addEventListener('change', toggleFuzzySearch);
    clearHistoryButton.addEventListener('click', clearHistory);

    // 点击设置面板外部关闭
    settingsPanel.addEventListener('click', (e) => {
      if (e.target === settingsPanel) {
        closeSettingsPanel();
      }
    });

    // 创建右键菜单
    createContextMenu();

  } catch (error) {
    console.error('初始化失败:', error);
    showError('初始化失败，请刷新重试');
    showLoading(false);
  }
});

// ==================== 加载书签 ====================
async function loadBookmarks() {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.getTree((bookmarkTreeNodes) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }

      try {
        allItems = flattenBookmarks(bookmarkTreeNodes);
        allBookmarks = allItems.filter(item => item.type === 'bookmark');
        updateView();
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

// ==================== 扁平化书签树 ====================
function flattenBookmarks(nodes, path = '', parentId = null) {
  let items = [];

  nodes.forEach(node => {
    if (!node.title) {
      if (node.children) {
        items = items.concat(flattenBookmarks(node.children, path, parentId));
      }
      return;
    }

    const currentPath = path ? `${path} > ${node.title}` : node.title;

    if (node.url) {
      items.push({
        id: node.id,
        type: 'bookmark',
        title: node.title,
        url: node.url,
        path: path || '根目录',
        parentId: parentId
      });
    } else if (node.children) {
      items.push({
        id: node.id,
        type: 'folder',
        title: node.title,
        path: path || '根目录',
        parentId: parentId,
        childCount: countChildren(node.children)
      });

      items = items.concat(
        flattenBookmarks(node.children, currentPath, node.id)
      );
    }
  });

  return items;
}

function countChildren(children) {
  let count = 0;
  children.forEach(child => {
    if (child.url) {
      count++;
    } else if (child.children) {
      count += countChildren(child.children);
    }
  });
  return count;
}

// ==================== 搜索防抖 ====================
function handleSearchWithDebounce() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    handleSearch();
  }, 200); // 200ms 防抖
}

// ==================== 控制清空按钮显示 ====================
function toggleClearButton() {
  if (searchInput.value.trim()) {
    clearSearchButton.style.display = 'flex';
  } else {
    clearSearchButton.style.display = 'none';
  }
}

// ==================== 清空搜索 ====================
function clearSearch() {
  searchInput.value = '';
  clearSearchButton.style.display = 'none';
  handleSearch();
  searchInput.focus();
}

// ==================== 搜索处理 ====================
function handleSearch() {
  const keyword = searchInput.value.trim();

  // 保存搜索历史
  if (keyword && !searchHistory.includes(keyword)) {
    searchHistory.unshift(keyword);
    searchHistory = searchHistory.slice(0, 10); // 只保留最近 10 条
    saveHistory();
  }

  updateView();
}

// ==================== 更新视图 ====================
function updateView() {
  const keyword = searchInput.value.trim().toLowerCase();

  let itemsToDisplay;

  if (currentFolderId === null) {
    if (keyword) {
      itemsToDisplay = searchItems(allItems, keyword);
    } else {
      itemsToDisplay = allItems.filter(item => item.parentId === null);
    }
  } else {
    itemsToDisplay = allItems.filter(item => item.parentId === currentFolderId);
    if (keyword) {
      itemsToDisplay = searchItems(itemsToDisplay, keyword);
    }
  }

  // 排序：文件夹优先，然后按标题排序
  itemsToDisplay.sort((a, b) => {
    // 首先按类型排序：文件夹在前
    if (a.type !== b.type) {
      return a.type === 'folder' ? -1 : 1;
    }
    // 同类型按标题排序（中文优先）
    return a.title.localeCompare(b.title, 'zh-CN', { sensitivity: 'base' });
  });

  selectedIndex = -1;
  displayItems(itemsToDisplay, keyword);

  const totalBookmarks = getTotalBookmarks();
  const displayedBookmarks = itemsToDisplay.filter(item => item.type === 'bookmark').length;
  updateStats(displayedBookmarks, totalBookmarks);
  updateNavigation();
}

// ==================== 搜索功能（支持模糊搜索）====================
function searchItems(items, keyword) {
  if (!keyword) return items;

  if (settings.fuzzySearch) {
    // 模糊搜索 - 改进算法，更宽松的匹配
    return items.filter(item => {
      const titleScore = fuzzyMatch(item.title.toLowerCase(), keyword);
      const urlScore = item.url ? fuzzyMatch(item.url.toLowerCase(), keyword) : 0;
      // 同时也支持精确包含匹配，提高准确性
      const titleIncludes = item.title.toLowerCase().includes(keyword);
      const urlIncludes = item.url && item.url.toLowerCase().includes(keyword);
      return titleScore > 0 || urlScore > 0 || titleIncludes || urlIncludes;
    });
  } else {
    // 精确搜索
    return items.filter(item => {
      const titleMatch = item.title.toLowerCase().includes(keyword);
      const urlMatch = item.url && item.url.toLowerCase().includes(keyword);
      return titleMatch || urlMatch;
    });
  }
}

// ==================== 模糊匹配算法 ====================
function fuzzyMatch(text, pattern) {
  // 改进的模糊匹配算法
  let score = 0;
  let patternIdx = 0;
  let textIdx = 0;
  let consecutiveMatches = 0;

  while (textIdx < text.length && patternIdx < pattern.length) {
    if (text[textIdx] === pattern[patternIdx]) {
      score++;
      consecutiveMatches++;
      patternIdx++;
      // 连续匹配加分
      if (consecutiveMatches > 1) {
        score += consecutiveMatches;
      }
    } else {
      consecutiveMatches = 0;
    }
    textIdx++;
  }

  // 必须匹配所有字符才算成功
  return patternIdx === pattern.length ? score : 0;
}

// ==================== 获取总书签数 ====================
function getTotalBookmarks() {
  if (currentFolderId === null) {
    return allBookmarks.length;
  } else {
    return allItems.filter(item => item.type === 'bookmark' && item.parentId === currentFolderId).length;
  }
}

// ==================== 更新导航 ====================
function updateNavigation() {
  if (currentFolderId === null) {
    backButton.style.display = 'none';
    currentPathDisplay.textContent = '所有书签';
  } else {
    backButton.style.display = 'flex';
    const currentFolder = allItems.find(item => item.id === currentFolderId);
    if (currentFolder) {
      currentPathDisplay.textContent = currentFolder.title;
    }
  }
}

// ==================== 返回上一级 ====================
function handleBack() {
  if (navigationStack.length > 0) {
    currentFolderId = navigationStack.pop();
  } else {
    currentFolderId = null;
  }
  searchInput.value = '';
  updateView();
}

// ==================== 进入文件夹 ====================
function enterFolder(folderId) {
  navigationStack.push(currentFolderId);
  currentFolderId = folderId;
  searchInput.value = '';
  updateView();
}

// ==================== 显示项目列表 ====================
function displayItems(items, keyword = '') {
  resultsContainer.innerHTML = '';

  if (items.length === 0) {
    emptyState.style.display = 'flex';
    resultsContainer.style.display = 'none';
    recentSection.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  resultsContainer.style.display = 'block';

  // 如果没有搜索关键词且在根目录，显示最近访问
  if (!keyword && currentFolderId === null && recentBookmarks.length > 0) {
    recentSection.style.display = 'block';
  } else {
    recentSection.style.display = 'none';
  }

  items.forEach((item, index) => {
    const itemElement = createItemElement(item, keyword, index);
    resultsContainer.appendChild(itemElement);
  });
}

// ==================== 创建项目元素 ====================
function createItemElement(item, keyword, index) {
  const div = document.createElement('div');
  div.className = item.type === 'folder' ? 'bookmark-item folder-item' : 'bookmark-item';
  div.dataset.index = index;
  div.setAttribute('role', 'listitem');

  const highlightedTitle = highlightText(item.title, keyword);

  if (item.type === 'folder') {
    div.innerHTML = `
      <div class="bookmark-title">
        <span class="folder-icon">📁</span>
        ${highlightedTitle}
        <span class="folder-count">(${item.childCount})</span>
      </div>
      <div class="bookmark-path">📂 ${item.path}</div>
    `;

    div.addEventListener('click', () => {
      enterFolder(item.id);
    });
  } else {
    const highlightedUrl = highlightText(item.url, keyword);
    const faviconHtml = settings.showFavicon ? `<img src="${getFaviconUrl(item.url)}" class="bookmark-favicon" onerror="this.style.display='none'">` : '';

    div.innerHTML = `
      <div class="bookmark-title">
        ${faviconHtml}
        ${highlightedTitle}
      </div>
      <div class="bookmark-url">${highlightedUrl}</div>
      <div class="bookmark-path">📁 ${item.path}</div>
    `;

    div.addEventListener('click', () => {
      openBookmark(item.url, item);
    });

    // 右键菜单
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e, item);
    });
  }

  div.addEventListener('mouseenter', () => {
    setSelectedIndex(index);
  });

  return div;
}

// ==================== 获取 Favicon URL ====================
function getFaviconUrl(url) {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return '';
  }
}

// ==================== 键盘导航处理 ====================
function handleKeyNavigation(e) {
  const bookmarkItems = resultsContainer.querySelectorAll('.bookmark-item');
  const totalItems = bookmarkItems.length;

  if (totalItems === 0) return;

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % totalItems;
      setSelectedIndex(selectedIndex);
      scrollToSelected();
      break;

    case 'ArrowUp':
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + totalItems) % totalItems;
      setSelectedIndex(selectedIndex);
      scrollToSelected();
      break;

    case 'Tab':
      e.preventDefault();
      if (e.shiftKey) {
        selectedIndex = (selectedIndex - 1 + totalItems) % totalItems;
      } else {
        selectedIndex = (selectedIndex + 1) % totalItems;
      }
      setSelectedIndex(selectedIndex);
      scrollToSelected();
      break;

    case 'Enter':
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < totalItems) {
        bookmarkItems[selectedIndex].click();
      } else if (totalItems > 0) {
        bookmarkItems[0].click();
      }
      break;

    case 'Escape':
      searchInput.value = '';
      handleSearch();
      searchInput.focus();
      break;
  }
}

// ==================== 设置选中状态 ====================
function setSelectedIndex(index) {
  const bookmarkItems = resultsContainer.querySelectorAll('.bookmark-item');
  bookmarkItems.forEach(item => item.classList.remove('selected'));

  if (index >= 0 && index < bookmarkItems.length) {
    selectedIndex = index;
    bookmarkItems[index].classList.add('selected');
  }
}

// ==================== 滚动到选中项 ====================
function scrollToSelected() {
  const selectedItem = resultsContainer.querySelector('.bookmark-item.selected');
  if (selectedItem) {
    selectedItem.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest'
    });
  }
}

// ==================== 打开书签 ====================
function openBookmark(url, bookmark) {
  chrome.tabs.create({ url: url });

  // 记录到最近访问
  addToRecentBookmarks(bookmark);
}

// ==================== 高亮文本 ====================
function highlightText(text, keyword) {
  if (!keyword) return escapeHtml(text);

  const escapedText = escapeHtml(text);
  const escapedKeyword = escapeHtml(keyword);

  const regex = new RegExp(`(${escapedKeyword})`, 'gi');
  return escapedText.replace(regex, '<span class="highlight">$1</span>');
}

// ==================== HTML 转义 ====================
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== 更新统计信息 ====================
function updateStats(filtered, total) {
  if (filtered === total) {
    resultCount.textContent = `共 ${total} 个书签`;
  } else {
    resultCount.textContent = `找到 ${filtered} 个书签（共 ${total} 个）`;
  }
}

// ==================== 最近访问功能 ====================
async function addToRecentBookmarks(bookmark) {
  // 移除重复项
  recentBookmarks = recentBookmarks.filter(b => b.id !== bookmark.id);

  // 添加到开头
  recentBookmarks.unshift(bookmark);

  // 只保留最近 5 个
  recentBookmarks = recentBookmarks.slice(0, 5);

  // 保存到 storage
  await saveHistory();

  // 更新显示
  displayRecentBookmarks();
}

function displayRecentBookmarks() {
  if (recentBookmarks.length === 0) {
    recentSection.style.display = 'none';
    return;
  }

  recentBookmarksEl.innerHTML = '';
  recentBookmarks.forEach(bookmark => {
    const item = document.createElement('div');
    item.className = 'recent-bookmark-item';
    item.textContent = bookmark.title;
    item.title = bookmark.url;
    item.addEventListener('click', () => {
      openBookmark(bookmark.url, bookmark);
    });
    recentBookmarksEl.appendChild(item);
  });
}

// ==================== 搜索历史功能 ====================
function showSearchHistory() {
  if (searchHistory.length === 0) return;

  searchHistoryEl.innerHTML = '';

  // 添加清空搜索历史按钮
  const clearHistoryItem = document.createElement('div');
  clearHistoryItem.className = 'history-item clear-history-item';
  clearHistoryItem.innerHTML = '<span>🗑️ 清空搜索记录</span>';
  clearHistoryItem.addEventListener('click', () => {
    if (confirm('确定要清空所有搜索记录吗？')) {
      searchHistory = [];
      saveHistory();
      hideSearchHistory();
      showError('搜索记录已清空', 'success');
    }
  });
  searchHistoryEl.appendChild(clearHistoryItem);

  // 添加分隔线
  const divider = document.createElement('div');
  divider.className = 'history-divider';
  searchHistoryEl.appendChild(divider);

  // 添加搜索历史项
  searchHistory.forEach(keyword => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.textContent = keyword;
    item.addEventListener('click', () => {
      searchInput.value = keyword;
      handleSearch();
      hideSearchHistory();
    });
    searchHistoryEl.appendChild(item);
  });

  searchHistoryEl.style.display = 'block';
}

function hideSearchHistory() {
  searchHistoryEl.style.display = 'none';
}

// ==================== 设置面板 ====================
function openSettings() {
  settingsPanel.style.display = 'flex';
}

function closeSettingsPanel() {
  settingsPanel.style.display = 'none';
}

function toggleDarkMode() {
  settings.darkMode = darkModeToggle.checked;
  document.body.classList.toggle('dark-mode', settings.darkMode);
  saveSettings();
}

function toggleFavicon() {
  settings.showFavicon = showFaviconToggle.checked;
  saveSettings();
  updateView();
}

function toggleFuzzySearch() {
  settings.fuzzySearch = fuzzySearchToggle.checked;
  saveSettings();
  updateView();
}

async function clearHistory() {
  if (confirm('确定要清除所有历史记录吗？')) {
    recentBookmarks = [];
    searchHistory = [];
    await saveHistory();
    displayRecentBookmarks();
    showError('历史记录已清除', 'success');
  }
}

// ==================== 存储功能 ====================
async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['settings'], (result) => {
      if (result.settings) {
        settings = { ...settings, ...result.settings };
      }

      // 应用设置
      darkModeToggle.checked = settings.darkMode;
      showFaviconToggle.checked = settings.showFavicon;
      fuzzySearchToggle.checked = settings.fuzzySearch;

      if (settings.darkMode) {
        document.body.classList.add('dark-mode');
      }

      resolve();
    });
  });
}

async function saveSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ settings }, resolve);
  });
}

async function loadHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['recentBookmarks', 'searchHistory'], (result) => {
      if (result.recentBookmarks) {
        recentBookmarks = result.recentBookmarks;
      }
      if (result.searchHistory) {
        searchHistory = result.searchHistory;
      }
      resolve();
    });
  });
}

async function saveHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.set({
      recentBookmarks,
      searchHistory
    }, resolve);
  });
}

// ==================== UI 辅助函数 ====================
function showLoading(show) {
  loadingState.style.display = show ? 'block' : 'none';
  resultsContainer.style.display = show ? 'none' : 'block';
}

function showError(message, type = 'error') {
  errorToast.textContent = message;
  errorToast.style.display = 'block';
  errorToast.style.background = type === 'success'
    ? 'rgba(34, 197, 94, 0.95)'
    : 'rgba(239, 68, 68, 0.95)';

  setTimeout(() => {
    errorToast.style.display = 'none';
  }, 3000);
}

// ==================== 右键菜单 ====================
function createContextMenu() {
  // 创建右键菜单项
  chrome.contextMenus.create({
    id: 'editBookmark',
    title: '编辑书签',
    contexts: ['all']
  });

  chrome.contextMenus.create({
    id: 'deleteBookmark',
    title: '删除书签',
    contexts: ['all']
  });
}

function showContextMenu(e, bookmark) {
  // 这里可以实现自定义右键菜单
  // 由于浏览器限制，暂时使用 chrome.contextMenus API
  console.log('Right click on:', bookmark);
}
