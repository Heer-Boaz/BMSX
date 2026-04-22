import { defineLintRule } from '../../rule';
import { type LuaFunctionExpression as CartFunctionExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { findCallExpressionInStatements } from '../../../../src/bmsx/lua/syntax/calls';
import { isTickInputCheckCallExpression } from './impl/support/fsm_core';
import { pushIssue } from './impl/support/lint_context';

export const tickInputCheckPatternRule = defineLintRule('cart', 'tick_input_check_pattern');

export function lintTickInputCheckPattern(functionExpression: CartFunctionExpression, issues: CartLintIssue[]): void {
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
