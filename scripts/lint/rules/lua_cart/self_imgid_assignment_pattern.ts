import { defineLintRule } from '../../rule';
import { type LuaExpression as Expression, LuaSyntaxKind as SyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { isSelfImageIdAssignmentTarget, isSpriteComponentImageIdAssignmentTarget } from './impl/support/self_properties';
import { pushIssue } from './impl/support/lint_context';

export const selfImgidAssignmentPatternRule = defineLintRule('cart', 'self_imgid_assignment_pattern');

export function lintSelfImgIdAssignmentPattern(target: Expression, value: Expression | undefined, issues: CartLintIssue[]): void {
	if (!isSelfImageIdAssignmentTarget(target) || !value) {
		return;
	}
	if (isSpriteComponentImageIdAssignmentTarget(target)) {
		return;
	}
	if (value.kind !== SyntaxKind.StringLiteralExpression && value.kind !== SyntaxKind.NilLiteralExpression) {
		return;
	}
	if (value.kind === SyntaxKind.StringLiteralExpression && value.value) {
		return;
	}
	pushIssue(
		issues,
		selfImgidAssignmentPatternRule.name,
		target,
		'Forbidden self.*imgid assignment variant. Use self.visible=false / self.<non_standard_sprite_component>.enabled=false instead of setting imgid to empty string or nil.',
	);
}
