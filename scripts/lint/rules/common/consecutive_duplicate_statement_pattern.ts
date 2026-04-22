import ts from 'typescript';
import type { CppFunctionInfo } from '../../../../src/bmsx/language/cpp/syntax/declarations';
import { collectCppStatementRanges, cppCallTargetFromStatement, isCppAccessSpecifier } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import { normalizedCppTokenText, type CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushLintIssue, type CppLintIssue } from '../cpp/support/diagnostics';
import { defineLintRule } from '../../rule';
import { compactStatementText } from '../../ts_node';
import { pushTsLintIssue, type TsLintIssue } from '../../ts_rule';

export const consecutiveDuplicateStatementPatternRule = defineLintRule('common', 'consecutive_duplicate_statement_pattern');

export function lintConsecutiveDuplicateStatementsPattern(
	statements: ts.NodeArray<ts.Statement>,
	sourceFile: ts.SourceFile,
	issues: TsLintIssue[],
): void {
	let previousText: string | null = null;
	for (let index = 0; index < statements.length; index += 1) {
		const statement = statements[index];
		if (ts.isEmptyStatement(statement)) {
			previousText = null;
			continue;
		}
		const text = compactStatementText(statement, sourceFile);
		if (text.length === 0) {
			previousText = null;
			continue;
		}
		if (text === previousText) {
			pushTsLintIssue(
				issues,
				sourceFile,
				statement,
				consecutiveDuplicateStatementPatternRule.name,
				'Consecutive duplicate statement is forbidden. Remove the duplicate or replace intentional repetition with a named loop/helper.',
			);
		}
		previousText = text;
	}
}

export function lintCppConsecutiveDuplicateStatements(file: string, tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, issues: CppLintIssue[]): void {
	const ranges = collectCppStatementRanges(tokens, info.bodyStart + 1, info.bodyEnd);
	let previousText: string | null = null;
	let previousEnd = -1;
	for (let index = 0; index < ranges.length; index += 1) {
		const start = ranges[index][0];
		const end = ranges[index][1];
		if (isCppDuplicateStatementBoundary(tokens, start, end) || cppRangeHasBrace(tokens, previousEnd, start)) {
			previousText = null;
		}
		const text = normalizedCppTokenText(tokens, start, end);
		if (text.length === 0) {
			previousText = null;
			previousEnd = end;
			continue;
		}
		if (text === previousText && !isAllowedCppConsecutiveDuplicateStatement(tokens, pairs, info, start, end)) {
			pushLintIssue(
				issues,
				file,
				tokens[start],
				consecutiveDuplicateStatementPatternRule.name,
				'Consecutive duplicate statement is forbidden. Remove the duplicate or replace intentional repetition with a named loop/helper.',
			);
		}
		previousText = text;
		previousEnd = end;
	}
}

function isAllowedCppConsecutiveDuplicateStatement(tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, start: number, end: number): boolean {
	const target = cppCallTargetFromStatement(tokens, pairs, start, end);
	return target !== null
		&& /Vertices?$/.test(info.name)
		&& /(?:^|::)(?:push|append)[A-Za-z0-9_]*Vertex$/.test(target);
}

function isCppDuplicateStatementBoundary(tokens: readonly CppToken[], start: number, end: number): boolean {
	if (start >= end) {
		return true;
	}
	const first = tokens[start].text;
	switch (first) {
		case 'case':
		case 'default':
			return true;
		default:
			return isCppAccessSpecifier(first);
	}
}

function cppRangeHasBrace(tokens: readonly CppToken[], start: number, end: number): boolean {
	for (let index = Math.max(0, start); index < end; index += 1) {
		if (tokens[index].text === '{' || tokens[index].text === '}') {
			return true;
		}
	}
	return false;
}
