import ts from 'typescript';
import type { CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushTokenLintIssue, type CppLintIssue } from '../cpp/support/diagnostics';
import { defineLintRule } from '../../rule';
import { pushTsLintIssue, type TsLintIssue } from '../../ts_rule';

export const emptyCatchPatternRule = defineLintRule('common', 'empty_catch_pattern');

export type CppCatchBlockInfo = {
	catchToken: number;
	declarationClose: number;
	blockOpen: number;
	blockClose: number;
	statements: readonly (readonly [number, number])[];
};

export function lintEmptyCatchPattern(
	node: ts.CatchClause,
	sourceFile: ts.SourceFile,
	issues: TsLintIssue[],
): boolean {
	if (node.block.statements.length !== 0) {
		return false;
	}
	pushTsLintIssue(
		issues,
		sourceFile,
		node,
		emptyCatchPatternRule.name,
		'Empty catch block is forbidden. Catch only when you can handle or rethrow the error.',
	);
	return true;
}

export function lintCppEmptyCatchPattern(
	file: string,
	tokens: readonly CppToken[],
	catchInfo: CppCatchBlockInfo,
	issues: CppLintIssue[],
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
