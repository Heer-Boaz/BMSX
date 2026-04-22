import type { CppFunctionInfo } from '../../../../src/bmsx/language/cpp/syntax/declarations';
import {
	findTopLevelCppSemicolon,
	isCppNullToken,
	trimmedCppExpressionText,
} from '../../../../src/bmsx/language/cpp/syntax/syntax';
import type { CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushLintIssue, type CppLintIssue } from '../cpp/support/diagnostics';
import { defineLintRule } from '../../rule';
import { type TsLintIssue as LintIssue, pushTsLintIssue } from '../../ts_rule';
import ts from 'typescript';
import { expressionUsesGuardedValue, isCrossNullishProjection, nullishGuardFingerprint, nullishReturnKind } from '../ts/support/nullish';
import { nextStatementAfter } from '../ts/support/statements';

export const nullishReturnGuardPatternRule = defineLintRule('code_quality', 'nullish_return_guard_pattern');

export function lintCppNullishReturnGuards(file: string, tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, issues: CppLintIssue[]): void {
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
		const returnEnd = findTopLevelCppSemicolon(tokens, returnStart, info.bodyEnd);
		if (returnEnd < 0) {
			continue;
		}
		const returnedExpression = trimmedCppExpressionText(tokens, returnStart + 1, returnEnd);
		if (!cppExpressionUsesGuardedValue(returnedExpression, guardedExpression)) {
			continue;
		}
		pushLintIssue(
			issues,
			file,
			tokens[index],
			nullishReturnGuardPatternRule.name,
			'Nullish guard that only returns nullptr before returning the guarded value is forbidden. Keep the compact expression form instead of expanding it into a branch.',
		);
	}
}

function cppNullishReturnConsequentEnd(tokens: readonly CppToken[], pairs: readonly number[], start: number, bodyEnd: number): number {
	if (tokens[start]?.text === '{') {
		const closeBrace = pairs[start];
		if (closeBrace < 0 || closeBrace > bodyEnd) {
			return -1;
		}
		const returnEnd = findTopLevelCppSemicolon(tokens, start + 1, closeBrace);
		if (returnEnd < 0 || returnEnd + 1 !== closeBrace || !cppStatementReturnsNull(tokens, start + 1, returnEnd)) {
			return -1;
		}
		return closeBrace;
	}
	const returnEnd = findTopLevelCppSemicolon(tokens, start, bodyEnd);
	if (returnEnd < 0 || !cppStatementReturnsNull(tokens, start, returnEnd)) {
		return -1;
	}
	return returnEnd;
}

function cppStatementReturnsNull(tokens: readonly CppToken[], start: number, end: number): boolean {
	return tokens[start]?.text === 'return' && end === start + 2 && cppRangeIsNull(tokens, start + 1, end);
}

function cppNullishGuardExpression(tokens: readonly CppToken[], start: number, end: number): string | null {
	const orIndex = findTopLevelCppOperator(tokens, start, end, '||');
	if (orIndex >= 0) {
		const left = cppNullishGuardExpression(tokens, start, orIndex);
		const right = cppNullishGuardExpression(tokens, orIndex + 1, end);
		return left !== null && left === right ? left : null;
	}
	const equalsIndex = findTopLevelCppOperator(tokens, start, end, '==');
	if (equalsIndex < 0) {
		return null;
	}
	if (cppRangeIsNull(tokens, start, equalsIndex)) {
		return trimmedCppExpressionText(tokens, equalsIndex + 1, end);
	}
	if (cppRangeIsNull(tokens, equalsIndex + 1, end)) {
		return trimmedCppExpressionText(tokens, start, equalsIndex);
	}
	return null;
}

function findTopLevelCppOperator(tokens: readonly CppToken[], start: number, end: number, operator: string): number {
	let parenDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;
	for (let index = start; index < end; index += 1) {
		const text = tokens[index].text;
		if (text === '(') parenDepth += 1;
		else if (text === ')') parenDepth -= 1;
		else if (text === '[') bracketDepth += 1;
		else if (text === ']') bracketDepth -= 1;
		else if (text === '{') braceDepth += 1;
		else if (text === '}') braceDepth -= 1;
		else if (text === operator && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) return index;
	}
	return -1;
}

export function cppRangeIsNull(tokens: readonly CppToken[], start: number, end: number): boolean {
	while (start < end && tokens[start].text === '(' && tokens[end - 1]?.text === ')') {
		start += 1;
		end -= 1;
	}
	return end === start + 1 && isCppNullToken(tokens[start]);
}

function cppExpressionUsesGuardedValue(expression: string, guardedExpression: string): boolean {
	return expression === guardedExpression
		|| expression.startsWith(`${guardedExpression}.`)
		|| expression.startsWith(`${guardedExpression}->`)
		|| expression.startsWith(`${guardedExpression}[`);
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
	pushTsLintIssue(
		issues,
		sourceFile,
		node,
		nullishReturnGuardPatternRule.name,
		'Nullish guard that only returns null/undefined before returning the guarded value is forbidden. Keep the compact expression form instead of expanding it into a branch.',
	);
}
