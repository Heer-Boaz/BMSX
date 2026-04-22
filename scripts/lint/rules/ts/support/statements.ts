import ts from 'typescript';
import { getCallExpressionTarget } from '../../../../../src/bmsx/language/ts/ast/expressions';

export function getSingleStatementWrapperTarget(statement: ts.Statement): string | null {
	if (ts.isReturnStatement(statement) && statement.expression !== undefined) {
		return getCallExpressionTarget(statement.expression);
	}
	if (ts.isExpressionStatement(statement)) {
		return getCallExpressionTarget(statement.expression);
	}
	return null;
}

export function nextStatementAfter(statement: ts.Statement): ts.Statement | null {
	const parent = statement.parent;
	if (!parent || (!ts.isBlock(parent) && !ts.isSourceFile(parent))) {
		return null;
	}
	const statements = parent.statements;
	for (let index = 0; index < statements.length - 1; index += 1) {
		if (statements[index] === statement) {
			return statements[index + 1];
		}
	}
	return null;
}

export function previousStatementBefore(statement: ts.Statement): ts.Statement | null {
	const parent = statement.parent;
	if (!parent || (!ts.isBlock(parent) && !ts.isSourceFile(parent))) {
		return null;
	}
	const statements = parent.statements;
	for (let index = 1; index < statements.length; index += 1) {
		if (statements[index] === statement) {
			return statements[index - 1];
		}
	}
	return null;
}

export function isLoopConditionExpression(node: ts.Expression, parent: ts.Node | undefined): boolean {
	return (parent !== undefined && ts.isForStatement(parent) && parent.condition === node)
		|| (parent !== undefined && ts.isWhileStatement(parent) && parent.expression === node)
		|| (parent !== undefined && ts.isDoStatement(parent) && parent.expression === node);
}

export function binaryParentAndSibling(node: ts.Expression): { parent: ts.BinaryExpression; sibling: ts.Expression } | null {
	let current: ts.Node = node;
	let parent = current.parent;
	while (
		parent !== undefined
		&& (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isNonNullExpression(parent))
	) {
		current = parent;
		parent = parent.parent;
	}
	if (parent === undefined || !ts.isBinaryExpression(parent)) {
		return null;
	}
	if (parent.left === current) {
		return { parent, sibling: parent.right };
	}
	if (parent.right === current) {
		return { parent, sibling: parent.left };
	}
	return null;
}
