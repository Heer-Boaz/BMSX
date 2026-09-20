import type { LuaTokenSequence } from './token_sequence';
import type { LuaSourceLocations } from './source_locations';
import {
	LuaSyntaxKind,
	LuaTableFieldKind,
	type LuaTableConstructorExpression,
	type LuaTableField,
} from './ast';
import { isLuaTrivia, LuaTokenType, type LuaToken } from './token';
import { findLuaTokenAfterPosition, luaTokenLeadingTriviaStart, luaTokenTrailingTriviaEnd } from './token_navigation';

/** Uses the parser-owned complete field end; never scans source for punctuation. */
export function findLuaTableFieldSeparator(locations: LuaSourceLocations, tokens: LuaTokenSequence, field: LuaTableField): LuaToken | null {
	const cursor = tokens.cursor(findLuaTokenAfterPosition(locations, tokens, locations.range(field.span).end));
	while (isLuaTrivia(cursor.token!.type)) cursor.advance();
	const next = cursor.token!;
	return next.type === LuaTokenType.Comma || next.type === LuaTokenType.Semicolon ? next : null;
}

/** Half-open field/separator pair with attached trivia, from a lossless token scan. */
export function getLuaTableFieldTriviaSpan(locations: LuaSourceLocations, tokens: LuaTokenSequence, field: LuaTableField): {
	startToken: LuaToken;
	endToken: LuaToken;
	separator: LuaToken | null;
} {
	const first = findLuaTokenAfterPosition(locations, tokens, locations.range(field.span).start) - 1;
	const after = findLuaTokenAfterPosition(locations, tokens, locations.range(field.span).end);
	const cursor = tokens.cursor(after);
	while (isLuaTrivia(cursor.token!.type)) cursor.advance();
	const next = cursor.index;
	const token = cursor.token!;
	const separator = token.type === LuaTokenType.Comma || token.type === LuaTokenType.Semicolon ? token : null;
	return {
		startToken: tokens.get(luaTokenLeadingTriviaStart(tokens, first)),
		endToken: tokens.get(luaTokenTrailingTriviaEnd(tokens, separator === null ? after - 1 : next)),
		separator,
	};
}

/** Resolves the Lua key of an identifier field or a static string-key field. */
export function staticLuaTableFieldName(field: LuaTableField): string | null {
	if (field.kind === LuaTableFieldKind.IdentifierKey) {
		return field.name;
	}
	if (field.kind === LuaTableFieldKind.ExpressionKey
		&& field.key.kind === LuaSyntaxKind.StringLiteralExpression) {
		return field.key.value;
	}
	return null;
}

/** Returns the last authored field because later duplicate Lua keys win. */
export function findNamedLuaTableField(
	table: LuaTableConstructorExpression,
	name: string,
): LuaTableField | null {
	for (let index = table.fields.length - 1; index >= 0; index -= 1) {
		const field = table.fields[index];
		if (staticLuaTableFieldName(field) === name) {
			return field;
		}
	}
	return null;
}
