import { defineLintRule } from '../../rule';
import { type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { forbiddenDispatchPatternRule } from './forbidden_dispatch_pattern';
import { findCallExpressionInStatements } from '../../../../src/bmsx/lua/syntax/calls';
import { isCrossObjectDispatchStateEventCallExpression } from './impl/support/object_ownership';
import { activeLintRules, pushIssue } from './impl/support/lint_context';

export const dispatchFanoutLoopPatternRule = defineLintRule('cart', 'dispatch_fanout_loop_pattern');

export function lintDispatchFanoutLoopPattern(statement: Statement, issues: CartLintIssue[]): void {
	if (activeLintRules.has(forbiddenDispatchPatternRule.name)) {
		return;
	}
	if (statement.kind !== SyntaxKind.ForNumericStatement && statement.kind !== SyntaxKind.ForGenericStatement) {
		return;
	}
	const dispatchCall = findCallExpressionInStatements(
		statement.block.body,
		isCrossObjectDispatchStateEventCallExpression,
	);
	if (!dispatchCall) {
		return;
	}
	pushIssue(
		issues,
		dispatchFanoutLoopPatternRule.name,
		dispatchCall,
		'Fan-out dispatch_state_event(...) loops are forbidden. Objects/services must own their own FSM/event handling instead of external manual dispatch loops.',
	);
}
