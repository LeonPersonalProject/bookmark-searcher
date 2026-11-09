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

test('搜索历史与结果容器提供 listbox 导航语义', () => {
  const searchInput = html.match(/<input\s[^>]*id="searchInput"[^>]*>/)?.[0] || '';
  const historyContainer = html.match(/<div\s[^>]*id="searchHistory"[^>]*>/)?.[0] || '';
  const resultsContainer = html.match(/<div\s[^>]*id="results"[^>]*>/)?.[0] || '';

  assert.match(searchInput, /aria-autocomplete="list"/);
  assert.match(searchInput, /role="combobox"/);
  assert.match(searchInput, /aria-haspopup="listbox"/);
  assert.match(searchInput, /aria-expanded="false"/);
  assert.match(searchInput, /aria-controls="results searchHistory"/);

  for (const [name, container] of [
    ['搜索历史', historyContainer],
    ['书签结果', resultsContainer]
  ]) {
    assert.match(container, /role="listbox"/, `${name} 容器需要 listbox 语义`);
    assert.match(container, /aria-orientation="vertical"/, `${name} 容器需要声明纵向导航`);
    assert.match(container, /aria-label="[^"]+"/, `${name} 容器需要可读标签`);
  }
});

test('动态列表项同步 option 选中状态与搜索展开状态', () => {
  assert.match(popupScript, /setAttribute\('role', 'option'\)/);
  assert.match(popupScript, /setAttribute\('aria-selected', 'false'\)/);
  assert.match(popupScript, /setAttribute\('aria-selected', 'true'\)/);
  assert.match(popupScript, /function syncSearchExpandedState\(\)/);
  assert.match(popupScript, /setAttribute\('aria-expanded', String\(/);
});

test('书签编辑与打开使用受限 URL 协议', () => {
  const protocolBlock = popupScript.match(
    /const allowedBookmarkProtocols = new Set\(\[([\s\S]*?)\]\)/
  )?.[1] || '';

  assert.match(protocolBlock, /'http:'/);
  assert.match(protocolBlock, /'https:'/);
  assert.doesNotMatch(protocolBlock, /javascript:/);
  assert.match(popupScript, /function isAllowedBookmarkUrl\(url\)/);
  assert.match(popupScript, /if \(!isAllowedBookmarkUrl\(url\)\)/);
});

function parseColor(value) {
  const hex = value.replace('#', '');
  return [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function relativeLuminance(value) {
  return parseColor(value)
    .map(channel => (channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrastRatio(first, second) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

test('浅色主题的 secondary 与 tertiary 文本保持可读对比度', () => {
  const lightThemeBlocks = [...css.matchAll(
    /body(?:\[data-color-theme="([^"]+)"\])?\s*\{([^}]*)\}/g
  )];

  const seenThemes = new Set();
  for (const match of lightThemeBlocks) {
    const theme = match[1] || 'classic';
    const declarations = match[2];
    const tokens = Object.fromEntries(
      [...declarations.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)]
        .map(token => [token[1], token[2]])
    );
    if (!tokens.surface || !tokens['surface-subtle'] || !tokens['page-background']) continue;
    seenThemes.add(theme);

    const backgrounds = [tokens.surface, tokens['surface-subtle'], tokens['page-background']];
    for (const background of backgrounds) {
      assert.ok(
        contrastRatio(tokens['text-secondary'], background) >= 4.5,
        `${theme} secondary 文本与 ${background} 的对比度不足`
      );
      assert.ok(
        contrastRatio(tokens['text-tertiary'], background) >= 3,
        `${theme} tertiary 文本与 ${background} 的对比度不足`
      );
    }
  }

  assert.deepEqual(
    [...seenThemes].sort(),
    ['classic', 'candy', 'ocean', 'matcha', 'sunset', 'mono'].sort()
  );
});

test('样式提供高对比度与强制颜色模式支持', () => {
  assert.match(css, /@media\s*\(prefers-contrast:\s*more\)/);
  assert.match(css, /@media\s*\(forced-colors:\s*active\)/);
  assert.match(css, /outline-width:\s*3px/);
  assert.match(css, /background:\s*Highlight/);
});
