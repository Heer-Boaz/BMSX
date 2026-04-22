import ts from 'typescript';
import type { FunctionInfo } from '../../../../src/bmsx/language/cpp/syntax/declarations';
import { collectStatementRanges, cppRangeHas } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import type { Token } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushTokenLintIssue } from '../cpp/support/diagnostics';
import { lineInAnalysisRegion, type AnalysisRegion } from '../../../analysis/lint_suppressions';
import { noteQualityLedger, type QualityLedger } from '../../../analysis/quality_ledger';
import { defineLintRule } from '../../rule';
import { pushLintIssue, tsNodeStartLine, type LintIssue } from '../../ts_rule';
import { lintTokenEmptyCatchPattern, type CatchBlockInfo } from './empty_catch_pattern';
import { lintTokenUselessCatchPattern } from './useless_catch_pattern';

export const silentCatchFallbackPatternRule = defineLintRule('common', 'silent_catch_fallback_pattern');

export function lintSilentCatchFallbackPattern(
	node: ts.CatchClause,
	sourceFile: ts.SourceFile,
	regions: readonly AnalysisRegion[],
	issues: LintIssue[],
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
		pushLintIssue(
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

export function lintCatchPatterns(
	file: string,
	tokens: readonly Token[],
	pairs: readonly number[],
	info: FunctionInfo,
	regions: readonly AnalysisRegion[],
	issues: LintIssue[],
	ledger: QualityLedger,
): void {
	for (let index = info.bodyStart + 1; index < info.bodyEnd; index += 1) {
		if (tokens[index].text !== 'catch' || tokens[index + 1]?.text !== '(') {
			continue;
		}
		noteQualityLedger(ledger, 'cpp_catch_boundary_checked');
		const catchInfo = readCatchBlock(tokens, pairs, info, index);
		if (catchInfo === null) {
			continue;
		}
		if (lintTokenEmptyCatchPattern(file, tokens, catchInfo, issues)) {
			continue;
		}
		if (lintTokenUselessCatchPattern(file, tokens, catchInfo, issues)) {
			continue;
		}
		lintTokenSilentCatchFallbackPattern(file, tokens, catchInfo, regions, issues, ledger);
	}
}

export function lintTokenSilentCatchFallbackPattern(
	file: string,
	tokens: readonly Token[],
	catchInfo: CatchBlockInfo,
	regions: readonly AnalysisRegion[],
	issues: LintIssue[],
	ledger: QualityLedger,
): boolean {
	if (!cppRangeHas(tokens, catchInfo.blockOpen + 1, catchInfo.blockClose, token => token.text === 'return')) {
		return false;
	}
	if (lineInAnalysisRegion(regions, 'fallible-boundary', tokens[catchInfo.catchToken].line)) {
		noteQualityLedger(ledger, 'allowed_cpp_catch_fallible_boundary');
		return true;
	}
	pushTokenLintIssue(
		issues,
		file,
		tokens[catchInfo.catchToken],
		silentCatchFallbackPatternRule.name,
		'Catch clause swallows the error and returns a fallback. Trust the caller/callee or mark the fallible boundary explicitly.',
	);
	return true;
}

function readCatchBlock(tokens: readonly Token[], pairs: readonly number[], info: FunctionInfo, catchToken: number): CatchBlockInfo | null {
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
		statements: collectStatementRanges(tokens, blockOpen + 1, blockClose),
	};
}
