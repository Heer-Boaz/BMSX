import {
	LuaSyntaxKind,
	type LuaAssignableExpression,
	type LuaExpression,
	type LuaIdentifierExpression,
	type LuaIndexExpression,
	type LuaMemberExpression,
	type LuaStringLiteralExpression,
} from '../../../lua/syntax/ast';

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
