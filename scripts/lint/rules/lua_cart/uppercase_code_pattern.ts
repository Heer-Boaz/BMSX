import { LuaTokenType, type LuaToken } from '../../../../src/bmsx/lua/syntax/token';
import type { LuaLintIssue, LuaLintLocationPusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';

export const uppercaseCodePatternRule = defineLintRule('lua_cart', 'uppercase_code_pattern');

export function lintUppercaseCode(path: string, tokens: ReadonlyArray<LuaToken>, issues: LuaLintIssue[], pushIssueAt: LuaLintLocationPusher): void {
	for (const token of tokens) {
		if (token.type === LuaTokenType.String || token.type === LuaTokenType.Eof) {
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
