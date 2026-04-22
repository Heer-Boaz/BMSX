import { type LuaExpression, LuaSyntaxKind, LuaTableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';

export function getExpressionSignature(expression: LuaExpression): string {
	switch (expression.kind) {
		case LuaSyntaxKind.NumericLiteralExpression:
			return `n:${String(expression.value)}`;
		case LuaSyntaxKind.StringLiteralExpression:
			return `s:${JSON.stringify(expression.value)}`;
		case LuaSyntaxKind.BooleanLiteralExpression:
			return expression.value ? 'b:1' : 'b:0';
		case LuaSyntaxKind.NilLiteralExpression:
			return 'nil';
		case LuaSyntaxKind.VarargExpression:
			return 'vararg';
		case LuaSyntaxKind.IdentifierExpression:
			return `id:${expression.name}`;
		case LuaSyntaxKind.MemberExpression:
			return `member:${getExpressionSignature(expression.base)}.${expression.identifier}`;
		case LuaSyntaxKind.IndexExpression:
			return `index:${getExpressionSignature(expression.base)}[${getExpressionSignature(expression.index)}]`;
		case LuaSyntaxKind.UnaryExpression:
			return `unary:${expression.operator}:${getExpressionSignature(expression.operand)}`;
			case LuaSyntaxKind.BinaryExpression:
				return `binary:${expression.operator}:${getExpressionSignature(expression.left)}:${getExpressionSignature(expression.right)}`;
			case LuaSyntaxKind.CallExpression: {
				const argumentSignatures = expression.arguments.map(getExpressionSignature);
				const callKind = expression.methodName === undefined ? 'call' : `method:${expression.methodName}`;
				return `${callKind}:${getExpressionSignature(expression.callee)}(${argumentSignatures.join(',')})`;
			}
		case LuaSyntaxKind.TableConstructorExpression: {
			const fieldSignatures = expression.fields.map(field => {
				if (field.kind === LuaTableFieldKind.Array) {
					return `a:${getExpressionSignature(field.value)}`;
				}
				if (field.kind === LuaTableFieldKind.IdentifierKey) {
					return `k:${field.name}:${getExpressionSignature(field.value)}`;
				}
				return `e:${getExpressionSignature(field.key)}:${getExpressionSignature(field.value)}`;
			});
			return `table:{${fieldSignatures.join('|')}}`;
		}
		case LuaSyntaxKind.FunctionExpression:
			return '';
		default:
			return '';
	}
}

export function getExpressionKeyName(expression: LuaExpression): string | undefined {
	if (expression.kind === LuaSyntaxKind.StringLiteralExpression) {
		return expression.value;
	}
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.name;
	}
	return undefined;
}
