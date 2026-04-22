import { defineLintRule } from '../../rule';
import { type LuaFunctionExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { matchesComparisonWrapperGetterPattern } from './impl/support/conditions';
import { pushIssue } from './impl/support/lint_context';

export const comparisonWrapperGetterPatternRule = defineLintRule('lua_cart', 'comparison_wrapper_getter_pattern');

export function lintComparisonWrapperGetterPattern(functionName: string, functionExpression: LuaFunctionExpression, issues: LuaLintIssue[]): void {
	if (functionName === '<anonymous>' || !matchesComparisonWrapperGetterPattern(functionExpression)) {
		return;
	}
	pushIssue(
		issues,
		comparisonWrapperGetterPatternRule.name,
		functionExpression,
		`Single-value comparison wrapper is forbidden ("${functionName}"). Inline the comparison or expose the original value source directly.`,
	);
}
