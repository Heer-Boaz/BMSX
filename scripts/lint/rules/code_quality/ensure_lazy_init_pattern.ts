import type { CppFunctionInfo } from '../../../../src/bmsx/language/cpp/syntax/declarations';
import {
	collectCppStatementRanges,
	cppCallTarget,
	cppCallTargetFromStatement,
	findTopLevelCppSemicolon,
} from '../../../../src/bmsx/language/cpp/syntax/syntax';
import type { CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import type { CppLintIssue } from '../../../analysis/cpp_quality/diagnostics';
import { pushLintIssue } from '../../../analysis/cpp_quality/diagnostics';
import { lineInAnalysisRegion, type AnalysisRegion } from '../../../analysis/lint_suppressions';
import { defineLintRule } from '../../rule';

export const ensureLazyInitPatternRule = defineLintRule('code_quality', 'ensure_lazy_init_pattern');

export function lintCppEnsureLazyInitPattern(file: string, tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, regions: readonly AnalysisRegion[], issues: CppLintIssue[]): void {
	if (!info.name.startsWith('ensure')) {
		return;
	}
	if (lineInAnalysisRegion(regions, 'ensure-acceptable', tokens[info.nameToken].line)) {
		return;
	}
	const bodyStart = info.bodyStart + 1;
	if (tokens[bodyStart]?.text !== 'if') {
		return;
	}
	const conditionOpen = bodyStart + 1;
	if (tokens[conditionOpen]?.text !== '(' || tokens[conditionOpen + 1]?.text !== '!') {
		return;
	}
	const conditionClose = pairs[conditionOpen];
	if (conditionClose <= conditionOpen) {
		return;
	}
	const hasInstanceTarget = cppCallTarget(tokens, conditionClose - 2);
	if (hasInstanceTarget === null || !hasInstanceTarget.endsWith('::hasInstance')) {
		return;
	}
	const blockOpen = conditionClose + 1;
	if (tokens[blockOpen]?.text !== '{' || pairs[blockOpen] < 0) {
		return;
	}
	const blockClose = pairs[blockOpen];
	const blockStatements = collectCppStatementRanges(tokens, blockOpen + 1, blockClose);
	let createTarget: string | null = null;
	for (let index = 0; index < blockStatements.length; index += 1) {
		createTarget = cppCallTargetFromStatement(tokens, pairs, blockStatements[index][0], blockStatements[index][1]);
		if (createTarget !== null) {
			break;
		}
	}
	if (createTarget === null) {
		return;
	}
	if (!/(?:create|init|initialize)[A-Za-z0-9_]*$/.test(createTarget)) {
		return;
	}
	const targetPrefix = createTarget.slice(0, createTarget.lastIndexOf('::'));
	const returnStart = blockClose + 1;
	const returnEnd = findTopLevelCppSemicolon(tokens, returnStart, info.bodyEnd);
	if (returnEnd < 0) {
		return;
	}
	const returnTarget = cppCallTargetFromStatement(tokens, pairs, returnStart, returnEnd);
	if (returnTarget !== `${targetPrefix}::instance`) {
		return;
	}
	pushLintIssue(
		issues,
		file,
		tokens[info.nameToken],
		ensureLazyInitPatternRule.name,
		'Lazy ensure/init wrapper is forbidden. Initialize eagerly instead of guarding creation and returning the cached singleton.',
	);
}
