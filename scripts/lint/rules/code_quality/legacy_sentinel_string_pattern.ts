import ts from 'typescript';
import type { Token } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushTokenLintIssue } from '../cpp/support/diagnostics';
import { defineLintRule } from '../../rule';
import { pushLintIssue, type LintIssue } from '../ts/support/ast';
import { isDoubleUnderscoreSentinelString } from '../../../analysis/code_quality/string_contracts';

export const legacySentinelStringPatternRule = defineLintRule('code_quality', 'legacy_sentinel_string_pattern');

export function lintLegacySentinelStringPattern(
	sourceFile: ts.SourceFile,
	node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral,
	issues: LintIssue[],
): void {
	if (!isDoubleUnderscoreSentinelString(node.text)) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		node,
		legacySentinelStringPatternRule.name,
		'Double-underscore sentinel string is forbidden. Use the current contract key instead of adding alias fallbacks.',
	);
}

export function lintTokenLegacySentinelStringPattern(file: string, tokens: readonly Token[], issues: LintIssue[]): void {
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.kind !== 'string' || !isDoubleUnderscoreSentinelString(token.text)) {
			continue;
		}
		pushTokenLintIssue(
			issues,
			file,
			token,
			legacySentinelStringPatternRule.name,
			'Double-underscore sentinel string is forbidden. Use the current contract key instead of adding alias fallbacks.',
		);
	}
}
