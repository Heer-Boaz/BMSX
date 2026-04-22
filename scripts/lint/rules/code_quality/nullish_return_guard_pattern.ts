import type { FunctionInfo } from '../../../../src/bmsx/language/cpp/syntax/declarations';
import {
	cppExpressionUsesAccessedValue,
	cppNullishGuardExpression,
	cppStatementReturnsNull,
	findTopLevelSemicolon,
	trimmedExpressionText,
} from '../../../../src/bmsx/language/cpp/syntax/syntax';
import type { Token } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushTokenLintIssue } from '../cpp/support/diagnostics';
import { defineLintRule } from '../../rule';
import { type LintIssue, pushLintIssue } from '../ts/support/ast';
import ts from 'typescript';
import { expressionUsesGuardedValue, isCrossNullishProjection, nullishGuardFingerprint, nullishReturnKind } from '../ts/support/nullish';
import { nextStatementAfter } from '../ts/support/statements';

export const nullishReturnGuardPatternRule = defineLintRule('code_quality', 'nullish_return_guard_pattern');

export function lintNullishReturnGuards(file: string, tokens: readonly Token[], pairs: readonly number[], info: FunctionInfo, issues: LintIssue[]): void {
	for (let index = info.bodyStart + 1; index < info.bodyEnd; index += 1) {
		if (tokens[index].text !== 'if' || tokens[index + 1]?.text !== '(') {
			continue;
		}
		const conditionStart = index + 2;
		const conditionEnd = pairs[index + 1];
		if (conditionEnd < 0 || conditionEnd >= info.bodyEnd) {
			continue;
		}
		const guardedExpression = cppNullishGuardExpression(tokens, conditionStart, conditionEnd);
		if (guardedExpression === null) {
			continue;
		}
		const consequentStart = conditionEnd + 1;
		const consequentEnd = cppNullishReturnConsequentEnd(tokens, pairs, consequentStart, info.bodyEnd);
		if (consequentEnd < 0) {
			continue;
		}
		const returnStart = consequentEnd + 1;
		if (tokens[returnStart]?.text === 'else' || tokens[returnStart]?.text !== 'return') {
			continue;
		}
		const returnEnd = findTopLevelSemicolon(tokens, returnStart, info.bodyEnd);
		if (returnEnd < 0) {
			continue;
		}
		const returnedExpression = trimmedExpressionText(tokens, returnStart + 1, returnEnd);
		if (!cppExpressionUsesAccessedValue(returnedExpression, guardedExpression)) {
			continue;
		}
		pushTokenLintIssue(
			issues,
			file,
			tokens[index],
			nullishReturnGuardPatternRule.name,
			'Nullish guard that only returns nullptr before returning the guarded value is forbidden. Keep the compact expression form instead of expanding it into a branch.',
		);
	}
}

function cppNullishReturnConsequentEnd(tokens: readonly Token[], pairs: readonly number[], start: number, bodyEnd: number): number {
	if (tokens[start]?.text === '{') {
		const closeBrace = pairs[start];
		if (closeBrace < 0 || closeBrace > bodyEnd) {
			return -1;
		}
		const returnEnd = findTopLevelSemicolon(tokens, start + 1, closeBrace);
		if (returnEnd < 0 || returnEnd + 1 !== closeBrace || !cppStatementReturnsNull(tokens, start + 1, returnEnd)) {
			return -1;
		}
		return closeBrace;
	}
	const returnEnd = findTopLevelSemicolon(tokens, start, bodyEnd);
	if (returnEnd < 0 || !cppStatementReturnsNull(tokens, start, returnEnd)) {
		return -1;
	}
	return returnEnd;
}

export function lintNullishReturnGuard(node: ts.IfStatement, sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	if (node.elseStatement !== undefined) {
		return;
	}
	const returnedKind = nullishReturnKind(node.thenStatement);
	if (returnedKind === null) {
		return;
	}
	const guardFingerprint = nullishGuardFingerprint(node.expression);
	if (guardFingerprint === null) {
		return;
	}
	const next = nextStatementAfter(node);
	if (next === null || !ts.isReturnStatement(next) || next.expression === undefined) {
		return;
	}
	if (!expressionUsesGuardedValue(next.expression, guardFingerprint)) {
		return;
	}
	if (isCrossNullishProjection(node.expression, returnedKind, next.expression)) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		node,
		nullishReturnGuardPatternRule.name,
		'Nullish guard that only returns null/undefined before returning the guarded value is forbidden. Keep the compact expression form instead of expanding it into a branch.',
	);
}
