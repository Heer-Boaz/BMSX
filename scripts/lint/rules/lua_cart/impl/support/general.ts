import { LuaBinaryOperator as BinaryOperator, type LuaBooleanLiteralExpression as BooleanLiteralExpression, type LuaExpression as Expression, type LuaFunctionExpression as CartFunctionExpression, type LuaIdentifierExpression as IdentifierExpression, type LuaIfStatement as IfStatement, type LuaIndexExpression as IndexExpression, type LuaMemberExpression as MemberExpression, type LuaNumericLiteralExpression as NumericLiteralExpression, type LuaStatement as Statement, type LuaStringLiteralExpression as StringLiteralExpression, LuaSyntaxKind as SyntaxKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { conditionComparesIdentifierWithValue, getReturnedCallToIdentifier, isIdentifier } from './bindings';
import { isErrorCallExpression } from '../../../../../../src/bmsx/lua/syntax/calls';
import { isNilExpression } from './conditions';
import { getLocalAssignmentIfFunctionBody } from './function_shapes';
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

export function expressionsEquivalentForLint(left: Expression, right: Expression): boolean {
	if (left.kind !== right.kind) {
		return false;
	}
	switch (left.kind) {
		case SyntaxKind.IdentifierExpression:
			return left.name === (right as IdentifierExpression).name;
		case SyntaxKind.MemberExpression:
			return (left as MemberExpression).identifier === (right as MemberExpression).identifier && expressionsEquivalentForLint((left as MemberExpression).base, (right as MemberExpression).base);
		case SyntaxKind.IndexExpression:
			return expressionsEquivalentForLint((left as IndexExpression).base, (right as IndexExpression).base) && expressionsEquivalentForLint((left as IndexExpression).index, (right as IndexExpression).index);
		case SyntaxKind.StringLiteralExpression:
			return (left as StringLiteralExpression).value === (right as StringLiteralExpression).value;
		case SyntaxKind.NumericLiteralExpression:
			return (left as NumericLiteralExpression).value === (right as NumericLiteralExpression).value;
		case SyntaxKind.BooleanLiteralExpression:
			return (left as BooleanLiteralExpression).value === (right as BooleanLiteralExpression).value;
		case SyntaxKind.NilLiteralExpression:
			return true;
		default:
			return false;
	}
}

export function isStateLikeAliasName(name: string): boolean {
	const lowered = name.toLowerCase();
	return lowered.includes('state') || lowered.includes('substate');
}

export function getCopiedSourceKey(expression: Expression, sourceIdentifier: string): string {
	if (expression.kind === SyntaxKind.MemberExpression) {
		if (!isIdentifier(expression.base, sourceIdentifier)) {
			return undefined;
		}
		return expression.identifier;
	}
	if (expression.kind !== SyntaxKind.IndexExpression) {
		return undefined;
	}
	if (expression.base.kind !== SyntaxKind.IdentifierExpression || expression.base.name !== sourceIdentifier) {
		return undefined;
	}
	if (expression.index.kind === SyntaxKind.StringLiteralExpression) {
		return expression.index.value;
	}
	if (expression.index.kind === SyntaxKind.IdentifierExpression) {
		return expression.index.name;
	}
	return undefined;
}

export function matchesMeaninglessSingleLineMethodPattern(functionExpression: CartFunctionExpression): boolean {
	const body = functionExpression.body.body;
	if (body.length !== 1) {
		return false;
	}
	const statement = body[0];
	if (statement.kind === SyntaxKind.CallStatement) {
		return isDelegationCallCandidate(statement.expression);
	}
	if (statement.kind !== SyntaxKind.ReturnStatement || statement.expressions.length !== 1) {
		return false;
	}
	const returnExpression = statement.expressions[0];
	return returnExpression.kind === SyntaxKind.CallExpression && isDelegationCallCandidate(returnExpression);
}

export function matchesForbiddenRandomHelperPattern(functionName: string): boolean {
	return FORBIDDEN_RANDOM_HELPER_NAME_PATTERN.test(getFunctionLeafName(functionName));
}

export function isErrorTerminatingStatement(statement: Statement): boolean {
	if (statement.kind === SyntaxKind.CallStatement) {
		return isErrorCallExpression(statement.expression);
	}
	if (statement.kind === SyntaxKind.ReturnStatement && statement.expressions.length === 1) {
		return isErrorCallExpression(statement.expressions[0]);
	}
	return false;
}

export function matchesUselessAssertPattern(statement: IfStatement): boolean {
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

export function getEnsureVariableName(statement: IfStatement): string {
	if (statement.clauses.length !== 1) {
		return undefined;
	}
	const clause = statement.clauses[0];
	const condition = clause.condition;
	if (!condition || condition.kind !== SyntaxKind.BinaryExpression || condition.operator !== BinaryOperator.Equal) {
		return undefined;
	}
	if (isNilExpression(condition.left) && condition.right.kind === SyntaxKind.IdentifierExpression) {
		return condition.right.name;
	}
	if (isNilExpression(condition.right) && condition.left.kind === SyntaxKind.IdentifierExpression) {
		return condition.left.name;
	}
	return undefined;
}

export function matchesHandlerIdentityDispatchPattern(functionExpression: CartFunctionExpression): boolean {
	const body = getLocalAssignmentIfFunctionBody(functionExpression);
	if (!body) {
		return false;
	}
	const fallbackReturn = body.third;
	if (body.localAssignment.values[0].kind !== SyntaxKind.IndexExpression) {
		return false;
	}
	const localName = body.localName;
	const onlyClause = body.onlyClause;
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
