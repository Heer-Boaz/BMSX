import ts from 'typescript';
import type { FunctionInfo } from '../../../../src/bmsx/language/cpp/syntax/declarations';
import { collectStatementRanges, cppCallTargetFromStatement, isAccessSpecifier } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import { normalizedTokenText, type Token } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushTokenLintIssue } from '../cpp/support/diagnostics';
import { defineLintRule } from '../../rule';
import { compactStatementText } from '../../ts_node';
import { pushLintIssue, type LintIssue } from '../ts/support/ast';

export const consecutiveDuplicateStatementPatternRule = defineLintRule('common', 'consecutive_duplicate_statement_pattern');

export function lintConsecutiveDuplicateStatementsPattern(
	statements: ts.NodeArray<ts.Statement>,
	sourceFile: ts.SourceFile,
	issues: LintIssue[],
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
			pushLintIssue(
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

export function lintConsecutiveDuplicateStatements(file: string, tokens: readonly Token[], pairs: readonly number[], info: FunctionInfo, issues: LintIssue[]): void {
	const ranges = collectStatementRanges(tokens, info.bodyStart + 1, info.bodyEnd);
	let previousText: string | null = null;
	let previousEnd = -1;
	for (let index = 0; index < ranges.length; index += 1) {
		const start = ranges[index][0];
		const end = ranges[index][1];
		if (isDuplicateStatementBoundary(tokens, start, end) || cppRangeHasBrace(tokens, previousEnd, start)) {
			previousText = null;
		}
		const text = normalizedTokenText(tokens, start, end);
		if (text.length === 0) {
			previousText = null;
			previousEnd = end;
			continue;
		}
		if (text === previousText && !isAllowedConsecutiveDuplicateStatement(tokens, pairs, info, start, end)) {
			pushTokenLintIssue(
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

function isAllowedConsecutiveDuplicateStatement(tokens: readonly Token[], pairs: readonly number[], info: FunctionInfo, start: number, end: number): boolean {
	const target = cppCallTargetFromStatement(tokens, pairs, start, end);
	return target !== null
		&& /Vertices?$/.test(info.name)
		&& /(?:^|::)(?:push|append)[A-Za-z0-9_]*Vertex$/.test(target);
}

function isDuplicateStatementBoundary(tokens: readonly Token[], start: number, end: number): boolean {
	if (start >= end) {
		return true;
	}
	const first = tokens[start].text;
	switch (first) {
		case 'case':
		case 'default':
			return true;
		default:
			return isAccessSpecifier(first);
	}
}

function cppRangeHasBrace(tokens: readonly Token[], start: number, end: number): boolean {
	for (let index = Math.max(0, start); index < end; index += 1) {
		if (tokens[index].text === '{' || tokens[index].text === '}') {
			return true;
		}
	}
	return false;
}
