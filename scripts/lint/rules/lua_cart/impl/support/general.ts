import { LuaBinaryOperator, type LuaBooleanLiteralExpression, type LuaExpression, type LuaFunctionExpression, type LuaIdentifierExpression, type LuaIfStatement, type LuaIndexExpression, type LuaMemberExpression, type LuaNumericLiteralExpression, type LuaStatement, type LuaStringLiteralExpression, LuaSyntaxKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { conditionComparesIdentifierWithValue, getReturnedCallToIdentifier } from './bindings';
import { isErrorCallExpression } from './calls';
import { isNilExpression } from './conditions';
import { removeLabel } from './fsm_labels';
import { getFunctionLeafName, isDelegationCallCandidate } from './functions';

export const BUILTIN_GLOBAL_FUNCTIONS = new Set<string>([
	'assert',
	'error',
	'getmetatable',
	'ipairs',
	'next',
	'pairs',
	'pcall',
	'print',
	'rawequal',
	'rawget',
	'rawlen',
	'rawset',
	'select',
	'setmetatable',
	'tonumber',
	'tostring',
	'type',
	'xpcall',
]);

export const BUILTIN_TABLE_NAMES = new Set<string>([
	'math',
	'string',
	'table',
	'coroutine',
	'utf8',
	'bit32',
	'os',
	'io',
	'debug',
	'package',
]);

export const FORBIDDEN_RANDOM_HELPER_NAME_PATTERN = /^(?:random|rand)(?:[_-]?(?:int|integer|range|between|index|idx)\d*)?$/i;

export const FORBIDDEN_STATE_CALL_RECEIVERS = new Set<string>([
	'sc',
	'worldobject',
]);

export const SINGLE_USE_LOCAL_SMALL_HELPER_MAX_LINES = 7;

export function expressionsEquivalentForLint(left: LuaExpression, right: LuaExpression): boolean {
	if (left.kind !== right.kind) {
		return false;
	}
	switch (left.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			return left.name === (right as LuaIdentifierExpression).name;
		case LuaSyntaxKind.MemberExpression:
			return (left as LuaMemberExpression).identifier === (right as LuaMemberExpression).identifier && expressionsEquivalentForLint((left as LuaMemberExpression).base, (right as LuaMemberExpression).base);
		case LuaSyntaxKind.IndexExpression:
			return expressionsEquivalentForLint((left as LuaIndexExpression).base, (right as LuaIndexExpression).base) && expressionsEquivalentForLint((left as LuaIndexExpression).index, (right as LuaIndexExpression).index);
		case LuaSyntaxKind.StringLiteralExpression:
			return (left as LuaStringLiteralExpression).value === (right as LuaStringLiteralExpression).value;
		case LuaSyntaxKind.NumericLiteralExpression:
			return (left as LuaNumericLiteralExpression).value === (right as LuaNumericLiteralExpression).value;
		case LuaSyntaxKind.BooleanLiteralExpression:
			return (left as LuaBooleanLiteralExpression).value === (right as LuaBooleanLiteralExpression).value;
		case LuaSyntaxKind.NilLiteralExpression:
			return true;
		default:
			return false;
	}
}

export function isAllowedSingleLineMethodName(functionName: string): boolean {
	const leaf = getFunctionLeafName(functionName).toLowerCase();
	return leaf === 'ctor';
}

export function isStateLikeAliasName(name: string): boolean {
	const lowered = name.toLowerCase();
	return lowered.includes('state') || lowered.includes('substate');
}

export function getCopiedSourceKey(expression: LuaExpression, sourceIdentifier: string): string {
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		if (expression.base.kind !== LuaSyntaxKind.IdentifierExpression || expression.base.name !== sourceIdentifier) {
			return undefined;
		}
		return expression.identifier;
	}
	if (expression.kind !== LuaSyntaxKind.IndexExpression) {
		return undefined;
	}
	if (expression.base.kind !== LuaSyntaxKind.IdentifierExpression || expression.base.name !== sourceIdentifier) {
		return undefined;
	}
	if (expression.index.kind === LuaSyntaxKind.StringLiteralExpression) {
		return expression.index.value;
	}
	if (expression.index.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.index.name;
	}
	return undefined;
}

