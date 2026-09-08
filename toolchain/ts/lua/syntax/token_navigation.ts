import type { LuaSourcePosition } from './ast';
import { isLuaTrivia, LuaTokenType, type LuaToken } from './token';

/** First token whose start is strictly after the inclusive source position. */
export function findLuaTokenAfterPosition(tokens: readonly LuaToken[], position: LuaSourcePosition): number {
	let low = 0;
	let high = tokens.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		const token = tokens[middle];
		if (token.line < position.line || (token.line === position.line && token.column <= position.column)) low = middle + 1;
		else high = middle;
	}
	return low;
}

/** Full Moon attachment: trivia after the preceding token's first newline is leading. */
export function luaTokenLeadingTriviaStart(tokens: readonly LuaToken[], index: number): number {
	let start = index;
	while (start > 0 && isLuaTrivia(tokens[start - 1].type)) start -= 1;
	if (start === 0) return start; // File-leading trivia has no preceding owner.
	while (start < index) {
		if (tokens[start++].type === LuaTokenType.NewLineTrivia) break;
	}
	return start;
}

/** Exclusive end, including the first newline token, not newlines inside comments. */
export function luaTokenTrailingTriviaEnd(tokens: readonly LuaToken[], index: number): number {
	let end = index + 1;
	while (isLuaTrivia(tokens[end].type)) {
		if (tokens[end++].type === LuaTokenType.NewLineTrivia) break;
	}
	return end;
}
