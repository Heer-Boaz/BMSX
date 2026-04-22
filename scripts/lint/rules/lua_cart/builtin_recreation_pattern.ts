import { defineLintRule } from '../../rule';
import { type LuaFunctionExpression as CartFunctionExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { matchesBuiltinRecreationPattern } from './impl/support/functions';
import { pushIssue } from './impl/support/lint_context';

export const builtinRecreationPatternRule = defineLintRule('cart', 'builtin_recreation_pattern');

export function lintBuiltinRecreationPattern(functionName: string, functionExpression: CartFunctionExpression, issues: CartLintIssue[]): boolean {
	if (functionName === '<anonymous>' || !matchesBuiltinRecreationPattern(functionExpression)) {
		return false;
	}
	pushIssue(
		issues,
		builtinRecreationPatternRule.name,
		functionExpression,
		`Recreating existing built-in behavior is forbidden ("${functionName}").`,
	);
	return true;
}
