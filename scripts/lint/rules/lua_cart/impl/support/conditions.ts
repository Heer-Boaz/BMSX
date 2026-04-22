import { LuaBinaryOperator, type LuaExpression, type LuaFunctionExpression, type LuaStatement, LuaSyntaxKind, LuaUnaryOperator } from '../../../../../../src/bmsx/lua/syntax/ast';
import { isBuiltinCallExpression } from './calls';
import { isDelegationCallCandidate, isDirectValueGetterExpression } from './functions';
import { getFunctionSingleReturnExpression } from './function_shapes';
import { expressionsEquivalentForLint } from './general';

export function isNilExpression(expression: LuaExpression): boolean {
	return expression.kind === LuaSyntaxKind.NilLiteralExpression;
}

export function getStringComparisonOperand(expression: LuaExpression): LuaExpression | undefined {
	if (expression.kind !== LuaSyntaxKind.BinaryExpression || expression.operator !== LuaBinaryOperator.Equal) {
		return undefined;
	}
	if (expression.left.kind === LuaSyntaxKind.StringLiteralExpression && expression.right.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return expression.right;
	}
	if (expression.right.kind === LuaSyntaxKind.StringLiteralExpression && expression.left.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return expression.left;
	}
	return undefined;
}

export function collectStringOrChainOperands(expression: LuaExpression, operands: LuaExpression[]): boolean {
	if (expression.kind === LuaSyntaxKind.BinaryExpression && expression.operator === LuaBinaryOperator.Or) {
		return collectStringOrChainOperands(expression.left, operands) && collectStringOrChainOperands(expression.right, operands);
	}
	const operand = getStringComparisonOperand(expression);
	if (!operand) {
		return false;
	}
	operands.push(operand);
	return true;
}

export function matchesStringOrChainComparisonPattern(expression: LuaExpression): boolean {
	const operands: LuaExpression[] = [];
	if (!collectStringOrChainOperands(expression, operands)) {
		return false;
	}
	if (operands.length <= 1) {
		return false;
	}
	for (let index = 1; index < operands.length; index += 1) {
		if (!expressionsEquivalentForLint(operands[0], operands[index])) {
			return false;
		}
	}
	return true;
}

export function evaluateTopLevelStringConstantExpression(
	expression: LuaExpression,
	knownValues: ReadonlyMap<string, string>,
): string | undefined {
	if (expression.kind === LuaSyntaxKind.StringLiteralExpression) {
		return expression.value;
	}
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return knownValues.get(expression.name);
	}
	if (expression.kind === LuaSyntaxKind.BinaryExpression && expression.operator === LuaBinaryOperator.Concat) {
		const left = evaluateTopLevelStringConstantExpression(expression.left, knownValues);
		if (left === undefined) {
			return undefined;
		}
		const right = evaluateTopLevelStringConstantExpression(expression.right, knownValues);
		if (right === undefined) {
			return undefined;
		}
		return left + right;
	}
	return undefined;
}

export function isComparisonOperator(operator: LuaBinaryOperator): boolean {
	return operator === LuaBinaryOperator.Equal
		|| operator === LuaBinaryOperator.NotEqual
		|| operator === LuaBinaryOperator.LessThan
		|| operator === LuaBinaryOperator.LessEqual
		|| operator === LuaBinaryOperator.GreaterThan
		|| operator === LuaBinaryOperator.GreaterEqual;
}

export function isComparisonWrapperProbeExpression(expression: LuaExpression): boolean {
	if (isDirectValueGetterExpression(expression)) {
		return true;
	}
	if (expression.kind !== LuaSyntaxKind.CallExpression) {
		return false;
	}
	if (isBuiltinCallExpression(expression)) {
		return false;
	}
	return isDelegationCallCandidate(expression);
}

export function isSingleValueComparisonWrapperExpression(expression: LuaExpression): boolean {
	if (expression.kind !== LuaSyntaxKind.BinaryExpression || !isComparisonOperator(expression.operator)) {
		return false;
	}
	const leftLiteral = isPrimitiveLiteralExpression(expression.left);
	const rightLiteral = isPrimitiveLiteralExpression(expression.right);
	if (leftLiteral === rightLiteral) {
		return false;
	}
	const probe = leftLiteral ? expression.right : expression.left;
	return isComparisonWrapperProbeExpression(probe);
}

