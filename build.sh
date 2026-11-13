#!/bin/bash

# 书签搜索器发布脚本
# 用于打包扩展并准备发布

set -euo pipefail

echo "📦 开始打包书签搜索器..."

# 获取版本号
VERSION=$(node -p "require('./manifest.json').version")
echo "📌 当前版本: v$VERSION"

# 创建发布目录
RELEASE_DIR="release"
PACKAGE_NAME="bookmark-searcher-v${VERSION}"

echo "🗂️  创建发布目录..."
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR/$PACKAGE_NAME"

# 复制必要文件
echo "📋 复制文件..."
required_files=(
  manifest.json
  popup.html
  popup.css
  popup.js
  pinyin.js
  search.js
  storage.js
  commands.js
  bookmarks.js
  dialogs.js
  keyboard.js
  README.md
  LICENSE
  PINYIN-DATA.md
  UNICODE-LICENSE.txt
  CHANGELOG.md
  logo.svg
  logo-small.svg
)
for file in "${required_files[@]}"; do
  test -f "$file"
  cp "$file" "$RELEASE_DIR/$PACKAGE_NAME/"
done

# 复制图标
echo "🎨 复制图标..."
cp -r icons "$RELEASE_DIR/$PACKAGE_NAME/"

# 创建 ZIP 包
echo "🗜️  创建 ZIP 包..."
cd "$RELEASE_DIR"
zip -r "${PACKAGE_NAME}.zip" "$PACKAGE_NAME"
cd ..

echo "✅ 打包完成！"
echo "📦 文件位置: $RELEASE_DIR/${PACKAGE_NAME}.zip"
echo ""
echo "📝 下一步："
echo "1. 测试扩展功能"
echo "2. 更新 CHANGELOG.md"
echo "3. 提交代码: git add . && git commit -m 'chore: release v$VERSION'"
echo "4. 创建标签: git tag v$VERSION"
echo "5. 推送代码: git push && git push --tags"
echo "6. 上传到 Chrome Web Store"
