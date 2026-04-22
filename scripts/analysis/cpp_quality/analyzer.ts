import { lintRepeatedExpressions } from '../../lint/rules/code_quality/repeated_expression_pattern';
import { readFileSync } from 'node:fs';
import { singleLineMethodPatternRule } from '../../lint/rules/common';
import { lintConsecutiveDuplicateStatements } from '../../lint/rules/common/consecutive_duplicate_statement_pattern';
import { lintEmptyStringConditionPattern } from '../../lint/rules/common/empty_string_condition_pattern';
import { lintTernaryFallbackPatterns } from '../../lint/rules/common/empty_string_fallback_pattern';
import { lintExplicitTruthyComparisonPattern } from '../../lint/rules/common/explicit_truthy_comparison_pattern';
import { lintCatchPatterns } from '../../lint/rules/common/silent_catch_fallback_pattern';
import { lintSinglePropertyOptionsTypes } from '../../lint/rules/common/single_property_options_parameter_pattern';
import { lintStringSwitchChains } from '../../lint/rules/common/string_switch_chain_pattern';
import { lintStringOrChains } from '../../lint/rules/common/string_or_chain_comparison_pattern';
import { lintTerminalReturnPaddingPattern } from '../../lint/rules/common/useless_terminal_return_pattern';
import { lintCrossLayerIncludes } from '../../lint/rules/code_quality/cross_layer_import_pattern';
import { lintEnsureLazyInitPattern } from '../../lint/rules/code_quality/ensure_lazy_init_pattern';
import { createFacadeStats, lintFacadeStats } from '../../lint/rules/code_quality/facade_module_density_pattern';
import { lintTokenLegacySentinelStringPattern } from '../../lint/rules/code_quality/legacy_sentinel_string_pattern';
import { lintNullishReturnGuards } from '../../lint/rules/code_quality/nullish_return_guard_pattern';
import { lintOptionalValueOrFallbackPatterns } from '../../lint/rules/code_quality/optional_value_or_fallback_pattern';

import { collectAnalysisRegions, filterSuppressedLintIssues, type AnalysisRegion } from '../lint_suppressions';
import { loadAnalysisConfig } from '../config';
import { createQualityLedger } from '../quality_ledger';
import {
	addDuplicateExportedTypeIssues,
	addNormalizedBodyDuplicateIssues,
	addSemanticNormalizedBodyDuplicateIssues,
	buildTokenDuplicateGroups,
	pushTokenLintIssue,
	recordDeclaration,
	relativeAnalysisResult,
	type AnalysisResult,
	type DuplicateKind,
	type DuplicateLocation,
	type ExportedTypeInfo,
	type LintIssue,
	type NormalizedBodyInfo,
} from './diagnostics';
import { collectNormalizedBody } from '../../lint/rules/code_quality/normalized_ast_duplicate_pattern';
import { lintTokenRedundantNumericSanitizationPattern } from '../../lint/rules/code_quality/redundant_numeric_sanitization_pattern';
import { lintSemanticRepeatedExpressions } from '../../lint/rules/code_quality/semantic_repeated_expression_pattern';
import { lintLocalBindings } from '../../lint/rules/common/local_const_pattern';
import { lintHotPathCalls } from '../../lint/rules/cpp/code_quality/hot_path_calls';
import {
	collectFunctionUsageCounts,
	createFunctionUsageInfo,
	isSingleLineWrapperAllowedByUsage,
} from '../../lint/rules/cpp/support/function_usage';
import {
	collectClassRanges,
	collectFunctionDefinitions,
	collectTypeDeclarations,
} from '../../../src/bmsx/language/cpp/syntax/declarations';
import { addTokenRepeatedStatementSequenceIssues, collectTokenRepeatedStatementSequences, type TokenStatementSequenceInfo } from '../../lint/rules/common/repeated_statement_sequence_pattern';
import { buildPairMap, tokenize } from '../../../src/bmsx/language/cpp/syntax/tokens';
import type { ClassRange, FunctionInfo, TypeDeclarationInfo } from '../../../src/bmsx/language/cpp/syntax/declarations';

type FileAnalysis = {
	file: string;
	source: string;
	regions: readonly AnalysisRegion[];
	tokens: ReturnType<typeof tokenize>;
	pairs: number[];
	classRanges: ClassRange[];
	typeDeclarations: TypeDeclarationInfo[];
	functions: FunctionInfo[];
};