export function matchesComparisonWrapperGetterPattern(functionExpression: LuaFunctionExpression): boolean {
	if (functionExpression.parameters.length !== 0 || functionExpression.hasVararg) {
		return false;
	}
	const expression = getFunctionSingleReturnExpression(functionExpression);
	return expression !== undefined && isSingleValueComparisonWrapperExpression(expression);
}

export function getSingleReturnedStringValue(statement: LuaStatement): string {
	if (statement.kind !== LuaSyntaxKind.ReturnStatement || statement.expressions.length !== 1) {
		return undefined;
	}
	const returned = statement.expressions[0];
	if (returned.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return undefined;
	}
	return returned.value;
}

export function isTruthyParamCondition(expression: LuaExpression, parameterName: string): boolean {
	return expression.kind === LuaSyntaxKind.IdentifierExpression && expression.name === parameterName;
}

export function isFalsyParamCondition(expression: LuaExpression, parameterName: string): boolean {
	return expression.kind === LuaSyntaxKind.UnaryExpression
		&& expression.operator === LuaUnaryOperator.Not
		&& expression.operand.kind === LuaSyntaxKind.IdentifierExpression
		&& expression.operand.name === parameterName;
}

export function returnsBool01Pair(whenTrue: string, whenFalse: string): boolean {
	return whenTrue === '1' && whenFalse === '0';
}

export function matchesBool01DuplicatePattern(functionExpression: LuaFunctionExpression): boolean {
	if (functionExpression.parameters.length !== 1 || functionExpression.hasVararg) {
		return false;
	}
	const parameterName = functionExpression.parameters[0].name;
	const body = functionExpression.body.body;
	if (body.length === 2) {
		const firstStatement = body[0];
		const fallback = getSingleReturnedStringValue(body[1]);
		if (firstStatement.kind !== LuaSyntaxKind.IfStatement || !fallback || firstStatement.clauses.length !== 1) {
			return false;
		}
		const onlyClause = firstStatement.clauses[0];
		if (!onlyClause.condition || onlyClause.block.body.length !== 1) {
			return false;
		}
		const clauseReturn = getSingleReturnedStringValue(onlyClause.block.body[0]);
		if (!clauseReturn) {
			return false;
		}
		if (isTruthyParamCondition(onlyClause.condition, parameterName)) {
			return returnsBool01Pair(clauseReturn, fallback);
		}
		if (isFalsyParamCondition(onlyClause.condition, parameterName)) {
			return returnsBool01Pair(fallback, clauseReturn);
		}
		return false;
	}
	if (body.length === 1) {
		const onlyIf = body[0];
		if (onlyIf.kind !== LuaSyntaxKind.IfStatement || onlyIf.clauses.length !== 2) {
			return false;
		}
		const first = onlyIf.clauses[0];
		const second = onlyIf.clauses[1];
		if (!first.condition || second.condition || first.block.body.length !== 1 || second.block.body.length !== 1) {
			return false;
		}
		const firstReturn = getSingleReturnedStringValue(first.block.body[0]);
		const secondReturn = getSingleReturnedStringValue(second.block.body[0]);
		if (!firstReturn || !secondReturn) {
			return false;
		}
		if (isTruthyParamCondition(first.condition, parameterName)) {
			return returnsBool01Pair(firstReturn, secondReturn);
		}
		if (isFalsyParamCondition(first.condition, parameterName)) {
			return returnsBool01Pair(secondReturn, firstReturn);
		}
	}
	return false;
}

export function isFalseOrNilExpression(expression: LuaExpression): boolean {
	return expression.kind === LuaSyntaxKind.NilLiteralExpression
		|| (expression.kind === LuaSyntaxKind.BooleanLiteralExpression && expression.value === false);
}

export function isPrimitiveLiteralExpression(expression: LuaExpression): boolean {
	return expression.kind === LuaSyntaxKind.StringLiteralExpression
		|| expression.kind === LuaSyntaxKind.NumericLiteralExpression
		|| expression.kind === LuaSyntaxKind.BooleanLiteralExpression
		|| expression.kind === LuaSyntaxKind.NilLiteralExpression;
}
