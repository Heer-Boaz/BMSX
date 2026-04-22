import ts from 'typescript';
import { unwrapExpression } from './expressions';
import { isOrderingComparisonOperator } from './operators';

export function expressionComparesIdentifierWithNumericLiteral(expression: ts.Expression, name: string): boolean {
	const current = unwrapExpression(expression);
	if (!ts.isBinaryExpression(current) || !isOrderingComparisonOperator(current.operatorToken.kind)) {
		return false;
	}
	return expressionIsIdentifier(current.left, name) && expressionIsNumericLiteral(current.right)
		|| expressionIsIdentifier(current.right, name) && expressionIsNumericLiteral(current.left);
}

export function statementAssignsIdentifier(statement: ts.Statement, name: string): boolean {
	if (ts.isBlock(statement)) {
		for (let index = 0; index < statement.statements.length; index += 1) {
			if (statementAssignsIdentifier(statement.statements[index], name)) {
				return true;
			}
		}
		return false;
	}
	if (!ts.isExpressionStatement(statement)) {
		return false;
	}
	const expression = unwrapExpression(statement.expression);
	return ts.isBinaryExpression(expression)
		&& expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
		&& expressionIsIdentifier(expression.left, name);
}

function expressionIsIdentifier(expression: ts.Expression, name: string): boolean {
	const current = unwrapExpression(expression);
	return ts.isIdentifier(current) && current.text === name;
}

function expressionIsNumericLiteral(expression: ts.Expression): boolean {
	const current = unwrapExpression(expression);
	if (ts.isNumericLiteral(current)) {
		return true;
	}
	return ts.isPrefixUnaryExpression(current)
		&& (current.operator === ts.SyntaxKind.MinusToken || current.operator === ts.SyntaxKind.PlusToken)
		&& ts.isNumericLiteral(current.operand);
}
