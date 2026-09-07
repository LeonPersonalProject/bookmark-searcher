# Repository Guidelines

## Project Structure & Module Organization

This repository is a dependency-free Manifest V3 browser extension. `manifest.json` declares permissions, icons, the popup entry point, and the keyboard command. The UI is split across `popup.html`, `popup.css`, and `popup.js`; keep markup, presentation, and Chrome API behavior in their respective files. PNG extension icons live in `icons/`, while `logo.svg` and `logo-small.svg` are editable source assets. Use `generate-icons.html` to regenerate icon sizes. Release notes and contributor-facing documentation live in `CHANGELOG.md`, `README.md`, and `CONTRIBUTING.md`.

## Build, Test, and Development Commands

There is no package manager or compilation step.

- Load the repository directory through `chrome://extensions/` or `edge://extensions/` using **Load unpacked** for local development.
- Run `node --check popup.js` to catch JavaScript syntax errors.
- Run `python3 -m json.tool manifest.json >/dev/null` to validate manifest JSON.
- Run `bash build.sh` to create `release/bookmark-searcher-v<version>.zip`; this requires the `zip` utility and recreates `release/`.

After changing extension files, reload the extension from the browser's extensions page before testing.

## Coding Style & Naming Conventions

Use ES6+ JavaScript with two-space indentation, semicolons, `const`/`let`, and `camelCase` identifiers. Follow the existing section-comment organization in `popup.js`, but reserve inline comments for non-obvious behavior. Use semantic HTML and preserve ARIA labels for interactive controls. Prefer descriptive kebab-case CSS classes such as `.bookmark-item`; reuse existing CSS variables and visual patterns where possible. No automated formatter or linter is configured, so match nearby code.

## Testing Guidelines

No automated test suite or coverage threshold exists. Manually verify bookmark loading, exact and fuzzy search, folder navigation, keyboard controls, settings persistence, recent/history behavior, favicon display, and both themes. Test at least Chrome or Edge, inspect the popup console for errors, and check that CSP and requested permissions still match runtime behavior.

## Commit & Pull Request Guidelines

Recent history uses brief Chinese summaries, while `CONTRIBUTING.md` recommends Conventional Commits. Prefer scoped, imperative messages such as `feat: add pinned bookmarks` or `fix: correct keyboard selection`. Keep commits focused. Pull requests should explain the change and motivation, link relevant issues, list manual test steps and browsers, and include screenshots or recordings for UI changes. Update `CHANGELOG.md` and the version in `manifest.json` for releases.
