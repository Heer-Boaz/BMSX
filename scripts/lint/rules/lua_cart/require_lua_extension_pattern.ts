import { LuaSyntaxKind as SyntaxKind, type LuaCallExpression as CallExpression } from '../../../../src/bmsx/lua/syntax/ast';
import type { CartLintIssue, CartLintIssuePusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';
import { lintForbiddenRenderModuleRequirePattern } from './forbidden_render_module_require_pattern';

export const requireExtensionPatternRule = defineLintRule('cart', 'require_lua_extension_pattern');

export function lintRequireCall(expression: CallExpression, issues: CartLintIssue[], pushIssue: CartLintIssuePusher): void {
	if (expression.callee.kind !== SyntaxKind.IdentifierExpression || expression.callee.name !== 'require') {
		return;
	}
	if (expression.arguments.length === 0) {
		return;
	}
	const firstArgument = expression.arguments[0];
	if (firstArgument.kind !== SyntaxKind.StringLiteralExpression) {
		return;
	}
	if (lintForbiddenRenderModuleRequirePattern(firstArgument, issues, pushIssue)) {
		return;
	}
	if (!firstArgument.value.toLowerCase().endsWith('.lua')) {
		return;
	}
	pushIssue(
		issues,
		requireExtensionPatternRule.name,
		firstArgument,
		`require() must not include a ".lua" suffix ("${firstArgument.value}").`,
	);
}
