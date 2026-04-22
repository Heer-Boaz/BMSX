import ts from 'typescript';
import { callAnyArgumentHasToken, callFirstArgumentHasToken, cppCallTarget, cppQualifiedNameHasLeaf } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import type { Token } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { getCallTargetLeafName } from '../../../../src/bmsx/language/ts/ast/expressions';
import { getCallLeafName } from '../../../../src/bmsx/lua/syntax/calls';
import { stringLiteralValue } from '../../../../src/bmsx/lua/syntax/literals';
import type { LuaCallExpression as CallExpression, LuaExpression as Expression } from '../../../../src/bmsx/lua/syntax/ast';
import { lineInAnalysisRegion, type AnalysisRegion } from '../../../analysis/lint_suppressions';
import type { CartLintIssue, CartLintIssuePusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';
import { pushTokenLintIssue } from '../cpp/support/diagnostics';
import { nodeStartLine, pushLintIssue, type LintIssue } from '../ts/support/ast';

export const newlineNormalizationPatternRule = defineLintRule('code_quality', 'newline_normalization_pattern');

const TEXT_REPLACE_CALL_TARGETS = new Set(['replace', 'replaceAll']);
const SCRIPT_REPLACE_CALL_TARGETS = new Set(['replace', 'replaceAll', 'gsub']);

function textIncludesNewlineEscape(text: string): boolean {
	return text.includes('\\n') || text.includes('\\r') || text.includes('\n') || text.includes('\r');
}

function isNewlineNormalizationArgument(node: ts.Expression): boolean {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
		return textIncludesNewlineEscape(node.text);
	}
	if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
		return textIncludesNewlineEscape(node.getText());
	}
	return false;
}

function expressionIncludesNewlineLiteral(expression: Expression): boolean {
	const value = stringLiteralValue(expression);
	return value !== undefined && textIncludesNewlineEscape(value);
}

function tokenIncludesNewlineLiteral(token: Token): boolean {
	return (token.kind === 'string' || token.kind === 'char') && textIncludesNewlineEscape(token.text);
}

function isTextReplaceTarget(target: string): boolean {
	return TEXT_REPLACE_CALL_TARGETS.has(target);
}

function isScriptReplaceTarget(target: string): boolean {
	return SCRIPT_REPLACE_CALL_TARGETS.has(target);
}

function qualifiedNameHasReplaceLeaf(target: string): boolean {
	return cppQualifiedNameHasLeaf(target, 'replace')
		|| cppQualifiedNameHasLeaf(target, 'replaceAll')
		|| cppQualifiedNameHasLeaf(target, 'regex_replace');
}

function callNormalizesNewlines(node: ts.CallExpression): boolean {
	const target = getCallTargetLeafName(node.expression);
	if (target === 'split') {
		return node.arguments.length > 0 && isNewlineNormalizationArgument(node.arguments[0]);
	}
	if (!isTextReplaceTarget(target)) {
		return false;
	}
	for (let index = 0; index < node.arguments.length; index += 1) {
		if (isNewlineNormalizationArgument(node.arguments[index])) {
			return true;
		}
	}
	return false;
}

function expressionCallNormalizesNewlines(expression: CallExpression): boolean {
	const target = getCallLeafName(expression);
	if (target === undefined) {
		return false;
	}
	if (target === 'split') {
		return expression.arguments.length > 0 && expressionIncludesNewlineLiteral(expression.arguments[0]);
	}
	if (!isScriptReplaceTarget(target)) {
		return false;
	}
	for (let index = 0; index < expression.arguments.length; index += 1) {
		if (expressionIncludesNewlineLiteral(expression.arguments[index])) {
			return true;
		}
	}
	return false;
}

function tokenCallNormalizesNewlines(tokens: readonly Token[], pairs: readonly number[], openParen: number, target: string): boolean {
	const closeParen = pairs[openParen];
	if (closeParen < 0) {
		return false;
	}
	if (cppQualifiedNameHasLeaf(target, 'split')) {
		return callFirstArgumentHasToken(tokens, openParen, closeParen, tokenIncludesNewlineLiteral);
	}
	if (!qualifiedNameHasReplaceLeaf(target)) {
		return false;
	}
	return callAnyArgumentHasToken(tokens, openParen, closeParen, tokenIncludesNewlineLiteral);
}

export function lintNewlineNormalizationPattern(
	node: ts.CallExpression,
	sourceFile: ts.SourceFile,
	regions: readonly AnalysisRegion[],
	issues: LintIssue[],
): void {
	if (!callNormalizesNewlines(node)) {
		return;
	}
	if (lineInAnalysisRegion(regions, newlineNormalizationPatternRule.name, nodeStartLine(sourceFile, node))) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		node,
		newlineNormalizationPatternRule.name,
		'Newline normalization is forbidden unless this boundary is explicitly marked with newline_normalization_pattern.',
	);
}

export function lintCallNewlineNormalizationPattern(
	expression: CallExpression,
	issues: CartLintIssue[],
	pushIssue: CartLintIssuePusher,
): void {
	if (!expressionCallNormalizesNewlines(expression)) {
		return;
	}
	pushIssue(
		issues,
		newlineNormalizationPatternRule.name,
		expression.callee,
		'Newline normalization is forbidden unless this boundary is explicitly marked with newline_normalization_pattern.',
	);
}

export function lintTokenNewlineNormalizationPattern(
	file: string,
	tokens: readonly Token[],
	pairs: readonly number[],
	regions: readonly AnalysisRegion[],
	issues: LintIssue[],
): void {
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.text !== '(') {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (target === null || !tokenCallNormalizesNewlines(tokens, pairs, index, target)) {
			continue;
		}
		if (lineInAnalysisRegion(regions, newlineNormalizationPatternRule.name, token.line)) {
			continue;
		}
		pushTokenLintIssue(
			issues,
			file,
			token,
			newlineNormalizationPatternRule.name,
			'Newline normalization is forbidden unless this boundary is explicitly marked with newline_normalization_pattern.',
		);
	}
}
