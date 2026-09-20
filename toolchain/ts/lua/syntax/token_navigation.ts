import type { LuaSourceLocations } from './source_locations';
import type { LuaTokenSequence } from './token_sequence';
import type { LuaSourcePosition } from './ast';
import { isLuaTrivia, LuaTokenType } from './token';

/** First token whose start is strictly after the inclusive source position. */
export function findLuaTokenAfterPosition(locations: LuaSourceLocations, tokens: LuaTokenSequence, position: LuaSourcePosition): number {
	const offset = locations.offsetAt(position);
	const cursor = tokens.cursor();
	cursor.seekOffset(offset);
	return cursor.token === undefined ? tokens.length : cursor.index + (cursor.offset <= offset ? 1 : 0);
}

/** Full Moon attachment: trivia after the preceding token's first newline is leading. */
export function luaTokenLeadingTriviaStart(tokens: LuaTokenSequence, index: number): number {
	const cursor = tokens.cursor(index);
	while (cursor.retreat()) {
		if (!isLuaTrivia(cursor.token!.type)) {
			cursor.advance();
			break;
		}
	}
	if (cursor.index === 0) return 0; // File-leading trivia has no preceding owner.
	while (cursor.index < index) {
		const type = cursor.token!.type;
		cursor.advance();
		if (type === LuaTokenType.NewLineTrivia) break;
	}
	return cursor.index;
}

/** Exclusive end, including the first newline token, not newlines inside comments. */
export function luaTokenTrailingTriviaEnd(tokens: LuaTokenSequence, index: number): number {
	const cursor = tokens.cursor(index + 1);
	while (cursor.token !== undefined && isLuaTrivia(cursor.token.type)) {
		const type = cursor.token.type;
		cursor.advance();
		if (type === LuaTokenType.NewLineTrivia) break;
	}
	return cursor.index;
}
