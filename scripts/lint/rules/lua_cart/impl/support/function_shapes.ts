import { type LuaExpression, type LuaFunctionExpression, type LuaIfClause, type LuaIfStatement, type LuaLocalAssignmentStatement, type LuaStatement, LuaSyntaxKind } from '../../../../../../src/bmsx/lua/syntax/ast';

export type ThreeStatementFunctionBody = {
	readonly first: LuaStatement;
	readonly second: LuaStatement;
	readonly third: LuaStatement;
};

export type LocalAssignmentIfFunctionBody = {
	readonly localAssignment: LuaLocalAssignmentStatement;
	readonly ifStatement: LuaIfStatement;
	readonly onlyClause: LuaIfClause;
	readonly third: LuaStatement;
	readonly localName: string;
};

export function getThreeStatementFunctionBody(functionExpression: LuaFunctionExpression): ThreeStatementFunctionBody | undefined {
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

export function getLocalAssignmentIfFunctionBody(functionExpression: LuaFunctionExpression): LocalAssignmentIfFunctionBody | undefined {
	const body = getThreeStatementFunctionBody(functionExpression);
	if (!body) {
		return undefined;
	}
	const localAssignment = body.first;
	if (localAssignment.kind !== LuaSyntaxKind.LocalAssignmentStatement) {
		return undefined;
	}
	if (localAssignment.names.length !== 1 || localAssignment.values.length !== 1) {
		return undefined;
	}
	const ifStatement = body.second;
	if (ifStatement.kind !== LuaSyntaxKind.IfStatement || ifStatement.clauses.length !== 1) {
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

export function getFunctionSingleReturnExpression(functionExpression: LuaFunctionExpression): LuaExpression | undefined {
	const body = functionExpression.body.body;
	if (body.length !== 1) {
		return undefined;
	}
	const statement = body[0];
	if (statement.kind !== LuaSyntaxKind.ReturnStatement || statement.expressions.length !== 1) {
		return undefined;
	}
	return statement.expressions[0];
}
