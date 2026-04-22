import { defineLintRule } from '../../rule';
import { type LuaIfStatement as IfStatement } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { matchesImgIdNilFallbackPattern } from './impl/support/self_properties';
import { pushIssue } from './impl/support/lint_context';

export const imgidFallbackPatternRule = defineLintRule('cart', 'imgid_fallback_pattern');

export function lintImgIdFallbackPattern(statement: IfStatement, issues: CartLintIssue[]): void {
	if (!matchesImgIdNilFallbackPattern(statement)) {
		return;
	}
	pushIssue(
		issues,
		imgidFallbackPatternRule.name,
		statement,
		'imgid fallback initialization is forbidden. Remove nil checks for imgid defaults; use deterministic setup.',
	);
}
