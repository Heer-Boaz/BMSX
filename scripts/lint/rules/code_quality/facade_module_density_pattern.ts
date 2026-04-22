import type { CppFunctionInfo } from '../../../../src/bmsx/language/cpp/syntax/declarations';
import type { CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushLintIssue, type CppLintIssue } from '../cpp/support/diagnostics';
import { defineLintRule } from '../../rule';
import { type TsLintIssue as LintIssue, pushTsLintIssue } from '../../ts_rule';
import ts from 'typescript';
import { isFunctionLikeValue } from '../../../../src/bmsx/language/ts/ast/functions';
import { hasExportModifier } from '../../../../src/bmsx/language/ts/ast/expressions';
import { getFunctionWrapperTarget } from '../ts/support/declarations';

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

export function lintFacadeModuleDensity(sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	let exportedCallableCount = 0;
	let exportedWrapperCount = 0;
	let firstWrapperNode: ts.Node | null = null;
	for (let index = 0; index < sourceFile.statements.length; index += 1) {
		const statement = sourceFile.statements[index];
		if (ts.isFunctionDeclaration(statement) && statement.body !== undefined && hasExportModifier(statement)) {
			exportedCallableCount += 1;
			if (getFunctionWrapperTarget(statement) !== null) {
				exportedWrapperCount += 1;
				firstWrapperNode ??= statement.name ?? statement;
			}
			continue;
		}
		if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) {
			continue;
		}
		const declarations = statement.declarationList.declarations;
		for (let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex += 1) {
			const declaration = declarations[declarationIndex];
			if (!isFunctionLikeValue(declaration.initializer)) {
				continue;
			}
			exportedCallableCount += 1;
			if (getFunctionWrapperTarget(declaration.initializer) !== null) {
				exportedWrapperCount += 1;
				firstWrapperNode ??= declaration.name;
			}
		}
	}
	if (exportedWrapperCount >= 3 && exportedWrapperCount * 10 >= exportedCallableCount * 6 && firstWrapperNode !== null) {
		pushTsLintIssue(
			issues,
			sourceFile,
			firstWrapperNode,
			facadeModuleDensityPatternRule.name,
			`Module exports ${exportedWrapperCount}/${exportedCallableCount} callable wrappers. Facade modules are forbidden; move ownership to the real module.`,
		);
	}
}
