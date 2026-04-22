import { cppCallTarget, splitCppArgumentRanges } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import type { CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import type { CppLintIssue } from '../../../analysis/cpp_quality/diagnostics';
import { pushLintIssue } from '../../../analysis/cpp_quality/diagnostics';
import { lineInAnalysisRegion, type AnalysisRegion } from '../../../analysis/lint_suppressions';
import { noteQualityLedger, type QualityLedger } from '../../../analysis/quality_ledger';
import { defineLintRule } from '../../rule';
import { eagerValueOrFallbackPatternRule } from './eager_value_or_fallback_pattern';

export const optionalValueOrFallbackPatternRule = defineLintRule('code_quality', 'optional_value_or_fallback_pattern');

export function lintCppOptionalValueOrFallbackPatterns(
	file: string,
	tokens: readonly CppToken[],
	pairs: readonly number[],
	regions: readonly AnalysisRegion[],
	issues: CppLintIssue[],
	ledger: QualityLedger,
): void {
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.text !== '(') {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (target === null || (target !== 'value_or' && !target.endsWith('.value_or') && !target.endsWith('::value_or'))) {
			continue;
		}
		if (cppValueOrHasEagerFallbackWork(tokens, pairs, index)) {
			pushLintIssue(issues, file, token, eagerValueOrFallbackPatternRule.name, 'std::optional::value_or eagerly evaluates its fallback. Use an explicit branch when the fallback does work.');
			continue;
		}
		const boundaryKind = cppValueOrBoundaryKind(regions, token.line);
		if (boundaryKind === null) {
			pushLintIssue(issues, file, token, optionalValueOrFallbackPatternRule.name, 'std::optional::value_or fallback is only allowed at explicit manifest/input/optional-parameter boundaries. Branch or require the value instead of hiding missing internal state.');
		} else {
			noteQualityLedger(ledger, `cpp_optional_value_or_${boundaryKind}`);
		}
	}
}

function cppValueOrHasEagerFallbackWork(tokens: readonly CppToken[], pairs: readonly number[], openParen: number): boolean {
	const closeParen = pairs[openParen];
	if (closeParen <= openParen) {
		return false;
	}
	const args = splitCppArgumentRanges(tokens, openParen + 1, closeParen);
	if (args.length !== 1) {
		return true;
	}
	const [start, end] = args[0];
	for (let index = start; index < end; index += 1) {
		const text = tokens[index].text;
		if (text === 'new' || text === '{' || text === '[') {
			return true;
		}
		if (text === '(' && pairs[index] > index && pairs[index] < end) {
			return true;
		}
	}
	return false;
}

function cppValueOrBoundaryKind(regions: readonly AnalysisRegion[], line: number): string | null {
	return lineInAnalysisRegion(regions, 'value-or-boundary', line) ? 'analysis_region' : null;
}