export function analyzeFiles(files: readonly string[]): AnalysisResult {
	const config = loadAnalysisConfig();
	const duplicateBuckets = new Map<string, DuplicateLocation[]>();
	const lintIssues: LintIssue[] = [];
	const exportedTypes: ExportedTypeInfo[] = [];
	const normalizedBodies: NormalizedBodyInfo[] = [];
	const statementSequences: TokenStatementSequenceInfo[] = [];
	const fileAnalyses: FileAnalysis[] = [];
	const functionUsageInfo = createFunctionUsageInfo();
	const ledger = createQualityLedger();
	for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
		const file = files[fileIndex];
		const source = readFileSync(file, 'utf8');
		const regions = collectAnalysisRegions(source);
		const tokens = tokenize(source);
		const pairs = buildPairMap(tokens);
		const classRanges = collectClassRanges(tokens, pairs);
		const typeDeclarations = collectTypeDeclarations(tokens, classRanges);
		const functions = collectFunctionDefinitions(tokens, pairs, classRanges);
		collectFunctionUsageCounts(tokens, pairs, functionUsageInfo);
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
			recordDeclaration(duplicateBuckets, declaration.kind, declaration.name, file, nameToken.line, nameToken.column, declaration.context);
			exportedTypes.push({ name: declaration.name, file, line: nameToken.line, column: nameToken.column, context: declaration.context });
		}
		const functions = analysis.functions;
		const facadeStats = createFacadeStats(functions, tokens);
		lintTokenLegacySentinelStringPattern(file, tokens, lintIssues);
		lintEmptyStringConditionPattern(file, tokens, lintIssues);
		lintExplicitTruthyComparisonPattern(file, tokens, lintIssues);
		lintTernaryFallbackPatterns(file, tokens, lintIssues);
		lintOptionalValueOrFallbackPatterns(file, tokens, pairs, regions, lintIssues, ledger);
		lintStringOrChains(file, tokens, lintIssues);
		lintSinglePropertyOptionsTypes(file, tokens, analysis.classRanges, lintIssues);
		lintCrossLayerIncludes(file, source, config.architecture, lintIssues);
		for (let functionIndex = 0; functionIndex < functions.length; functionIndex += 1) {
			const info = functions[functionIndex];
			if (facadeStats !== null) {
				facadeStats.callableCount += 1;
			}
			if (info.wrapperTarget === null) {
				const kind: DuplicateKind = info.context === null ? 'function' : 'method';
				recordDeclaration(
					duplicateBuckets,
					kind,
					info.name,
					file,
					tokens[info.nameToken].line,
					tokens[info.nameToken].column,
					info.context,
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
				if (!isSingleLineWrapperAllowedByUsage(info, functionUsageInfo, regions, tokens)) {
					pushTokenLintIssue(
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
			lintCatchPatterns(file, tokens, pairs, info, regions, lintIssues, ledger);
			lintTokenRedundantNumericSanitizationPattern(file, tokens, pairs, info, regions, lintIssues);
			lintEnsureLazyInitPattern(file, tokens, pairs, info, regions, lintIssues);
			lintTerminalReturnPaddingPattern(file, tokens, info, lintIssues);
			lintConsecutiveDuplicateStatements(file, tokens, pairs, info, lintIssues);
			lintHotPathCalls(file, tokens, pairs, info, regions, lintIssues);
			lintLocalBindings(file, tokens, info, regions, lintIssues, ledger);
			lintNullishReturnGuards(file, tokens, pairs, info, lintIssues);
			lintStringSwitchChains(file, tokens, pairs, info, lintIssues);
			lintRepeatedExpressions(file, tokens, pairs, info, lintIssues);
			lintSemanticRepeatedExpressions(file, tokens, pairs, info, lintIssues);
			collectTokenRepeatedStatementSequences(file, tokens, pairs, info, regions, statementSequences);
			collectNormalizedBody(file, tokens, pairs, info, regions, normalizedBodies, ledger);
		}
		if (facadeStats !== null) {
			lintFacadeStats(file, facadeStats, lintIssues);
		}
	}
	addDuplicateExportedTypeIssues(exportedTypes, lintIssues);
	addNormalizedBodyDuplicateIssues(normalizedBodies, lintIssues);
	addSemanticNormalizedBodyDuplicateIssues(normalizedBodies, lintIssues);
	addTokenRepeatedStatementSequenceIssues(statementSequences, lintIssues, ledger);
	const sourceTextByFile = new Map<string, string>();
	for (let fileIndex = 0; fileIndex < fileAnalyses.length; fileIndex += 1) {
		const analysis = fileAnalyses[fileIndex];
		sourceTextByFile.set(analysis.file, analysis.source);
	}
	const filteredLintIssues = filterSuppressedLintIssues(lintIssues, sourceTextByFile);
	return relativeAnalysisResult({
		duplicateGroups: buildTokenDuplicateGroups(duplicateBuckets),
		lintIssues: filteredLintIssues,
		ledger,
	});
}
