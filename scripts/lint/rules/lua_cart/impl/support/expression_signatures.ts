import { type LuaExpression as Expression, LuaSyntaxKind as SyntaxKind, LuaTableFieldKind as TableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';

export function getExpressionSignature(expression: Expression): string {
	switch (expression.kind) {
		case SyntaxKind.NumericLiteralExpression:
			return `n:${String(expression.value)}`;
		case SyntaxKind.StringLiteralExpression:
			return `s:${JSON.stringify(expression.value)}`;
		case SyntaxKind.BooleanLiteralExpression:
			return expression.value ? 'b:1' : 'b:0';
		case SyntaxKind.NilLiteralExpression:
			return 'nil';
		case SyntaxKind.VarargExpression:
			return 'vararg';
		case SyntaxKind.IdentifierExpression:
			return `id:${expression.name}`;
		case SyntaxKind.MemberExpression:
			return `member:${getExpressionSignature(expression.base)}.${expression.identifier}`;
		case SyntaxKind.IndexExpression:
			return `index:${getExpressionSignature(expression.base)}[${getExpressionSignature(expression.index)}]`;
		case SyntaxKind.UnaryExpression:
			return `unary:${expression.operator}:${getExpressionSignature(expression.operand)}`;
			case SyntaxKind.BinaryExpression:
				return `binary:${expression.operator}:${getExpressionSignature(expression.left)}:${getExpressionSignature(expression.right)}`;
			case SyntaxKind.CallExpression: {
				const argumentSignatures = expression.arguments.map(getExpressionSignature);
				const callKind = expression.methodName === undefined ? 'call' : `method:${expression.methodName}`;
				return `${callKind}:${getExpressionSignature(expression.callee)}(${argumentSignatures.join(',')})`;
			}
		case SyntaxKind.TableConstructorExpression: {
			const fieldSignatures = expression.fields.map(field => {
				if (field.kind === TableFieldKind.Array) {
					return `a:${getExpressionSignature(field.value)}`;
				}
				if (field.kind === TableFieldKind.IdentifierKey) {
					return `k:${field.name}:${getExpressionSignature(field.value)}`;
				}
				return `e:${getExpressionSignature(field.key)}:${getExpressionSignature(field.value)}`;
			});
			return `table:{${fieldSignatures.join('|')}}`;
		}
		case SyntaxKind.FunctionExpression:
			return '';
		default:
			return '';
	}
}

export function getExpressionKeyName(expression: Expression): string | undefined {
	if (expression.kind === SyntaxKind.StringLiteralExpression) {
		return expression.value;
	}
	if (expression.kind === SyntaxKind.IdentifierExpression) {
		return expression.name;
	}
	return undefined;
}
