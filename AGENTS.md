# Repository Guidelines

## Project Structure & Module Organization

This repository is a dependency-free Manifest V3 browser extension. `manifest.json` declares permissions, icons, the popup entry point, and the keyboard command. Keep markup in `popup.html`, presentation in `popup.css`, and UI coordination in `popup.js`. Small native modules provide search (`search.js` and `pinyin.js`), keyboard mapping (`keyboard.js`), persistence (`storage.js`), commands (`commands.js`), bookmark indexing and icon privacy rules (`bookmarks.js`), and dialogs (`dialogs.js`); they are browser globals and can also be required by Node tests. PNG extension icons live in `icons/`, while `logo.svg` and `logo-small.svg` are editable source assets. Use `generate-icons.html` to regenerate icon sizes. Release notes and contributor-facing documentation live in `CHANGELOG.md`, `README.md`, and `CONTRIBUTING.md`. Keep the bundled pinyin data attribution and license in `PINYIN-DATA.md` and `UNICODE-LICENSE.txt` when packaging.

## Build, Test, and Development Commands

There is no package manager or compilation step.

- Load the repository directory through `chrome://extensions/` or `edge://extensions/` using **Load unpacked** for local development.
- Run `bash check.sh` for JavaScript syntax, Manifest JSON, shell syntax, static checks, and Node's built-in tests.
- Run `bash check.sh --browser` to add the optional Chromium UI check, or `node scripts/browser-check.cjs` for that check alone. Install development tools with `npm install --no-save --package-lock=false playwright@1.62.1` and `npx playwright install chromium`; the extension itself has no runtime dependencies. `PLAYWRIGHT_MODULE` can point to an existing Playwright module, `BROWSER_EXECUTABLE` selects a local Chrome/Chromium executable, and `BROWSER_CHECK_OUTPUT` selects the screenshot directory (otherwise a temporary directory is printed).
- Run `node --test tests/storage.test.js` or another relevant test file for a focused check during development.
- Run `node scripts/benchmark.cjs` for synthetic 1,000 / 10,000 / 50,000 bookmark trees. Optional numeric arguments select smaller samples, such as `node scripts/benchmark.cjs 1000`. This only measures indexing and querying; it does not read real bookmarks or measure popup rendering.
- Run `bash build.sh` to create `release/bookmark-searcher-v<version>.zip`; this requires the `zip` utility and recreates `release/`.

After changing extension files, reload the extension from the browser's extensions page before testing.

## Coding Style & Naming Conventions

Use ES6+ JavaScript with two-space indentation, semicolons, `const`/`let`, and `camelCase` identifiers. Follow the existing section-comment organization in `popup.js`, but reserve inline comments for non-obvious behavior. Use semantic HTML and preserve ARIA labels for interactive controls. Prefer descriptive kebab-case CSS classes such as `.bookmark-item`; reuse existing CSS variables and visual patterns where possible. No automated formatter or linter is configured, so match nearby code.

## Testing Guidelines

Tests in `tests/` use Node's built-in test runner; no coverage threshold is configured. Keep meaningful tests for search ranking, pinyin and domain matching, command execution, storage errors and queues, keyboard behavior, and popup semantics. The optional browser check exercises real Chromium DOM, native keyboard behavior, dialogs, search scope, pagination, navigation recovery, pins, retries, and twelve light/dark theme combinations. It injects fixture `chrome.bookmarks`, `chrome.storage`, and `chrome.tabs` APIs; do not call it end-to-end validation of a live extension. Loading the unpacked extension in Chrome or Edge is still required to verify actual platform APIs, permissions, the global shortcut, popup closure, and real bookmark reads/writes. Also manually verify offline/favicon display and inspect the popup console. Record privacy implications when changing external icon requests: preferences use `storage.sync`, while history, usage, and pinned bookmark IDs use `storage.local`.

## Commit & Pull Request Guidelines

Recent history uses brief Chinese summaries, while `CONTRIBUTING.md` recommends Conventional Commits. Prefer scoped, imperative messages such as `feat: add pinned bookmarks` or `fix: correct keyboard selection`. Keep commits focused. Pull requests should explain the change and motivation, link relevant issues, list manual test steps and browsers, and include screenshots or recordings for UI changes. Update `CHANGELOG.md` and the version in `manifest.json` for releases.
