import {
	LuaSyntaxKind,
	LuaTableFieldKind,
	type LuaExpression,
	type LuaBinaryExpression,
	type LuaCallExpression,
	type LuaFunctionExpression,
	type LuaIndexExpression,
	type LuaMemberExpression,
	type LuaTableConstructorExpression,
	type LuaUnaryExpression,
} from './lua_ast';

function unreachableExpression(expression: never): never {
	throw new Error(`[LuaAstTraversal] Unhandled expression kind: ${String((expression as LuaExpression).kind)}`);
}

function unreachableTableFieldKind(value: never): never {
	throw new Error(`[LuaAstTraversal] Unhandled table field kind: ${String(value)}`);
}

export function walkLuaExpressionTree(
	expression: LuaExpression,
	visit: (expression: LuaExpression) => void | false,
): void {
	if (visit(expression) === false) {
		return;
	}
	visitLuaExpressionChildren(expression, (child) => {
		walkLuaExpressionTree(child, visit);
	});
}

export function visitLuaExpressionChildren(
	expression: LuaExpression,
	visit: (expression: LuaExpression) => void,
): void {
	switch (expression.kind) {
		case LuaSyntaxKind.BinaryExpression: {
			const binary = expression as LuaBinaryExpression;
			visit(binary.left);
			visit(binary.right);
			return;
		}
		case LuaSyntaxKind.UnaryExpression:
			visit((expression as LuaUnaryExpression).operand);
			return;
		case LuaSyntaxKind.CallExpression: {
			const call = expression as LuaCallExpression;
			visit(call.callee);
			for (let index = 0; index < call.arguments.length; index += 1) {
				visit(call.arguments[index]);
			}
			return;
		}
		case LuaSyntaxKind.MemberExpression:
			visit((expression as LuaMemberExpression).base);
			return;
		case LuaSyntaxKind.IndexExpression: {
			const indexExpression = expression as LuaIndexExpression;
			visit(indexExpression.base);
			visit(indexExpression.index);
			return;
		}
		case LuaSyntaxKind.TableConstructorExpression: {
			const table = expression as LuaTableConstructorExpression;
			for (let index = 0; index < table.fields.length; index += 1) {
				const field = table.fields[index];
				switch (field.kind) {
					case LuaTableFieldKind.Array:
					case LuaTableFieldKind.IdentifierKey:
						visit(field.value);
						break;
					case LuaTableFieldKind.ExpressionKey:
						visit(field.key);
						visit(field.value);
						break;
					default:
						unreachableTableFieldKind(field.kind);
				}
			}
			return;
		}
		case LuaSyntaxKind.FunctionExpression:
		case LuaSyntaxKind.NumericLiteralExpression:
		case LuaSyntaxKind.StringLiteralExpression:
		case LuaSyntaxKind.StringRefLiteralExpression:
		case LuaSyntaxKind.BooleanLiteralExpression:
		case LuaSyntaxKind.NilLiteralExpression:
		case LuaSyntaxKind.VarargExpression:
		case LuaSyntaxKind.IdentifierExpression:
			return;
		default:
			unreachableExpression(expression);
	}
}
