#!/bin/bash

# 书签搜索器发布脚本
# 用于打包扩展并准备发布

set -e

echo "📦 开始打包书签搜索器..."

# 获取版本号
VERSION=$(grep '"version"' manifest.json | sed 's/.*"version": "\(.*\)".*/\1/')
echo "📌 当前版本: v$VERSION"

# 创建发布目录
RELEASE_DIR="release"
PACKAGE_NAME="bookmark-searcher-v${VERSION}"

echo "🗂️  创建发布目录..."
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR/$PACKAGE_NAME"

# 复制必要文件
echo "📋 复制文件..."
cp manifest.json "$RELEASE_DIR/$PACKAGE_NAME/"
cp popup.html "$RELEASE_DIR/$PACKAGE_NAME/"
cp popup.css "$RELEASE_DIR/$PACKAGE_NAME/"
cp popup.js "$RELEASE_DIR/$PACKAGE_NAME/"
cp search.js "$RELEASE_DIR/$PACKAGE_NAME/"
cp keyboard.js "$RELEASE_DIR/$PACKAGE_NAME/"
cp README.md "$RELEASE_DIR/$PACKAGE_NAME/"
cp LICENSE "$RELEASE_DIR/$PACKAGE_NAME/"
cp CHANGELOG.md "$RELEASE_DIR/$PACKAGE_NAME/"

# 复制图标
echo "🎨 复制图标..."
cp -r icons "$RELEASE_DIR/$PACKAGE_NAME/"
cp logo.svg "$RELEASE_DIR/$PACKAGE_NAME/"
cp logo-small.svg "$RELEASE_DIR/$PACKAGE_NAME/"

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
