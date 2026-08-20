import { defineLintRule } from '../../rule';
import { type LuaFunctionExpression as CartFunctionExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { matchesGetterPattern, matchesMetatableConstructorPattern, matchesSetterPattern } from './impl/support/functions';
import { pushIssue } from './impl/support/lint_context';

export const getterSetterPatternRule = defineLintRule('cart', 'getter_setter_pattern');

export function lintGetterSetterPattern(functionName: string, functionExpression: CartFunctionExpression, issues: CartLintIssue[]): boolean {
	if (
		functionName === '<anonymous>'
		|| matchesMetatableConstructorPattern(functionName, functionExpression)
		|| (!matchesGetterPattern(functionExpression) && !matchesSetterPattern(functionExpression))
	) {
		return false;
	}
	pushIssue(
		issues,
		getterSetterPatternRule.name,
		functionExpression,
		`Getter/setter wrapper pattern is forbidden ("${functionName}").`,
	);
	return true;
}
