import { type LuaLocalFunctionStatement as LocalFunctionStatement, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind } from '../../../../toolchain/ts/lua/syntax/ast';
import type { CartLintContext, CartLintIssuePusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';

export const localFunctionConstPatternRule = defineLintRule('cart', 'local_function_const_pattern');

export function lintLocalFunctionConstPattern(statement: Statement, lint: CartLintContext, pushIssue: CartLintIssuePusher): void {
	if (statement.kind !== SyntaxKind.LocalFunctionStatement) {
		return;
	}
	const localFunction = statement as LocalFunctionStatement;
	if (localFunction.attribute === 'init') {
		return;
	}
	pushIssue(
		lint,
		localFunctionConstPatternRule.name,
		localFunction.name,
		`Local function "${localFunction.name.name}" is forbidden. Use "local ${localFunction.name.name}<const> = function(...) ... end" instead.`,
	);
}
