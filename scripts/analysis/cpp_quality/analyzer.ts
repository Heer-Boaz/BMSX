import { lintCppRepeatedExpressions } from '../../lint/rules/code_quality/repeated_expression_pattern';
import { readFileSync } from 'node:fs';
import { singleLineMethodPatternRule } from '../../lint/rules/common';
import { lintCppConsecutiveDuplicateStatements } from '../../lint/rules/common/consecutive_duplicate_statement_pattern';
import { lintCppEmptyStringConditionPattern } from '../../lint/rules/common/empty_string_condition_pattern';
import { lintCppTernaryFallbackPatterns } from '../../lint/rules/common/empty_string_fallback_pattern';
import { lintCppExplicitTruthyComparisonPattern } from '../../lint/rules/common/explicit_truthy_comparison_pattern';
import { lintCppCatchPatterns } from '../../lint/rules/common/silent_catch_fallback_pattern';
import { lintCppSinglePropertyOptionsTypes } from '../../lint/rules/common/single_property_options_parameter_pattern';
import { lintCppStringSwitchChains } from '../../lint/rules/common/string_switch_chain_pattern';
import { lintCppStringOrChains } from '../../lint/rules/common/string_or_chain_comparison_pattern';
import { lintCppTerminalReturnPaddingPattern } from '../../lint/rules/common/useless_terminal_return_pattern';
import { lintCppCrossLayerIncludes } from '../../lint/rules/code_quality/cross_layer_import_pattern';
import { lintCppEnsureLazyInitPattern } from '../../lint/rules/code_quality/ensure_lazy_init_pattern';
import { createCppFacadeStats, lintCppFacadeStats } from '../../lint/rules/code_quality/facade_module_density_pattern';
import { lintCppLegacySentinelStringPattern } from '../../lint/rules/code_quality/legacy_sentinel_string_pattern';
import { lintCppNullishReturnGuards } from '../../lint/rules/code_quality/nullish_return_guard_pattern';
import { lintCppOptionalValueOrFallbackPatterns } from '../../lint/rules/code_quality/optional_value_or_fallback_pattern';

import { collectAnalysisRegions, filterSuppressedLintIssues, type AnalysisRegion } from '../lint_suppressions';
import { loadAnalysisConfig } from '../config';
import { createQualityLedger } from '../quality_ledger';
import {
	addDuplicateExportedTypeIssues,
	addNormalizedBodyDuplicateIssues,
	addSemanticNormalizedBodyDuplicateIssues,
	buildDuplicateGroups,
	pushLintIssue,
	recordDeclaration,
	relativeAnalysisResult,
	type CppAnalysisResult,
	type CppDuplicateKind,
	type CppDuplicateLocation,
	type CppExportedTypeInfo,
	type CppLintIssue,
	type CppNormalizedBodyInfo,
} from './diagnostics';
import { collectCppNormalizedBody } from '../../lint/rules/code_quality/normalized_ast_duplicate_pattern';
import { lintCppRedundantNumericSanitizationPattern } from '../../lint/rules/code_quality/redundant_numeric_sanitization_pattern';
import { lintCppSemanticRepeatedExpressions } from '../../lint/rules/code_quality/semantic_repeated_expression_pattern';
import { lintCppLocalBindings } from '../../lint/rules/common/local_const_pattern';
import { lintCppHotPathCalls } from '../../lint/rules/cpp/code_quality/hot_path_calls';
import {
	collectCppFunctionUsageCounts,
	createCppFunctionUsageInfo,
	isCppSingleLineWrapperAllowedByUsage,
} from '../../lint/rules/cpp/support/function_usage';
import {
	collectCppClassRanges,
	collectCppFunctionDefinitions,
	collectCppTypeDeclarations,
} from '../../../src/bmsx/language/cpp/syntax/declarations';
import { addCppRepeatedStatementSequenceIssues, collectCppRepeatedStatementSequences, type CppStatementSequenceInfo } from '../../lint/rules/common/repeated_statement_sequence_pattern';
import { buildCppPairMap, tokenizeCpp } from '../../../src/bmsx/language/cpp/syntax/tokens';
import type { CppClassRange, CppFunctionInfo, CppTypeDeclarationInfo } from '../../../src/bmsx/language/cpp/syntax/declarations';

type CppFileAnalysis = {
	file: string;
	source: string;
	regions: readonly AnalysisRegion[];
	tokens: ReturnType<typeof tokenizeCpp>;
	pairs: number[];
	classRanges: CppClassRange[];
	typeDeclarations: CppTypeDeclarationInfo[];
	functions: CppFunctionInfo[];
};

