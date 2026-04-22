import { LuaSyntaxKind as SyntaxKind, type LuaCallExpression as CallExpression } from '../../../../src/bmsx/lua/syntax/ast';
import type { CartLintIssue, CartLintIssuePusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';

export const forbiddenRenderWrapperCallPatternRule = defineLintRule('cart', 'forbidden_render_wrapper_call_pattern');

const FORBIDDEN_RENDER_WRAPPER_CALLS = new Set<string>([
	'cls',
	'blit_rect',
	'fill_rect',
	'fill_rect_color',
	'blit_poly',
	'blit_glyphs',
	'blit_text',
	'blit_text_color',
	'blit_text_with_font',
	'blit_text_inline_with_font',
	'blit_text_inline_span_with_font',
]);

export function lintForbiddenRenderWrapperCall(expression: CallExpression, issues: CartLintIssue[], pushIssue: CartLintIssuePusher): void {
	if (expression.callee.kind !== SyntaxKind.IdentifierExpression) {
		return;
	}
	const calleeName = expression.callee.name;
	if (!FORBIDDEN_RENDER_WRAPPER_CALLS.has(calleeName)) {
		return;
	}
	pushIssue(
		issues,
		forbiddenRenderWrapperCallPatternRule.name,
		expression.callee,
		`Legacy render wrapper "${calleeName}" is forbidden. Submit VDP work through MMIO registers instead of Lua draw-wrapper calls.`,
	);
}
