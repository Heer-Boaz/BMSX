import { type LuaCallExpression, type LuaExpression, type LuaFunctionExpression, LuaSyntaxKind, LuaTableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../../../lua_rule';
import { lintFsmEventReemitHandlerPatternInMap } from '../../fsm_event_reemit_handler_pattern';
import { lintFsmLifecycleWrapperPatternInTable } from '../../fsm_lifecycle_wrapper_pattern';
import { getCallMethodName, getCallReceiverExpression, isGlobalCall } from '../../../../../../src/bmsx/lua/syntax/calls';
import { FSM_STATE_HANDLER_MAP_KEYS } from './fsm_transitions';
import { isSelfExpressionRoot } from './self_properties';
import { findTableFieldByKey, getTableFieldKey } from './table_fields';

export function isEventsContainerExpression(expression: LuaExpression): boolean {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.name === 'events';
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		return expression.identifier === 'events';
	}
	if (expression.kind !== LuaSyntaxKind.IndexExpression) {
		return false;
	}
	if (expression.index.kind === LuaSyntaxKind.StringLiteralExpression) {
		return expression.index.value === 'events';
	}
	if (expression.index.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.index.name === 'events';
	}
	return false;
}

export function isEventsOnCallExpression(expression: LuaCallExpression): boolean {
	const methodName = getCallMethodName(expression);
	if (methodName !== 'on') {
		return false;
	}
	let receiver: LuaExpression;
	if (expression.methodName && expression.methodName.length > 0) {
		receiver = expression.callee;
	} else if (expression.callee.kind === LuaSyntaxKind.MemberExpression) {
		receiver = expression.callee.base;
	} else {
		return false;
	}
	return isEventsContainerExpression(receiver);
}

export function isEventsEmitCallExpression(expression: LuaExpression): expression is LuaCallExpression {
	if (expression.kind !== LuaSyntaxKind.CallExpression) {
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

export function isSelfEventsEmitCallExpression(expression: LuaCallExpression): boolean {
	if (getCallMethodName(expression) !== 'emit') {
		return false;
	}
	const receiver = getCallReceiverExpression(expression);
	if (!receiver) {
		return false;
	}
	return isEventsContainerExpression(receiver) && isSelfExpressionRoot(receiver);
}

export function getGoFunctionFromHandlerEntryValue(value: LuaExpression): LuaFunctionExpression | undefined {
	if (value.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return undefined;
	}
	const goField = findTableFieldByKey(value, 'go');
	if (!goField || goField.value.kind !== LuaSyntaxKind.FunctionExpression) {
		return undefined;
	}
	return goField.value;
}

export function lintFsmEventReemitHandlerPatternInTable(expression: LuaExpression, issues: LuaLintIssue[]): void {
	if (expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		const key = getTableFieldKey(field);
		if (key && FSM_STATE_HANDLER_MAP_KEYS.has(key)) {
			lintFsmEventReemitHandlerPatternInMap(field.value, issues);
		}
		if (field.kind === LuaTableFieldKind.ExpressionKey) {
			lintFsmEventReemitHandlerPatternInTable(field.key, issues);
		}
		lintFsmEventReemitHandlerPatternInTable(field.value, issues);
	}
}

export function lintFsmEventReemitHandlerPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const definition = expression.arguments[1];
	if (!definition) {
		return;
	}
	lintFsmEventReemitHandlerPatternInTable(definition, issues);
}

export function getLifecycleWrapperCallExpression(functionExpression: LuaFunctionExpression): LuaCallExpression | undefined {
	if (functionExpression.parameters.length === 0 || functionExpression.hasVararg) {
		return undefined;
	}
	if (functionExpression.body.body.length !== 1) {
		return undefined;
	}
	const onlyStatement = functionExpression.body.body[0];
	let expression: LuaExpression | undefined;
	if (onlyStatement.kind === LuaSyntaxKind.CallStatement) {
		expression = onlyStatement.expression;
	} else if (onlyStatement.kind === LuaSyntaxKind.ReturnStatement && onlyStatement.expressions.length === 1) {
		expression = onlyStatement.expressions[0];
	}
	if (!expression || expression.kind !== LuaSyntaxKind.CallExpression) {
		return undefined;
	}
	const receiver = getCallReceiverExpression(expression);
	if (!receiver || receiver.kind !== LuaSyntaxKind.IdentifierExpression) {
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
		if (argument.kind !== LuaSyntaxKind.IdentifierExpression) {
			return undefined;
		}
		const expectedParamName = functionExpression.parameters[index + 1].name;
		if (argument.name !== expectedParamName) {
			return undefined;
		}
	}
	return expression;
}

export function lintFsmLifecycleWrapperPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const definition = expression.arguments[1];
	if (!definition) {
		return;
	}
	lintFsmLifecycleWrapperPatternInTable(definition, issues);
}
