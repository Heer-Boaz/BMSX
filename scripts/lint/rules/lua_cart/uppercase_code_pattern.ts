import type { LuaSourceLocations } from '../../../../toolchain/ts/lua/syntax/source_locations';
import type { LuaTokenSequence } from '../../../../toolchain/ts/lua/syntax/token_sequence';
import { LuaTokenType as TokenType, isLuaTrivia } from '../../../../toolchain/ts/lua/syntax/token';
import type { CartLintIssue, CartLintLocationPusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';

export const uppercaseCodePatternRule = defineLintRule('cart', 'uppercase_code_pattern');

export function lintUppercaseCode(locations: LuaSourceLocations, tokens: LuaTokenSequence, issues: CartLintIssue[], pushIssueAt: CartLintLocationPusher): void {
	const cursor = tokens.cursor();
	while (cursor.token !== undefined && isLuaTrivia(cursor.token.type)) cursor.advance();
	for (; cursor.token !== undefined; cursor.advanceSignificant()) {
		const token = cursor.token;
		if (token.type === TokenType.String || token.type === TokenType.Eof) {
			continue;
		}
		const uppercaseIndex = firstUppercaseIndex(token.lexeme);
		if (uppercaseIndex === -1) {
			continue;
		}
		const start = locations.range(token).start;
		pushIssueAt(
			issues,
			uppercaseCodePatternRule.name,
			locations.path,
			start.line,
			start.column + uppercaseIndex,
			'Upper-case code is forbidden outside strings/comments.',
		);
	}
}

function firstUppercaseIndex(text: string): number {
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (code >= 65 && code <= 90) {
			return index;
		}
	}
	return -1;
}
