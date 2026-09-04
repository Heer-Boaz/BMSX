import {
	LuaSyntaxKind,
	LuaTableFieldKind,
	type LuaTableConstructorExpression,
	type LuaTableField,
} from './ast';

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
