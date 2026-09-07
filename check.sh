#!/bin/bash

set -e

node --check search.js
node --check keyboard.js
node --check popup.js
python3 -m json.tool manifest.json >/dev/null
node --test tests/*.test.js
git diff --check

echo "✅ 所有静态检查与单元测试通过"
