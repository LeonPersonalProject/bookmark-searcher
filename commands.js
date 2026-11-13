(function initializeCommandCore(globalScope, factory) {
  const core = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  if (globalScope) globalScope.BookmarkCommandCore = core;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const commands = [
    { name: 'clear', usage: '/clear [all]', description: '清空搜索历史；all 同时清空最近使用和使用统计', args: ['', 'all'] },
    { name: 'help', usage: '/help', description: '命令说明与键盘快捷键', args: [''] },
    { name: 'settings', usage: '/settings', description: '打开设置', args: [''] },
    { name: 'home', usage: '/home', description: '返回全部书签', args: [''] },
    { name: 'back', usage: '/back', description: '返回上一级目录', args: [''] },
    { name: 'theme', usage: '/theme system|light|dark', description: '设置外观模式', args: ['system', 'light', 'dark'] },
    { name: 'fuzzy', usage: '/fuzzy on|off', description: '设置模糊搜索', args: ['on', 'off'] },
    { name: 'favicon', usage: '/favicon on|off', description: '设置在线网站图标', args: ['on', 'off'] }
  ];
  const argumentLabels = { system: '跟随系统', light: '浅色模式', dark: '深色模式', on: '开启', off: '关闭', all: '清空全部历史', '': '仅清空搜索历史' };

  function getCommandSuggestions(value) {
    if (typeof value !== 'string' || !value.startsWith('/') || /^\/[\/\s]/.test(value)) return [];
    const text = value.slice(1).toLowerCase();
    const parts = text.trim().split(/\s+/);
    const exact = commands.find(command => command.name === parts[0]);
    const hasArgument = /^\S+\s/.test(text);
    if (exact && hasArgument) {
      const argument = parts.slice(1).join(' ');
      return exact.args.filter(arg => arg.startsWith(argument)).map(arg => ({
        ...exact,
        argument: arg,
        value: `/${exact.name}${arg ? ` ${arg}` : ''}`,
        label: `/${exact.name}${arg ? ` ${arg}` : ''}`,
        description: argumentLabels[arg] || exact.description
      }));
    }
    return (exact ? [exact] : commands.filter(command => command.name.startsWith(text.trim()))).map(command => ({
      ...command,
      value: `/${command.name}${command.args.includes('') ? '' : ' '}`,
      label: command.usage
    }));
  }

  return { commands, getCommandSuggestions };
}));
