import { LuaAssignmentOperator as AssignmentOperator, type LuaCallExpression as CallExpression, type LuaExpression as Expression, type LuaFunctionDeclarationStatement as FunctionDeclarationStatement, type LuaFunctionExpression as CartFunctionExpression, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind } from '../../../../../../toolchain/ts/lua/syntax/ast';
import { isIdentifier } from './bindings';
import { isBuiltinCallExpression } from './calls';
import { matchesLocalAliasReturnWrapperPattern } from './cart_patterns';
import { isAssignableStorageExpression, isSimpleCallableExpression } from './expressions';
import { getFunctionSingleReturnExpression } from './function_shapes';
import { getCopiedSourceKey } from './general';
import { expressionContainsInlineTableOrFunction, findTableFieldByKey, getTableFieldKey } from './table_fields';

export function getFunctionDisplayName(statement: Statement): string {
	if (statement.kind === SyntaxKind.LocalFunctionStatement) {
		return statement.name.name;
	}
	const declaration = statement as FunctionDeclarationStatement;
	let prefix = declaration.name.path[0].name;
	for (let index = 1; index < declaration.name.path.length; index += 1) {
		prefix += `.${declaration.name.path[index].name}`;
	}
	if (declaration.name.method) {
		return `${prefix}:${declaration.name.method.name}`;
	}
	return prefix;
}

export function getFunctionParameterNames(functionExpression: CartFunctionExpression): ReadonlyArray<string> {
	return functionExpression.parameters.map(parameter => parameter.name);
}

export function getFunctionLeafName(functionName: string): string {
	const dotIndex = functionName.lastIndexOf('.');
	const colonIndex = functionName.lastIndexOf(':');
	const separatorIndex = Math.max(dotIndex, colonIndex);
	if (separatorIndex === -1) {
		return functionName;
	}
	return functionName.slice(separatorIndex + 1);
}

export function matchesMetatableConstructorPattern(functionName: string, functionExpression: CartFunctionExpression): boolean {
	if (getFunctionLeafName(functionName) !== 'new') {
		return false;
	}
	const separatorIndex = Math.max(functionName.lastIndexOf('.'), functionName.lastIndexOf(':'));
	if (separatorIndex < 1) {
		return false;
	}
	const className = functionName.slice(0, separatorIndex);
	const expression = getFunctionSingleReturnExpression(functionExpression);
	if (
		expression?.kind !== SyntaxKind.CallExpression
		|| !isIdentifier(expression.callee, 'setmetatable')
		|| expression.arguments.length !== 2
		|| !isIdentifier(expression.arguments[1], className)
	) {
		return false;
	}
	const baseConstructor = expression.arguments[0];
	if (baseConstructor.kind !== SyntaxKind.CallExpression || baseConstructor.callee.kind !== SyntaxKind.MemberExpression) {
		return false;
	}
	return baseConstructor.callee.member.name === 'new'
		&& matchesForwardedArgumentList(baseConstructor.arguments, getFunctionParameterNames(functionExpression));
}

export function isMethodLikeFunctionDeclaration(statement: FunctionDeclarationStatement): boolean {
	return statement.name.path.length > 1 || !!statement.name.method;
}

export function matchesForwardedArgumentList(argumentsList: ReadonlyArray<Expression>, parameterNames: ReadonlyArray<string>): boolean {
	if (argumentsList.length !== parameterNames.length) {
		return false;
	}
	for (let index = 0; index < parameterNames.length; index += 1) {
		const argument = argumentsList[index];
		if (!isIdentifier(argument, parameterNames[index])) {
			return false;
		}
	}
	return true;
}

export function matchesIndexLookupGetter(expression: Expression, parameterNames: ReadonlyArray<string>): boolean {
	if (parameterNames.length !== 1 || expression.kind !== SyntaxKind.IndexExpression) {
		return false;
	}
	return isIdentifier(expression.index, parameterNames[0]);
}

export function isDirectValueGetterExpression(expression: Expression): boolean {
	return expression.kind === SyntaxKind.IdentifierExpression
		|| expression.kind === SyntaxKind.MemberExpression
		|| expression.kind === SyntaxKind.IndexExpression;
}

