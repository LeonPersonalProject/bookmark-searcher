const test = require('node:test');
const assert = require('node:assert/strict');
const { getShortcutIntent } = require('../keyboard.js');

function keyboardEvent(key, modifiers = {}) {
  return { key, ...modifiers };
}

test('支持返回上级和进入文件夹快捷键', () => {
  assert.equal(
    getShortcutIntent(keyboardEvent('ArrowLeft', { altKey: true }), { inFolder: true }),
    'parent-folder'
  );
  assert.equal(
    getShortcutIntent(keyboardEvent('Backspace'), {
      inFolder: true,
      isInputFocused: true,
      searchEmpty: true
    }),
    'parent-folder'
  );
  assert.equal(
    getShortcutIntent(keyboardEvent('Backspace'), {
      inFolder: true,
      isInputFocused: false,
      searchEmpty: true
    }),
    'parent-folder'
  );
  assert.equal(
    getShortcutIntent(keyboardEvent('ArrowRight', { altKey: true })),
    'enter-folder'
  );
  assert.equal(
    getShortcutIntent(keyboardEvent('ArrowLeft'), { inFolder: true, searchEmpty: true }),
    'parent-folder'
  );
  assert.equal(
    getShortcutIntent(keyboardEvent('ArrowRight'), { searchEmpty: true }),
    'enter-folder'
  );
});

test('搜索框有内容时 Backspace 和 Delete 保持文本编辑行为', () => {
  const state = {
    hasSelection: true,
    inFolder: true,
    isInputFocused: true,
    searchEmpty: false,
    selectedType: 'bookmark'
  };

  assert.equal(getShortcutIntent(keyboardEvent('Backspace'), state), null);
  assert.equal(getShortcutIntent(keyboardEvent('Delete'), state), null);
  assert.equal(getShortcutIntent(keyboardEvent('ArrowLeft'), state), null);
  assert.equal(getShortcutIntent(keyboardEvent('ArrowRight'), state), null);
});

test('支持文件夹跳转、首尾选择和翻页', () => {
  assert.equal(
    getShortcutIntent(keyboardEvent('ArrowDown', { ctrlKey: true })),
    'next-folder'
  );
  assert.equal(
    getShortcutIntent(keyboardEvent('ArrowUp', { metaKey: true })),
    'previous-folder'
  );
  assert.equal(getShortcutIntent(keyboardEvent('Home', { ctrlKey: true })), 'first-result');
  assert.equal(getShortcutIntent(keyboardEvent('End', { metaKey: true })), 'last-result');
  assert.equal(getShortcutIntent(keyboardEvent('PageDown')), 'page-down');
  assert.equal(getShortcutIntent(keyboardEvent('PageUp')), 'page-up');
});

test('书签管理快捷键只作用于选中的书签', () => {
  const bookmarkState = {
    hasSelection: true,
    selectedType: 'bookmark',
    searchEmpty: true
  };

  assert.equal(getShortcutIntent(keyboardEvent('F2'), bookmarkState), 'edit-bookmark');
  assert.equal(
    getShortcutIntent(keyboardEvent('Enter', { ctrlKey: true }), bookmarkState),
    'open-background'
  );
  assert.equal(
    getShortcutIntent(keyboardEvent('Enter', { shiftKey: true }), bookmarkState),
    'open-current'
  );
  assert.equal(
    getShortcutIntent(keyboardEvent('F10', { shiftKey: true }), bookmarkState),
    'bookmark-actions'
  );
  assert.equal(getShortcutIntent(keyboardEvent('Delete'), bookmarkState), 'delete-bookmark');
  assert.equal(
    getShortcutIntent(keyboardEvent('F2'), { ...bookmarkState, selectedType: 'folder' }),
    null
  );
});

test('支持聚焦搜索和打开快捷键说明', () => {
  assert.equal(getShortcutIntent(keyboardEvent('f', { ctrlKey: true })), 'focus-search');
  assert.equal(getShortcutIntent(keyboardEvent('f', { metaKey: true })), 'focus-search');
  assert.equal(getShortcutIntent(keyboardEvent('/', { ctrlKey: true })), 'show-shortcuts');
  assert.equal(getShortcutIntent(keyboardEvent('?'), { searchEmpty: true }), 'show-shortcuts');
  assert.equal(getShortcutIntent(keyboardEvent('?'), { searchEmpty: false }), null);
});
