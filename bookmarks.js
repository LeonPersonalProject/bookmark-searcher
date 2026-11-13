(function initializeBookmarkDataCore(globalScope, factory) {
  const core = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  if (globalScope) globalScope.BookmarkDataCore = core;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function getFallbackTitle(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname || parsed.pathname || url;
    } catch {
      return url || '未命名书签';
    }
  }

  function createBookmarkIndex(nodes, prepareItem = item => item) {
    const items = [];
    const itemsById = new Map();
    const foldersById = new Map();
    const itemsByParentId = new Map();
    const visit = (children, path, parentId) => {
      let count = 0;
      for (const node of children || []) {
        if (!node.url && String(node.id) === '0') {
          count += visit(node.children, path, parentId);
          continue;
        }
        const title = String(node.title || '').trim()
          || (node.url ? getFallbackTitle(node.url) : '未命名文件夹');
        const item = prepareItem({
          id: String(node.id),
          type: node.url ? 'bookmark' : 'folder',
          title,
          ...(node.url ? { url: node.url } : { childCount: 0 }),
          path: path || '根目录',
          parentId
        });
        items.push(item);
        itemsById.set(item.id, item);
        const key = parentId === null ? '__root__' : String(parentId);
        if (!itemsByParentId.has(key)) itemsByParentId.set(key, []);
        itemsByParentId.get(key).push(item);
        if (node.url) {
          count++;
        } else {
          foldersById.set(item.id, item);
          item.childCount = visit(node.children, path ? `${path} / ${title}` : title, item.id);
          count += item.childCount;
        }
      }
      return count;
    };
    visit(nodes, '', null);
    return { items, bookmarks: items.filter(item => item.type === 'bookmark'), itemsById, foldersById, itemsByParentId };
  }

  function getDescendantItems(folderId, itemsByParentId) {
    const results = [];
    const pending = [String(folderId)];
    const visited = new Set();
    for (let index = 0; index < pending.length; index++) {
      const parentId = pending[index];
      if (visited.has(parentId)) continue;
      visited.add(parentId);
      for (const item of itemsByParentId.get(parentId) || []) {
        results.push(item);
        if (item.type === 'folder') pending.push(String(item.id));
      }
    }
    return results;
  }

  function isPublicFaviconUrl(url) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return false;
      const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
      if (!host.includes('.') || host.includes(':') || /^\d+(?:\.\d+){3}$/.test(host)) return false;
      if (host.split('.').some(label => !label)) return false;
      const internalSuffixes = ['localhost', 'local', 'internal', 'intranet', 'lan', 'home', 'home.arpa', 'corp', 'private', 'office', 'test', 'example', 'invalid', 'onion'];
      return !internalSuffixes.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
    } catch {
      return false;
    }
  }

  return { createBookmarkIndex, getDescendantItems, getFallbackTitle, isPublicFaviconUrl };
}));
