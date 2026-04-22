import { defineLintRule } from '../../rule';
import { type LuaExpression, LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { getRootIdentifier } from './impl/support/bindings';
import { isSelfExpressionRoot, isSpriteComponentImageIdAssignmentTarget } from './impl/support/self_properties';
import { pushIssue } from './impl/support/lint_context';

export const imgidAssignmentPatternRule = defineLintRule('lua_cart', 'imgid_assignment_pattern');

export function lintSpriteImgIdAssignmentPattern(target: LuaExpression, issues: LuaLintIssue[]): void {
	if (!isSpriteComponentImageIdAssignmentTarget(target)) {
		return;
	}
	let targetExpr = '';
	let isSelfTarget = false;
	if (target.kind === LuaSyntaxKind.MemberExpression) {
		isSelfTarget = isSelfExpressionRoot(target.base);
		targetExpr = `${isSelfTarget ? 'self' : getRootIdentifier(target.base)}`;
	} else if (target.kind === LuaSyntaxKind.IndexExpression) {
		const root = getRootIdentifier(target.base);
		isSelfTarget = root === 'self';
		targetExpr = isSelfTarget ? 'self' : root;
	}
	const replacementBase = targetExpr || 'sprite_component';
	const message = isSelfTarget
		? 'Direct imgid assignment on sprite component is forbidden. Use self.gfx(<img>) instead.'
		: 'Direct imgid assignment on sprite component is forbidden. Use self.gfx(<img>) or <sprite_component>.gfx(<img>) instead.';
	pushIssue(
		issues,
		imgidAssignmentPatternRule.name,
		target,
		`${message.replace('<sprite_component>', replacementBase)}`,
	);
}
