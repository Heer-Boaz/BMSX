import type { CppFunctionInfo } from '../../../../src/bmsx/language/cpp/syntax/declarations';
import type { CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import type { CppLintIssue } from '../../../analysis/cpp_quality/diagnostics';
import { pushLintIssue } from '../../../analysis/cpp_quality/diagnostics';
import { defineLintRule } from '../../rule';

export const facadeModuleDensityPatternRule = defineLintRule('code_quality', 'facade_module_density_pattern');

export type CppFacadeStats = {
	callableCount: number;
	wrapperCount: number;
	firstWrapperToken: CppToken;
};

export function createCppFacadeStats(functions: readonly CppFunctionInfo[], tokens: readonly CppToken[]): CppFacadeStats | null {
	if (functions.length === 0) {
		return null;
	}
	return {
		callableCount: 0,
		wrapperCount: 0,
		firstWrapperToken: tokens[functions[0].nameToken],
	};
}

export function lintCppFacadeStats(file: string, stats: CppFacadeStats, issues: CppLintIssue[]): void {
	if (stats.wrapperCount < 3 || stats.wrapperCount * 10 < stats.callableCount * 6) {
		return;
	}
	pushLintIssue(
		issues,
		file,
		stats.firstWrapperToken,
		facadeModuleDensityPatternRule.name,
		`Translation unit contains ${stats.wrapperCount}/${stats.callableCount} callable wrappers. Facade modules are forbidden; move ownership to the real module.`,
	);
}
