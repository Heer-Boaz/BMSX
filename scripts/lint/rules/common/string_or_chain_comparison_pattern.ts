import {
	cppRangeHas,
	findNextDelimiter,
	findPreviousDelimiter,
	trimmedExpressionText,
} from '../../../../src/bmsx/language/cpp/syntax/syntax';
import type { Token } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushTokenLintIssue, type LintIssue } from '../cpp/support/diagnostics';
import { defineLintRule } from '../../rule';
import { type LuaExpression as Expression } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { matchesStringOrChainComparisonPattern } from '../lua_cart/impl/support/conditions';
import { pushIssue } from '../lua_cart/impl/support/lint_context';

export const stringOrChainComparisonPatternRule = defineLintRule('common', 'string_or_chain_comparison_pattern');

export function lintStringOrChains(file: string, tokens: readonly Token[], issues: LintIssue[]): void {
	const visited = new Set<number>();
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index].text !== '||') {
			continue;
		}
		const start = findPreviousDelimiter(tokens, index) + 1;
		if (visited.has(start)) {
			continue;
		}
		visited.add(start);
		const end = findNextDelimiter(tokens, index);
		const subjects: string[] = [];
		let segmentStart = start;
		for (let cursor = start; cursor <= end; cursor += 1) {
			if (cursor === end || tokens[cursor].text === '||') {
				const subject = stringComparisonSubject(tokens, segmentStart, cursor);
				if (subject !== null) {
					subjects.push(subject);
				}
				segmentStart = cursor + 1;
			}
		}
		if (subjects.length <= 2) {
			continue;
		}
		const first = subjects[0];
		let sameSubject = true;
		for (let subjectIndex = 1; subjectIndex < subjects.length; subjectIndex += 1) {
			if (subjects[subjectIndex] !== first) {
				sameSubject = false;
				break;
			}
		}
		if (sameSubject) {
			pushTokenLintIssue(issues, file, tokens[index], stringOrChainComparisonPatternRule.name, 'Multiple OR-comparisons against the same expression with string literals are forbidden. Use switch-statement or set-like lookups instead.');
		}
	}
}

function stringComparisonSubject(tokens: readonly Token[], start: number, end: number): string | null {
	for (let index = start; index < end; index += 1) {
		if (tokens[index].text !== '==' && tokens[index].text !== '!=') {
			continue;
		}
		if (cppRangeHas(tokens, start, index, token => token.kind === 'string') && !cppRangeHas(tokens, index + 1, end, token => token.kind === 'string')) {
			return trimmedExpressionText(tokens, index + 1, end);
		}
		if (cppRangeHas(tokens, index + 1, end, token => token.kind === 'string') && !cppRangeHas(tokens, start, index, token => token.kind === 'string')) {
			return trimmedExpressionText(tokens, start, index);
		}
	}
	return null;
}

export function lintStringOrChainComparisonPattern(expression: Expression, issues: CartLintIssue[]): void {
	if (!matchesStringOrChainComparisonPattern(expression)) {
		return;
	}
	pushIssue(
		issues,
		stringOrChainComparisonPatternRule.name,
		expression,
		'OR-chains that compare the same expression against multiple string literals are forbidden. Use lookup-based membership instead.',
	);
}
