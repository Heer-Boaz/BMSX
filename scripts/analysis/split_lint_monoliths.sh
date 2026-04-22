#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cd "$ROOT"

git show HEAD:scripts/analysis/code_quality.ts > "$TMP_DIR/code_quality.ts"
git show HEAD:scripts/analysis/cpp_quality/rules.ts > "$TMP_DIR/cpp_rules.ts"
git show HEAD:scripts/rompacker/cart_lua_linter.ts > "$TMP_DIR/cart_lua_linter.ts"

git diff --name-only -- \
	scripts/lint/rules \
	scripts/analysis/cpp_quality/rules.ts \
	scripts/analysis/cpp_quality/analyzer.ts \
	scripts/rompacker/cart_lua_linter.ts \
	| while IFS= read -r path; do
		if git cat-file -e "HEAD:$path" 2>/dev/null; then
			git show "HEAD:$path" > "$path"
		fi
	done

node scripts/analysis/split_lint_monoliths.mjs "$TMP_DIR"
