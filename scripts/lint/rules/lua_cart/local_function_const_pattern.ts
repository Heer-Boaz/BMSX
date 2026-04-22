import { type LuaLocalFunctionStatement, type LuaStatement, LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import type { LuaLintIssue, LuaLintIssuePusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';

export const localFunctionConstPatternRule = defineLintRule('lua_cart', 'local_function_const_pattern');

export function lintLocalFunctionConstPattern(statement: LuaStatement, issues: LuaLintIssue[], pushIssue: LuaLintIssuePusher): void {
	if (statement.kind !== LuaSyntaxKind.LocalFunctionStatement) {
		return;
	}
	const localFunction = statement as LuaLocalFunctionStatement;
	pushIssue(
		issues,
		localFunctionConstPatternRule.name,
		localFunction.name,
		`Local function "${localFunction.name.name}" is forbidden. Use "local ${localFunction.name.name}<const> = function(...) ... end" instead.`,
	);
}
