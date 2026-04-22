import { LuaBinaryOperator as BinaryOperator, type LuaExpression as Expression } from '../../../../src/bmsx/lua/syntax/ast';
import { isLuaNilLiteral as isNilLiteral, luaBinaryExpressionHasOperand } from '../../../../src/bmsx/lua/syntax/literals';
import type { CartLintIssue, CartLintIssuePusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';

export const orNilFallbackPatternRule = defineLintRule('common', 'or_nil_fallback_pattern');

export function lintAstOrNilFallbackPattern(expression: Expression, issues: CartLintIssue[], pushIssue: CartLintIssuePusher): void {
	if (!luaBinaryExpressionHasOperand(expression, BinaryOperator.Or, isNilLiteral)) {
		return;
	}
	pushIssue(
		issues,
		orNilFallbackPatternRule.name,
		expression,
		'"or nil" fallback pattern is forbidden. Lua has no undefined; remove JS-style nil normalization. If you mean "only compute/use this when a source value exists", guard on that value directly (for example "tracks and compile_tracks(tracks)"). If you truly need an explicit nil branch, use a real if/else.',
	);
}
