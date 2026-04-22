import { defineLintRule } from '../../rule';
import { lineInAnalysisRegion, type AnalysisRegion } from '../../../analysis/lint_suppressions';
import { type TsLintIssue as LintIssue, pushTsLintIssue } from '../../ts_rule';
import ts from 'typescript';
import { nodeStartLine, unwrapExpression } from '../ts/support/ast';
import { callTargetText } from '../ts/support/calls';
import { isNumericLiteralText } from '../ts/support/numeric';
import { isSemanticFloorDivisionCall } from '../ts/support/semantic';
import { type CppFunctionInfo } from '../../../../src/bmsx/language/cpp/syntax/declarations';
import { cppCallTarget, findCppAccessChainStart } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import { type CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { type CppLintIssue, pushLintIssue } from '../cpp/support/diagnostics';
import { isCppNumericSanitizationCall, rangeContainsNestedCppNumericSanitization } from '../cpp/support/numeric';
import { isCppSemanticFloorDivisionCall } from '../cpp/support/semantic';
import { isNumericDefensiveSanitizationCall } from './numeric_defensive_sanitization_pattern';

export const redundantNumericSanitizationPatternRule = defineLintRule('code_quality', 'redundant_numeric_sanitization_pattern');

export function lintRedundantNumericSanitizationPattern(
	node: ts.CallExpression,
	sourceFile: ts.SourceFile,
	regions: readonly AnalysisRegion[],
	issues: LintIssue[],
): void {
	if (lineInAnalysisRegion(regions, 'hot-path', nodeStartLine(sourceFile, node)) || !isNumericDefensiveSanitizationCall(node)) {
		return;
	}
	if (isNestedInsideNumericSanitizationCall(node, node.parent)) {
		return;
	}
	if (isSemanticFloorDivisionCall(node)) {
		return;
	}
	if (isMinimumRasterPixelSizeCall(node, sourceFile)) {
		return;
	}
	if (isNormalizedColorBytePackingCall(node)) {
		return;
	}
	if (!containsNestedNumericSanitizationCall(node)) {
		return;
	}
	pushTsLintIssue(
		issues,
		sourceFile,
		node,
		redundantNumericSanitizationPatternRule.name,
		'Redundant numeric sanitization is forbidden. Bound values once at the boundary instead of clamping or flooring them repeatedly.',
	);
}

export function lintCppRedundantNumericSanitizationPattern(file: string, tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, regions: readonly AnalysisRegion[], issues: CppLintIssue[]): void {
	if (lineInAnalysisRegion(regions, 'numeric-sanitization-acceptable', tokens[info.nameToken].line)) {
		return;
	}
	if (lineInAnalysisRegion(regions, 'hot-path', tokens[info.nameToken].line)) {
		return;
	}
	const activeNumericCalls: number[] = [];
	for (let index = info.bodyStart + 1; index < info.bodyEnd; index += 1) {
		while (activeNumericCalls.length > 0 && activeNumericCalls[activeNumericCalls.length - 1] <= index) {
			activeNumericCalls.pop();
		}
		if (tokens[index].text !== '(' || pairs[index] < 0 || pairs[index] > info.bodyEnd) {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (!isCppNumericSanitizationCall(tokens, index, target)) {
			continue;
		}
		if (isCppSemanticFloorDivisionCall(tokens, pairs, index, target)) {
			continue;
		}
		if (activeNumericCalls.length > 0) {
			continue;
		}
		const callStart = findCppAccessChainStart(tokens, index - 1);
		const callEnd = pairs[index] + 1;
		if (!rangeContainsNestedCppNumericSanitization(tokens, pairs, callStart, callEnd)) {
			continue;
		}
		pushLintIssue(
			issues,
			file,
			tokens[index],
			redundantNumericSanitizationPatternRule.name,
			'Redundant numeric sanitization is forbidden. Bound values once at the boundary instead of clamping or flooring them repeatedly.',
		);
		activeNumericCalls.push(callEnd);
	}
}

function containsNestedNumericSanitizationCall(node: ts.Node): boolean {
	let found = false;
	const visit = (current: ts.Node): void => {
		if (found) {
			return;
		}
		if (current !== node && ts.isCallExpression(current) && isNumericDefensiveSanitizationCall(current)) {
			found = true;
			return;
		}
		ts.forEachChild(current, visit);
	};
	visit(node);
	return found;
}

function isNestedInsideNumericSanitizationCall(node: ts.CallExpression, parent: ts.Node | undefined): boolean {
	let current = parent;
	while (
		current !== undefined
		&& (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current))
	) {
		current = current.parent;
	}
	while (current !== undefined) {
		if (ts.isCallExpression(current) && current !== node && isNumericDefensiveSanitizationCall(current)) {
			return true;
		}
		current = current.parent;
	}
	return false;
}

function isMinimumRasterPixelSizeCall(node: ts.CallExpression, sourceFile: ts.SourceFile): boolean {
	if (callTargetText(node) !== 'Math.max' || node.arguments.length !== 2) {
		return false;
	}
	let roundedArgument: ts.Expression | null = null;
	if (isNumericLiteralText(node.arguments[0], '1')) {
		roundedArgument = node.arguments[1];
	} else if (isNumericLiteralText(node.arguments[1], '1')) {
		roundedArgument = node.arguments[0];
	}
	if (roundedArgument === null) {
		return false;
	}
	const roundedCall = unwrapExpression(roundedArgument);
	if (!ts.isCallExpression(roundedCall) || callTargetText(roundedCall) !== 'Math.round' || roundedCall.arguments.length !== 1) {
		return false;
	}
	const roundedText = roundedCall.arguments[0].getText(sourceFile).replace(/\s+/g, ' ');
	if (/\bthickness(?:Value)?\b/.test(roundedText)) {
		return true;
	}
	return /\b(?:width|height)\b.*\bscale[XY]\b/i.test(roundedText)
		|| /\bscale[XY]\b.*\b(?:width|height)\b/i.test(roundedText)
		|| /\b(?:width|height)\b.*\bscale\s*(?:!|\?)?\.\s*[xy]\b/i.test(roundedText)
		|| /\bscale\s*(?:!|\?)?\.\s*[xy]\b.*\b(?:width|height)\b/i.test(roundedText);
}

function isNormalizedColorBytePackingCall(node: ts.CallExpression): boolean {
	if (callTargetText(node) !== 'Math.round' || node.arguments.length !== 1) {
		return false;
	}
	const arg = unwrapExpression(node.arguments[0]);
	if (!ts.isBinaryExpression(arg) || arg.operatorToken.kind !== ts.SyntaxKind.AsteriskToken) {
		return false;
	}
	const leftIsScale = isNumericLiteralText(arg.left, '255');
	const rightIsScale = isNumericLiteralText(arg.right, '255');
	if (leftIsScale === rightIsScale) {
		return false;
	}
	const normalized = unwrapExpression(leftIsScale ? arg.right : arg.left);
	if (!ts.isCallExpression(normalized) || callTargetText(normalized) !== 'clamp' || normalized.arguments.length !== 3) {
		return false;
	}
	return isNumericLiteralText(normalized.arguments[1], '0')
		&& isNumericLiteralText(normalized.arguments[2], '1');
}
