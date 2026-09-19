import { defineLintRule } from '../../rule';
import { type LuaIfStatement as IfStatement } from '../../../../toolchain/ts/lua/syntax/ast';
import { type CartLintContext } from '../../lua_rule';
import { matchesImgIdNilFallbackPattern } from './impl/support/self_properties';
import { pushIssue } from './impl/support/lint_context';

export const imgidFallbackPatternRule = defineLintRule('cart', 'imgid_fallback_pattern');

export function lintImgIdFallbackPattern(statement: IfStatement, lint: CartLintContext): void {
	if (!matchesImgIdNilFallbackPattern(statement)) {
		return;
	}
	pushIssue(
		lint,
		imgidFallbackPatternRule.name,
		statement,
		'imgid fallback initialization is forbidden. Remove nil checks for imgid defaults; use deterministic setup.',
	);
}
