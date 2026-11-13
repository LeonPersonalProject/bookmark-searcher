(function initializeDialogCore(globalScope, factory) {
  const core = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  if (globalScope) globalScope.BookmarkDialogCore = core;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function getFocusableElements(container) {
    return [...container.querySelectorAll('button, input, select, textarea, [tabindex]')]
      .filter(element => !element.disabled && element.tabIndex >= 0 && !element.closest('[hidden]'));
  }

  function trapFocus(event, container) {
    if (event.key !== 'Tab') return;
    const elements = getFocusableElements(container);
    if (!elements.length) return;
    const first = elements[0];
    const last = elements[elements.length - 1];
    const active = container.ownerDocument.activeElement;
    if (event.shiftKey && (active === first || !container.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !container.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  return { getFocusableElements, trapFocus };
}));
