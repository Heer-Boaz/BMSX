import { defineLintRule } from '../../rule';
import { type LuaExpression, LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { isSelfImageIdAssignmentTarget, isSpriteComponentImageIdAssignmentTarget } from './impl/support/self_properties';
import { pushIssue } from './impl/support/lint_context';

export const selfImgidAssignmentPatternRule = defineLintRule('lua_cart', 'self_imgid_assignment_pattern');

export function lintSelfImgIdAssignmentPattern(target: LuaExpression, value: LuaExpression | undefined, issues: LuaLintIssue[]): void {
	if (!isSelfImageIdAssignmentTarget(target) || !value) {
		return;
	}
	if (isSpriteComponentImageIdAssignmentTarget(target)) {
		return;
	}
	if (value.kind !== LuaSyntaxKind.StringLiteralExpression && value.kind !== LuaSyntaxKind.NilLiteralExpression) {
		return;
	}
	if (value.kind === LuaSyntaxKind.StringLiteralExpression && value.value) {
		return;
	}
	pushIssue(
		issues,
		selfImgidAssignmentPatternRule.name,
		target,
		'Forbidden self.*imgid assignment variant. Use self.visible=false / self.<non_standard_sprite_component>.enabled=false instead of setting imgid to empty string or nil.',
	);
}
