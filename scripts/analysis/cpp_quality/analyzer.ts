import { readFileSync } from 'node:fs';

import {
	addDuplicateExportedTypeIssues,
	addNormalizedBodyDuplicateIssues,
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
	collectCppNormalizedBody,
	createCppFacadeStats,
	lintCppCrossLayerIncludes,
	lintCppFacadeStats,
	lintCppHotPathCalls,
	lintCppLocalBindings,
	lintCppRepeatedExpressions,
	lintCppSimpleTokenPatterns,
} from './rules';
import { buildCppPairMap, tokenizeCpp } from '../../../src/bmsx/language/cpp/syntax/tokens';

export function analyzeCppFiles(files: readonly string[]): CppAnalysisResult {
	const duplicateBuckets = new Map<string, CppDuplicateLocation[]>();
	const lintIssues: CppLintIssue[] = [];
	const exportedTypes: CppExportedTypeInfo[] = [];
	const normalizedBodies: CppNormalizedBodyInfo[] = [];
	for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
		const file = files[fileIndex];
		const source = readFileSync(file, 'utf8');
		const tokens = tokenizeCpp(source);
		const pairs = buildCppPairMap(tokens);
		const classRanges = collectCppClassRanges(tokens, pairs);
		const typeDeclarations = collectCppTypeDeclarations(tokens, classRanges);
		for (let typeIndex = 0; typeIndex < typeDeclarations.length; typeIndex += 1) {
			const declaration = typeDeclarations[typeIndex];
			const nameToken = tokens[declaration.nameToken];
			recordDeclaration(duplicateBuckets, declaration.kind, declaration.name, file, nameToken.line, nameToken.column);
			exportedTypes.push({ name: declaration.name, file, line: nameToken.line, column: nameToken.column });
		}
		const functions = collectCppFunctionDefinitions(tokens, pairs, classRanges);
		const facadeStats = createCppFacadeStats(functions, tokens);
		lintCppSimpleTokenPatterns(file, tokens, lintIssues);
		lintCppHotPathCalls(file, tokens, pairs, lintIssues);
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
				pushLintIssue(
					lintIssues,
					file,
					tokens[info.nameToken],
					'single_line_method_pattern',
					'Single-line wrapper function/method is forbidden. Prefer direct logic over delegation wrappers.',
				);
				if (facadeStats !== null) {
					if (facadeStats.wrapperCount === 0) {
						facadeStats.firstWrapperToken = tokens[info.nameToken];
					}
					facadeStats.wrapperCount += 1;
				}
			}
			lintCppLocalBindings(file, tokens, info, lintIssues);
			lintCppRepeatedExpressions(file, tokens, pairs, info, lintIssues);
			collectCppNormalizedBody(file, tokens, info, normalizedBodies);
		}
		if (facadeStats !== null) {
			lintCppFacadeStats(file, facadeStats, lintIssues);
		}
	}
	addDuplicateExportedTypeIssues(exportedTypes, lintIssues);
	addNormalizedBodyDuplicateIssues(normalizedBodies, lintIssues);
	return relativeAnalysisResult({
		duplicateGroups: buildDuplicateGroups(duplicateBuckets),
		lintIssues,
	});
}
