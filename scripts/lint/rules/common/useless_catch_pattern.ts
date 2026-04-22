import ts from 'typescript';
import { previousIdentifier, trimmedExpressionText } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import type { Token } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushTokenLintIssue } from '../cpp/support/diagnostics';
import { defineLintRule } from '../../rule';
import { pushLintIssue, type LintIssue } from '../ts/support/ast';
import type { CatchBlockInfo } from './empty_catch_pattern';

export const uselessCatchPatternRule = defineLintRule('common', 'useless_catch_pattern');

export function lintUselessCatchPattern(
	node: ts.CatchClause,
	sourceFile: ts.SourceFile,
	issues: LintIssue[],
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
	pushLintIssue(
		issues,
		sourceFile,
		node,
		uselessCatchPatternRule.name,
		'Catch clause only rethrows the caught error. Remove the wrapper and let the exception propagate.',
	);
	return true;
}

export function lintTokenUselessCatchPattern(
	file: string,
	tokens: readonly Token[],
	catchInfo: CatchBlockInfo,
	issues: LintIssue[],
): boolean {
	if (catchInfo.statements.length !== 1) {
		return false;
	}
	const declarationNameIndex = previousIdentifier(tokens, catchInfo.declarationClose);
	const declarationName = declarationNameIndex >= 0 && tokens[declarationNameIndex + 1]?.text === ')' ? tokens[declarationNameIndex].text : null;
	const [statementStart, statementEnd] = catchInfo.statements[0];
	if (
		tokens[statementStart]?.text !== 'throw'
		|| (
			statementEnd !== statementStart + 1
			&& (declarationName === null || trimmedExpressionText(tokens, statementStart + 1, statementEnd) !== declarationName)
		)
	) {
		return false;
	}
	pushTokenLintIssue(
		issues,
		file,
		tokens[catchInfo.catchToken],
		uselessCatchPatternRule.name,
		'Catch clause only rethrows the caught error. Remove the wrapper and let the exception propagate.',
	);
	return true;
}