export function matchesMeaninglessSingleLineMethodPattern(functionExpression: LuaFunctionExpression): boolean {
	const body = functionExpression.body.body;
	if (body.length !== 1) {
		return false;
	}
	const statement = body[0];
	if (statement.kind === LuaSyntaxKind.CallStatement) {
		return isDelegationCallCandidate(statement.expression);
	}
	if (statement.kind !== LuaSyntaxKind.ReturnStatement || statement.expressions.length !== 1) {
		return false;
	}
	const returnExpression = statement.expressions[0];
	return returnExpression.kind === LuaSyntaxKind.CallExpression && isDelegationCallCandidate(returnExpression);
}

export function matchesForbiddenRandomHelperPattern(functionName: string): boolean {
	return FORBIDDEN_RANDOM_HELPER_NAME_PATTERN.test(getFunctionLeafName(functionName));
}

export function isErrorTerminatingStatement(statement: LuaStatement): boolean {
	if (statement.kind === LuaSyntaxKind.CallStatement) {
		return isErrorCallExpression(statement.expression);
	}
	if (statement.kind === LuaSyntaxKind.ReturnStatement && statement.expressions.length === 1) {
		return isErrorCallExpression(statement.expressions[0]);
	}
	return false;
}

export function matchesUselessAssertPattern(statement: LuaIfStatement): boolean {
	for (const clause of statement.clauses) {
		if (!clause.condition) {
			continue;
		}
		for (const clauseStatement of clause.block.body) {
			if (isErrorTerminatingStatement(clauseStatement)) {
				return true;
			}
		}
	}
	return false;
}

export function isEventProxyFlagPropertyName(propertyName: string): boolean {
	const lowered = propertyName.toLowerCase();
	return lowered.endsWith('_requested')
		|| lowered.endsWith('_pending')
		|| lowered.endsWith('_done')
		|| lowered.startsWith('pending_');
}

export function getEnsureVariableName(statement: LuaIfStatement): string {
	if (statement.clauses.length !== 1) {
		return undefined;
	}
	const clause = statement.clauses[0];
	const condition = clause.condition;
	if (!condition || condition.kind !== LuaSyntaxKind.BinaryExpression || condition.operator !== LuaBinaryOperator.Equal) {
		return undefined;
	}
	if (isNilExpression(condition.left) && condition.right.kind === LuaSyntaxKind.IdentifierExpression) {
		return condition.right.name;
	}
	if (isNilExpression(condition.right) && condition.left.kind === LuaSyntaxKind.IdentifierExpression) {
		return condition.left.name;
	}
	return undefined;
}

export function matchesHandlerIdentityDispatchPattern(functionExpression: LuaFunctionExpression): boolean {
	const body = functionExpression.body.body;
	if (body.length !== 3) {
		return false;
	}
	const localAssignment = body[0];
	const ifStatement = body[1];
	const fallbackReturn = body[2];
	if (localAssignment.kind !== LuaSyntaxKind.LocalAssignmentStatement) {
		return false;
	}
	if (localAssignment.names.length !== 1 || localAssignment.values.length !== 1) {
		return false;
	}
	if (localAssignment.values[0].kind !== LuaSyntaxKind.IndexExpression) {
		return false;
	}
	const localName = localAssignment.names[0].name;
	if (ifStatement.kind !== LuaSyntaxKind.IfStatement || ifStatement.clauses.length !== 1) {
		return false;
	}
	const onlyClause = ifStatement.clauses[0];
	if (!onlyClause.condition || !conditionComparesIdentifierWithValue(onlyClause.condition, localName)) {
		return false;
	}
	if (onlyClause.block.body.length !== 1) {
		return false;
	}
	const specialReturnCall = getReturnedCallToIdentifier(onlyClause.block.body[0], localName);
	if (!specialReturnCall) {
		return false;
	}
	const fallbackReturnCall = getReturnedCallToIdentifier(fallbackReturn, localName);
	if (!fallbackReturnCall) {
		return false;
	}
	return specialReturnCall.arguments.length !== fallbackReturnCall.arguments.length;
}

export function appendSuggestionMessage(baseMessage: string, value: string, label: string): string {
	const suggested = removeLabel(value, label);
	if (!suggested) {
		return baseMessage;
	}
	return `${baseMessage} Use "${suggested}" instead.`;
}
