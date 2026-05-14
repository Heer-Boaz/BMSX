import type { FunctionInfo } from '../../../../src/bmsx/language/cpp/syntax/declarations';
import type { Token } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushTokenLintIssue } from '../cpp/support/diagnostics';
import { defineLintRule } from '../../rule';
import { type LintIssue, pushLintIssue } from '../ts/support/ast';
import ts from 'typescript';
import { isFunctionLikeValue } from '../../../../src/bmsx/language/ts/ast/functions';
import { getCallExpressionTarget, hasExportModifier } from '../../../../src/bmsx/language/ts/ast/expressions';
import { getFunctionWrapperTarget } from '../ts/support/declarations';
import { getDelegationCallExpression } from '../ts/support/statements';

export const facadeModuleDensityPatternRule = defineLintRule('code_quality', 'facade_module_density_pattern');

export type FacadeStats = {
	callableCount: number;
	wrapperCount: number;
	firstWrapperToken: Token;
};

export function createFacadeStats(functions: readonly FunctionInfo[], tokens: readonly Token[]): FacadeStats | null {
	if (functions.length === 0) {
		return null;
	}
	return {
		callableCount: 0,
		wrapperCount: 0,
		firstWrapperToken: tokens[functions[0].nameToken],
	};
}

export function lintFacadeStats(file: string, stats: FacadeStats, issues: LintIssue[]): void {
	if (stats.wrapperCount < 3 || stats.wrapperCount * 10 < stats.callableCount * 6) {
		return;
	}
	pushTokenLintIssue(
		issues,
		file,
		stats.firstWrapperToken,
		facadeModuleDensityPatternRule.name,
		`Translation unit contains ${stats.wrapperCount}/${stats.callableCount} callable wrappers. Facade modules are forbidden; move ownership to the real module.`,
	);
}

function collectTopLevelFunctionNames(sourceFile: ts.SourceFile): Set<string> {
	const names = new Set<string>();
	for (let index = 0; index < sourceFile.statements.length; index += 1) {
		const statement = sourceFile.statements[index];
		if (ts.isFunctionDeclaration(statement) && statement.name !== undefined && statement.body !== undefined) {
			names.add(statement.name.text);
			continue;
		}
		if (!ts.isVariableStatement(statement)) {
			continue;
		}
		const declarations = statement.declarationList.declarations;
		for (let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex += 1) {
			const declaration = declarations[declarationIndex];
			if (ts.isIdentifier(declaration.name) && isFunctionLikeValue(declaration.initializer)) {
				names.add(declaration.name.text);
			}
		}
	}
	return names;
}

function getStatementDelegationCall(statement: ts.Statement): ts.CallExpression | null {
	if (ts.isReturnStatement(statement) && statement.expression !== undefined) {
		return getDelegationCallExpression(statement.expression);
	}
	if (ts.isExpressionStatement(statement)) {
		return getDelegationCallExpression(statement.expression);
	}
	return null;
}

function getFunctionWrapperCall(node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression): ts.CallExpression | null {
	const body = node.body;
	if (body === undefined || body === null) {
		return null;
	}
	if (!ts.isBlock(body)) {
		return getDelegationCallExpression(body);
	}
	const statements = body.statements;
	if (statements.length === 1) {
		return getStatementDelegationCall(statements[0]);
	}
	if (statements.length === 2) {
		const first = statements[0];
		const second = statements[1];
		if (ts.isIfStatement(first) && first.elseStatement === undefined
			&& ts.isReturnStatement(first.thenStatement) && first.thenStatement.expression === undefined) {
			return getStatementDelegationCall(second);
		}
	}
	return null;
}

function invokesTopLevelFunction(node: ts.Node, localNames: ReadonlySet<string>): boolean {
	let invokesLocal = false;
	const visit = (current: ts.Node): void => {
		if (invokesLocal) {
			return;
		}
		if (ts.isCallExpression(current)) {
			const target = getCallExpressionTarget(current);
			if (target !== null && localNames.has(target)) {
				invokesLocal = true;
				return;
			}
		}
		ts.forEachChild(current, visit);
	};
	visit(node);
	return invokesLocal;
}

function isFacadeWrapper(node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression, localNames: ReadonlySet<string>): boolean {
	const target = getFunctionWrapperTarget(node);
	if (target === null || localNames.has(target)) {
		return false;
	}
	const call = getFunctionWrapperCall(node);
	return call !== null && !invokesTopLevelFunction(call, localNames);
}

export function lintFacadeModuleDensity(sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	const localNames = collectTopLevelFunctionNames(sourceFile);
	let exportedCallableCount = 0;
	let exportedWrapperCount = 0;
	let firstWrapperNode: ts.Node | null = null;
	for (let index = 0; index < sourceFile.statements.length; index += 1) {
		const statement = sourceFile.statements[index];
		if (ts.isFunctionDeclaration(statement) && statement.body !== undefined && hasExportModifier(statement)) {
			exportedCallableCount += 1;
			if (isFacadeWrapper(statement, localNames)) {
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
			if (isFacadeWrapper(declaration.initializer, localNames)) {
				exportedWrapperCount += 1;
				firstWrapperNode ??= declaration.name;
			}
		}
	}
	if (exportedWrapperCount >= 3 && exportedWrapperCount * 10 >= exportedCallableCount * 6 && firstWrapperNode !== null) {
		pushLintIssue(
			issues,
			sourceFile,
			firstWrapperNode,
			facadeModuleDensityPatternRule.name,
			`Module exports ${exportedWrapperCount}/${exportedCallableCount} callable wrappers. Facade modules are forbidden; move ownership to the real module.`,
		);
	}
}
