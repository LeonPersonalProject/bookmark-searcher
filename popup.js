// ==================== 全局状态 ====================
let allBookmarks = [];
let allItems = [];
let selectedIndex = -1;
let currentFolderId = null;
let searchTimeout = null;
let toastTimeout = null;
let settingsPanelAnimation = null;
let settingsDrawerAnimation = null;
let settingsAnimationGeneration = 0;
let historySelectedIndex = -1;
let recentBookmarks = [];
let searchHistory = [];
let lastFocusedElement = null;
let confirmLastFocusedElement = null;
let confirmResolver = null;
let settings = {
  themeMode: 'system',
  colorTheme: 'classic',
  showFavicon: true,
  fuzzySearch: false
};

const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

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

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
  bindEventListeners();
  updateShortcutLabel();
  showLoading(true);
  searchInput.focus();

  try {
    await Promise.all([loadSettings(), loadHistory()]);
    await loadBookmarks();
    displayRecentBookmarks();
    showLoading(false);
    updateView();
    createContextMenu();
  } catch (error) {
    console.error('初始化失败:', error);
    showLoading(false);
    showError('初始化失败，请重新打开弹窗');
  }
});

function bindEventListeners() {
  searchInput.addEventListener('input', handleSearchWithDebounce);
  searchInput.addEventListener('focus', showSearchHistory);
  searchInput.addEventListener('click', showSearchHistory);
  searchInput.addEventListener('blur', () => {
    setTimeout(() => {
      if (!searchHistoryEl.contains(document.activeElement)) {
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
  systemThemeQuery.addEventListener('change', () => {
    if (settings.themeMode === 'system') {
      applyTheme();
    }
  });
}

function updateShortcutLabel() {
  const isMac = navigator.platform.toLowerCase().includes('mac');
  searchShortcut.textContent = isMac ? '⌘ ⇧ K' : 'Ctrl ⇧ K';
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
        allItems = flattenBookmarks(bookmarkTreeNodes);
        allBookmarks = allItems.filter(item => item.type === 'bookmark');
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

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
        parentId
      });
    } else if (node.children) {
      items.push({
        id: node.id,
        type: 'folder',
        title: node.title,
        path: path || '根目录',
        parentId,
        childCount: countChildren(node.children)
      });

      items = items.concat(flattenBookmarks(node.children, currentPath, node.id));
    }
  });

  return items;
}

function countChildren(children) {
  return children.reduce((count, child) => {
    if (child.url) return count + 1;
    if (child.children) return count + countChildren(child.children);
    return count;
  }, 0);
}

// ==================== 搜索与排序 ====================
function handleSearchWithDebounce() {
  clearTimeout(searchTimeout);
  toggleClearButton();
  hideSearchHistory();
  searchTimeout = setTimeout(updateView, 140);
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
  const keyword = searchInput.value.trim().toLowerCase();
  let itemsToDisplay;

  if (currentFolderId === null) {
    itemsToDisplay = keyword
      ? searchItems(allItems, keyword)
      : allItems.filter(item => item.parentId === null);
  } else {
    itemsToDisplay = allItems.filter(item => item.parentId === currentFolderId);
    if (keyword) {
      itemsToDisplay = searchItems(itemsToDisplay, keyword);
    }
  }

  itemsToDisplay.sort((first, second) => compareItems(first, second, keyword));
  selectedIndex = -1;
  searchInput.removeAttribute('aria-activedescendant');
  displayItems(itemsToDisplay, keyword);
  updateStats(itemsToDisplay.length, keyword);
  updateNavigation();
  contentArea.scrollTop = 0;
}

function searchItems(items, keyword) {
  if (!keyword) return items;

  return items.filter(item => {
    const title = item.title.toLowerCase();
    const url = item.url ? item.url.toLowerCase() : '';
    const exactMatch = title.includes(keyword) || url.includes(keyword);

    if (!settings.fuzzySearch) return exactMatch;
    return exactMatch || fuzzyMatch(title, keyword) > 0 || fuzzyMatch(url, keyword) > 0;
  });
}

function compareItems(first, second, keyword) {
  if (!keyword && first.type !== second.type) {
    return first.type === 'folder' ? -1 : 1;
  }

  if (keyword) {
    const scoreDifference = getMatchRank(first, keyword) - getMatchRank(second, keyword);
    if (scoreDifference !== 0) return scoreDifference;
  }

  return first.title.localeCompare(second.title, 'zh-CN', { sensitivity: 'base' });
}

