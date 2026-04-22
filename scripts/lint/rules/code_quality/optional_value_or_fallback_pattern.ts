import { cppCallTarget, cppQualifiedNameHasLeaf } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import type { Token } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushTokenLintIssue, type LintIssue } from '../cpp/support/diagnostics';
import { lineInAnalysisRegion, type AnalysisRegion } from '../../../analysis/lint_suppressions';
import { noteQualityLedger, type QualityLedger } from '../../../analysis/quality_ledger';
import { defineLintRule } from '../../rule';
import { lintEagerValueOrFallbackPattern } from './eager_value_or_fallback_pattern';

export const optionalValueOrFallbackPatternRule = defineLintRule('code_quality', 'optional_value_or_fallback_pattern');

export function lintOptionalValueOrFallbackPatterns(
	file: string,
	tokens: readonly Token[],
	pairs: readonly number[],
	regions: readonly AnalysisRegion[],
	issues: LintIssue[],
	ledger: QualityLedger,
): void {
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.text !== '(') {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (target === null || !cppQualifiedNameHasLeaf(target, 'value_or')) {
			continue;
		}
		if (lintEagerValueOrFallbackPattern(file, tokens, pairs, index, issues)) {
			continue;
		}
		const boundaryKind = cppValueOrBoundaryKind(regions, token.line);
		if (boundaryKind === null) {
			pushTokenLintIssue(issues, file, token, optionalValueOrFallbackPatternRule.name, 'std::optional::value_or fallback is only allowed at an explicit value-or-boundary analysis region. Branch or require the value instead of hiding missing internal state.');
		} else {
			noteQualityLedger(ledger, `cpp_optional_value_or_${boundaryKind}`);
		}
	}
}

function cppValueOrBoundaryKind(regions: readonly AnalysisRegion[], line: number): string | null {
	return lineInAnalysisRegion(regions, 'value-or-boundary', line) ? 'analysis_region' : null;
}
