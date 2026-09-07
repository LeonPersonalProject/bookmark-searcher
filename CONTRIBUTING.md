# 贡献指南

感谢你对书签搜索器项目的关注！我们欢迎任何形式的贡献。

## 🤝 如何贡献

### 报告 Bug

如果你发现了 Bug，请：

1. 检查 [Issues](https://github.com/LeonPersonalProject/bookmark-searcher/issues) 确认问题是否已被报告
2. 如果没有，创建一个新的 Issue，包含：
   - 清晰的标题和描述
   - 重现步骤
   - 预期行为和实际行为
   - 截图（如果适用）
   - 浏览器版本和操作系统信息

### 提出新功能

如果你有新功能的想法：

1. 先创建一个 Issue 讨论这个功能
2. 说明为什么需要这个功能
3. 描述你期望的行为
4. 等待维护者的反馈

### 提交代码

1. **Fork 项目**
   ```bash
   # 点击 GitHub 页面右上角的 Fork 按钮
   ```

2. **克隆你的 Fork**
   ```bash
   git clone https://github.com/YOUR_USERNAME/bookmark-searcher.git
   cd bookmark-searcher
   ```

3. **创建分支**
   ```bash
   git checkout -b feature/your-feature-name
   # 或
   git checkout -b fix/your-bug-fix
   ```

4. **进行修改**
   - 遵循现有的代码风格
   - 添加必要的注释
   - 确保代码可以正常运行

5. **测试你的修改**
   - 在 Chrome/Edge 中加载扩展
   - 测试所有相关功能
   - 确保没有破坏现有功能

6. **提交修改**
   ```bash
   git add .
   git commit -m "feat: 添加新功能描述"
   # 或
   git commit -m "fix: 修复某个问题"
   ```

7. **推送到你的 Fork**
   ```bash
   git push origin feature/your-feature-name
   ```

8. **创建 Pull Request**
   - 访问你的 Fork 页面
   - 点击 "New Pull Request"
   - 填写 PR 描述，说明你的修改
   - 等待审核

## 📝 代码规范

### JavaScript

- 使用 ES6+ 语法
- 使用 2 空格缩进
- 函数和变量使用驼峰命名
- 添加清晰的注释
- 避免使用 `var`，使用 `const` 和 `let`

```javascript
// ✅ 好的示例
const bookmarkTitle = 'Example';
function getBookmarkById(id) {
  // 实现...
}

// ❌ 不好的示例
var bookmark_title = 'Example';
function GetBookmarkByID(id) {
  // 实现...
}
```

### CSS

- 使用有意义的类名
- 遵循 BEM 命名规范（可选）
- 添加注释说明复杂样式
- 使用 CSS 变量（如果适用）

```css
/* ✅ 好的示例 */
.bookmark-item {
  padding: 12px;
}

.bookmark-item--selected {
  background: #6366f1;
}

/* ❌ 不好的示例 */
.bi {
  padding: 12px;
}
```

### HTML

- 使用语义化标签
- 添加必要的 ARIA 属性
- 保持结构清晰

## 📋 Commit 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

- `feat:` 新功能
- `fix:` Bug 修复
- `docs:` 文档更新
- `style:` 代码格式（不影响功能）
- `refactor:` 重构
- `perf:` 性能优化
- `test:` 测试相关
- `chore:` 构建/工具相关

示例：
```bash
feat: 添加深色模式支持
fix: 修复搜索框焦点问题
docs: 更新 README 安装说明
style: 格式化代码
refactor: 重构搜索逻辑
perf: 优化书签加载性能
```

## 🧪 测试

先运行自动检查：

```bash
bash check.sh
```

在提交 PR 之前，请确保：

- [ ] 扩展可以正常加载
- [ ] 所有现有功能正常工作
- [ ] 新功能按预期工作
- [ ] 没有控制台错误
- [ ] 在不同浏览器中测试（Chrome, Edge）
- [ ] 测试浅色、深色模式以及所有配色主题

## 📚 开发环境设置

1. **安装依赖**
   ```bash
   # 本项目目前不需要 npm 依赖
   # 如果将来需要，会在这里说明
   ```

2. **加载扩展**
   - 打开 `chrome://extensions/`
   - 开启"开发者模式"
   - 点击"加载已解压的扩展程序"
   - 选择项目文件夹

3. **调试**
   - 右键点击扩展图标 → 检查弹出内容
   - 使用 Chrome DevTools 调试

## 🎨 设计指南

- 遵循现有的高密度命令面板布局，优先保证搜索和结果层级
- 新颜色应接入主题变量，并同时覆盖浅色与深色外观
- 把动效用于打开、关闭和确认等状态变化，尊重减少动态效果偏好
- 保持可见键盘焦点，并检查所有配色主题下的文字对比度

## ❓ 问题？

如果你有任何问题：

1. 查看 [README.md](README.md)
2. 搜索现有的 [Issues](https://github.com/LeonPersonalProject/bookmark-searcher/issues)
3. 创建新的 Issue 提问

## 📄 许可证

通过贡献代码，你同意你的贡献将在 MIT 许可证下发布。

---

再次感谢你的贡献！🎉
