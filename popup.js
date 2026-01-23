// ==================== 全局变量 ====================
let allBookmarks = []; // 存储所有书签的扁平化数组
let allItems = []; // 存储所有项目（书签 + 文件夹）
let selectedIndex = -1; // 当前选中的书签索引（-1 表示未选中）
let currentFolderId = null; // 当前所在文件夹的 ID（null 表示根目录）
let navigationStack = []; // 导航历史栈

// ==================== DOM 元素引用 ====================
const searchInput = document.getElementById('searchInput');
const resultsContainer = document.getElementById('results');
const emptyState = document.getElementById('emptyState');
const resultCount = document.getElementById('resultCount');
const backButton = document.getElementById('backButton');
const currentPathDisplay = document.getElementById('currentPath');

// ==================== 初始化 ====================
// 页面加载完成后立即执行
document.addEventListener('DOMContentLoaded', () => {
  // 加载所有书签
  loadBookmarks();

  // 监听搜索框输入事件（实时搜索）
  searchInput.addEventListener('input', handleSearch);

  // 监听键盘事件（导航和打开）
  searchInput.addEventListener('keydown', handleKeyNavigation);

  // 监听返回按钮点击事件
  backButton.addEventListener('click', handleBack);
});

// ==================== 加载书签 ====================
/**
 * 从浏览器获取所有书签并扁平化处理
 */
function loadBookmarks() {
  // 使用 Chrome Bookmarks API 获取整个书签树
  chrome.bookmarks.getTree((bookmarkTreeNodes) => {
    // 将书签树扁平化为数组，方便搜索
    allItems = flattenBookmarks(bookmarkTreeNodes);
    allBookmarks = allItems.filter(item => item.type === 'bookmark');

    // 显示当前视图
    updateView();
  });
}

// ==================== 扁平化书签树 ====================
/**
 * 递归遍历书签树，将所有书签和文件夹提取到一个扁平数组中
 * @param {Array} nodes - 书签树节点数组
 * @param {String} path - 当前节点的路径（用于显示书签所在文件夹）
 * @param {String} parentId - 父文件夹 ID
 * @returns {Array} - 扁平化的书签和文件夹数组
 */
function flattenBookmarks(nodes, path = '', parentId = null) {
  let items = [];

  // 遍历每个节点
  nodes.forEach(node => {
    // 跳过根节点（没有标题的节点）
    if (!node.title) {
      if (node.children) {
        items = items.concat(flattenBookmarks(node.children, path, parentId));
      }
      return;
    }

    // 构建当前路径
    const currentPath = path ? `${path} > ${node.title}` : node.title;

    // 如果节点有 URL，说明是书签
    if (node.url) {
      items.push({
        id: node.id,
        type: 'bookmark',
        title: node.title,
        url: node.url,
        path: path || '根目录', // 书签所在的文件夹路径
        parentId: parentId
      });
    } else if (node.children) {
      // 如果节点有子节点但没有 URL，说明是文件夹
      items.push({
        id: node.id,
        type: 'folder',
        title: node.title,
        path: path || '根目录',
        parentId: parentId,
        childCount: countChildren(node.children)
      });

      // 递归处理子节点
      items = items.concat(
        flattenBookmarks(node.children, currentPath, node.id)
      );
    }
  });

  return items;
}

/**
 * 统计文件夹中的书签数量
 * @param {Array} children - 子节点数组
 * @returns {Number} - 书签数量
 */
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

// ==================== 更新视图 ====================
/**
 * 根据当前状态更新视图
 */
