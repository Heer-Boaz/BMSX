import { LuaAssignmentOperator, type LuaAssignmentStatement, LuaBinaryOperator, type LuaFunctionExpression, type LuaLocalAssignmentStatement, LuaSyntaxKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { isIdentifier } from './bindings';
import { isNilExpression } from './conditions';
import { isAssignableStorageExpression } from './expressions';
import { getLocalAssignmentIfFunctionBody } from './function_shapes';
import { getEnsureVariableName } from './general';

export function matchesLocalAliasReturnWrapperPattern(functionExpression: LuaFunctionExpression): boolean {
	const body = functionExpression.body.body;
	if (body.length !== 2) {
		return false;
	}
	const localAssignment = body[0];
	const returnStatement = body[1];
	if (localAssignment.kind !== LuaSyntaxKind.LocalAssignmentStatement) {
		return false;
	}
	if (returnStatement.kind !== LuaSyntaxKind.ReturnStatement || returnStatement.expressions.length !== 1) {
		return false;
	}
	const assignment = localAssignment as LuaLocalAssignmentStatement;
	if (assignment.names.length !== 1 || assignment.values.length !== 1) {
		return false;
	}
	const returned = returnStatement.expressions[0];
	return returned.kind === LuaSyntaxKind.IdentifierExpression && returned.name === assignment.names[0].name;
}

export function matchesEnsurePattern(functionExpression: LuaFunctionExpression): boolean {
	const body = functionExpression.body.body;
	if (body.length !== 2) {
		return false;
	}
	if (body[0].kind !== LuaSyntaxKind.IfStatement || body[1].kind !== LuaSyntaxKind.ReturnStatement) {
		return false;
	}
	const ifStatement = body[0];
	const variableName = getEnsureVariableName(ifStatement);
	if (!variableName) {
		return false;
	}
	const clauseBody = ifStatement.clauses[0].block.body;
	if (clauseBody.length !== 1 || clauseBody[0].kind !== LuaSyntaxKind.AssignmentStatement) {
		return false;
	}
	const assignment = clauseBody[0] as LuaAssignmentStatement;
	if (assignment.operator !== LuaAssignmentOperator.Assign || assignment.left.length !== 1 || assignment.right.length !== 1) {
		return false;
	}
	if (!isIdentifier(assignment.left[0], variableName)) {
		return false;
	}
	const returnStatement = body[1];
	return returnStatement.expressions.length === 1 && isIdentifier(returnStatement.expressions[0], variableName);
}

export function matchesEnsureLocalAliasPattern(functionExpression: LuaFunctionExpression): boolean {
	const body = getLocalAssignmentIfFunctionBody(functionExpression);
	if (!body) {
		return false;
	}
	const returnStatement = body.third;
	const localName = body.localName;
	const onlyClause = body.onlyClause;
	if (!onlyClause.condition || onlyClause.condition.kind !== LuaSyntaxKind.BinaryExpression || onlyClause.condition.operator !== LuaBinaryOperator.Equal) {
		return false;
	}
	const comparesNil = (isIdentifier(onlyClause.condition.left, localName) && isNilExpression(onlyClause.condition.right))
		|| (isIdentifier(onlyClause.condition.right, localName) && isNilExpression(onlyClause.condition.left));
	if (!comparesNil || onlyClause.block.body.length !== 2) {
		return false;
	}
	const assignLocal = onlyClause.block.body[0];
	const assignStorage = onlyClause.block.body[1];
	if (assignLocal.kind !== LuaSyntaxKind.AssignmentStatement || assignStorage.kind !== LuaSyntaxKind.AssignmentStatement) {
		return false;
	}
	if (assignLocal.operator !== LuaAssignmentOperator.Assign || assignLocal.left.length !== 1 || assignLocal.right.length !== 1) {
		return false;
	}
	if (!isIdentifier(assignLocal.left[0], localName)) {
		return false;
	}
	if (assignStorage.operator !== LuaAssignmentOperator.Assign || assignStorage.left.length !== 1 || assignStorage.right.length !== 1) {
		return false;
	}
	if (!isIdentifier(assignStorage.right[0], localName)) {
		return false;
	}
	const storageTarget = assignStorage.left[0];
	if (!isAssignableStorageExpression(storageTarget)) {
		return false;
	}
	if (storageTarget.kind === LuaSyntaxKind.IdentifierExpression && storageTarget.name === localName) {
		return false;
	}
	return returnStatement.kind === LuaSyntaxKind.ReturnStatement
		&& returnStatement.expressions.length === 1
		&& isIdentifier(returnStatement.expressions[0], localName);
}
