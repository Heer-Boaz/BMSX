import { defineLintRule } from '../../rule';
import { type LuaFunctionExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { findCallExpressionInStatements } from '../../../../src/bmsx/lua/syntax/calls';
import { isTickInputCheckCallExpression } from './impl/support/fsm_core';
import { pushIssue } from './impl/support/lint_context';

export const tickInputCheckPatternRule = defineLintRule('lua_cart', 'tick_input_check_pattern');

export function lintTickInputCheckPattern(functionExpression: LuaFunctionExpression, issues: LuaLintIssue[]): void {
	const inputCheck = findCallExpressionInStatements(functionExpression.body.body, isTickInputCheckCallExpression);
	if (!inputCheck) {
		return;
	}
	pushIssue(
		issues,
		tickInputCheckPatternRule.name,
		inputCheck,
		'Input checks inside tick are forbidden. Use FSM input handlers (player-index based), the FSM process_input handler, or events/timelines instead of polling input in tick.',
	);
}
