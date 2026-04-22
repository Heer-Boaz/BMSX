import type { LuaLocalFunctionStatement } from '../../../../src/bmsx/lua/syntax/ast';
import type { LuaLintIssue, LuaLintIssuePusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';

export const localFunctionConstPatternRule = defineLintRule('lua_cart', 'local_function_const_pattern');

export function lintLocalFunctionConstPattern(statement: LuaLocalFunctionStatement, issues: LuaLintIssue[], pushIssue: LuaLintIssuePusher): void {
	pushIssue(
		issues,
		localFunctionConstPatternRule.name,
		statement.name,
		`Local function "${statement.name.name}" is forbidden. Use "local ${statement.name.name}<const> = function(...) ... end" instead.`,
	);
}
