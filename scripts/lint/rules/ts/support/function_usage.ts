import ts from 'typescript';
import { unwrapExpression } from '../../../../../src/bmsx/language/ts/ast/expressions';
import { functionUsageExpressionName, usageCountForNames } from './ast';
import { FunctionUsageInfo } from './types';

export function incrementUsageCount(counts: Map<string, number>, name: string | null): void {
	if (name === null || name.length === 0) {
		return;
	}
	counts.set(name, (counts.get(name) ?? 0) + 1);
}

export function incrementExpressionUsageCounts(
	expression: ts.Expression,
	totalCounts: Map<string, number>,
	referenceCounts: Map<string, number>,
	countAsFunctionReference: boolean,
): void {
	const fullName = functionUsageExpressionName(expression);
	incrementUsageCount(totalCounts, fullName);
	if (countAsFunctionReference) {
		incrementUsageCount(referenceCounts, fullName);
	}
	const unwrapped = unwrapExpression(expression);
	if (ts.isPropertyAccessExpression(unwrapped)) {
		const memberName = `.${unwrapped.name.text}`;
		incrementUsageCount(totalCounts, memberName);
		if (countAsFunctionReference) {
			incrementUsageCount(referenceCounts, memberName);
		}
	}
}

export function collectFunctionUsageCountsInExpression(
	expression: ts.Expression | undefined,
	totalCounts: Map<string, number>,
	referenceCounts: Map<string, number>,
	countAsFunctionReference: boolean,
): void {
	if (expression === undefined) {
		return;
	}
	const unwrapped = unwrapExpression(expression);
	if (ts.isIdentifier(unwrapped) || ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
		incrementExpressionUsageCounts(unwrapped, totalCounts, referenceCounts, countAsFunctionReference);
	}
	if (ts.isCallExpression(unwrapped)) {
		incrementExpressionUsageCounts(unwrapped.expression, totalCounts, referenceCounts, false);
		for (let index = 0; index < unwrapped.arguments.length; index += 1) {
			collectFunctionUsageCountsInExpression(unwrapped.arguments[index], totalCounts, referenceCounts, true);
		}
		return;
	}
	if (ts.isNewExpression(unwrapped)) {
		collectFunctionUsageCountsInExpression(unwrapped.expression, totalCounts, referenceCounts, false);
		const args = unwrapped.arguments;
		if (args !== undefined) {
			for (let index = 0; index < args.length; index += 1) {
				collectFunctionUsageCountsInExpression(args[index], totalCounts, referenceCounts, true);
			}
		}
		return;
	}
	if (ts.isBinaryExpression(unwrapped)) {
		collectFunctionUsageCountsInExpression(unwrapped.left, totalCounts, referenceCounts, false);
		collectFunctionUsageCountsInExpression(unwrapped.right, totalCounts, referenceCounts, true);
		return;
	}
	if (ts.isConditionalExpression(unwrapped)) {
		collectFunctionUsageCountsInExpression(unwrapped.condition, totalCounts, referenceCounts, false);
		collectFunctionUsageCountsInExpression(unwrapped.whenTrue, totalCounts, referenceCounts, true);
		collectFunctionUsageCountsInExpression(unwrapped.whenFalse, totalCounts, referenceCounts, true);
		return;
	}
	if (ts.isPrefixUnaryExpression(unwrapped) || ts.isPostfixUnaryExpression(unwrapped)) {
		collectFunctionUsageCountsInExpression(unwrapped.operand, totalCounts, referenceCounts, false);
		return;
	}
	if (ts.isPropertyAccessExpression(unwrapped)) {
		collectFunctionUsageCountsInExpression(unwrapped.expression, totalCounts, referenceCounts, false);
		return;
	}
	if (ts.isElementAccessExpression(unwrapped)) {
		collectFunctionUsageCountsInExpression(unwrapped.expression, totalCounts, referenceCounts, false);
		collectFunctionUsageCountsInExpression(unwrapped.argumentExpression, totalCounts, referenceCounts, false);
		return;
	}
	if (ts.isObjectLiteralExpression(unwrapped)) {
		for (let index = 0; index < unwrapped.properties.length; index += 1) {
			const property = unwrapped.properties[index];
			if (ts.isPropertyAssignment(property)) {
				collectFunctionUsageCountsInExpression(property.initializer, totalCounts, referenceCounts, true);
			} else if (ts.isSpreadAssignment(property)) {
				collectFunctionUsageCountsInExpression(property.expression, totalCounts, referenceCounts, false);
			}
		}
		return;
	}
	if (ts.isArrayLiteralExpression(unwrapped)) {
		for (let index = 0; index < unwrapped.elements.length; index += 1) {
			collectFunctionUsageCountsInExpression(unwrapped.elements[index], totalCounts, referenceCounts, true);
		}
		return;
	}
	if (ts.isArrowFunction(unwrapped)) {
		if (ts.isBlock(unwrapped.body)) {
			collectFunctionUsageCountsInStatements(unwrapped.body.statements, totalCounts, referenceCounts);
		} else {
			collectFunctionUsageCountsInExpression(unwrapped.body, totalCounts, referenceCounts, true);
		}
		return;
	}
	if (ts.isFunctionExpression(unwrapped)) {
		if (unwrapped.body !== undefined) {
			collectFunctionUsageCountsInStatements(unwrapped.body.statements, totalCounts, referenceCounts);
		}
		return;
	}
	ts.forEachChild(unwrapped, child => {
		if (ts.isExpression(child)) {
			collectFunctionUsageCountsInExpression(child, totalCounts, referenceCounts, false);
		}
	});
}

