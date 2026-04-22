import { defineLintRule } from '../../rule';
import { type LuaFunctionExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { matchesEnsureLocalAliasPattern } from './impl/support/cart_patterns';
import { pushIssue } from './impl/support/lint_context';

export const ensureLocalAliasPatternRule = defineLintRule('lua_cart', 'ensure_local_alias_pattern');

export function lintEnsureLocalAliasPattern(functionName: string, functionExpression: LuaFunctionExpression, issues: LuaLintIssue[]): void {
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
