import { repeatedAccessChainPatternRule } from './repeated_access_chain_pattern';
import type { CppLintIssue } from '../cpp/support/diagnostics';
import { cppTokenText, normalizedCppTokenText, type CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { collectCppStatementRanges, cppRangeHas } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import type { CppFunctionInfo } from '../../../../src/bmsx/language/cpp/syntax/declarations';
import type { TsLintIssue } from '../../ts_rule';
import { defineLintRule } from '../../rule';

export const repeatedExpressionPatternRule = defineLintRule('code_quality', 'repeated_expression_pattern');

const MIN_REPEATED_EXPRESSION_COUNT = 2;
const REPEATED_EXPRESSION_PAIR_MIN_LENGTH = 48;

export type RepeatedExpressionInfo = {
	line: number;
	column: number;
	count: number;
	sampleText: string;
};

export function addRepeatedExpressionIssues(
	scope: ReadonlyMap<string, RepeatedExpressionInfo>,
	fileName: string,
	issues: TsLintIssue[],
): void {
	for (const info of scope.values()) {
		if (info.count < MIN_REPEATED_EXPRESSION_COUNT) {
			continue;
		}
		if (info.count === 2 && info.sampleText.length < REPEATED_EXPRESSION_PAIR_MIN_LENGTH) {
			continue;
		}
		issues.push({
			kind: repeatedExpressionPatternRule.name,
			file: fileName,
			line: info.line,
			column: info.column,
			name: repeatedExpressionPatternRule.name,
			message: `Expression is repeated ${info.count} times in the same scope: ${info.sampleText}`,
		});
	}
}

function compactCppSampleText(text: string): string {
	return text.length <= 180 ? text : `${text.slice(0, 177)}...`;
}

export function lintCppRepeatedExpressions(file: string, tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, issues: CppLintIssue[]): void {
	const expressions = new Map<string, { token: CppToken; count: number }>();
	const repeatedAccessChains = new Map<string, { token: CppToken; count: number }>();
	const record = (start: number, end: number): void => {
		const text = normalizedCppTokenText(tokens, start, end);
		if (text.length < 24 || text.startsWith('this.') || text.startsWith('this->')) {
			return;
		}
		const existing = expressions.get(text);
		if (existing !== undefined) {
			existing.count += 1;
			return;
		}
		expressions.set(text, { token: tokens[start], count: 1 });
	};
	const recordAccessChain = (index: number): void => {
		const text = cppRepeatedAccessChain(tokens, pairs, index);
		if (text === null) {
			return;
		}
		const existing = repeatedAccessChains.get(text);
		if (existing !== undefined) {
			existing.count += 1;
			return;
		}
		repeatedAccessChains.set(text, { token: tokens[index], count: 1 });
	};
	const ranges = collectCppStatementRanges(tokens, info.bodyStart + 1, info.bodyEnd);
	for (let index = 0; index < ranges.length; index += 1) {
		const start = ranges[index][0];
		const end = ranges[index][1];
		if (cppRangeHas(tokens, start, end, token => token.text === '==' || token.text === '!=' || token.text === '<' || token.text === '>')) {
			record(start, end);
		}
	}
	for (let index = info.bodyStart + 1; index < info.bodyEnd; index += 1) {
		recordAccessChain(index);
	}
	for (const [text, value] of expressions) {
		if (value.count <= 2) {
			continue;
		}
		issues.push({
			kind: repeatedExpressionPatternRule.name,
			file,
			line: value.token.line,
			column: value.token.column,
			name: repeatedExpressionPatternRule.name,
			message: `Expression is repeated ${value.count} times in the same scope: ${compactCppSampleText(text)}`,
		});
	}
	for (const [text, value] of repeatedAccessChains) {
		if (value.count <= 2) {
			continue;
		}
		issues.push({
			kind: repeatedAccessChainPatternRule.name,
			file,
			line: value.token.line,
			column: value.token.column,
			name: repeatedAccessChainPatternRule.name,
			message: `Access/call chain is repeated ${value.count} times in the same function: ${text}`,
		});
	}
}

function cppRepeatedAccessChain(tokens: readonly CppToken[], pairs: readonly number[], start: number): string | null {
	if (tokens[start]?.kind !== 'id') {
		return null;
	}
	const previous = tokens[start - 1]?.text;
	if (previous === '.' || previous === '->' || previous === '::') {
		return null;
	}
	let index = start + 1;
	let segmentCount = 0;
	while (index < tokens.length) {
		if (tokens[index]?.text === '(' && pairs[index] > index) {
			index = pairs[index] + 1;
			continue;
		}
		const separator = tokens[index]?.text;
		if ((separator !== '.' && separator !== '->' && separator !== '::') || tokens[index + 1]?.kind !== 'id') {
			break;
		}
		segmentCount += 1;
		index += 2;
	}
	if (segmentCount < 2) {
		return null;
	}
	const text = cppTokenText(tokens, start, index);
	if (text.length < 24 || text.startsWith('this.') || text.startsWith('this->')) {
		return null;
	}
	return compactCppSampleText(text);
}
