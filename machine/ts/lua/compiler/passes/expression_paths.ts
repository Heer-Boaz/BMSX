import {
	LuaSyntaxKind,
	LuaTableFieldKind,
	type LuaAssignableExpression,
	type LuaExpression,
	type LuaIdentifierExpression,
	type LuaIndexExpression,
	type LuaMemberExpression,
	type LuaStringLiteralExpression,
	type LuaTableConstructorExpression,
	type LuaTableExpressionField,
	type LuaTableIdentifierField,
} from '../../syntax/ast';

export const extractTableKeyFromExpression = (expression: LuaExpression): string | null => {
	switch (expression.kind) {
		case LuaSyntaxKind.StringLiteralExpression:
			return (expression as LuaStringLiteralExpression).value;
		case LuaSyntaxKind.IdentifierExpression:
			return (expression as LuaIdentifierExpression).name;
		default:
			return null;
	}
};

type NamedTableField = LuaTableIdentifierField | LuaTableExpressionField;

export const visitNamedTableFields = (
	table: LuaTableConstructorExpression,
	visit: (key: string, value: LuaExpression, field: NamedTableField) => void,
): void => {
	for (let index = 0; index < table.fields.length; index += 1) {
		const field = table.fields[index];
		if (field.kind === LuaTableFieldKind.Array) {
			continue;
		}
		const key = field.kind === LuaTableFieldKind.IdentifierKey
			? field.name
			: extractTableKeyFromExpression(field.key);
		if (!key) {
			continue;
		}
		visit(key, field.value, field);
	}
};

export const extractAssignmentPath = (expression: LuaAssignableExpression): string[] | null => {
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			return [(expression as LuaIdentifierExpression).name];
		case LuaSyntaxKind.MemberExpression: {
			const member = expression as LuaMemberExpression;
			const basePath = extractAssignmentPath(member.base as LuaAssignableExpression);
			if (!basePath) {
				return null;
			}
			basePath.push(member.identifier);
			return basePath;
		}
		case LuaSyntaxKind.IndexExpression: {
			const indexExpr = expression as LuaIndexExpression;
			const basePath = extractAssignmentPath(indexExpr.base as LuaAssignableExpression);
			if (!basePath) {
				return null;
			}
			const key = extractTableKeyFromExpression(indexExpr.index);
			if (!key) {
				return null;
			}
			basePath.push(key);
			return basePath;
		}
		default:
			return null;
	}
};
