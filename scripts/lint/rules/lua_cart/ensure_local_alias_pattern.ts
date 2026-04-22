import { defineLintRule } from '../../rule';
import { type LuaFunctionExpression as CartFunctionExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { matchesEnsureLocalAliasPattern } from './impl/support/cart_patterns';
import { pushIssue } from './impl/support/lint_context';

export const ensureLocalAliasPatternRule = defineLintRule('cart', 'ensure_local_alias_pattern');

export function lintEnsureLocalAliasPattern(functionName: string, functionExpression: CartFunctionExpression, issues: CartLintIssue[]): void {
	if (!matchesEnsureLocalAliasPattern(functionExpression)) {
		return;
	}
	pushIssue(
		issues,
		ensureLocalAliasPatternRule.name,
		functionExpression,
		`Ensure-style local alias lazy initialization is forbidden ("${functionName}").`,
	);
}