function updateView() {
  const keyword = searchInput.value.trim().toLowerCase();

  // 获取当前应该显示的项目
  let itemsToDisplay;

  if (currentFolderId === null) {
    // 在根目录，显示所有项目或搜索结果
    if (keyword) {
      itemsToDisplay = allItems.filter(item => {
        const titleMatch = item.title.toLowerCase().includes(keyword);
        const urlMatch = item.url && item.url.toLowerCase().includes(keyword);
        return titleMatch || urlMatch;
      });
    } else {
      // 只显示根目录下的项目
      itemsToDisplay = allItems.filter(item => item.parentId === null);
    }
  } else {
    // 在某个文件夹内，只显示该文件夹的直接子项
    itemsToDisplay = allItems.filter(item => item.parentId === currentFolderId);

    // 如果有搜索关键词，进一步过滤
    if (keyword) {
      itemsToDisplay = itemsToDisplay.filter(item => {
        const titleMatch = item.title.toLowerCase().includes(keyword);
        const urlMatch = item.url && item.url.toLowerCase().includes(keyword);
        return titleMatch || urlMatch;
      });
    }
  }

  // 排序：文件夹优先，然后是书签
  itemsToDisplay.sort((a, b) => {
    // 如果类型不同，文件夹排在前面
    if (a.type !== b.type) {
      return a.type === 'folder' ? -1 : 1;
    }
    // 如果类型相同，按标题排序
    return a.title.localeCompare(b.title, 'zh-CN');
  });

  // 重置选中索引
  selectedIndex = -1;

  // 显示项目
  displayItems(itemsToDisplay, keyword);

  // 更新统计信息
  const totalBookmarks = currentFolderId === null
    ? allBookmarks.length
    : allItems.filter(item => item.type === 'bookmark' && item.parentId === currentFolderId).length;
  const displayedBookmarks = itemsToDisplay.filter(item => item.type === 'bookmark').length;
  updateStats(displayedBookmarks, totalBookmarks);

  // 更新返回按钮和路径显示
  updateNavigation();
}

// ==================== 更新导航 ====================
/**
 * 更新返回按钮和当前路径显示
 */
function updateNavigation() {
  if (currentFolderId === null) {
    // 在根目录，隐藏返回按钮
    backButton.style.display = 'none';
    currentPathDisplay.textContent = '所有书签';
  } else {
    // 在文件夹内，显示返回按钮和当前路径
    backButton.style.display = 'flex';
    const currentFolder = allItems.find(item => item.id === currentFolderId);
    if (currentFolder) {
      currentPathDisplay.textContent = currentFolder.title;
    }
  }
}
/**
 * 处理搜索输入，过滤书签并显示结果
 */
function handleSearch() {
  updateView();
}

// ==================== 返回上一级 ====================
/**
 * 返回到上一级文件夹
 */
function handleBack() {
  if (navigationStack.length > 0) {
    currentFolderId = navigationStack.pop();
  } else {
    currentFolderId = null;
  }
  updateView();
}

// ==================== 进入文件夹 ====================
/**
 * 进入指定的文件夹
 * @param {String} folderId - 文件夹 ID
 */
function enterFolder(folderId) {
  // 将当前文件夹 ID 压入导航栈
  navigationStack.push(currentFolderId);
  // 设置新的当前文件夹
  currentFolderId = folderId;
  // 清空搜索框
  searchInput.value = '';
  // 更新视图
  updateView();
}

// ==================== 显示项目列表 ====================
/**
 * 在页面上渲染项目列表（书签和文件夹）
 * @param {Array} items - 要显示的项目数组
 * @param {String} keyword - 搜索关键词（用于高亮显示）
 */
function displayItems(items, keyword = '') {
  // 清空结果容器
  resultsContainer.innerHTML = '';

  // 如果没有结果，显示空状态
  if (items.length === 0) {
    emptyState.style.display = 'flex';
    resultsContainer.style.display = 'none';
    return;
  }

  // 隐藏空状态，显示结果列表
  emptyState.style.display = 'none';
  resultsContainer.style.display = 'block';

  // 遍历项目，创建 DOM 元素
  items.forEach((item, index) => {
    const itemElement = createItemElement(item, keyword, index);
    resultsContainer.appendChild(itemElement);
  });
}

// ==================== 创建项目元素 ====================
/**
 * 创建单个项目的 DOM 元素（书签或文件夹）
 * @param {Object} item - 项目对象
 * @param {String} keyword - 搜索关键词（用于高亮）
 * @param {Number} index - 项目在列表中的索引
 * @returns {HTMLElement} - 项目的 DOM 元素
 */
function createItemElement(item, keyword, index) {
  // 创建容器
  const div = document.createElement('div');
  div.className = item.type === 'folder' ? 'bookmark-item folder-item' : 'bookmark-item';
  div.dataset.index = index; // 存储索引，方便键盘导航

  // 高亮显示匹配的关键词
  const highlightedTitle = highlightText(item.title, keyword);

  if (item.type === 'folder') {
    // 文件夹样式
    div.innerHTML = `
      <div class="bookmark-title">
        <span class="folder-icon">📁</span>
        ${highlightedTitle}
        <span class="folder-count">(${item.childCount})</span>
      </div>
      <div class="bookmark-path">📂 ${item.path}</div>
    `;

    // 点击事件：进入文件夹
    div.addEventListener('click', () => {
      enterFolder(item.id);
    });
  } else {
    // 书签样式
    const highlightedUrl = highlightText(item.url, keyword);
    div.innerHTML = `
      <div class="bookmark-title">${highlightedTitle}</div>
      <div class="bookmark-url">${highlightedUrl}</div>
      <div class="bookmark-path">📁 ${item.path}</div>
    `;

    // 点击事件：在新标签页中打开书签
    div.addEventListener('click', () => {
      openBookmark(item.url);
    });
  }

  // 鼠标悬停事件：更新选中索引
  div.addEventListener('mouseenter', () => {
    setSelectedIndex(index);
  });

  return div;
}

