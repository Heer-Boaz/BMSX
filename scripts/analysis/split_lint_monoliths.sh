#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cd "$ROOT"

source_revision_for() {
	local path="$1"
	local pattern="$2"
	local revision
	while IFS= read -r revision; do
		if git show "$revision:$path" 2>/dev/null | grep -q "$pattern"; then
			printf '%s\n' "$revision"
			return
		fi
	done < <(git rev-list HEAD -- "$path")
	printf 'No monolith source found for %s\n' "$path" >&2
	exit 1
}

TS_SOURCE_REVISION="$(source_revision_for scripts/analysis/code_quality.ts 'function collectLintIssues')"
CPP_SOURCE_REVISION="$(source_revision_for scripts/analysis/cpp_quality/rules.ts 'function lintCppLocalBindings')"
LUA_SOURCE_REVISION="$(source_revision_for scripts/rompacker/cart_lua_linter.ts 'function lintCartLuaSources')"

git show "$TS_SOURCE_REVISION:scripts/analysis/code_quality.ts" > "$TMP_DIR/code_quality.ts"
git show "$CPP_SOURCE_REVISION:scripts/analysis/cpp_quality/rules.ts" > "$TMP_DIR/cpp_rules.ts"
git show "$LUA_SOURCE_REVISION:scripts/rompacker/cart_lua_linter.ts" > "$TMP_DIR/cart_lua_linter.ts"

node scripts/analysis/split_lint_monoliths.mjs "$TMP_DIR"
