#!/bin/bash

set -euo pipefail

run_browser=false
if [ "$#" -gt 0 ]; then
  if [ "$#" -ne 1 ] || [ "$1" != "--browser" ]; then
    echo "用法：bash check.sh [--browser]" >&2
    exit 2
  fi
  run_browser=true
fi

for script in pinyin.js search.js storage.js commands.js bookmarks.js dialogs.js keyboard.js popup.js scripts/benchmark.cjs scripts/browser-check.cjs; do
  node --check "$script"
done
python3 -m json.tool manifest.json >/dev/null
bash -n check.sh build.sh
node --test tests/*.test.js
git diff --check

echo "✅ 所有静态检查与单元测试通过"

if [ "$run_browser" = true ]; then
  node scripts/browser-check.cjs
fi
