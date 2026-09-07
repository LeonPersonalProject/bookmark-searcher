(function initializeKeyboardCore(globalScope, factory) {
  const keyboardCore = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = keyboardCore;
  }

  if (globalScope) {
    globalScope.BookmarkKeyboardCore = keyboardCore;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function getShortcutIntent(event, state = {}) {
    const key = event.key;
    const primaryKey = Boolean(event.ctrlKey || event.metaKey);
    const altKey = Boolean(event.altKey);
    const shiftKey = Boolean(event.shiftKey);
    const {
      hasSelection = false,
      inFolder = false,
      isInputFocused = false,
      searchEmpty = true,
      selectedType = null
    } = state;

    if (primaryKey && key.toLowerCase() === 'f') return 'focus-search';
    if (primaryKey && key === '/') return 'show-shortcuts';
    if (key === '?' && searchEmpty) return 'show-shortcuts';

    const plainLeft = key === 'ArrowLeft' && !altKey && !primaryKey && !shiftKey && searchEmpty;
    if (inFolder && (plainLeft || (altKey && (key === 'ArrowLeft' || key === 'ArrowUp')))) {
      return 'parent-folder';
    }
    if (inFolder && key === 'Backspace' && searchEmpty) {
      return 'parent-folder';
    }
    const plainRight = key === 'ArrowRight' && !altKey && !primaryKey && !shiftKey && searchEmpty;
    if (plainRight || (altKey && key === 'ArrowRight')) return 'enter-folder';

    if (primaryKey && key === 'ArrowDown') return 'next-folder';
    if (primaryKey && key === 'ArrowUp') return 'previous-folder';
    if (primaryKey && key === 'Home') return 'first-result';
    if (primaryKey && key === 'End') return 'last-result';
    if (key === 'PageDown' && !altKey && !primaryKey) return 'page-down';
    if (key === 'PageUp' && !altKey && !primaryKey) return 'page-up';

    if (hasSelection && selectedType === 'bookmark') {
      if (primaryKey && key === 'Enter') return 'open-background';
      if (shiftKey && key === 'Enter') return 'open-current';
      if (key === 'F2') return 'edit-bookmark';
      if ((key === 'F10' && shiftKey) || key === 'ContextMenu') return 'bookmark-actions';
      if (key === 'Delete' && (!isInputFocused || searchEmpty)) return 'delete-bookmark';
    }

    return null;
  }

  return { getShortcutIntent };
}));
