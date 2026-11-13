const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const searchCore = require('../../search.js');
const keyboardCore = require('../../keyboard.js');
const storageCore = require('../../storage.js');
const bookmarkDataCore = require('../../bookmarks.js');
const commandCore = require('../../commands.js');
const dialogCore = require('../../dialogs.js');

const popupSource = fs.readFileSync(path.join(__dirname, '..', '..', 'popup.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'popup.html'), 'utf8');

// Exercise the popup's real rendering, delegated clicks and keyboard handlers.
// This small DOM records selection and focus; it does not emulate CSS or layout.
function createPopup(items = [
  { id: '1', title: 'Atlas A', url: 'https://atlas-a.example/' },
  { id: '2', title: 'Atlas B', url: 'https://atlas-b.example/' },
  { id: '3', title: 'Beta', url: 'https://beta.example/' }
], { stubHistoryWrites = true } = {}) {
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
      this.ownerDocument = document;
      this.tabIndex = ['BUTTON', 'INPUT'].includes(this.tagName) ? 0 : -1;
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
      BookmarkStorageCore: storageCore,
      BookmarkDataCore: bookmarkDataCore,
      BookmarkCommandCore: commandCore,
      BookmarkDialogCore: dialogCore,
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
    ${stubHistoryWrites ? 'saveHistory = () => Promise.resolve();' : ''}
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


module.exports = { createPopup };
