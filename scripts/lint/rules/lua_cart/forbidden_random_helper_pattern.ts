import { defineLintRule } from '../../rule';
import { type LuaFunctionExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { matchesForbiddenRandomHelperPattern } from './impl/support/general';
import { pushIssue } from './impl/support/lint_context';

export const forbiddenRandomHelperPatternRule = defineLintRule('lua_cart', 'forbidden_random_helper_pattern');

export function lintForbiddenRandomHelperPattern(functionName: string, functionExpression: LuaFunctionExpression, isBuiltinRecreation: boolean, issues: LuaLintIssue[]): void {
	if (functionName === '<anonymous>' || isBuiltinRecreation || !matchesForbiddenRandomHelperPattern(functionName)) {
		return;
	}
	pushIssue(
		issues,
		forbiddenRandomHelperPatternRule.name,
		functionExpression,
		`Custom random helper "${functionName}" is forbidden. Use math.random directly instead of inventing a random_int-style wrapper.`,
	);
}