function getMatchRank(item, keyword) {
  const title = item.title.toLowerCase();
  const url = item.url ? item.url.toLowerCase() : '';

  if (title.startsWith(keyword)) return 0;
  if (title.includes(keyword)) return 1;
  if (url.includes(keyword)) return 2;
  if (fuzzyMatch(title, keyword) > 0) return 3;
  return 4;
}

function fuzzyMatch(text, pattern) {
  if (!text || !pattern) return 0;

  let score = 0;
  let patternIndex = 0;
  let consecutiveMatches = 0;

  for (let textIndex = 0; textIndex < text.length && patternIndex < pattern.length; textIndex++) {
    if (text[textIndex] === pattern[patternIndex]) {
      consecutiveMatches++;
      score += 1 + consecutiveMatches;
      patternIndex++;
    } else {
      consecutiveMatches = 0;
    }
  }

  return patternIndex === pattern.length ? score : 0;
}

// ==================== 结果渲染 ====================
function displayItems(items, keyword = '') {
  resultsContainer.innerHTML = '';

  const showRecent = !keyword && currentFolderId === null && recentBookmarks.length > 0;
  recentSection.hidden = !showRecent;
  emptyState.hidden = items.length > 0;
  resultsSection.hidden = items.length === 0;

  if (keyword) {
    resultsTitle.textContent = '搜索结果';
    resultsMeta.textContent = settings.fuzzySearch ? '模糊匹配' : '标题与网址';
  } else if (currentFolderId === null) {
    resultsTitle.textContent = '浏览';
    resultsMeta.textContent = '文件夹优先';
  } else {
    resultsTitle.textContent = '当前文件夹';
    resultsMeta.textContent = `${items.length} 项`;
  }

  items.forEach((item, index) => {
    resultsContainer.appendChild(createItemElement(item, keyword, index));
  });
}

function createItemElement(item, keyword, index) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = item.type === 'folder' ? 'bookmark-item folder-item' : 'bookmark-item';
  button.dataset.index = index;
  button.id = `result-item-${index}`;

  const highlightedTitle = highlightText(item.title, keyword);

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
    `;

    button.addEventListener('click', () => {
      recordSearchKeyword();
      enterFolder(item.id);
    });
  } else {
    const displayUrl = getDisplayUrl(item.url);
    const faviconUrl = settings.showFavicon ? getFaviconUrl(item.url) : '';
    const iconContent = faviconUrl
      ? `<img src="${escapeHtml(faviconUrl)}" class="bookmark-favicon" alt="">`
      : iconSvg('globe');

    button.title = item.url;
    button.setAttribute('aria-label', `打开书签 ${item.title}`);
    button.innerHTML = `
      <span class="item-icon">${iconContent}</span>
      <span class="item-copy">
        <span class="bookmark-title">${highlightedTitle}</span>
        <span class="bookmark-meta">${highlightText(displayUrl, keyword)} · ${escapeHtml(item.path)}</span>
      </span>
      <span class="item-trailing">${iconSvg('external-link')}</span>
    `;

    const favicon = button.querySelector('.bookmark-favicon');
    if (favicon) {
      favicon.addEventListener('error', () => {
        favicon.parentElement.innerHTML = iconSvg('globe');
      }, { once: true });
    }

    button.addEventListener('click', () => {
      recordSearchKeyword();
      openBookmark(item.url, item);
    });

    button.addEventListener('contextmenu', event => {
      event.preventDefault();
      showContextMenu(event, item);
    });
  }

  return button;
}

function getFaviconUrl(url) {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
  } catch {
    return '';
  }
}

function getDisplayUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const path = parsedUrl.pathname === '/' ? '' : parsedUrl.pathname;
    return `${parsedUrl.hostname}${path}`;
  } catch {
    return url;
  }
}

function getSiteInitial(bookmark) {
  const source = getDisplayUrl(bookmark.url || '') || bookmark.title || '?';
  return source.charAt(0).toUpperCase();
}

function highlightText(text, keyword) {
  const value = String(text);
  if (!keyword) return escapeHtml(value);

  const regex = new RegExp(`(${escapeRegExp(keyword)})`, 'gi');
  return value.split(regex).map((part, index) => {
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
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path>'
  };

  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ''}</svg>`;
}

