import ts from 'typescript';
import { previousCppIdentifier, trimmedCppExpressionText } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import type { CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushLintIssue, type CppLintIssue } from '../cpp/support/diagnostics';
import { defineLintRule } from '../../rule';
import { pushTsLintIssue, type TsLintIssue } from '../../ts_rule';
import type { CppCatchBlockInfo } from './empty_catch_pattern';

export const uselessCatchPatternRule = defineLintRule('common', 'useless_catch_pattern');

export function lintUselessCatchPattern(
	node: ts.CatchClause,
	sourceFile: ts.SourceFile,
	issues: TsLintIssue[],
): boolean {
	const statements = node.block.statements;
	const declaration = node.variableDeclaration;
	if (declaration === undefined || !ts.isIdentifier(declaration.name) || statements.length !== 1) {
		return false;
	}
	const onlyStatement = statements[0];
	if (
		!ts.isThrowStatement(onlyStatement)
		|| onlyStatement.expression === undefined
		|| !ts.isIdentifier(onlyStatement.expression)
		|| onlyStatement.expression.text !== declaration.name.text
	) {
		return false;
	}
	pushTsLintIssue(
		issues,
		sourceFile,
		node,
		uselessCatchPatternRule.name,
		'Catch clause only rethrows the caught error. Remove the wrapper and let the exception propagate.',
	);
	return true;
}

export function lintCppUselessCatchPattern(
	file: string,
	tokens: readonly CppToken[],
	catchInfo: CppCatchBlockInfo,
	issues: CppLintIssue[],
): boolean {
	if (catchInfo.statements.length !== 1) {
		return false;
	}
	const declarationNameIndex = previousCppIdentifier(tokens, catchInfo.declarationClose);
	const declarationName = declarationNameIndex >= 0 && tokens[declarationNameIndex + 1]?.text === ')' ? tokens[declarationNameIndex].text : null;
	const [statementStart, statementEnd] = catchInfo.statements[0];
	if (
		tokens[statementStart]?.text !== 'throw'
		|| (
			statementEnd !== statementStart + 1
			&& (declarationName === null || trimmedCppExpressionText(tokens, statementStart + 1, statementEnd) !== declarationName)
		)
	) {
		return false;
	}
	pushLintIssue(
		issues,
		file,
		tokens[catchInfo.catchToken],
		uselessCatchPatternRule.name,
		'Catch clause only rethrows the caught error. Remove the wrapper and let the exception propagate.',
	);
	return true;
}
