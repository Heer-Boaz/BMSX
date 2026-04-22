import { type CppFunctionInfo } from '../../../../../src/bmsx/language/cpp/syntax/declarations';
import { cppAccessChainLeafName, cppCallTarget, isCppFunctionDeclaratorParen } from '../../../../../src/bmsx/language/cpp/syntax/syntax';
import { type CppToken } from '../../../../../src/bmsx/language/cpp/syntax/tokens';
import { type AnalysisRegion, lineInAnalysisRegion } from '../../../../analysis/lint_suppressions';
import { isCppConstructorLike } from './bindings';
import { CppFunctionUsageInfo } from './types';

export function incrementCppUsageCount(counts: Map<string, number>, name: string): void {
	if (name.length === 0) {
		return;
	}
	counts.set(name, (counts.get(name) ?? 0) + 1);
}

export function cppUsageLeafName(name: string): string {
	return cppAccessChainLeafName(name);
}

export function createCppFunctionUsageInfo(): { totalCounts: Map<string, number>; referenceCounts: Map<string, number>; } {
	return {
		totalCounts: new Map<string, number>(),
		referenceCounts: new Map<string, number>(),
	};
}

export function collectCppFunctionUsageCounts(tokens: readonly CppToken[], pairs: readonly number[], usageInfo: { totalCounts: Map<string, number>; referenceCounts: Map<string, number>; }): void {
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index].text !== '(' || pairs[index] <= index) {
			continue;
		}
		if (isCppFunctionDeclaratorParen(tokens, pairs, index)) {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (target === null) {
			continue;
		}
		incrementCppUsageCount(usageInfo.totalCounts, target);
		incrementCppUsageCount(usageInfo.totalCounts, `leaf:${cppUsageLeafName(target)}`);
	}
}

export function isCppSingleLineWrapperAllowedByUsage(info: CppFunctionInfo, usageInfo: CppFunctionUsageInfo, regions: readonly AnalysisRegion[], tokens: readonly CppToken[]): boolean {
	if (isCppConstructorLike(info)) {
		return true;
	}
	if (lineInAnalysisRegion(regions, 'single-line-wrapper-acceptable', tokens[info.nameToken].line)) {
		return true;
	}
	const names = [info.qualifiedName, info.name, `leaf:${info.name}`];
	let total = 0;
	for (let index = 0; index < names.length; index += 1) {
		total += usageInfo.totalCounts.get(names[index]) ?? 0;
	}
	if (total >= 2) {
		return true;
	}
	for (let index = 0; index < names.length; index += 1) {
		if ((usageInfo.referenceCounts.get(names[index]) ?? 0) >= 1) {
			return true;
		}
	}
	return false;
}