// ==================== 键盘导航 ====================
function handleKeyNavigation(event) {
  if (!searchHistoryEl.hidden) {
    const historyItems = searchHistoryEl.querySelectorAll('.history-item:not(.clear-history-item)');

    if (event.key === 'ArrowDown' && historyItems.length > 0) {
      event.preventDefault();
      setHistorySelectedIndex((historySelectedIndex + 1) % historyItems.length);
      return;
    }

    if (event.key === 'ArrowUp' && historyItems.length > 0) {
      event.preventDefault();
      setHistorySelectedIndex((historySelectedIndex - 1 + historyItems.length) % historyItems.length);
      return;
    }

    if (event.key === 'Enter') {
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

    if (!searchHistoryEl.hidden) {
      hideSearchHistory();
    } else if (searchInput.value) {
      clearSearch();
    } else if (currentFolderId !== null) {
      handleBack();
    } else {
      window.close();
    }
    return;
  }

  if (totalItems === 0) return;

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      setSelectedIndex((selectedIndex + 1) % totalItems);
      scrollToSelected();
      break;

    case 'ArrowUp':
      event.preventDefault();
      setSelectedIndex((selectedIndex - 1 + totalItems) % totalItems);
      scrollToSelected();
      break;

    case 'Enter':
      event.preventDefault();
      bookmarkItems[selectedIndex >= 0 ? selectedIndex : 0].click();
      break;
  }
}

function setSelectedIndex(index) {
  const bookmarkItems = resultsContainer.querySelectorAll('.bookmark-item');
  bookmarkItems.forEach(item => item.classList.remove('selected'));

  if (index >= 0 && index < bookmarkItems.length) {
    selectedIndex = index;
    bookmarkItems[index].classList.add('selected');
    searchInput.setAttribute('aria-activedescendant', bookmarkItems[index].id);
  } else {
    selectedIndex = -1;
    searchInput.removeAttribute('aria-activedescendant');
  }
}

