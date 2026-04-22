import { LuaSyntaxKind, type LuaCallExpression } from '../../../../src/bmsx/lua/syntax/ast';
import type { LuaLintIssue, LuaLintIssuePusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';
import {
	forbiddenRenderModuleRequireMessage,
	forbiddenRenderModuleRequirePatternRule,
	isForbiddenRenderModuleRequire,
} from './forbidden_render_module_require_pattern';

export const requireLuaExtensionPatternRule = defineLintRule('lua_cart', 'require_lua_extension_pattern');

export function lintRequireCall(expression: LuaCallExpression, issues: LuaLintIssue[], pushIssue: LuaLintIssuePusher): void {
	if (expression.callee.kind !== LuaSyntaxKind.IdentifierExpression || expression.callee.name !== 'require') {
		return;
	}
	if (expression.arguments.length === 0) {
		return;
	}
	const firstArgument = expression.arguments[0];
	if (firstArgument.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return;
	}
	if (isForbiddenRenderModuleRequire(firstArgument.value)) {
		pushIssue(
			issues,
			forbiddenRenderModuleRequirePatternRule.name,
			firstArgument,
			forbiddenRenderModuleRequireMessage(firstArgument.value),
		);
		return;
	}
	if (!firstArgument.value.toLowerCase().endsWith('.lua')) {
		return;
	}
	pushIssue(
		issues,
		requireLuaExtensionPatternRule.name,
		firstArgument,
		`require() must not include a ".lua" suffix ("${firstArgument.value}").`,
	);
}
