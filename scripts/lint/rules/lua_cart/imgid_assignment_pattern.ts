import { defineLintRule } from '../../rule';
import { type LuaExpression as Expression, LuaSyntaxKind as SyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { getRootIdentifier } from './impl/support/bindings';
import { isSelfExpressionRoot, isSpriteComponentImageIdAssignmentTarget } from './impl/support/self_properties';
import { pushIssue } from './impl/support/lint_context';

export const imgidAssignmentPatternRule = defineLintRule('cart', 'imgid_assignment_pattern');

export function lintSpriteImgIdAssignmentPattern(target: Expression, issues: CartLintIssue[]): void {
	if (!isSpriteComponentImageIdAssignmentTarget(target)) {
		return;
	}
	let targetExpr = '';
	let isSelfTarget = false;
	if (target.kind === SyntaxKind.MemberExpression) {
		isSelfTarget = isSelfExpressionRoot(target.base);
		targetExpr = `${isSelfTarget ? 'self' : getRootIdentifier(target.base)}`;
	} else if (target.kind === SyntaxKind.IndexExpression) {
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
