import { type LuaExpression, type LuaStatement, LuaSyntaxKind, LuaTableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { FunctionUsageInfo, incrementUsageCount } from '../../../../function_usage';
import { getExpressionKeyName } from './expression_signatures';

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

export function collectCartExpressionFunctionUsageCounts(
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
			collectCartExpressionFunctionUsageCounts(expression.base, totalCounts, referenceCounts, false);
			return;
		case LuaSyntaxKind.IndexExpression:
			incrementUsageCount(totalCounts, getExpressionReferenceName(expression));
			if (countAsFunctionReference) {
				incrementUsageCount(referenceCounts, getExpressionReferenceName(expression));
			}
			collectCartExpressionFunctionUsageCounts(expression.base, totalCounts, referenceCounts, false);
			collectCartExpressionFunctionUsageCounts(expression.index, totalCounts, referenceCounts, false);
			return;
		case LuaSyntaxKind.CallExpression:
			if (expression.methodName && expression.methodName.length > 0) {
				const calleeName = getExpressionReferenceName(expression.callee);
				if (calleeName) {
					incrementUsageCount(totalCounts, `${calleeName}:${expression.methodName}`);
				}
			}
			collectCartExpressionFunctionUsageCounts(expression.callee, totalCounts, referenceCounts, false);
			for (const argument of expression.arguments) {
				collectCartExpressionFunctionUsageCounts(argument, totalCounts, referenceCounts, true);
			}
			return;
		case LuaSyntaxKind.BinaryExpression:
			collectCartExpressionFunctionUsageCounts(expression.left, totalCounts, referenceCounts, false);
			collectCartExpressionFunctionUsageCounts(expression.right, totalCounts, referenceCounts, false);
			return;
		case LuaSyntaxKind.UnaryExpression:
			collectCartExpressionFunctionUsageCounts(expression.operand, totalCounts, referenceCounts, false);
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					collectCartExpressionFunctionUsageCounts(field.key, totalCounts, referenceCounts, false);
				}
				collectCartExpressionFunctionUsageCounts(field.value, totalCounts, referenceCounts, true);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
			collectCartStatementListFunctionUsageCounts(expression.body.body, totalCounts, referenceCounts);
			return;
		default:
			return;
	}
}

export function collectCartStatementListFunctionUsageCounts(
	statements: ReadonlyArray<LuaStatement>,
	totalCounts: Map<string, number>,
	referenceCounts: Map<string, number>,
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				for (const value of statement.values) {
					collectCartExpressionFunctionUsageCounts(value, totalCounts, referenceCounts, true);
				}
				break;
			case LuaSyntaxKind.AssignmentStatement:
				for (const right of statement.right) {
					collectCartExpressionFunctionUsageCounts(right, totalCounts, referenceCounts, true);
				}
				break;
			case LuaSyntaxKind.LocalFunctionStatement:
				collectCartStatementListFunctionUsageCounts(statement.functionExpression.body.body, totalCounts, referenceCounts);
				break;
			case LuaSyntaxKind.FunctionDeclarationStatement:
				collectCartStatementListFunctionUsageCounts(statement.functionExpression.body.body, totalCounts, referenceCounts);
				break;
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					collectCartExpressionFunctionUsageCounts(expression, totalCounts, referenceCounts, true);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					collectCartExpressionFunctionUsageCounts(clause.condition, totalCounts, referenceCounts, false);
					collectCartStatementListFunctionUsageCounts(clause.block.body, totalCounts, referenceCounts);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				collectCartExpressionFunctionUsageCounts(statement.condition, totalCounts, referenceCounts, false);
				collectCartStatementListFunctionUsageCounts(statement.block.body, totalCounts, referenceCounts);
				break;
			case LuaSyntaxKind.RepeatStatement:
				collectCartStatementListFunctionUsageCounts(statement.block.body, totalCounts, referenceCounts);
				collectCartExpressionFunctionUsageCounts(statement.condition, totalCounts, referenceCounts, false);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				collectCartExpressionFunctionUsageCounts(statement.start, totalCounts, referenceCounts, false);
				collectCartExpressionFunctionUsageCounts(statement.limit, totalCounts, referenceCounts, false);
				collectCartExpressionFunctionUsageCounts(statement.step, totalCounts, referenceCounts, false);
				collectCartStatementListFunctionUsageCounts(statement.block.body, totalCounts, referenceCounts);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					collectCartExpressionFunctionUsageCounts(iterator, totalCounts, referenceCounts, false);
				}
				collectCartStatementListFunctionUsageCounts(statement.block.body, totalCounts, referenceCounts);
				break;
			case LuaSyntaxKind.DoStatement:
				collectCartStatementListFunctionUsageCounts(statement.block.body, totalCounts, referenceCounts);
				break;
			case LuaSyntaxKind.CallStatement:
				collectCartExpressionFunctionUsageCounts(statement.expression, totalCounts, referenceCounts, false);
				break;
			default:
				break;
		}
	}
}

export function collectCartFunctionUsageCounts(statements: ReadonlyArray<LuaStatement>): FunctionUsageInfo {
	const totalCounts = new Map<string, number>();
	const referenceCounts = new Map<string, number>();
	collectCartStatementListFunctionUsageCounts(statements, totalCounts, referenceCounts);
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