export function matchesPureCopyFunctionPattern(functionExpression: CartFunctionExpression): boolean {
	if (functionExpression.parameters.length !== 1) {
		return false;
	}
	const body = functionExpression.body.body;
	if (body.length !== 1) {
		return false;
	}
	const onlyStatement = body.get(0);
	if (onlyStatement.kind !== SyntaxKind.ReturnStatement || onlyStatement.expressions.length !== 1) {
		return false;
	}
	const onlyExpression = onlyStatement.expressions[0];
	if (onlyExpression.kind !== SyntaxKind.TableConstructorExpression || onlyExpression.fields.length === 0) {
		return false;
	}
	const sourceIdentifier = functionExpression.parameters[0].name;
	for (const field of onlyExpression.fields) {
		const fieldKey = getTableFieldKey(field);
		if (!fieldKey) {
			return false;
		}
		const copiedKey = getCopiedSourceKey(field.value, sourceIdentifier);
		if (!copiedKey || copiedKey !== fieldKey) {
			return false;
		}
	}
	return true;
}

export function matchesCallDelegationGetter(expression: Expression, parameterNames: ReadonlyArray<string>): boolean {
	if (expression.kind !== SyntaxKind.CallExpression) {
		return false;
	}
	if (!isSimpleCallableExpression(expression.callee)) {
		return false;
	}
	if (isBuiltinCallExpression(expression)) {
		return false;
	}
	return matchesForwardedArgumentList(expression.arguments, parameterNames);
}

export function matchesGetterPattern(functionExpression: CartFunctionExpression): boolean {
	const body = functionExpression.body.body;
	if (matchesLocalAliasReturnWrapperPattern(functionExpression)) {
		return true;
	}
	if (body.length !== 1) {
		return false;
	}
	const returnStatement = body.get(0);
	if (returnStatement.kind !== SyntaxKind.ReturnStatement || returnStatement.expressions.length !== 1) {
		return false;
	}
	const expression = returnStatement.expressions[0];
	const parameterNames = getFunctionParameterNames(functionExpression);
	return isDirectValueGetterExpression(expression)
		|| matchesIndexLookupGetter(expression, parameterNames)
		|| matchesCallDelegationGetter(expression, parameterNames);
}

export function matchesSetterPattern(functionExpression: CartFunctionExpression): boolean {
	const body = functionExpression.body.body;
	if (functionExpression.parameters.length < 1 || body.length !== 1) {
		return false;
	}
	const assignment = body.get(0);
	if (assignment.kind !== SyntaxKind.AssignmentStatement) {
		return false;
	}
	if (assignment.operator !== AssignmentOperator.Assign || assignment.left.length !== 1 || assignment.right.length !== 1) {
		return false;
	}
	const target = assignment.left[0];
	if (!isAssignableStorageExpression(target)) {
		return false;
	}
	const value = assignment.right[0];
	if (value.kind !== SyntaxKind.IdentifierExpression) {
		return false;
	}
	const parameterNames = new Set<string>(getFunctionParameterNames(functionExpression));
	if (!parameterNames.has(value.name)) {
		return false;
	}
	return !(target.kind === SyntaxKind.IdentifierExpression && target.name === value.name);
}

export function isDelegationCallCandidate(expression: CallExpression): boolean {
	if (expressionContainsInlineTableOrFunction(expression.callee)) {
		return false;
	}
	for (const argument of expression.arguments) {
		if (expressionContainsInlineTableOrFunction(argument)) {
			return false;
		}
	}
	return true;
}

export function matchesBuiltinRecreationPattern(functionExpression: CartFunctionExpression): boolean {
	const expression = getFunctionSingleReturnExpression(functionExpression);
	if (!expression) {
		return false;
	}
	if (expression.kind !== SyntaxKind.CallExpression) {
		return false;
	}
	if (!isBuiltinCallExpression(expression)) {
		return false;
	}
	return matchesForwardedArgumentList(expression.arguments, getFunctionParameterNames(functionExpression));
}

export function getRunCheckGoFunction(entryExpression: Expression): CartFunctionExpression | undefined {
	if (entryExpression.kind === SyntaxKind.FunctionExpression) {
		return entryExpression;
	}
	if (entryExpression.kind !== SyntaxKind.TableConstructorExpression) {
		return undefined;
	}
	const goField = findTableFieldByKey(entryExpression, 'go');
	if (!goField || goField.value.kind !== SyntaxKind.FunctionExpression) {
		return undefined;
	}
	return goField.value;
}
