import { readFileSync } from 'node:fs';

import { filterSuppressedLintIssues } from '../lint_suppressions';
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
import {
	collectCppClassRanges,
	collectCppFunctionDefinitions,
	collectCppTypeDeclarations,
} from '../../../src/bmsx/language/cpp/syntax/declarations';
import {
	collectCppFunctionUsageCounts,
	collectCppNormalizedBody,
	createCppFunctionUsageInfo,
	createCppFacadeStats,
	lintCppCatchPatterns,
	lintCppEnsureLazyInitPattern,
	lintCppRedundantNumericSanitizationPattern,
	lintCppTerminalReturnPaddingPattern,
	isCppSingleLineWrapperAllowedByUsage,
	lintCppCrossLayerIncludes,
	lintCppFacadeStats,
	lintCppHotPathCalls,
	lintCppLocalBindings,
	lintCppNullishReturnGuards,
	lintCppRepeatedExpressions,
	lintCppSemanticRepeatedExpressions,
	lintCppSinglePropertyOptionsTypes,
	lintCppSimpleTokenPatterns,
	lintCppStringSwitchChains,
} from './rules';
import { buildCppPairMap, tokenizeCpp } from '../../../src/bmsx/language/cpp/syntax/tokens';
import type { CppClassRange, CppFunctionInfo, CppTypeDeclarationInfo } from '../../../src/bmsx/language/cpp/syntax/declarations';

type CppFileAnalysis = {
	file: string;
	source: string;
	tokens: ReturnType<typeof tokenizeCpp>;
	pairs: number[];
	classRanges: CppClassRange[];
	typeDeclarations: CppTypeDeclarationInfo[];
	functions: CppFunctionInfo[];
};

export function analyzeCppFiles(files: readonly string[]): CppAnalysisResult {
	const duplicateBuckets = new Map<string, CppDuplicateLocation[]>();
	const lintIssues: CppLintIssue[] = [];
	const exportedTypes: CppExportedTypeInfo[] = [];
	const normalizedBodies: CppNormalizedBodyInfo[] = [];
	const fileAnalyses: CppFileAnalysis[] = [];
	const functionUsageInfo = createCppFunctionUsageInfo();
	const ledger = createQualityLedger();
	for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
		const file = files[fileIndex];
		const source = readFileSync(file, 'utf8');
		const tokens = tokenizeCpp(source);
		const pairs = buildCppPairMap(tokens);
		const classRanges = collectCppClassRanges(tokens, pairs);
		const typeDeclarations = collectCppTypeDeclarations(tokens, classRanges);
		const functions = collectCppFunctionDefinitions(tokens, pairs, classRanges);
		collectCppFunctionUsageCounts(tokens, pairs, functionUsageInfo);
		fileAnalyses.push({ file, source, tokens, pairs, classRanges, typeDeclarations, functions });
	}
	for (let fileIndex = 0; fileIndex < fileAnalyses.length; fileIndex += 1) {
		const analysis = fileAnalyses[fileIndex];
		const file = analysis.file;
		const source = analysis.source;
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
		lintCppSimpleTokenPatterns(file, tokens, lintIssues, ledger);
		lintCppSinglePropertyOptionsTypes(file, tokens, analysis.classRanges, lintIssues);
		lintCppCrossLayerIncludes(file, source, lintIssues);
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
						'single_line_method_pattern',
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
			lintCppCatchPatterns(file, tokens, pairs, info, lintIssues, ledger);
			lintCppRedundantNumericSanitizationPattern(file, tokens, pairs, info, lintIssues);
			lintCppEnsureLazyInitPattern(file, tokens, pairs, info, lintIssues);
			lintCppTerminalReturnPaddingPattern(file, tokens, info, lintIssues);
			lintCppHotPathCalls(file, tokens, pairs, info, lintIssues);
			lintCppLocalBindings(file, tokens, info, lintIssues, ledger);
			lintCppNullishReturnGuards(file, tokens, pairs, info, lintIssues);
			lintCppStringSwitchChains(file, tokens, pairs, info, lintIssues);
			lintCppRepeatedExpressions(file, tokens, pairs, info, lintIssues);
			lintCppSemanticRepeatedExpressions(file, tokens, pairs, info, lintIssues);
			collectCppNormalizedBody(file, tokens, pairs, info, normalizedBodies, ledger);
		}
		if (facadeStats !== null) {
			lintCppFacadeStats(file, facadeStats, lintIssues);
		}
	}
	addDuplicateExportedTypeIssues(exportedTypes, lintIssues);
	addNormalizedBodyDuplicateIssues(normalizedBodies, lintIssues);
	addSemanticNormalizedBodyDuplicateIssues(normalizedBodies, lintIssues);
	const sourceTextByFile = new Map<string, string>();
	for (let fileIndex = 0; fileIndex < fileAnalyses.length; fileIndex += 1) {
		const analysis = fileAnalyses[fileIndex];
		sourceTextByFile.set(analysis.file, analysis.source);
	}
	const filteredLintIssues = filterSuppressedLintIssues(lintIssues, sourceTextByFile);
	return relativeAnalysisResult({
		duplicateGroups: buildDuplicateGroups(duplicateBuckets),
		lintIssues: filteredLintIssues,
		ledger,
	});
}
