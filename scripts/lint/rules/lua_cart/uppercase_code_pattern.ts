import { LuaTokenType as TokenType, type LuaToken as Token } from '../../../../src/bmsx/lua/syntax/token';
import type { CartLintIssue, CartLintLocationPusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';

export const uppercaseCodePatternRule = defineLintRule('cart', 'uppercase_code_pattern');

export function lintUppercaseCode(path: string, tokens: ReadonlyArray<Token>, issues: CartLintIssue[], pushIssueAt: CartLintLocationPusher): void {
	for (const token of tokens) {
		if (token.type === TokenType.String || token.type === TokenType.Eof) {
			continue;
		}
		const uppercaseIndex = firstUppercaseIndex(token.lexeme);
		if (uppercaseIndex === -1) {
			continue;
		}
		pushIssueAt(
			issues,
			uppercaseCodePatternRule.name,
			path,
			token.line,
			token.column + uppercaseIndex,
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
