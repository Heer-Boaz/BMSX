import { defineLintRule } from '../../rule';
import { type LuaFunctionExpression as CartFunctionExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { matchesBool01DuplicatePattern } from './impl/support/conditions';
import { pushIssue } from './impl/support/lint_context';

export const bool01DuplicatePatternRule = defineLintRule('cart', 'bool01_duplicate_pattern');

export function lintBool01DuplicatePattern(functionName: string, functionExpression: CartFunctionExpression, issues: CartLintIssue[]): void {
	if (functionName === '<anonymous>' || !matchesBool01DuplicatePattern(functionExpression)) {
		return;
	}
	pushIssue(
		issues,
		bool01DuplicatePatternRule.name,
		functionExpression,
		`Duplicate of global bool01 is forbidden ("${functionName}"). Use bool01(...) directly.`,
	);
}