export function collectFunctionUsageCountsInStatements(
	statements: ts.NodeArray<ts.Statement>,
	totalCounts: Map<string, number>,
	referenceCounts: Map<string, number>,
): void {
	for (let index = 0; index < statements.length; index += 1) {
		const statement = statements[index];
		if (ts.isExpressionStatement(statement)) {
			collectFunctionUsageCountsInExpression(statement.expression, totalCounts, referenceCounts, false);
		} else if (ts.isReturnStatement(statement)) {
			collectFunctionUsageCountsInExpression(statement.expression, totalCounts, referenceCounts, true);
		} else if (ts.isVariableStatement(statement)) {
			for (let declarationIndex = 0; declarationIndex < statement.declarationList.declarations.length; declarationIndex += 1) {
				collectFunctionUsageCountsInExpression(statement.declarationList.declarations[declarationIndex].initializer, totalCounts, referenceCounts, true);
			}
		} else if (ts.isIfStatement(statement)) {
			collectFunctionUsageCountsInExpression(statement.expression, totalCounts, referenceCounts, false);
			collectFunctionUsageCountsInStatement(statement.thenStatement, totalCounts, referenceCounts);
			if (statement.elseStatement !== undefined) {
				collectFunctionUsageCountsInStatement(statement.elseStatement, totalCounts, referenceCounts);
			}
		} else if (ts.isBlock(statement)) {
			collectFunctionUsageCountsInStatements(statement.statements, totalCounts, referenceCounts);
		} else if (ts.isForStatement(statement)) {
			collectFunctionUsageCountsInExpression(statement.condition, totalCounts, referenceCounts, false);
			collectFunctionUsageCountsInExpression(statement.incrementor, totalCounts, referenceCounts, false);
			collectFunctionUsageCountsInStatement(statement.statement, totalCounts, referenceCounts);
		} else if (ts.isForOfStatement(statement) || ts.isForInStatement(statement)) {
			collectFunctionUsageCountsInExpression(statement.expression, totalCounts, referenceCounts, false);
			collectFunctionUsageCountsInStatement(statement.statement, totalCounts, referenceCounts);
		} else if (ts.isWhileStatement(statement) || ts.isDoStatement(statement)) {
			collectFunctionUsageCountsInExpression(statement.expression, totalCounts, referenceCounts, false);
			collectFunctionUsageCountsInStatement(statement.statement, totalCounts, referenceCounts);
		} else if (ts.isFunctionDeclaration(statement) && statement.body !== undefined) {
			collectFunctionUsageCountsInStatements(statement.body.statements, totalCounts, referenceCounts);
		} else if (ts.isClassDeclaration(statement)) {
			for (let memberIndex = 0; memberIndex < statement.members.length; memberIndex += 1) {
				const member = statement.members[memberIndex];
				if ((ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) && member.body !== undefined) {
					collectFunctionUsageCountsInStatements(member.body.statements, totalCounts, referenceCounts);
				}
			}
		} else {
			ts.forEachChild(statement, child => {
				if (ts.isExpression(child)) {
					collectFunctionUsageCountsInExpression(child, totalCounts, referenceCounts, false);
				} else if (ts.isStatement(child)) {
					collectFunctionUsageCountsInStatement(child, totalCounts, referenceCounts);
				}
			});
		}
	}
}

export function collectFunctionUsageCountsInStatement(
	statement: ts.Statement,
	totalCounts: Map<string, number>,
	referenceCounts: Map<string, number>,
): void {
	if (ts.isBlock(statement)) {
		collectFunctionUsageCountsInStatements(statement.statements, totalCounts, referenceCounts);
		return;
	}
	const statements = ts.factory.createNodeArray([statement]);
	collectFunctionUsageCountsInStatements(statements, totalCounts, referenceCounts);
}

export function collectFunctionUsageCounts(sourceFiles: readonly ts.SourceFile[]): FunctionUsageInfo {
	const totalCounts = new Map<string, number>();
	const referenceCounts = new Map<string, number>();
	for (let index = 0; index < sourceFiles.length; index += 1) {
		collectFunctionUsageCountsInStatements(sourceFiles[index].statements, totalCounts, referenceCounts);
	}
	return {
		totalCounts,
		referenceCounts,
	};
}

export function getFunctionNodeUsageNames(node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction): string[] {
	const names: string[] = [];
	if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name !== undefined) {
		names.push(node.name.text);
	}
	if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
		names.push(node.name.text, `.${node.name.text}`);
		const classNode = node.parent;
		if (ts.isClassLike(classNode) && classNode.name !== undefined) {
			names.push(`${classNode.name.text}.${node.name.text}`);
		}
	}
	const parent = node.parent;
	if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
		names.push(parent.name.text);
	}
	if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
		names.push(parent.name.text, `.${parent.name.text}`);
	}
	if (ts.isPropertyAssignment(parent) && ts.isStringLiteral(parent.name)) {
		names.push(parent.name.text, `.${parent.name.text}`);
	}
	return names;
}

export function isAllowedBySingleLineFunctionUsage(
	node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
	usageInfo: FunctionUsageInfo,
): boolean {
	const names = getFunctionNodeUsageNames(node);
	if (names.length === 0) {
		return false;
	}
	if (usageCountForNames(names, usageInfo.totalCounts) >= 2) {
		return true;
	}
	return usageCountForNames(names, usageInfo.referenceCounts) >= 1;
}
