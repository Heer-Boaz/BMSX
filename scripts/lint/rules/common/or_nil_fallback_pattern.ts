import { LuaBinaryOperator, type LuaExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { isLuaNilLiteral, luaBinaryExpressionHasOperand } from '../../../../src/bmsx/lua/syntax/literals';
import type { LuaLintIssue, LuaLintIssuePusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';

export const orNilFallbackPatternRule = defineLintRule('common', 'or_nil_fallback_pattern');

export function lintLuaOrNilFallbackPattern(expression: LuaExpression, issues: LuaLintIssue[], pushIssue: LuaLintIssuePusher): void {
	if (!luaBinaryExpressionHasOperand(expression, LuaBinaryOperator.Or, isLuaNilLiteral)) {
		return;
	}
	pushIssue(
		issues,
		orNilFallbackPatternRule.name,
		expression,
		'"or nil" fallback pattern is forbidden. Lua has no undefined; remove JS-style nil normalization. If you mean "only compute/use this when a source value exists", guard on that value directly (for example "tracks and compile_tracks(tracks)"). If you truly need an explicit nil branch, use a real if/else.',
	);
}
