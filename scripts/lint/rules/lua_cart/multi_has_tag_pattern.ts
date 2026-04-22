import { defineLintRule } from '../../rule';
import { type LuaExpression, type LuaIfStatement } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { countHasTagCalls, countSplitNestedIfHasTagCalls } from './impl/support/tags';
import { pushIssue } from './impl/support/lint_context';

export const multiHasTagPatternRule = defineLintRule('lua_cart', 'multi_has_tag_pattern');

export function lintSplitNestedIfHasTagPattern(statement: LuaIfStatement, issues: LuaLintIssue[]): void {
	const hasTagCheckCount = countSplitNestedIfHasTagCalls(statement);
	if (hasTagCheckCount <= 1) {
		return;
	}
	pushIssue(
		issues,
		multiHasTagPatternRule.name,
		statement,
		`Nested if-chain splits ${hasTagCheckCount} has_tag checks across multiple statements. This is a forbidden workaround for the multi has_tag rule. Use tag_groups, tag_derivations, or derived_tags instead.`,
	);
}

export function lintMultiHasTagPattern(expression: LuaExpression, issues: LuaLintIssue[]): void {
	const hasTagCheckCount = countHasTagCalls(expression);
	if (hasTagCheckCount <= 1) {
		return;
	}
	pushIssue(
		issues,
		multiHasTagPatternRule.name,
		expression,
		`Statement contains ${hasTagCheckCount} has_tag checks. Use tag_groups, tag_derivations, or derived_tags instead.`,
	);
}
