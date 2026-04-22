import { type LuaLocalFunctionStatement as LocalFunctionStatement, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import type { CartLintIssue, CartLintIssuePusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';

export const localFunctionConstPatternRule = defineLintRule('cart', 'local_function_const_pattern');

export function lintLocalFunctionConstPattern(statement: Statement, issues: CartLintIssue[], pushIssue: CartLintIssuePusher): void {
	if (statement.kind !== SyntaxKind.LocalFunctionStatement) {
		return;
	}
	const localFunction = statement as LocalFunctionStatement;
	pushIssue(
		issues,
		localFunctionConstPatternRule.name,
		localFunction.name,
		`Local function "${localFunction.name.name}" is forbidden. Use "local ${localFunction.name.name}<const> = function(...) ... end" instead.`,
	);
}
