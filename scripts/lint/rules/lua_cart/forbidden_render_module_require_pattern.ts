import { defineLintRule } from '../../rule';
import { type LuaStringLiteralExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue, type LuaLintIssuePusher } from '../../lua_rule';

export const forbiddenRenderModuleRequirePatternRule = defineLintRule('lua_cart', 'forbidden_render_module_require_pattern');

const FORBIDDEN_RENDER_MODULE_REQUIRES = new Set<string>([
	'vdp_firmware',
	'textflow',
]);

export function isForbiddenRenderModuleRequire(value: string): boolean {
	return FORBIDDEN_RENDER_MODULE_REQUIRES.has(value);
}

export function lintForbiddenRenderModuleRequirePattern(expression: LuaStringLiteralExpression, issues: LuaLintIssue[], pushIssue: LuaLintIssuePusher): boolean {
	if (!isForbiddenRenderModuleRequire(expression.value)) {
		return false;
	}
	pushIssue(
		issues,
		forbiddenRenderModuleRequirePatternRule.name,
		expression,
		`require('${expression.value}') is forbidden. The legacy Lua render wrapper modules are removed; submit VDP work through MMIO registers instead.`,
	);
	return true;
}
