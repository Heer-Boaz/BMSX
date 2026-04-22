import { defineLintRule } from '../../rule';
import type { TsLintIssue } from '../../ts_rule';
import { type CppFunctionInfo } from '../../../../src/bmsx/language/cpp/syntax/declarations';
import { type CppToken, normalizedCppTokenText } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { type CppNormalizedBodyInfo } from '../cpp/support/diagnostics';
import { type NormalizedBodyInfo } from '../ts/support/declarations';
import { type AnalysisRegion, lineInAnalysisRegion } from '../../../analysis/lint_suppressions';
import { noteQualityLedger, type QualityLedger } from '../../../analysis/quality_ledger';
import { CPP_NORMALIZED_BODY_MIN_LENGTH } from '../cpp/support/ast';
import { normalizedBodyFingerprint } from '../cpp/support/normalization';
import { collectSemanticBodySignatures, isSemanticNormalizationWrapperTarget } from '../cpp/support/semantic';

export const normalizedAstDuplicatePatternRule = defineLintRule('code_quality', 'normalized_ast_duplicate_pattern');

export function addNormalizedBodyDuplicateIssues(normalizedBodies: readonly NormalizedBodyInfo[], issues: TsLintIssue[]): void {
	const byFingerprint = new Map<string, NormalizedBodyInfo[]>();
	for (let index = 0; index < normalizedBodies.length; index += 1) {
		const entry = normalizedBodies[index];
		let list = byFingerprint.get(entry.fingerprint);
		if (list === undefined) {
			list = [];
			byFingerprint.set(entry.fingerprint, list);
		}
		list.push(entry);
	}
	for (const list of byFingerprint.values()) {
		if (list.length <= 1) {
			continue;
		}
		const names = new Set<string>();
		for (let index = 0; index < list.length; index += 1) {
			names.add(list[index].name);
		}
		if (names.size <= 1) {
			continue;
		}
		const namePreview = Array.from(names).sort((left, right) => left.localeCompare(right)).slice(0, 4);
		const nameSuffix = names.size > namePreview.length ? ' …' : '';
		const nameSummary = namePreview.join(', ') + nameSuffix;
		for (let index = 0; index < list.length; index += 1) {
			const entry = list[index];
			issues.push({
				kind: normalizedAstDuplicatePatternRule.name,
				file: entry.file,
				line: entry.line,
				column: entry.column,
				name: normalizedAstDuplicatePatternRule.name,
				message: `Function/method body duplicates ${list.length} normalized AST bodies with different names: ${nameSummary}. Extract shared ownership instead of copying logic.`,
			});
		}
	}
}

export function collectCppNormalizedBody(file: string, tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, regions: readonly AnalysisRegion[], normalizedBodies: CppNormalizedBodyInfo[], ledger: QualityLedger): void {
	if (info.name.endsWith('Thunk')) {
		noteQualityLedger(ledger, 'skipped_cpp_normalized_body_thunk');
		return;
	}
	if (lineInAnalysisRegion(regions, 'normalized-body-acceptable', tokens[info.nameToken].line)) {
		noteQualityLedger(ledger, 'skipped_cpp_normalized_body_analysis_region');
		return;
	}
	const semanticNormalization = info.wrapperTarget !== null && isSemanticNormalizationWrapperTarget(info.wrapperTarget);
	if (info.wrapperTarget !== null && !semanticNormalization) {
		noteQualityLedger(ledger, 'skipped_cpp_normalized_body_wrapper');
		return;
	}
	const bodyText = normalizedCppTokenText(tokens, info.bodyStart + 1, info.bodyEnd);
	const semanticSignatures = collectSemanticBodySignatures(tokens, pairs, info.bodyStart + 1, info.bodyEnd);
	const semanticBody = semanticSignatures.length > 0;
	if (!semanticBody && bodyText.length < CPP_NORMALIZED_BODY_MIN_LENGTH) {
		noteQualityLedger(ledger, 'skipped_cpp_normalized_body_short_text');
		return;
	}
	normalizedBodies.push({
		name: info.qualifiedName,
		file,
		line: tokens[info.nameToken].line,
		column: tokens[info.nameToken].column,
		fingerprint: normalizedBodyFingerprint(tokens, info.bodyStart + 1, info.bodyEnd),
		semanticSignatures: semanticBody ? semanticSignatures : null,
	});
}
