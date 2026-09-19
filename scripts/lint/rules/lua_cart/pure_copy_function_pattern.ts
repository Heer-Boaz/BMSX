import { defineLintRule } from '../../rule';
import { type LuaFunctionExpression as CartFunctionExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import { type CartLintContext } from '../../lua_rule';
import { matchesPureCopyFunctionPattern } from './impl/support/functions';
import { pushIssue } from './impl/support/lint_context';

export const pureCopyFunctionPatternRule = defineLintRule('cart', 'pure_copy_function_pattern');

export function lintPureCopyFunctionPattern(functionName: string, functionExpression: CartFunctionExpression, lint: CartLintContext): void {
	if (functionName === '<anonymous>' || !matchesPureCopyFunctionPattern(functionExpression)) {
		return;
	}
	pushIssue(
		lint,
		pureCopyFunctionPatternRule.name,
		functionExpression,
		`Defensive pure-copy function is forbidden ("${functionName}"). Do not replace it with workaround wrappers/helpers; use original source values directly.`,
	);
}
