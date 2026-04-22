import ts from 'typescript';
import type { CppFunctionInfo } from '../../../../src/bmsx/language/cpp/syntax/declarations';
import { collectCppStatementRanges, cppRangeHas } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import type { CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushLintIssue, type CppLintIssue } from '../cpp/support/diagnostics';
import { lineInAnalysisRegion, type AnalysisRegion } from '../../../analysis/lint_suppressions';
import { noteQualityLedger, type QualityLedger } from '../../../analysis/quality_ledger';
import { defineLintRule } from '../../rule';
import { pushTsLintIssue, tsNodeStartLine, type TsLintIssue } from '../../ts_rule';
import { lintCppEmptyCatchPattern, type CppCatchBlockInfo } from './empty_catch_pattern';
import { lintCppUselessCatchPattern } from './useless_catch_pattern';

export const silentCatchFallbackPatternRule = defineLintRule('common', 'silent_catch_fallback_pattern');

export function lintSilentCatchFallbackPattern(
	node: ts.CatchClause,
	sourceFile: ts.SourceFile,
	regions: readonly AnalysisRegion[],
	issues: TsLintIssue[],
	ledger: QualityLedger,
): boolean {
	const statements = node.block.statements;
	for (let index = 0; index < statements.length; index += 1) {
		const statement = statements[index];
		if (!ts.isReturnStatement(statement)) {
			continue;
		}
		if (lineInAnalysisRegion(regions, 'fallible-boundary', tsNodeStartLine(sourceFile, node))) {
			noteQualityLedger(ledger, 'allowed_catch_fallible_boundary');
			return true;
		}
		pushTsLintIssue(
			issues,
			sourceFile,
			node,
			silentCatchFallbackPatternRule.name,
			'Catch clause swallows the error and returns a fallback. Trust the caller/callee or mark the fallible boundary explicitly.',
		);
		return true;
	}
	return false;
}

export function lintCppCatchPatterns(
	file: string,
	tokens: readonly CppToken[],
	pairs: readonly number[],
	info: CppFunctionInfo,
	regions: readonly AnalysisRegion[],
	issues: CppLintIssue[],
	ledger: QualityLedger,
): void {
	for (let index = info.bodyStart + 1; index < info.bodyEnd; index += 1) {
		if (tokens[index].text !== 'catch' || tokens[index + 1]?.text !== '(') {
			continue;
		}
		noteQualityLedger(ledger, 'cpp_catch_boundary_checked');
		const catchInfo = readCppCatchBlock(tokens, pairs, info, index);
		if (catchInfo === null) {
			continue;
		}
		if (lintCppEmptyCatchPattern(file, tokens, catchInfo, issues)) {
			continue;
		}
		if (lintCppUselessCatchPattern(file, tokens, catchInfo, issues)) {
			continue;
		}
		lintCppSilentCatchFallbackPattern(file, tokens, catchInfo, regions, issues, ledger);
	}
}

export function lintCppSilentCatchFallbackPattern(
	file: string,
	tokens: readonly CppToken[],
	catchInfo: CppCatchBlockInfo,
	regions: readonly AnalysisRegion[],
	issues: CppLintIssue[],
	ledger: QualityLedger,
): boolean {
	if (!cppRangeHas(tokens, catchInfo.blockOpen + 1, catchInfo.blockClose, token => token.text === 'return')) {
		return false;
	}
	if (lineInAnalysisRegion(regions, 'fallible-boundary', tokens[catchInfo.catchToken].line)) {
		noteQualityLedger(ledger, 'allowed_cpp_catch_fallible_boundary');
		return true;
	}
	pushLintIssue(
		issues,
		file,
		tokens[catchInfo.catchToken],
		silentCatchFallbackPatternRule.name,
		'Catch clause swallows the error and returns a fallback. Trust the caller/callee or mark the fallible boundary explicitly.',
	);
	return true;
}

function readCppCatchBlock(tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, catchToken: number): CppCatchBlockInfo | null {
	const declarationClose = pairs[catchToken + 1];
	if (declarationClose < 0 || declarationClose >= info.bodyEnd) {
		return null;
	}
	const blockOpen = declarationClose + 1;
	if (tokens[blockOpen]?.text !== '{' || pairs[blockOpen] < 0 || pairs[blockOpen] > info.bodyEnd) {
		return null;
	}
	const blockClose = pairs[blockOpen];
	return {
		catchToken,
		declarationClose,
		blockOpen,
		blockClose,
		statements: collectCppStatementRanges(tokens, blockOpen + 1, blockClose),
	};
}
