const test = require('node:test');
const assert = require('node:assert/strict');
const { commands, getCommandSuggestions } = require('../commands.js');

test('斜杠入口列出全部命令，部分名称仅返回匹配建议', () => {
  assert.deepEqual(getCommandSuggestions('/').map(item => item.name), commands.map(item => item.name));
  assert.deepEqual(getCommandSuggestions('/f').map(item => item.name), ['fuzzy', 'favicon']);
  assert.deepEqual(getCommandSuggestions('/SET').map(item => item.value), ['/settings']);
});

test('必需参数命令先补全到参数位置，而非隐式执行默认值', () => {
  for (const name of ['theme', 'fuzzy', 'favicon']) {
    const suggestions = getCommandSuggestions(`/${name}`);
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].value, `/${name} `);
    assert.equal(suggestions[0].argument, undefined);
    assert.equal(suggestions[0].args.includes(''), false);
  }
});

test('主题参数按前缀补全，值和描述与待执行操作一致', () => {
  assert.deepEqual(getCommandSuggestions('/theme ').map(item => item.argument), ['system', 'light', 'dark']);
  const light = getCommandSuggestions('/theme l');
  assert.equal(light.length, 1);
  assert.equal(light[0].argument, 'light');
  assert.equal(light[0].value, '/theme light');
  assert.equal(light[0].label, '/theme light');
  assert.equal(light[0].description, '浅色模式');
  assert.deepEqual(getCommandSuggestions('/THEME   D').map(item => item.value), ['/theme dark']);
});

test('开关命令枚举 on/off，并支持参数前缀过滤', () => {
  for (const name of ['fuzzy', 'favicon']) {
    assert.deepEqual(getCommandSuggestions(`/${name} `).map(item => item.argument), ['on', 'off']);
    assert.deepEqual(getCommandSuggestions(`/${name} of`).map(item => item.value), [`/${name} off`]);
    assert.equal(getCommandSuggestions(`/${name} enabled`).length, 0);
  }
});

test('clear 允许不带参数，all 为明确的可选操作', () => {
  const clear = getCommandSuggestions('/clear');
  assert.equal(clear[0].value, '/clear');
  assert.equal(clear[0].argument, undefined);
  assert.ok(clear[0].args.includes(''));
  assert.deepEqual(getCommandSuggestions('/clear ').map(item => item.argument), ['', 'all']);
  const all = getCommandSuggestions('/clear a');
  assert.equal(all[0].argument, 'all');
  assert.equal(all[0].value, '/clear all');
  assert.equal(getCommandSuggestions('/clear nope').length, 0);
});

test('不带参数的命令在空白后仍有效，但拒绝额外参数', () => {
  for (const name of ['help', 'settings', 'home', 'back']) {
    assert.equal(getCommandSuggestions(`/${name}`)[0].value, `/${name}`);
    assert.equal(getCommandSuggestions(`/${name} `)[0].argument, '');
    assert.equal(getCommandSuggestions(`/${name} extra`).length, 0);
  }
});

test('未知命令、非法参数及多余参数返回空建议', () => {
  for (const input of ['/unknown', '/clearall', '/theme ultraviolet', '/theme dark extra', '/clear all extra']) {
    assert.deepEqual(getCommandSuggestions(input), [], input);
  }
});

test('普通搜索、转义斜杠及非字符串输入不被当作命令', () => {
  for (const input of ['', 'x', 'clear', ' /clear', '//', '//clear', '/ clear', '/\tclear', null, undefined, 0, 1, {}, []]) {
    assert.deepEqual(getCommandSuggestions(input), [], String(input));
  }
});
