import { type LuaExpression as Expression, type LuaFunctionExpression as CartFunctionExpression, type LuaIfClause as IfClause, type LuaIfStatement as IfStatement, type LuaLocalAssignmentStatement as LocalAssignmentStatement, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind } from '../../../../../../src/bmsx/lua/syntax/ast';

export type ThreeStatementFunctionBody = {
	readonly first: Statement;
	readonly second: Statement;
	readonly third: Statement;
};

export type LocalAssignmentIfFunctionBody = {
	readonly localAssignment: LocalAssignmentStatement;
	readonly ifStatement: IfStatement;
	readonly onlyClause: IfClause;
	readonly third: Statement;
	readonly localName: string;
};

export function getThreeStatementFunctionBody(functionExpression: CartFunctionExpression): ThreeStatementFunctionBody | undefined {
	const body = functionExpression.body.body;
	if (body.length !== 3) {
		return undefined;
	}
	return {
		first: body[0],
		second: body[1],
		third: body[2],
	};
}

export function getLocalAssignmentIfFunctionBody(functionExpression: CartFunctionExpression): LocalAssignmentIfFunctionBody | undefined {
	const body = getThreeStatementFunctionBody(functionExpression);
	if (!body) {
		return undefined;
	}
	const localAssignment = body.first;
	if (localAssignment.kind !== SyntaxKind.LocalAssignmentStatement) {
		return undefined;
	}
	if (localAssignment.names.length !== 1 || localAssignment.values.length !== 1) {
		return undefined;
	}
	const ifStatement = body.second;
	if (ifStatement.kind !== SyntaxKind.IfStatement || ifStatement.clauses.length !== 1) {
		return undefined;
	}
	return {
		localAssignment,
		ifStatement,
		onlyClause: ifStatement.clauses[0],
		third: body.third,
		localName: localAssignment.names[0].name,
	};
}

export function getFunctionSingleReturnExpression(functionExpression: CartFunctionExpression): Expression | undefined {
	const body = functionExpression.body.body;
	if (body.length !== 1) {
		return undefined;
	}
	const statement = body[0];
	if (statement.kind !== SyntaxKind.ReturnStatement || statement.expressions.length !== 1) {
		return undefined;
	}
	return statement.expressions[0];
}
