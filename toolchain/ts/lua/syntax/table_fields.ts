import {
	LuaSyntaxKind,
	LuaTableFieldKind,
	type LuaTableConstructorExpression,
	type LuaTableField,
} from './ast';
import { LuaTokenType, type LuaToken } from './token';

/** Uses the parser-owned complete field end; never scans source for punctuation. */
export function findLuaTableFieldSeparator(tokens: readonly LuaToken[], field: LuaTableField): LuaToken | null {
	const end = field.range.end;
	let low = 0;
	let high = tokens.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		const token = tokens[middle];
		if (token.line < end.line || (token.line === end.line && token.column <= end.column)) low = middle + 1;
		else high = middle;
	}
	const next = tokens[low];
	return next.type === LuaTokenType.Comma || next.type === LuaTokenType.Semicolon ? next : null;
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
