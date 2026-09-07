const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(projectRoot, 'popup.html'), 'utf8');
const css = fs.readFileSync(path.join(projectRoot, 'popup.css'), 'utf8');
const popupScript = fs.readFileSync(path.join(projectRoot, 'popup.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8'));

test('HTML ID 唯一且脚本引用的元素都存在', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const uniqueIds = new Set(ids);
  const referencedIds = [...popupScript.matchAll(/getElementById\('([^']+)'\)/g)]
    .map(match => match[1]);

  assert.equal(uniqueIds.size, ids.length);
  assert.deepEqual(referencedIds.filter(id => !uniqueIds.has(id)), []);
});

test('搜索与键盘核心在弹窗逻辑之前加载', () => {
  const searchScriptIndex = html.indexOf('<script src="search.js"></script>');
  const keyboardScriptIndex = html.indexOf('<script src="keyboard.js"></script>');
  const popupScriptIndex = html.indexOf('<script src="popup.js"></script>');

  assert.ok(searchScriptIndex >= 0);
  assert.ok(keyboardScriptIndex > searchScriptIndex);
  assert.ok(popupScriptIndex > keyboardScriptIndex);
});

test('CSS 大括号匹配', () => {
  const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0;

  for (const character of cssWithoutComments) {
    if (character === '{') depth++;
    if (character === '}') depth--;
    assert.ok(depth >= 0);
  }

  assert.equal(depth, 0);
});

test('Manifest 使用最小化权限并与界面版本一致', () => {
  assert.deepEqual(manifest.permissions.sort(), ['bookmarks', 'storage']);
  assert.ok(!manifest.permissions.includes('contextMenus'));
  assert.match(html, new RegExp(`v${manifest.version.replaceAll('.', '\\.')}`));
});

test('六套配色选项与样式保持同步', () => {
  const palettes = [...html.matchAll(/name="colorTheme" value="([^"]+)"/g)]
    .map(match => match[1]);

  assert.deepEqual(palettes, ['classic', 'candy', 'ocean', 'matcha', 'sunset', 'mono']);
  palettes.filter(palette => palette !== 'classic').forEach(palette => {
    assert.match(css, new RegExp(`data-color-theme="${palette}"`));
  });
});
