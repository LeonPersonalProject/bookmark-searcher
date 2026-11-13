const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'popup.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const palettes = ['classic', 'candy', 'ocean', 'matcha', 'sunset', 'mono'];
const modes = ['light', 'dark'];
const textBackgrounds = [
  'page-background',
  'surface',
  'surface-subtle',
  'surface-hover',
  'accent-soft',
  'folder-soft',
  'danger-soft',
  'success-soft'
];

const themeRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((match, order) => {
    const selector = match[1].trim();
    const theme = selector.match(/^body(\.dark-mode)?(?:\[data-color-theme="([a-z]+)"\])?$/);
    if (!theme) return null;

    return {
      selector,
      darkOnly: Boolean(theme[1]),
      palette: theme[2] || null,
      specificity: Number(Boolean(theme[1])) + Number(Boolean(theme[2])),
      order,
      tokens: Object.fromEntries(
        [...match[2].matchAll(/--([a-z-]+):\s*([^;]+);/g)]
          .map(token => [token[1], token[2].trim()])
      )
    };
  })
  .filter(Boolean);

function getThemeTokens(palette, mode) {
  // Light palette rules also match a dark body. Apply specificity and source
  // order so missing dark overrides inherit exactly as they do in the popup.
  return themeRules
    .filter(rule => (!rule.darkOnly || mode === 'dark')
      && (!rule.palette || rule.palette === palette))
    .sort((first, second) => first.specificity - second.specificity || first.order - second.order)
    .reduce((tokens, rule) => ({ ...tokens, ...rule.tokens }), {});
}

function relativeLuminance(color) {
  assert.match(color || '', /^#[0-9a-f]{6}$/i, `需要六位十六进制颜色，实际为 ${color}`);
  return [1, 3, 5]
    .map(offset => Number.parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map(channel => (channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function assertReadable(tokens, foreground, background, theme) {
  const first = relativeLuminance(tokens[foreground]);
  const second = relativeLuminance(tokens[background]);
  const ratio = (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);

  assert.ok(
    ratio >= 4.5,
    `${theme} ${foreground} ${tokens[foreground]} / ${background} ${tokens[background]}`
      + ` 对比度 ${ratio.toFixed(3)}:1，必须达到 4.5:1`
  );
}

test('主题对比度检查覆盖六种配色及明暗两种模式', () => {
  const expectedSelectors = ['body', 'body.dark-mode'];
  palettes.filter(palette => palette !== 'classic').forEach(palette => {
    expectedSelectors.push(
      `body[data-color-theme="${palette}"]`,
      `body.dark-mode[data-color-theme="${palette}"]`
    );
  });

  assert.deepEqual(
    themeRules.map(rule => rule.selector).sort(),
    expectedSelectors.sort()
  );
});

for (const palette of palettes) {
  for (const mode of modes) {
    const theme = `${palette}/${mode}`;
    const tokens = getThemeTokens(palette, mode);

    test(`${theme} 普通文字和强调文字在各层表面达到 4.5:1`, () => {
      for (const foreground of ['text-primary', 'text-secondary', 'text-tertiary', 'accent']) {
        for (const background of textBackgrounds) {
          assertReadable(tokens, foreground, background, theme);
        }
      }
    });

    test(`${theme} 文件夹、错误和成功提示达到 4.5:1`, () => {
      for (const foreground of ['folder', 'danger', 'success']) {
        assertReadable(tokens, foreground, `${foreground}-soft`, theme);
      }
    });

    test(`${theme} 强调和危险按钮的前景达到 4.5:1`, () => {
      assertReadable(tokens, 'accent-foreground', 'accent', theme);
      assertReadable(tokens, 'accent-foreground', 'accent-hover', theme);
      assertReadable(tokens, 'danger-foreground', 'danger', theme);
    });
  }
}
