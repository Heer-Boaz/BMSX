import { LuaAssignmentOperator as AssignmentOperator, type LuaCallExpression as CallExpression, type LuaExpression as Expression, type LuaFunctionDeclarationStatement as FunctionDeclarationStatement, type LuaFunctionExpression as CartFunctionExpression, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind, LuaTableFieldKind as TableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { isIdentifier } from './bindings';
import { isBuiltinCallExpression } from './calls';
import { matchesLocalAliasReturnWrapperPattern } from './cart_patterns';
import { isAssignableStorageExpression, isSimpleCallableExpression } from './expressions';
import { getFunctionSingleReturnExpression } from './function_shapes';
import { getCopiedSourceKey } from './general';
import { expressionContainsInlineTableOrFunction, findTableFieldByKey, getTableFieldKey } from './table_fields';
import { OptionsParameterUse } from './types';

export function getFunctionDisplayName(statement: Statement): string {
	if (statement.kind === SyntaxKind.LocalFunctionStatement) {
		return statement.name.name;
	}
	const declaration = statement as FunctionDeclarationStatement;
	const prefix = declaration.name.identifiers.join('.');
	if (declaration.name.methodName && declaration.name.methodName.length > 0) {
		return `${prefix}:${declaration.name.methodName}`;
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

export function isMethodLikeFunctionDeclaration(statement: FunctionDeclarationStatement): boolean {
	return statement.name.identifiers.length > 1 || !!statement.name.methodName;
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
	const onlyStatement = body[0];
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
	const returnStatement = body[0];
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
	const assignment = body[0];
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

export function collectOptionsParameterUseInStatements(statements: ReadonlyArray<Statement>, parameterName: string, use: OptionsParameterUse): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case SyntaxKind.LocalAssignmentStatement:
				for (const value of statement.values) {
					collectOptionsParameterUseInExpression(value, parameterName, use);
				}
				break;
			case SyntaxKind.AssignmentStatement:
				for (const left of statement.left) {
					collectOptionsParameterUseInExpression(left, parameterName, use);
				}
				for (const right of statement.right) {
					collectOptionsParameterUseInExpression(right, parameterName, use);
				}
				break;
			case SyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					collectOptionsParameterUseInExpression(expression, parameterName, use);
				}
				break;
			case SyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						collectOptionsParameterUseInExpression(clause.condition, parameterName, use);
					}
					collectOptionsParameterUseInStatements(clause.block.body, parameterName, use);
				}
				break;
			case SyntaxKind.WhileStatement:
				collectOptionsParameterUseInExpression(statement.condition, parameterName, use);
				collectOptionsParameterUseInStatements(statement.block.body, parameterName, use);
				break;
			case SyntaxKind.RepeatStatement:
				collectOptionsParameterUseInStatements(statement.block.body, parameterName, use);
				collectOptionsParameterUseInExpression(statement.condition, parameterName, use);
				break;
			case SyntaxKind.ForNumericStatement:
				collectOptionsParameterUseInExpression(statement.start, parameterName, use);
				collectOptionsParameterUseInExpression(statement.limit, parameterName, use);
				if (statement.step) {
					collectOptionsParameterUseInExpression(statement.step, parameterName, use);
				}
				collectOptionsParameterUseInStatements(statement.block.body, parameterName, use);
				break;
			case SyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					collectOptionsParameterUseInExpression(iterator, parameterName, use);
				}
				collectOptionsParameterUseInStatements(statement.block.body, parameterName, use);
				break;
			case SyntaxKind.DoStatement:
				collectOptionsParameterUseInStatements(statement.block.body, parameterName, use);
				break;
			case SyntaxKind.CallStatement:
				collectOptionsParameterUseInExpression(statement.expression, parameterName, use);
				break;
			case SyntaxKind.LocalFunctionStatement:
			case SyntaxKind.FunctionDeclarationStatement:
			case SyntaxKind.BreakStatement:
			case SyntaxKind.HaltUntilIrqStatement:
			case SyntaxKind.GotoStatement:
			case SyntaxKind.LabelStatement:
				break;
		}
	}
}

export function collectOptionsParameterUseInExpression(expression: Expression, parameterName: string, use: OptionsParameterUse): void {
	switch (expression.kind) {
		case SyntaxKind.IdentifierExpression:
			if (expression.name === parameterName) {
				use.bareReads += 1;
			}
			return;
		case SyntaxKind.MemberExpression:
			if (isIdentifier(expression.base, parameterName)) {
				use.fields.add(expression.identifier);
				return;
			}
			collectOptionsParameterUseInExpression(expression.base, parameterName, use);
			return;
		case SyntaxKind.IndexExpression:
			if (isIdentifier(expression.base, parameterName)) {
				if (expression.index.kind === SyntaxKind.StringLiteralExpression || expression.index.kind === SyntaxKind.StringRefLiteralExpression) {
					use.fields.add(expression.index.value);
				} else {
					use.dynamicReads += 1;
				}
				return;
			}
			collectOptionsParameterUseInExpression(expression.base, parameterName, use);
			collectOptionsParameterUseInExpression(expression.index, parameterName, use);
			return;
		case SyntaxKind.CallExpression:
			collectOptionsParameterUseInExpression(expression.callee, parameterName, use);
			for (const argument of expression.arguments) {
				collectOptionsParameterUseInExpression(argument, parameterName, use);
			}
			return;
		case SyntaxKind.BinaryExpression:
			collectOptionsParameterUseInExpression(expression.left, parameterName, use);
			collectOptionsParameterUseInExpression(expression.right, parameterName, use);
			return;
		case SyntaxKind.UnaryExpression:
			collectOptionsParameterUseInExpression(expression.operand, parameterName, use);
			return;
		case SyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === TableFieldKind.ExpressionKey) {
					collectOptionsParameterUseInExpression(field.key, parameterName, use);
				}
				collectOptionsParameterUseInExpression(field.value, parameterName, use);
			}
			return;
		case SyntaxKind.FunctionExpression:
		case SyntaxKind.NumericLiteralExpression:
		case SyntaxKind.StringLiteralExpression:
		case SyntaxKind.StringRefLiteralExpression:
		case SyntaxKind.BooleanLiteralExpression:
		case SyntaxKind.NilLiteralExpression:
		case SyntaxKind.VarargExpression:
			return;
	}
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
