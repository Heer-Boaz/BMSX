import ts from 'typescript';
import { getCallTargetLeafName } from '../../../../src/bmsx/language/ts/ast/expressions';
import { lineInAnalysisRegion, type AnalysisRegion } from '../../../analysis/lint_suppressions';
import { defineLintRule } from '../../rule';
import { nodeStartLine, pushLintIssue, type LintIssue } from '../ts/support/ast';

export const newlineNormalizationPatternRule = defineLintRule('code_quality', 'newline_normalization_pattern');

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

function callNormalizesNewlines(node: ts.CallExpression): boolean {
	const target = getCallTargetLeafName(node.expression);
	if (target === 'split') {
		return node.arguments.length > 0 && isNewlineNormalizationArgument(node.arguments[0]);
	}
	if (target !== 'replace' && target !== 'replaceAll') {
		return false;
	}
	for (let index = 0; index < node.arguments.length; index += 1) {
		if (isNewlineNormalizationArgument(node.arguments[index])) {
			return true;
		}
	}
	return false;
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
