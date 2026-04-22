import { LuaBinaryOperator as BinaryOperator, type LuaExpression as Expression, type LuaFunctionExpression as CartFunctionExpression, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind, LuaUnaryOperator as UnaryOperator } from '../../../../../../src/bmsx/lua/syntax/ast';
import { isBuiltinCallExpression } from './calls';
import { isDelegationCallCandidate, isDirectValueGetterExpression } from './functions';
import { getFunctionSingleReturnExpression } from './function_shapes';
import { expressionsEquivalentForLint } from './general';

export function isNilExpression(expression: Expression): boolean {
	return expression.kind === SyntaxKind.NilLiteralExpression;
}

export function getStringComparisonOperand(expression: Expression): Expression | undefined {
	if (expression.kind !== SyntaxKind.BinaryExpression || expression.operator !== BinaryOperator.Equal) {
		return undefined;
	}
	if (expression.left.kind === SyntaxKind.StringLiteralExpression && expression.right.kind !== SyntaxKind.StringLiteralExpression) {
		return expression.right;
	}
	if (expression.right.kind === SyntaxKind.StringLiteralExpression && expression.left.kind !== SyntaxKind.StringLiteralExpression) {
		return expression.left;
	}
	return undefined;
}

export function collectStringOrChainOperands(expression: Expression, operands: Expression[]): boolean {
	if (expression.kind === SyntaxKind.BinaryExpression && expression.operator === BinaryOperator.Or) {
		return collectStringOrChainOperands(expression.left, operands) && collectStringOrChainOperands(expression.right, operands);
	}
	const operand = getStringComparisonOperand(expression);
	if (!operand) {
		return false;
	}
	operands.push(operand);
	return true;
}

export function matchesStringOrChainComparisonPattern(expression: Expression): boolean {
	const operands: Expression[] = [];
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
	expression: Expression,
	knownValues: ReadonlyMap<string, string>,
): string | undefined {
	if (expression.kind === SyntaxKind.StringLiteralExpression) {
		return expression.value;
	}
	if (expression.kind === SyntaxKind.IdentifierExpression) {
		return knownValues.get(expression.name);
	}
	if (expression.kind === SyntaxKind.BinaryExpression && expression.operator === BinaryOperator.Concat) {
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

export function isComparisonOperator(operator: BinaryOperator): boolean {
	return operator === BinaryOperator.Equal
		|| operator === BinaryOperator.NotEqual
		|| operator === BinaryOperator.LessThan
		|| operator === BinaryOperator.LessEqual
		|| operator === BinaryOperator.GreaterThan
		|| operator === BinaryOperator.GreaterEqual;
}

export function isComparisonWrapperProbeExpression(expression: Expression): boolean {
	if (isDirectValueGetterExpression(expression)) {
		return true;
	}
	if (expression.kind !== SyntaxKind.CallExpression) {
		return false;
	}
	if (isBuiltinCallExpression(expression)) {
		return false;
	}
	return isDelegationCallCandidate(expression);
}

export function isSingleValueComparisonWrapperExpression(expression: Expression): boolean {
	if (expression.kind !== SyntaxKind.BinaryExpression || !isComparisonOperator(expression.operator)) {
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

export function matchesComparisonWrapperGetterPattern(functionExpression: CartFunctionExpression): boolean {
	if (functionExpression.parameters.length !== 0 || functionExpression.hasVararg) {
		return false;
	}
	const expression = getFunctionSingleReturnExpression(functionExpression);
	return expression !== undefined && isSingleValueComparisonWrapperExpression(expression);
}

export function getSingleReturnedStringValue(statement: Statement): string {
	if (statement.kind !== SyntaxKind.ReturnStatement || statement.expressions.length !== 1) {
		return undefined;
	}
	const returned = statement.expressions[0];
	if (returned.kind !== SyntaxKind.StringLiteralExpression) {
		return undefined;
	}
	return returned.value;
}

export function isTruthyParamCondition(expression: Expression, parameterName: string): boolean {
	return expression.kind === SyntaxKind.IdentifierExpression && expression.name === parameterName;
}

export function isFalsyParamCondition(expression: Expression, parameterName: string): boolean {
	return expression.kind === SyntaxKind.UnaryExpression
		&& expression.operator === UnaryOperator.Not
		&& expression.operand.kind === SyntaxKind.IdentifierExpression
		&& expression.operand.name === parameterName;
}

export function returnsBool01Pair(whenTrue: string, whenFalse: string): boolean {
	return whenTrue === '1' && whenFalse === '0';
}

export function matchesBool01DuplicatePattern(functionExpression: CartFunctionExpression): boolean {
	if (functionExpression.parameters.length !== 1 || functionExpression.hasVararg) {
		return false;
	}
	const parameterName = functionExpression.parameters[0].name;
	const body = functionExpression.body.body;
	if (body.length === 2) {
		const firstStatement = body[0];
		const fallback = getSingleReturnedStringValue(body[1]);
		if (firstStatement.kind !== SyntaxKind.IfStatement || !fallback || firstStatement.clauses.length !== 1) {
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
		if (onlyIf.kind !== SyntaxKind.IfStatement || onlyIf.clauses.length !== 2) {
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

export function isFalseOrNilExpression(expression: Expression): boolean {
	return expression.kind === SyntaxKind.NilLiteralExpression
		|| (expression.kind === SyntaxKind.BooleanLiteralExpression && expression.value === false);
}

export function isPrimitiveLiteralExpression(expression: Expression): boolean {
	return expression.kind === SyntaxKind.StringLiteralExpression
		|| expression.kind === SyntaxKind.NumericLiteralExpression
		|| expression.kind === SyntaxKind.BooleanLiteralExpression
		|| expression.kind === SyntaxKind.NilLiteralExpression;
}
