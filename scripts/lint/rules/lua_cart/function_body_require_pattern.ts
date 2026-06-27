import { LuaSyntaxKind as SyntaxKind, type LuaCallExpression as CallExpression } from '../../../../machine/ts/lua/syntax/ast';
import type { CartLintIssue, CartLintIssuePusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';

export const functionBodyRequirePatternRule = defineLintRule('cart', 'function_body_require_pattern');

export function lintFunctionBodyRequireCall(expression: CallExpression, insideFunction: boolean, issues: CartLintIssue[], pushIssue: CartLintIssuePusher): void {
	if (!insideFunction || expression.callee.kind !== SyntaxKind.IdentifierExpression || expression.callee.name !== 'require') {
		return;
	}
	pushIssue(
		issues,
		functionBodyRequirePatternRule.name,
		expression,
		'require() inside function bodies is forbidden. Hoist module imports to file scope with local <const> require bindings.',
	);
}
