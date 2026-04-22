import { type LuaCallExpression as CallExpression, type LuaExpression as Expression, type LuaFunctionExpression as CartFunctionExpression, LuaSyntaxKind as SyntaxKind, LuaTableFieldKind as TableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../../../lua_rule';
import { lintFsmEventReemitHandlerPatternInMap } from '../../fsm_event_reemit_handler_pattern';
import { lintFsmLifecycleWrapperPatternInTable } from '../../fsm_lifecycle_wrapper_pattern';
import { getCallMethodName, getCallReceiverExpression, isGlobalCall } from '../../../../../../src/bmsx/lua/syntax/calls';
import { FSM_STATE_HANDLER_MAP_KEYS } from './fsm_transitions';
import { isSelfExpressionRoot } from './self_properties';
import { findTableFieldByKey, getTableFieldKey } from './table_fields';

export function isEventsContainerExpression(expression: Expression): boolean {
	if (expression.kind === SyntaxKind.IdentifierExpression) {
		return expression.name === 'events';
	}
	if (expression.kind === SyntaxKind.MemberExpression) {
		return expression.identifier === 'events';
	}
	if (expression.kind !== SyntaxKind.IndexExpression) {
		return false;
	}
	if (expression.index.kind === SyntaxKind.StringLiteralExpression) {
		return expression.index.value === 'events';
	}
	if (expression.index.kind === SyntaxKind.IdentifierExpression) {
		return expression.index.name === 'events';
	}
	return false;
}

export function isEventsOnCallExpression(expression: CallExpression): boolean {
	const methodName = getCallMethodName(expression);
	if (methodName !== 'on') {
		return false;
	}
	let receiver: Expression;
	if (expression.methodName && expression.methodName.length > 0) {
		receiver = expression.callee;
	} else if (expression.callee.kind === SyntaxKind.MemberExpression) {
		receiver = expression.callee.base;
	} else {
		return false;
	}
	return isEventsContainerExpression(receiver);
}

export function isEventsEmitCallExpression(expression: Expression): expression is CallExpression {
	if (expression.kind !== SyntaxKind.CallExpression) {
		return false;
	}
	if (getCallMethodName(expression) !== 'emit') {
		return false;
	}
	const receiver = getCallReceiverExpression(expression);
	if (!receiver) {
		return false;
	}
	return isEventsContainerExpression(receiver);
}

export function isSelfEventsEmitCallExpression(expression: CallExpression): boolean {
	if (getCallMethodName(expression) !== 'emit') {
		return false;
	}
	const receiver = getCallReceiverExpression(expression);
	if (!receiver) {
		return false;
	}
	return isEventsContainerExpression(receiver) && isSelfExpressionRoot(receiver);
}

export function getGoFunctionFromHandlerEntryValue(value: Expression): CartFunctionExpression | undefined {
	if (value.kind !== SyntaxKind.TableConstructorExpression) {
		return undefined;
	}
	const goField = findTableFieldByKey(value, 'go');
	if (!goField || goField.value.kind !== SyntaxKind.FunctionExpression) {
		return undefined;
	}
	return goField.value;
}

export function lintFsmEventReemitHandlerPatternInTable(expression: Expression, issues: CartLintIssue[]): void {
	if (expression.kind !== SyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		const key = getTableFieldKey(field);
		if (key && FSM_STATE_HANDLER_MAP_KEYS.has(key)) {
			lintFsmEventReemitHandlerPatternInMap(field.value, issues);
		}
		if (field.kind === TableFieldKind.ExpressionKey) {
			lintFsmEventReemitHandlerPatternInTable(field.key, issues);
		}
		lintFsmEventReemitHandlerPatternInTable(field.value, issues);
	}
}

export function lintFsmEventReemitHandlerPattern(expression: CallExpression, issues: CartLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const definition = expression.arguments[1];
	if (!definition) {
		return;
	}
	lintFsmEventReemitHandlerPatternInTable(definition, issues);
}

export function getLifecycleWrapperCallExpression(functionExpression: CartFunctionExpression): CallExpression | undefined {
	if (functionExpression.parameters.length === 0 || functionExpression.hasVararg) {
		return undefined;
	}
	if (functionExpression.body.body.length !== 1) {
		return undefined;
	}
	const onlyStatement = functionExpression.body.body[0];
	let expression: Expression | undefined;
	if (onlyStatement.kind === SyntaxKind.CallStatement) {
		expression = onlyStatement.expression;
	} else if (onlyStatement.kind === SyntaxKind.ReturnStatement && onlyStatement.expressions.length === 1) {
		expression = onlyStatement.expressions[0];
	}
	if (!expression || expression.kind !== SyntaxKind.CallExpression) {
		return undefined;
	}
	const receiver = getCallReceiverExpression(expression);
	if (!receiver || receiver.kind !== SyntaxKind.IdentifierExpression) {
		return undefined;
	}
	const firstParamName = functionExpression.parameters[0].name;
	if (receiver.name !== firstParamName) {
		return undefined;
	}
	const passthroughParameterCount = functionExpression.parameters.length - 1;
	if (expression.arguments.length > passthroughParameterCount) {
		return undefined;
	}
	for (let index = 0; index < expression.arguments.length; index += 1) {
		const argument = expression.arguments[index];
		if (argument.kind !== SyntaxKind.IdentifierExpression) {
			return undefined;
		}
		const expectedParamName = functionExpression.parameters[index + 1].name;
		if (argument.name !== expectedParamName) {
			return undefined;
		}
	}
	return expression;
}

export function lintFsmLifecycleWrapperPattern(expression: CallExpression, issues: CartLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const definition = expression.arguments[1];
	if (!definition) {
		return;
	}
	lintFsmLifecycleWrapperPatternInTable(definition, issues);
}
