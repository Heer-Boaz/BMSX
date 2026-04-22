import { defineLintRule } from '../../rule';
import { type LuaFunctionExpression as CartFunctionExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { matchesHandlerIdentityDispatchPattern } from './impl/support/general';
import { pushIssue } from './impl/support/lint_context';

export const handlerIdentityDispatchPatternRule = defineLintRule('cart', 'handler_identity_dispatch_pattern');

export function lintHandlerIdentityDispatchPattern(functionName: string, functionExpression: CartFunctionExpression, issues: CartLintIssue[]): void {
	if (functionName === '<anonymous>' || !matchesHandlerIdentityDispatchPattern(functionExpression)) {
		return;
	}
	pushIssue(
		issues,
		handlerIdentityDispatchPatternRule.name,
		functionExpression,
		`Handler-identity dispatch branching with mixed call signatures is forbidden ("${functionName}"). Use uniform handler signatures and direct dispatch without a cached handler local.`,
	);
}
