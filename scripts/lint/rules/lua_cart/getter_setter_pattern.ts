import { defineLintRule } from '../../rule';
import { type LuaFunctionExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { matchesGetterPattern, matchesSetterPattern } from './impl/support/functions';
import { pushIssue } from './impl/support/lint_context';

export const getterSetterPatternRule = defineLintRule('lua_cart', 'getter_setter_pattern');

export function lintGetterSetterPattern(functionName: string, functionExpression: LuaFunctionExpression, issues: LuaLintIssue[]): boolean {
	if (functionName === '<anonymous>' || (!matchesGetterPattern(functionExpression) && !matchesSetterPattern(functionExpression))) {
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
