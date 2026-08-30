import {
	LuaSyntaxKind,
	type LuaExpression,
} from '../syntax/ast';
import { isLuaIdentifier } from '../syntax/identifier';

export function resolveStaticLuaNamePath(namePath: readonly string[]): string | null {
	for (let index = 0; index < namePath.length; index += 1) {
		if (!isLuaIdentifier(namePath[index])) {
			return null;
		}
	}
	return namePath.join('.');
}

export function resolveStaticLuaExpressionPath(expression: LuaExpression): string | null {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.name;
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		const base = resolveStaticLuaExpressionPath(expression.base);
		return base === null ? null : `${base}.${expression.member.name}`;
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression
		&& expression.index.kind === LuaSyntaxKind.StringLiteralExpression) {
		const base = resolveStaticLuaExpressionPath(expression.base);
		const member = expression.index.value;
		return base === null || !isLuaIdentifier(member)
			? null
			: `${base}.${member}`;
	}
	return null;
}