function scrollToSelected() {
  const selectedItem = resultsContainer.querySelector('.bookmark-item.selected');
  if (selectedItem) {
    selectedItem.scrollIntoView({
      behavior: reducedMotionQuery.matches ? 'auto' : 'smooth',
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
  let activeFolder = allItems.find(item => item.type === 'folder' && item.id === folderId);

  while (activeFolder) {
    chain.unshift({ id: activeFolder.id, title: activeFolder.title });
    activeFolder = allItems.find(item => item.type === 'folder' && item.id === activeFolder.parentId);
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
  const currentFolder = allItems.find(item => item.type === 'folder' && item.id === currentFolderId);
  navigateToFolder(currentFolder ? currentFolder.parentId : null);
}

function enterFolder(folderId) {
  navigateToFolder(folderId);
}

function updateStats(displayedCount, keyword) {
  if (keyword) {
    resultCount.textContent = `${displayedCount} 项`;
  } else if (currentFolderId === null) {
    resultCount.textContent = `${allBookmarks.length} 个书签`;
  } else {
    resultCount.textContent = `${displayedCount} 项`;
  }
}

// ==================== 最近使用 ====================
function openBookmark(url, bookmark) {
  chrome.tabs.create({ url });
  addToRecentBookmarks(bookmark);
}

async function addToRecentBookmarks(bookmark) {
  recentBookmarks = recentBookmarks.filter(item => item.id !== bookmark.id);
  recentBookmarks.unshift(bookmark);
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
    button.setAttribute('aria-label', `打开最近使用的书签 ${bookmark.title}`);

    const faviconUrl = settings.showFavicon ? getFaviconUrl(bookmark.url) : '';
    const iconContent = faviconUrl
      ? `<img src="${escapeHtml(faviconUrl)}" alt="">`
      : escapeHtml(getSiteInitial(bookmark));

    button.innerHTML = `
      <span class="recent-favicon">${iconContent}</span>
      <span class="recent-copy">
        <span class="recent-title">${escapeHtml(bookmark.title)}</span>
        <span class="recent-domain">${escapeHtml(getDisplayUrl(bookmark.url))}</span>
      </span>
    `;

    const favicon = button.querySelector('img');
    if (favicon) {
      favicon.addEventListener('error', () => {
        favicon.parentElement.textContent = getSiteInitial(bookmark);
      }, { once: true });
    }

    button.addEventListener('click', () => openBookmark(bookmark.url, bookmark));
    recentBookmarksEl.appendChild(button);
  });
}

// ==================== 搜索历史 ====================
function recordSearchKeyword() {
  const keyword = searchInput.value.trim();
  if (!keyword) return;

  searchHistory = searchHistory.filter(item => item.toLowerCase() !== keyword.toLowerCase());
  searchHistory.unshift(keyword);
  searchHistory = searchHistory.slice(0, 8);
  saveHistory();
}

function showSearchHistory() {
  if (searchInput.value.trim() || searchHistory.length === 0 || !settingsPanel.hidden) return;

  searchHistoryEl.innerHTML = '';
  historySelectedIndex = -1;

  const label = document.createElement('span');
  label.className = 'history-label';
  label.textContent = '最近搜索';
  searchHistoryEl.appendChild(label);

  searchHistory.slice(0, 8).forEach((keyword, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-item';
    button.id = `history-item-${index}`;
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
  searchHistoryEl.appendChild(divider);

  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'history-item clear-history-item';
  clearButton.innerHTML = `${iconSvg('trash')}<span>清空搜索历史</span>`;
  clearButton.addEventListener('click', clearSearchHistory);
  searchHistoryEl.appendChild(clearButton);

  searchHistoryEl.hidden = false;
}

function hideSearchHistory() {
  searchHistoryEl.hidden = true;
  historySelectedIndex = -1;
  searchInput.removeAttribute('aria-activedescendant');
}

function setHistorySelectedIndex(index) {
  const historyItems = searchHistoryEl.querySelectorAll('.history-item:not(.clear-history-item)');
  historyItems.forEach(item => item.classList.remove('selected'));

  if (index >= 0 && index < historyItems.length) {
    historySelectedIndex = index;
    historyItems[index].classList.add('selected');
    searchInput.setAttribute('aria-activedescendant', historyItems[index].id);
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
  await saveHistory();
  hideSearchHistory();
  showError('搜索历史已清空', 'success');
}

// ==================== 设置面板 ====================
function openSettings() {
  if (!settingsPanel.hidden && !settingsPanel.classList.contains('is-closing')) return;

  const generation = ++settingsAnimationGeneration;
  cancelSettingsAnimations();
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
      duration: reducedMotion ? 140 : 260,
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
      duration: reducedMotion ? 140 : 420,
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
      duration: reducedMotion ? 120 : 240,
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
      duration: reducedMotion ? 120 : 320,
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
  saveSettings();
}

function changeColorTheme(event) {
  settings.colorTheme = event.target.value;
  applyTheme();
  saveSettings();
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
  saveSettings();
  displayRecentBookmarks();
  updateView();
}

function toggleFuzzySearch() {
  settings.fuzzySearch = fuzzySearchToggle.checked;
  saveSettings();
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
  await saveHistory();
  displayRecentBookmarks();
  updateView();
  showError('历史记录已清除', 'success');
}

// ==================== 设置与历史存储 ====================
async function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(['settings'], result => {
      const savedSettings = result.settings || {};
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
        ...savedSettings,
        themeMode: migratedTheme,
        colorTheme: migratedColorTheme
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
  return new Promise(resolve => {
    chrome.storage.sync.set({ settings }, resolve);
  });
}

async function loadHistory() {
  return new Promise(resolve => {
    chrome.storage.local.get(['recentBookmarks', 'searchHistory'], result => {
      recentBookmarks = Array.isArray(result.recentBookmarks) ? result.recentBookmarks : [];
      searchHistory = Array.isArray(result.searchHistory) ? result.searchHistory : [];
      resolve();
    });
  });
}

async function saveHistory() {
  return new Promise(resolve => {
    chrome.storage.local.set({ recentBookmarks, searchHistory }, resolve);
  });
}

// ==================== UI 辅助函数 ====================
function showLoading(show) {
  loadingState.hidden = !show;

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

// ==================== 浏览器右键菜单 ====================
function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
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
  });
}

function showContextMenu(event, bookmark) {
  console.log('Right click on:', bookmark, event.clientX, event.clientY);
}
