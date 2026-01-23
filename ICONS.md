# 图标文件说明

本扩展需要三个尺寸的图标文件：

- icon16.png (16x16 像素) - 用于浏览器工具栏
- icon48.png (48x48 像素) - 用于扩展管理页面
- icon128.png (128x128 像素) - 用于 Chrome Web Store

## 快速生成图标的方法

### 方法 1：在线工具
访问 https://favicon.io/favicon-generator/ 生成图标，然后调整尺寸

### 方法 2：使用 Emoji
你可以使用在线工具将 🔖 emoji 转换为 PNG 图标

### 方法 3：临时方案
如果暂时不需要图标，可以在 manifest.json 中删除以下部分：

```json
"action": {
  "default_popup": "popup.html"
  // 删除 default_icon 部分
},
// 删除整个 icons 部分
```

扩展仍然可以正常工作，只是没有自定义图标。
