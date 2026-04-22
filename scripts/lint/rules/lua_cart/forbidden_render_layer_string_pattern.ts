import { LuaSyntaxKind as SyntaxKind, LuaTableFieldKind as TableFieldKind, type LuaTableField as TableField } from '../../../../src/bmsx/lua/syntax/ast';
import type { CartLintIssue, CartLintIssuePusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';

export const forbiddenRenderLayerStringPatternRule = defineLintRule('cart', 'forbidden_render_layer_string_pattern');

const FORBIDDEN_RENDER_LAYER_STRINGS = new Set<string>([
	'world',
	'ui',
	'ide',
]);

export function lintForbiddenRenderLayerString(field: TableField, issues: CartLintIssue[], pushIssue: CartLintIssuePusher): void {
	if (field.kind !== TableFieldKind.IdentifierKey || field.name !== 'layer') {
		return;
	}
	if (field.value.kind !== SyntaxKind.StringLiteralExpression) {
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