export function analyzeCppFiles(files: readonly string[]): CppAnalysisResult {
	const config = loadAnalysisConfig();
	const duplicateBuckets = new Map<string, CppDuplicateLocation[]>();
	const lintIssues: CppLintIssue[] = [];
	const exportedTypes: CppExportedTypeInfo[] = [];
	const normalizedBodies: CppNormalizedBodyInfo[] = [];
	const statementSequences: CppStatementSequenceInfo[] = [];
	const fileAnalyses: CppFileAnalysis[] = [];
	const functionUsageInfo = createCppFunctionUsageInfo();
	const ledger = createQualityLedger();
	for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
		const file = files[fileIndex];
		const source = readFileSync(file, 'utf8');
		const regions = collectAnalysisRegions(source, config.directiveMarker);
		const tokens = tokenizeCpp(source);
		const pairs = buildCppPairMap(tokens);
		const classRanges = collectCppClassRanges(tokens, pairs);
		const typeDeclarations = collectCppTypeDeclarations(tokens, classRanges);
		const functions = collectCppFunctionDefinitions(tokens, pairs, classRanges);
		collectCppFunctionUsageCounts(tokens, pairs, functionUsageInfo);
		fileAnalyses.push({ file, source, regions, tokens, pairs, classRanges, typeDeclarations, functions });
	}
	for (let fileIndex = 0; fileIndex < fileAnalyses.length; fileIndex += 1) {
		const analysis = fileAnalyses[fileIndex];
		const file = analysis.file;
		const source = analysis.source;
		const regions = analysis.regions;
		const tokens = analysis.tokens;
		const pairs = analysis.pairs;
		const typeDeclarations = analysis.typeDeclarations;
		for (let typeIndex = 0; typeIndex < typeDeclarations.length; typeIndex += 1) {
			const declaration = typeDeclarations[typeIndex];
			const nameToken = tokens[declaration.nameToken];
			recordDeclaration(duplicateBuckets, declaration.kind, declaration.name, file, nameToken.line, nameToken.column, declaration.context ?? undefined);
			exportedTypes.push({ name: declaration.name, file, line: nameToken.line, column: nameToken.column, context: declaration.context });
		}
		const functions = analysis.functions;
		const facadeStats = createCppFacadeStats(functions, tokens);
		lintCppLegacySentinelStringPattern(file, tokens, lintIssues);
		lintCppEmptyStringConditionPattern(file, tokens, lintIssues);
		lintCppExplicitTruthyComparisonPattern(file, tokens, lintIssues);
		lintCppTernaryFallbackPatterns(file, tokens, lintIssues);
		lintCppOptionalValueOrFallbackPatterns(file, tokens, pairs, regions, lintIssues, ledger);
		lintCppStringOrChains(file, tokens, lintIssues);
		lintCppSinglePropertyOptionsTypes(file, tokens, analysis.classRanges, lintIssues);
		lintCppCrossLayerIncludes(file, source, config.architecture, lintIssues);
		for (let functionIndex = 0; functionIndex < functions.length; functionIndex += 1) {
			const info = functions[functionIndex];
			if (facadeStats !== null) {
				facadeStats.callableCount += 1;
			}
			if (info.wrapperTarget === null) {
				const kind: CppDuplicateKind = info.context === null ? 'function' : 'method';
				recordDeclaration(
					duplicateBuckets,
					kind,
					info.name,
					file,
					tokens[info.nameToken].line,
					tokens[info.nameToken].column,
					info.context ?? undefined,
					info.signature,
				);
			} else {
				recordDeclaration(
					duplicateBuckets,
					'wrapper',
					info.name,
					file,
					tokens[info.nameToken].line,
					tokens[info.nameToken].column,
					info.wrapperTarget,
				);
				if (!isCppSingleLineWrapperAllowedByUsage(info, functionUsageInfo)) {
					pushLintIssue(
						lintIssues,
						file,
						tokens[info.nameToken],
						singleLineMethodPatternRule.name,
						'Single-line wrapper function/method is forbidden. Prefer direct logic over delegation wrappers.',
					);
				}
				if (facadeStats !== null) {
					if (facadeStats.wrapperCount === 0) {
						facadeStats.firstWrapperToken = tokens[info.nameToken];
					}
					facadeStats.wrapperCount += 1;
				}
			}
			lintCppCatchPatterns(file, tokens, pairs, info, regions, lintIssues, ledger);
			lintCppRedundantNumericSanitizationPattern(file, tokens, pairs, info, regions, lintIssues);
			lintCppEnsureLazyInitPattern(file, tokens, pairs, info, regions, lintIssues);
			lintCppTerminalReturnPaddingPattern(file, tokens, info, lintIssues);
			lintCppConsecutiveDuplicateStatements(file, tokens, pairs, info, lintIssues);
			lintCppHotPathCalls(file, tokens, pairs, info, regions, lintIssues);
			lintCppLocalBindings(file, tokens, info, regions, lintIssues, ledger);
			lintCppNullishReturnGuards(file, tokens, pairs, info, lintIssues);
			lintCppStringSwitchChains(file, tokens, pairs, info, lintIssues);
			lintCppRepeatedExpressions(file, tokens, pairs, info, lintIssues);
			lintCppSemanticRepeatedExpressions(file, tokens, pairs, info, lintIssues);
			collectCppRepeatedStatementSequences(file, tokens, pairs, info, regions, statementSequences);
			collectCppNormalizedBody(file, tokens, pairs, info, regions, normalizedBodies, ledger);
		}
		if (facadeStats !== null) {
			lintCppFacadeStats(file, facadeStats, lintIssues);
		}
	}
	addDuplicateExportedTypeIssues(exportedTypes, lintIssues);
	addNormalizedBodyDuplicateIssues(normalizedBodies, lintIssues);
	addSemanticNormalizedBodyDuplicateIssues(normalizedBodies, lintIssues);
	addCppRepeatedStatementSequenceIssues(statementSequences, lintIssues, ledger);
	const sourceTextByFile = new Map<string, string>();
	for (let fileIndex = 0; fileIndex < fileAnalyses.length; fileIndex += 1) {
		const analysis = fileAnalyses[fileIndex];
		sourceTextByFile.set(analysis.file, analysis.source);
	}
	const filteredLintIssues = filterSuppressedLintIssues(lintIssues, sourceTextByFile, config.directiveMarker);
	return relativeAnalysisResult({
		duplicateGroups: buildDuplicateGroups(duplicateBuckets),
		lintIssues: filteredLintIssues,
		ledger,
	});
}
