import { LuaAssignmentOperator, type LuaCallExpression, type LuaExpression, type LuaFunctionDeclarationStatement, type LuaFunctionExpression, type LuaStatement, LuaSyntaxKind, LuaTableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { isIdentifier } from './bindings';
import { isBuiltinCallExpression } from './calls';
import { matchesLocalAliasReturnWrapperPattern } from './cart_patterns';
import { isAssignableStorageExpression, isSimpleCallableExpression } from './expressions';
import { getFunctionSingleReturnExpression } from './function_shapes';
import { getCopiedSourceKey } from './general';
import { expressionContainsInlineTableOrFunction, findTableFieldByKey, getTableFieldKey } from './table_fields';
import { LuaOptionsParameterUse } from './types';

export function getFunctionDisplayName(statement: LuaStatement): string {
	if (statement.kind === LuaSyntaxKind.LocalFunctionStatement) {
		return statement.name.name;
	}
	const declaration = statement as LuaFunctionDeclarationStatement;
	const prefix = declaration.name.identifiers.join('.');
	if (declaration.name.methodName && declaration.name.methodName.length > 0) {
		return `${prefix}:${declaration.name.methodName}`;
	}
	return prefix;
}

export function getFunctionParameterNames(functionExpression: LuaFunctionExpression): ReadonlyArray<string> {
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

export function isMethodLikeFunctionDeclaration(statement: LuaFunctionDeclarationStatement): boolean {
	return statement.name.identifiers.length > 1 || !!statement.name.methodName;
}

export function matchesForwardedArgumentList(argumentsList: ReadonlyArray<LuaExpression>, parameterNames: ReadonlyArray<string>): boolean {
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

export function matchesIndexLookupGetter(expression: LuaExpression, parameterNames: ReadonlyArray<string>): boolean {
	if (parameterNames.length !== 1 || expression.kind !== LuaSyntaxKind.IndexExpression) {
		return false;
	}
	return isIdentifier(expression.index, parameterNames[0]);
}

export function isDirectValueGetterExpression(expression: LuaExpression): boolean {
	return expression.kind === LuaSyntaxKind.IdentifierExpression
		|| expression.kind === LuaSyntaxKind.MemberExpression
		|| expression.kind === LuaSyntaxKind.IndexExpression;
}

export function matchesPureCopyFunctionPattern(functionExpression: LuaFunctionExpression): boolean {
	if (functionExpression.parameters.length !== 1) {
		return false;
	}
	const body = functionExpression.body.body;
	if (body.length !== 1) {
		return false;
	}
	const onlyStatement = body[0];
	if (onlyStatement.kind !== LuaSyntaxKind.ReturnStatement || onlyStatement.expressions.length !== 1) {
		return false;
	}
	const onlyExpression = onlyStatement.expressions[0];
	if (onlyExpression.kind !== LuaSyntaxKind.TableConstructorExpression || onlyExpression.fields.length === 0) {
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

export function matchesCallDelegationGetter(expression: LuaExpression, parameterNames: ReadonlyArray<string>): boolean {
	if (expression.kind !== LuaSyntaxKind.CallExpression) {
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

export function matchesGetterPattern(functionExpression: LuaFunctionExpression): boolean {
	const body = functionExpression.body.body;
	if (matchesLocalAliasReturnWrapperPattern(functionExpression)) {
		return true;
	}
	if (body.length !== 1) {
		return false;
	}
	const returnStatement = body[0];
	if (returnStatement.kind !== LuaSyntaxKind.ReturnStatement || returnStatement.expressions.length !== 1) {
		return false;
	}
	const expression = returnStatement.expressions[0];
	const parameterNames = getFunctionParameterNames(functionExpression);
	return isDirectValueGetterExpression(expression)
		|| matchesIndexLookupGetter(expression, parameterNames)
		|| matchesCallDelegationGetter(expression, parameterNames);
}

export function matchesSetterPattern(functionExpression: LuaFunctionExpression): boolean {
	const body = functionExpression.body.body;
	if (functionExpression.parameters.length < 1 || body.length !== 1) {
		return false;
	}
	const assignment = body[0];
	if (assignment.kind !== LuaSyntaxKind.AssignmentStatement) {
		return false;
	}
	if (assignment.operator !== LuaAssignmentOperator.Assign || assignment.left.length !== 1 || assignment.right.length !== 1) {
		return false;
	}
	const target = assignment.left[0];
	if (!isAssignableStorageExpression(target)) {
		return false;
	}
	const value = assignment.right[0];
	if (value.kind !== LuaSyntaxKind.IdentifierExpression) {
		return false;
	}
	const parameterNames = new Set<string>(getFunctionParameterNames(functionExpression));
	if (!parameterNames.has(value.name)) {
		return false;
	}
	return !(target.kind === LuaSyntaxKind.IdentifierExpression && target.name === value.name);
}

export function isDelegationCallCandidate(expression: LuaCallExpression): boolean {
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

export function matchesBuiltinRecreationPattern(functionExpression: LuaFunctionExpression): boolean {
	const expression = getFunctionSingleReturnExpression(functionExpression);
	if (!expression) {
		return false;
	}
	if (expression.kind !== LuaSyntaxKind.CallExpression) {
		return false;
	}
	if (!isBuiltinCallExpression(expression)) {
		return false;
	}
	return matchesForwardedArgumentList(expression.arguments, getFunctionParameterNames(functionExpression));
}

export function collectLuaOptionsParameterUseInStatements(statements: ReadonlyArray<LuaStatement>, parameterName: string, use: LuaOptionsParameterUse): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				for (const value of statement.values) {
					collectLuaOptionsParameterUseInExpression(value, parameterName, use);
				}
				break;
			case LuaSyntaxKind.AssignmentStatement:
				for (const left of statement.left) {
					collectLuaOptionsParameterUseInExpression(left, parameterName, use);
				}
				for (const right of statement.right) {
					collectLuaOptionsParameterUseInExpression(right, parameterName, use);
				}
				break;
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					collectLuaOptionsParameterUseInExpression(expression, parameterName, use);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						collectLuaOptionsParameterUseInExpression(clause.condition, parameterName, use);
					}
					collectLuaOptionsParameterUseInStatements(clause.block.body, parameterName, use);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				collectLuaOptionsParameterUseInExpression(statement.condition, parameterName, use);
				collectLuaOptionsParameterUseInStatements(statement.block.body, parameterName, use);
				break;
			case LuaSyntaxKind.RepeatStatement:
				collectLuaOptionsParameterUseInStatements(statement.block.body, parameterName, use);
				collectLuaOptionsParameterUseInExpression(statement.condition, parameterName, use);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				collectLuaOptionsParameterUseInExpression(statement.start, parameterName, use);
				collectLuaOptionsParameterUseInExpression(statement.limit, parameterName, use);
				if (statement.step) {
					collectLuaOptionsParameterUseInExpression(statement.step, parameterName, use);
				}
				collectLuaOptionsParameterUseInStatements(statement.block.body, parameterName, use);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					collectLuaOptionsParameterUseInExpression(iterator, parameterName, use);
				}
				collectLuaOptionsParameterUseInStatements(statement.block.body, parameterName, use);
				break;
			case LuaSyntaxKind.DoStatement:
				collectLuaOptionsParameterUseInStatements(statement.block.body, parameterName, use);
				break;
			case LuaSyntaxKind.CallStatement:
				collectLuaOptionsParameterUseInExpression(statement.expression, parameterName, use);
				break;
			case LuaSyntaxKind.LocalFunctionStatement:
			case LuaSyntaxKind.FunctionDeclarationStatement:
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.HaltUntilIrqStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				break;
		}
	}
}

export function collectLuaOptionsParameterUseInExpression(expression: LuaExpression, parameterName: string, use: LuaOptionsParameterUse): void {
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			if (expression.name === parameterName) {
				use.bareReads += 1;
			}
			return;
		case LuaSyntaxKind.MemberExpression:
			if (isIdentifier(expression.base, parameterName)) {
				use.fields.add(expression.identifier);
				return;
			}
			collectLuaOptionsParameterUseInExpression(expression.base, parameterName, use);
			return;
		case LuaSyntaxKind.IndexExpression:
			if (isIdentifier(expression.base, parameterName)) {
				if (expression.index.kind === LuaSyntaxKind.StringLiteralExpression || expression.index.kind === LuaSyntaxKind.StringRefLiteralExpression) {
					use.fields.add(expression.index.value);
				} else {
					use.dynamicReads += 1;
				}
				return;
			}
			collectLuaOptionsParameterUseInExpression(expression.base, parameterName, use);
			collectLuaOptionsParameterUseInExpression(expression.index, parameterName, use);
			return;
		case LuaSyntaxKind.CallExpression:
			collectLuaOptionsParameterUseInExpression(expression.callee, parameterName, use);
			for (const argument of expression.arguments) {
				collectLuaOptionsParameterUseInExpression(argument, parameterName, use);
			}
			return;
		case LuaSyntaxKind.BinaryExpression:
			collectLuaOptionsParameterUseInExpression(expression.left, parameterName, use);
			collectLuaOptionsParameterUseInExpression(expression.right, parameterName, use);
			return;
		case LuaSyntaxKind.UnaryExpression:
			collectLuaOptionsParameterUseInExpression(expression.operand, parameterName, use);
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					collectLuaOptionsParameterUseInExpression(field.key, parameterName, use);
				}
				collectLuaOptionsParameterUseInExpression(field.value, parameterName, use);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
		case LuaSyntaxKind.NumericLiteralExpression:
		case LuaSyntaxKind.StringLiteralExpression:
		case LuaSyntaxKind.StringRefLiteralExpression:
		case LuaSyntaxKind.BooleanLiteralExpression:
		case LuaSyntaxKind.NilLiteralExpression:
		case LuaSyntaxKind.VarargExpression:
			return;
	}
}

export function getRunCheckGoFunction(entryExpression: LuaExpression): LuaFunctionExpression | undefined {
	if (entryExpression.kind === LuaSyntaxKind.FunctionExpression) {
		return entryExpression;
	}
	if (entryExpression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return undefined;
	}
	const goField = findTableFieldByKey(entryExpression, 'go');
	if (!goField || goField.value.kind !== LuaSyntaxKind.FunctionExpression) {
		return undefined;
	}
	return goField.value;
}