// ==================== 键盘导航处理 ====================
/**
 * 处理键盘导航事件
 * @param {KeyboardEvent} e - 键盘事件对象
 */
function handleKeyNavigation(e) {
  const bookmarkItems = resultsContainer.querySelectorAll('.bookmark-item');
  const totalItems = bookmarkItems.length;

  // 如果没有书签，不处理
  if (totalItems === 0) return;

  switch (e.key) {
    case 'ArrowDown': // 向下箭头
      e.preventDefault(); // 阻止默认滚动行为
      selectedIndex = (selectedIndex + 1) % totalItems;
      setSelectedIndex(selectedIndex);
      scrollToSelected();
      break;

    case 'ArrowUp': // 向上箭头
      e.preventDefault(); // 阻止默认滚动行为
      selectedIndex = (selectedIndex - 1 + totalItems) % totalItems;
      setSelectedIndex(selectedIndex);
      scrollToSelected();
      break;

    case 'Tab': // Tab 键
      e.preventDefault(); // 阻止默认焦点切换
      if (e.shiftKey) {
        // Shift + Tab：向上导航
        selectedIndex = (selectedIndex - 1 + totalItems) % totalItems;
      } else {
        // Tab：向下导航
        selectedIndex = (selectedIndex + 1) % totalItems;
      }
      setSelectedIndex(selectedIndex);
      scrollToSelected();
      break;

    case 'Enter': // 回车键
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < totalItems) {
        // 触发选中项的点击事件（可能是打开书签或进入文件夹）
        bookmarkItems[selectedIndex].click();
      } else if (totalItems > 0) {
        // 如果没有选中，触发第一个项目
        bookmarkItems[0].click();
      }
      break;

    case 'Escape': // ESC 键：清空搜索
      searchInput.value = '';
      handleSearch();
      searchInput.focus();
      break;
  }
}

// ==================== 设置选中状态 ====================
/**
 * 设置指定索引的书签为选中状态
 * @param {Number} index - 要选中的书签索引
 */
function setSelectedIndex(index) {
  // 移除所有选中状态
  const bookmarkItems = resultsContainer.querySelectorAll('.bookmark-item');
  bookmarkItems.forEach(item => item.classList.remove('selected'));

  // 添加选中状态
  if (index >= 0 && index < bookmarkItems.length) {
    selectedIndex = index;
    bookmarkItems[index].classList.add('selected');
  }
}

// ==================== 滚动到选中项 ====================
/**
 * 将选中的书签滚动到可见区域
 */
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
/**
 * 在新标签页中打开书签
 * @param {String} url - 书签 URL
 */
function openBookmark(url) {
  chrome.tabs.create({ url: url });
}

// ==================== 高亮文本 ====================
/**
 * 在文本中高亮显示关键词
 * @param {String} text - 原始文本
 * @param {String} keyword - 要高亮的关键词
 * @returns {String} - 包含高亮标记的 HTML 字符串
 */
function highlightText(text, keyword) {
  if (!keyword) return escapeHtml(text);

  // 转义 HTML 特殊字符
  const escapedText = escapeHtml(text);
  const escapedKeyword = escapeHtml(keyword);

  // 使用正则表达式进行不区分大小写的替换
  const regex = new RegExp(`(${escapedKeyword})`, 'gi');
  return escapedText.replace(regex, '<span class="highlight">$1</span>');
}

// ==================== HTML 转义 ====================
/**
 * 转义 HTML 特殊字符，防止 XSS 攻击
 * @param {String} text - 原始文本
 * @returns {String} - 转义后的文本
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== 更新统计信息 ====================
/**
 * 更新显示的统计信息
 * @param {Number} filtered - 过滤后的书签数量
 * @param {Number} total - 总书签数量
 */
function updateStats(filtered, total) {
  if (filtered === total) {
    resultCount.textContent = `共 ${total} 个书签`;
  } else {
    resultCount.textContent = `找到 ${filtered} 个书签（共 ${total} 个）`;
  }
}
