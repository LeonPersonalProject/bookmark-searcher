(function initializeStorageCore(globalScope, factory) {
  const storageCore = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = storageCore;
  }

  if (globalScope) {
    globalScope.BookmarkStorageCore = storageCore;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function createStorageAdapter(chromeApi) {
    let settingsWriteQueue = Promise.resolve();
    let historyWriteQueue = Promise.resolve();

    function callStorage(areaName, operation, value) {
      return new Promise((resolve, reject) => {
        const area = chromeApi?.storage?.[areaName];
        if (typeof area?.[operation] !== 'function') {
          reject(new Error(`浏览器存储不可用：chrome.storage.${areaName}.${operation}`));
          return;
        }

        try {
          area[operation](value, result => {
            // Chrome only exposes lastError during this API callback.
            const lastError = chromeApi.runtime?.lastError;
            if (lastError) {
              reject(new Error(lastError.message || String(lastError)));
            } else {
              resolve(operation === 'get' ? result || {} : undefined);
            }
          });
        } catch (error) {
          reject(error);
        }
      });
    }

    function cloneSnapshot(snapshot) {
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new Error('存储快照必须是对象');
      }
      return JSON.parse(JSON.stringify(snapshot));
    }

    return {
      getSettings() {
        return callStorage('sync', 'get', ['settings']);
      },

      getHistory() {
        return callStorage('local', 'get', [
          'recentBookmarks', 'searchHistory', 'usageStats', 'pinnedBookmarkIds'
        ]);
      },

      async saveSettings(snapshot) {
        const value = cloneSnapshot(snapshot);
        settingsWriteQueue = settingsWriteQueue.catch(() => {}).then(() => (
          callStorage('sync', 'set', value)
        ));
        return settingsWriteQueue;
      },

      async saveHistory(snapshot) {
        const value = cloneSnapshot(snapshot);
        historyWriteQueue = historyWriteQueue.catch(() => {}).then(() => (
          callStorage('local', 'set', value)
        ));
        return historyWriteQueue;
      }
    };
  }

  return { createStorageAdapter };
}));
