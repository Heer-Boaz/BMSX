import { type FunctionInfo } from '../../../../../src/bmsx/language/cpp/syntax/declarations';
import { cppAccessChainLeafName, cppCallTarget, isFunctionDeclaratorParen } from '../../../../../src/bmsx/language/cpp/syntax/syntax';
import { type Token } from '../../../../../src/bmsx/language/cpp/syntax/tokens';
import { type AnalysisRegion, lineInAnalysisRegion } from '../../../../analysis/lint_suppressions';
import { incrementUsageCount } from '../../../function_usage';
import { isConstructorLike } from './bindings';

export function createFunctionUsageInfo(): { totalCounts: Map<string, number>; referenceCounts: Map<string, number>; } {
	return {
		totalCounts: new Map<string, number>(),
		referenceCounts: new Map<string, number>(),
	};
}

export function collectFunctionUsageCounts(tokens: readonly Token[], pairs: readonly number[], usageInfo: { totalCounts: Map<string, number>; referenceCounts: Map<string, number>; }): void {
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index].text !== '(' || pairs[index] <= index) {
			continue;
		}
		if (isFunctionDeclaratorParen(tokens, pairs, index)) {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (target === null) {
			continue;
		}
		incrementUsageCount(usageInfo.totalCounts, target);
		incrementUsageCount(usageInfo.totalCounts, `leaf:${cppAccessChainLeafName(target)}`);
	}
}

export function isSingleLineWrapperAllowed(info: FunctionInfo, regions: readonly AnalysisRegion[], tokens: readonly Token[]): boolean {
	if (isConstructorLike(info)) {
		return true;
	}
	if (lineInAnalysisRegion(regions, 'single_line_method_pattern', tokens[info.nameToken].line)) {
		return true;
	}
	return false;
}
