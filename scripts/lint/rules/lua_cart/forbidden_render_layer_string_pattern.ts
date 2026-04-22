import { LuaSyntaxKind, LuaTableFieldKind, type LuaTableField } from '../../../../src/bmsx/lua/syntax/ast';
import type { LuaLintIssue, LuaLintIssuePusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';

export const forbiddenRenderLayerStringPatternRule = defineLintRule('lua_cart', 'forbidden_render_layer_string_pattern');

const FORBIDDEN_RENDER_LAYER_STRINGS = new Set<string>([
	'world',
	'ui',
	'ide',
]);

export function lintForbiddenRenderLayerString(field: LuaTableField, issues: LuaLintIssue[], pushIssue: LuaLintIssuePusher): void {
	if (field.kind !== LuaTableFieldKind.IdentifierKey || field.name !== 'layer') {
		return;
	}
	if (field.value.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return;
	}
	if (!FORBIDDEN_RENDER_LAYER_STRINGS.has(field.value.value)) {
		return;
	}
	pushIssue(
		issues,
		forbiddenRenderLayerStringPatternRule.name,
		field.value,
		`Render layer "${field.value.value}" is forbidden here. Use the sys_vdp_layer_* enum constants instead of Lua strings.`,
	);
}
