import type { CppFunctionInfo } from '../../../../src/bmsx/language/cpp/syntax/declarations';
import {
	cppRangeHas,
	findTopLevelCppSemicolon,
	trimmedCppExpressionText,
} from '../../../../src/bmsx/language/cpp/syntax/syntax';
import type { CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushLintIssue, type CppLintIssue } from '../cpp/support/diagnostics';
import { defineLintRule } from '../../rule';
import { type TsLintIssue as LintIssue } from '../../ts_rule';
import ts from 'typescript';
import { stringSwitchComparisonSubject } from '../ts/support/conditions';

export const stringSwitchChainPatternRule = defineLintRule('common', 'string_switch_chain_pattern');

export function lintCppStringSwitchChains(file: string, tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, issues: CppLintIssue[]): void {
	for (let index = info.bodyStart + 1; index < info.bodyEnd; index += 1) {
		if (tokens[index].text !== 'if' || tokens[index - 1]?.text === 'else') {
			continue;
		}
		const subjects: string[] = [];
		let currentIfIndex = index;
		while (true) {
			if (tokens[currentIfIndex]?.text !== 'if' || tokens[currentIfIndex + 1]?.text !== '(') {
				subjects.length = 0;
				break;
			}
			const conditionStart = currentIfIndex + 2;
			const conditionEnd = pairs[currentIfIndex + 1];
			if (conditionEnd < 0 || conditionEnd >= info.bodyEnd) {
				subjects.length = 0;
				break;
			}
			const subject = cppStringSwitchComparisonSubject(tokens, conditionStart, conditionEnd);
			if (subject === null) {
				subjects.length = 0;
				break;
			}
			subjects.push(subject);
			const consequentEnd = cppIfBranchEnd(tokens, pairs, conditionEnd + 1, info.bodyEnd);
			if (consequentEnd < 0) {
				subjects.length = 0;
				break;
			}
			if (tokens[consequentEnd + 1]?.text !== 'else') {
				break;
			}
			currentIfIndex = consequentEnd + 2;
			if (tokens[currentIfIndex]?.text !== 'if') {
				break;
			}
		}
		if (subjects.length < 3) {
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
			pushLintIssue(issues, file, tokens[index], stringSwitchChainPatternRule.name, 'Multiple string comparisons against the same expression are forbidden. Use switch-statement or lookup table instead.');
		}
	}
}

function cppIfBranchEnd(tokens: readonly CppToken[], pairs: readonly number[], start: number, bodyEnd: number): number {
	if (tokens[start]?.text === '{') {
		const closeBrace = pairs[start];
		if (closeBrace < 0 || closeBrace > bodyEnd) {
			return -1;
		}
		return closeBrace;
	}
	return findTopLevelCppSemicolon(tokens, start, bodyEnd);
}

function cppStringSwitchComparisonSubject(tokens: readonly CppToken[], start: number, end: number): string | null {
	for (let index = start; index < end; index += 1) {
		if (tokens[index].text !== '==') {
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

export function lintStringSwitchChain(node: ts.IfStatement, sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	const parent = node.parent;
	if (ts.isIfStatement(parent) && parent.elseStatement === node) {
		return;
	}
	const subjects: string[] = [];
	let current: ts.IfStatement | undefined = node;
	while (current !== undefined) {
		const subject = stringSwitchComparisonSubject(current.expression);
		if (subject === null) {
			return;
		}
		subjects.push(subject);
		const elseStatement = current.elseStatement;
		if (elseStatement === undefined || !ts.isIfStatement(elseStatement)) {
			break;
		}
		current = elseStatement;
	}
	if (subjects.length < 3) {
		return;
	}
	const first = subjects[0];
	for (let index = 1; index < subjects.length; index += 1) {
		if (subjects[index] !== first) {
			return;
		}
	}
	const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
	issues.push({
		kind: stringSwitchChainPatternRule.name,
		file: sourceFile.fileName,
		line: position.line + 1,
		column: position.character + 1,
		name: stringSwitchChainPatternRule.name,
		message: 'Multiple string comparisons against the same expression are forbidden. Use `switch`-statement or lookup table instead.',
	});
}
