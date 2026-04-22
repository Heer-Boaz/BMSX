import ts from 'typescript';
import type { Token } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushTokenLintIssue } from '../cpp/support/diagnostics';
import { defineLintRule } from '../../rule';
import { pushLintIssue, type LintIssue } from '../../ts_rule';

export const emptyCatchPatternRule = defineLintRule('common', 'empty_catch_pattern');

export type CatchBlockInfo = {
	catchToken: number;
	declarationClose: number;
	blockOpen: number;
	blockClose: number;
	statements: readonly (readonly [number, number])[];
};

export function lintEmptyCatchPattern(
	node: ts.CatchClause,
	sourceFile: ts.SourceFile,
	issues: LintIssue[],
): boolean {
	if (node.block.statements.length !== 0) {
		return false;
	}
	pushLintIssue(
		issues,
		sourceFile,
		node,
		emptyCatchPatternRule.name,
		'Empty catch block is forbidden. Catch only when you can handle or rethrow the error.',
	);
	return true;
}

export function lintTokenEmptyCatchPattern(
	file: string,
	tokens: readonly Token[],
	catchInfo: CatchBlockInfo,
	issues: LintIssue[],
): boolean {
	if (catchInfo.statements.length !== 0) {
		return false;
	}
	pushTokenLintIssue(
		issues,
		file,
		tokens[catchInfo.catchToken],
		emptyCatchPatternRule.name,
		'Empty catch block is forbidden. Catch only when you can handle or rethrow the error.',
	);
	return true;
}
