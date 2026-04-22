import { defineLintRule } from '../../rule';
import { type LuaIfStatement } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { matchesImgIdNilFallbackPattern } from './impl/support/self_properties';
import { pushIssue } from './impl/support/lint_context';

export const imgidFallbackPatternRule = defineLintRule('lua_cart', 'imgid_fallback_pattern');

export function lintImgIdFallbackPattern(statement: LuaIfStatement, issues: LuaLintIssue[]): void {
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
