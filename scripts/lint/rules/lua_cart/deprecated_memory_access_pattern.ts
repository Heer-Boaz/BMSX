import { LuaSyntaxKind as SyntaxKind, type LuaExpression as Expression } from '../../../../toolchain/ts/lua/syntax/ast';
import type { CartLintIssue, CartLintIssuePusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';

const DEPRECATED_MEMORY_SPACES = new Set([
	'mem',
	'mem8',
	'mem16le',
	'mem32le',
	'memf32le',
	'memf64le',
]);

export const deprecatedMemoryAccessPatternRule = defineLintRule('cart', 'deprecated_memory_access_pattern');

export function lintDeprecatedMemoryAccessPattern(expression: Expression, issues: CartLintIssue[], pushIssue: CartLintIssuePusher): void {
	if (
		expression.kind !== SyntaxKind.IndexExpression
		|| expression.base.kind !== SyntaxKind.IdentifierExpression
		|| !DEPRECATED_MEMORY_SPACES.has(expression.base.name)
	) {
		return;
	}
	pushIssue(
		issues,
		deprecatedMemoryAccessPatternRule.name,
		expression,
		`Deprecated raw memory access "${expression.base.name}[...]" is forbidden. Use a typed pointer.`,
	);
}
