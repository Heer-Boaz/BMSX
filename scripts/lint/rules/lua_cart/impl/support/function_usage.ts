import { type LuaExpression as Expression, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind, LuaTableFieldKind as TableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { FunctionUsageInfo, incrementUsageCount } from '../../../../function_usage';
import { getExpressionKeyName } from './expression_signatures';

export function getExpressionReferenceName(expression: Expression): string | undefined {
	if (expression.kind === SyntaxKind.IdentifierExpression) {
		return expression.name;
	}
	if (expression.kind === SyntaxKind.MemberExpression) {
		const baseName = getExpressionReferenceName(expression.base);
		if (!baseName) {
			return undefined;
		}
		return `${baseName}.${expression.identifier}`;
	}
	if (expression.kind === SyntaxKind.IndexExpression) {
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
	expression: Expression | null,
	totalCounts: Map<string, number>,
	referenceCounts: Map<string, number>,
	countAsFunctionReference: boolean,
): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case SyntaxKind.IdentifierExpression:
			incrementUsageCount(totalCounts, expression.name);
			if (countAsFunctionReference) {
				incrementUsageCount(referenceCounts, expression.name);
			}
			return;
		case SyntaxKind.MemberExpression:
			incrementUsageCount(totalCounts, getExpressionReferenceName(expression));
			if (countAsFunctionReference) {
				incrementUsageCount(referenceCounts, getExpressionReferenceName(expression));
			}
			collectCartExpressionFunctionUsageCounts(expression.base, totalCounts, referenceCounts, false);
			return;
		case SyntaxKind.IndexExpression:
			incrementUsageCount(totalCounts, getExpressionReferenceName(expression));
			if (countAsFunctionReference) {
				incrementUsageCount(referenceCounts, getExpressionReferenceName(expression));
			}
			collectCartExpressionFunctionUsageCounts(expression.base, totalCounts, referenceCounts, false);
			collectCartExpressionFunctionUsageCounts(expression.index, totalCounts, referenceCounts, false);
			return;
		case SyntaxKind.CallExpression:
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
		case SyntaxKind.BinaryExpression:
			collectCartExpressionFunctionUsageCounts(expression.left, totalCounts, referenceCounts, false);
			collectCartExpressionFunctionUsageCounts(expression.right, totalCounts, referenceCounts, false);
			return;
		case SyntaxKind.UnaryExpression:
			collectCartExpressionFunctionUsageCounts(expression.operand, totalCounts, referenceCounts, false);
			return;
		case SyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === TableFieldKind.ExpressionKey) {
					collectCartExpressionFunctionUsageCounts(field.key, totalCounts, referenceCounts, false);
				}
				collectCartExpressionFunctionUsageCounts(field.value, totalCounts, referenceCounts, true);
			}
			return;
		case SyntaxKind.FunctionExpression:
			collectCartStatementListFunctionUsageCounts(expression.body.body, totalCounts, referenceCounts);
			return;
		default:
			return;
	}
}

export function collectCartStatementListFunctionUsageCounts(
	statements: ReadonlyArray<Statement>,
	totalCounts: Map<string, number>,
	referenceCounts: Map<string, number>,
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case SyntaxKind.LocalAssignmentStatement:
				for (const value of statement.values) {
					collectCartExpressionFunctionUsageCounts(value, totalCounts, referenceCounts, true);
				}
				break;
			case SyntaxKind.AssignmentStatement:
				for (const right of statement.right) {
					collectCartExpressionFunctionUsageCounts(right, totalCounts, referenceCounts, true);
				}
				break;
			case SyntaxKind.LocalFunctionStatement:
				collectCartStatementListFunctionUsageCounts(statement.functionExpression.body.body, totalCounts, referenceCounts);
				break;
			case SyntaxKind.FunctionDeclarationStatement:
				collectCartStatementListFunctionUsageCounts(statement.functionExpression.body.body, totalCounts, referenceCounts);
				break;
			case SyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					collectCartExpressionFunctionUsageCounts(expression, totalCounts, referenceCounts, true);
				}
				break;
			case SyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					collectCartExpressionFunctionUsageCounts(clause.condition, totalCounts, referenceCounts, false);
					collectCartStatementListFunctionUsageCounts(clause.block.body, totalCounts, referenceCounts);
				}
				break;
			case SyntaxKind.WhileStatement:
				collectCartExpressionFunctionUsageCounts(statement.condition, totalCounts, referenceCounts, false);
				collectCartStatementListFunctionUsageCounts(statement.block.body, totalCounts, referenceCounts);
				break;
			case SyntaxKind.RepeatStatement:
				collectCartStatementListFunctionUsageCounts(statement.block.body, totalCounts, referenceCounts);
				collectCartExpressionFunctionUsageCounts(statement.condition, totalCounts, referenceCounts, false);
				break;
			case SyntaxKind.ForNumericStatement:
				collectCartExpressionFunctionUsageCounts(statement.start, totalCounts, referenceCounts, false);
				collectCartExpressionFunctionUsageCounts(statement.limit, totalCounts, referenceCounts, false);
				collectCartExpressionFunctionUsageCounts(statement.step, totalCounts, referenceCounts, false);
				collectCartStatementListFunctionUsageCounts(statement.block.body, totalCounts, referenceCounts);
				break;
			case SyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					collectCartExpressionFunctionUsageCounts(iterator, totalCounts, referenceCounts, false);
				}
				collectCartStatementListFunctionUsageCounts(statement.block.body, totalCounts, referenceCounts);
				break;
			case SyntaxKind.DoStatement:
				collectCartStatementListFunctionUsageCounts(statement.block.body, totalCounts, referenceCounts);
				break;
			case SyntaxKind.CallStatement:
				collectCartExpressionFunctionUsageCounts(statement.expression, totalCounts, referenceCounts, false);
				break;
			default:
				break;
		}
	}
}

export function collectCartFunctionUsageCounts(statements: ReadonlyArray<Statement>): FunctionUsageInfo {
	const totalCounts = new Map<string, number>();
	const referenceCounts = new Map<string, number>();
	collectCartStatementListFunctionUsageCounts(statements, totalCounts, referenceCounts);
	return {
		totalCounts,
		referenceCounts,
	};
}
