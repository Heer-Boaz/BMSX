import ts from 'typescript';
import type { CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushTokenLintIssue, type CppLintIssue } from '../cpp/support/diagnostics';
import { defineLintRule } from '../../rule';
import { pushTsLintIssue, type TsLintIssue } from '../../ts_rule';
import { isDoubleUnderscoreSentinelString } from '../../../analysis/code_quality/string_contracts';

export const legacySentinelStringPatternRule = defineLintRule('code_quality', 'legacy_sentinel_string_pattern');

export function lintLegacySentinelStringPattern(
	sourceFile: ts.SourceFile,
	node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral,
	issues: TsLintIssue[],
): void {
	if (!isDoubleUnderscoreSentinelString(node.text)) {
		return;
	}
	pushTsLintIssue(
		issues,
		sourceFile,
		node,
		legacySentinelStringPatternRule.name,
		'Double-underscore sentinel string is forbidden. Use the current contract key instead of adding alias fallbacks.',
	);
}

export function lintCppLegacySentinelStringPattern(file: string, tokens: readonly CppToken[], issues: CppLintIssue[]): void {
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
