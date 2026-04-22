import { type LuaExpression, type LuaStatement, LuaSyntaxKind, LuaTableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { getExpressionKeyName } from './expression_signatures';
import { FunctionUsageInfo } from './types';

export function incrementUsageCount(counts: Map<string, number>, name: string | undefined): void {
	if (!name || name.length === 0) {
		return;
	}
	counts.set(name, (counts.get(name) ?? 0) + 1);
}

export function getExpressionReferenceName(expression: LuaExpression): string | undefined {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.name;
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		const baseName = getExpressionReferenceName(expression.base);
		if (!baseName) {
			return undefined;
		}
		return `${baseName}.${expression.identifier}`;
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression) {
		const baseName = getExpressionReferenceName(expression.base);
		const keyName = getExpressionKeyName(expression.index);
		if (!baseName || !keyName) {
			return undefined;
		}
		return `${baseName}.${keyName}`;
	}
	return undefined;
}

export function collectFunctionUsageCountsInExpression(
	expression: LuaExpression | null,
	totalCounts: Map<string, number>,
	referenceCounts: Map<string, number>,
	countAsFunctionReference: boolean,
): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			incrementUsageCount(totalCounts, expression.name);
			if (countAsFunctionReference) {
				incrementUsageCount(referenceCounts, expression.name);
			}
			return;
		case LuaSyntaxKind.MemberExpression:
			incrementUsageCount(totalCounts, getExpressionReferenceName(expression));
			if (countAsFunctionReference) {
				incrementUsageCount(referenceCounts, getExpressionReferenceName(expression));
			}
			collectFunctionUsageCountsInExpression(expression.base, totalCounts, referenceCounts, false);
			return;
		case LuaSyntaxKind.IndexExpression:
			incrementUsageCount(totalCounts, getExpressionReferenceName(expression));
			if (countAsFunctionReference) {
				incrementUsageCount(referenceCounts, getExpressionReferenceName(expression));
			}
			collectFunctionUsageCountsInExpression(expression.base, totalCounts, referenceCounts, false);
			collectFunctionUsageCountsInExpression(expression.index, totalCounts, referenceCounts, false);
			return;
		case LuaSyntaxKind.CallExpression:
			if (expression.methodName && expression.methodName.length > 0) {
				const calleeName = getExpressionReferenceName(expression.callee);
				if (calleeName) {
					incrementUsageCount(totalCounts, `${calleeName}:${expression.methodName}`);
				}
			}
			collectFunctionUsageCountsInExpression(expression.callee, totalCounts, referenceCounts, false);
			for (const argument of expression.arguments) {
				collectFunctionUsageCountsInExpression(argument, totalCounts, referenceCounts, true);
			}
			return;
		case LuaSyntaxKind.BinaryExpression:
			collectFunctionUsageCountsInExpression(expression.left, totalCounts, referenceCounts, false);
			collectFunctionUsageCountsInExpression(expression.right, totalCounts, referenceCounts, false);
			return;
		case LuaSyntaxKind.UnaryExpression:
			collectFunctionUsageCountsInExpression(expression.operand, totalCounts, referenceCounts, false);
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					collectFunctionUsageCountsInExpression(field.key, totalCounts, referenceCounts, false);
				}
				collectFunctionUsageCountsInExpression(field.value, totalCounts, referenceCounts, true);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
			collectFunctionUsageCountsInStatements(expression.body.body, totalCounts, referenceCounts);
			return;
		default:
			return;
	}
}

export function collectFunctionUsageCountsInStatements(
	statements: ReadonlyArray<LuaStatement>,
	totalCounts: Map<string, number>,
	referenceCounts: Map<string, number>,
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				for (const value of statement.values) {
					collectFunctionUsageCountsInExpression(value, totalCounts, referenceCounts, true);
				}
				break;
			case LuaSyntaxKind.AssignmentStatement:
				for (const right of statement.right) {
					collectFunctionUsageCountsInExpression(right, totalCounts, referenceCounts, true);
				}
				break;
			case LuaSyntaxKind.LocalFunctionStatement:
				collectFunctionUsageCountsInStatements(statement.functionExpression.body.body, totalCounts, referenceCounts);
				break;
			case LuaSyntaxKind.FunctionDeclarationStatement:
				collectFunctionUsageCountsInStatements(statement.functionExpression.body.body, totalCounts, referenceCounts);
				break;
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					collectFunctionUsageCountsInExpression(expression, totalCounts, referenceCounts, true);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					collectFunctionUsageCountsInExpression(clause.condition, totalCounts, referenceCounts, false);
					collectFunctionUsageCountsInStatements(clause.block.body, totalCounts, referenceCounts);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				collectFunctionUsageCountsInExpression(statement.condition, totalCounts, referenceCounts, false);
				collectFunctionUsageCountsInStatements(statement.block.body, totalCounts, referenceCounts);
				break;
			case LuaSyntaxKind.RepeatStatement:
				collectFunctionUsageCountsInStatements(statement.block.body, totalCounts, referenceCounts);
				collectFunctionUsageCountsInExpression(statement.condition, totalCounts, referenceCounts, false);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				collectFunctionUsageCountsInExpression(statement.start, totalCounts, referenceCounts, false);
				collectFunctionUsageCountsInExpression(statement.limit, totalCounts, referenceCounts, false);
				collectFunctionUsageCountsInExpression(statement.step, totalCounts, referenceCounts, false);
				collectFunctionUsageCountsInStatements(statement.block.body, totalCounts, referenceCounts);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					collectFunctionUsageCountsInExpression(iterator, totalCounts, referenceCounts, false);
				}
				collectFunctionUsageCountsInStatements(statement.block.body, totalCounts, referenceCounts);
				break;
			case LuaSyntaxKind.DoStatement:
				collectFunctionUsageCountsInStatements(statement.block.body, totalCounts, referenceCounts);
				break;
			case LuaSyntaxKind.CallStatement:
				collectFunctionUsageCountsInExpression(statement.expression, totalCounts, referenceCounts, false);
				break;
			default:
				break;
		}
	}
}

export function collectFunctionUsageCounts(statements: ReadonlyArray<LuaStatement>): FunctionUsageInfo {
	const totalCounts = new Map<string, number>();
	const referenceCounts = new Map<string, number>();
	collectFunctionUsageCountsInStatements(statements, totalCounts, referenceCounts);
	return {
		totalCounts,
		referenceCounts,
	};
}

export function getSingleLineMethodUsageCount(functionName: string, usageCounts: ReadonlyMap<string, number>): number {
	const names = new Set<string>([functionName]);
	if (functionName.includes(':')) {
		names.add(functionName.replace(':', '.'));
	}
	let total = 0;
	for (const name of names) {
		total += usageCounts.get(name) ?? 0;
	}
	return total;
}

export function isAllowedBySingleLineMethodUsage(functionName: string, usageInfo: FunctionUsageInfo | undefined): boolean {
	if (!usageInfo) {
		return false;
	}
	const totalUsageCount = getSingleLineMethodUsageCount(functionName, usageInfo.totalCounts);
	if (totalUsageCount >= 2) {
		return true;
	}
	const functionReferenceUsageCount = getSingleLineMethodUsageCount(functionName, usageInfo.referenceCounts);
	return functionReferenceUsageCount >= 1;
}
