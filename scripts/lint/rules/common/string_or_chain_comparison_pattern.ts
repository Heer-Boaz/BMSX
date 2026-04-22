import {
	cppRangeHas,
	findNextCppDelimiter,
	findPreviousCppDelimiter,
	trimmedCppExpressionText,
} from '../../../../src/bmsx/language/cpp/syntax/syntax';
import type { CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import type { CppLintIssue } from '../../../analysis/cpp_quality/diagnostics';
import { pushLintIssue } from '../../../analysis/cpp_quality/diagnostics';
import { defineLintRule } from '../../rule';

export const stringOrChainComparisonPatternRule = defineLintRule('common', 'string_or_chain_comparison_pattern');

export function lintCppStringOrChains(file: string, tokens: readonly CppToken[], issues: CppLintIssue[]): void {
	const visited = new Set<number>();
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index].text !== '||') {
			continue;
		}
		const start = findPreviousCppDelimiter(tokens, index) + 1;
		if (visited.has(start)) {
			continue;
		}
		visited.add(start);
		const end = findNextCppDelimiter(tokens, index);
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
			pushLintIssue(issues, file, tokens[index], stringOrChainComparisonPatternRule.name, 'Multiple OR-comparisons against the same expression with string literals are forbidden. Use switch-statement or set-like lookups instead.');
		}
	}
}

function stringComparisonSubject(tokens: readonly CppToken[], start: number, end: number): string | null {
	for (let index = start; index < end; index += 1) {
		if (tokens[index].text !== '==' && tokens[index].text !== '!=') {
			continue;
		}
		if (cppRangeHas(tokens, start, index, token => token.kind === 'string') && !cppRangeHas(tokens, index + 1, end, token => token.kind === 'string')) {
			return trimmedCppExpressionText(tokens, index + 1, end);
		}
		if (cppRangeHas(tokens, index + 1, end, token => token.kind === 'string') && !cppRangeHas(tokens, start, index, token => token.kind === 'string')) {
			return trimmedCppExpressionText(tokens, start, index);
		}
	}
	return null;
}
