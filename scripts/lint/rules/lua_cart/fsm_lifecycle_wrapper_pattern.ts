import { defineLintRule } from '../../rule';
import { type LuaExpression, LuaSyntaxKind, LuaTableFieldKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { getCallMethodName } from '../../../../src/bmsx/lua/syntax/calls';
import { FSM_DELEGATE_HANDLER_KEYS } from './impl/support/fsm_core';
import { getLifecycleWrapperCallExpression } from './impl/support/fsm_events';
import { getTableFieldKey } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';

export const fsmLifecycleWrapperPatternRule = defineLintRule('lua_cart', 'fsm_lifecycle_wrapper_pattern');

export function lintFsmLifecycleWrapperPatternInTable(expression: LuaExpression, issues: LuaLintIssue[]): void {
	if (expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		const key = getTableFieldKey(field);
		if (key && FSM_DELEGATE_HANDLER_KEYS.has(key) && field.value.kind === LuaSyntaxKind.FunctionExpression) {
			const callExpression = getLifecycleWrapperCallExpression(field.value);
			if (callExpression) {
				const methodName = getCallMethodName(callExpression) || 'handler';
				pushIssue(
					issues,
					fsmLifecycleWrapperPatternRule.name,
					field.value,
					`FSM handler wrapper for "${key}" is forbidden ("${methodName}"). Use a direct function reference (for example "<class>.${methodName}") instead of wrapper functions like "function(self) self:${methodName}(...) end".`,
				);
			}
		}
		if (field.kind === LuaTableFieldKind.ExpressionKey) {
			lintFsmLifecycleWrapperPatternInTable(field.key, issues);
		}
		lintFsmLifecycleWrapperPatternInTable(field.value, issues);
	}
}
