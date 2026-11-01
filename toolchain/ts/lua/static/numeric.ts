import { LuaBinaryOperator, LuaSyntaxKind, LuaUnaryOperator, type LuaExpression, type LuaIdentifierExpression,
	type LuaIndexExpression, type LuaMemberExpression, type LuaOffsetOfExpression, type LuaSizeOfExpression } from '../syntax/ast';
import { evaluateStaticNumberBinaryOperator } from './scalar';

export type StaticNumericValue<Link extends { readonly kind: 'link_value' }> = { kind: 'number'; value: number } | Link;

/** One numeric expression grammar; each owner supplies its own bindings and symbolic link operations. */
export interface StaticNumericContext<Scope, Link extends { readonly kind: 'link_value' }> {
	resolveNumeric(scope: Scope, expression: LuaIdentifierExpression | LuaMemberExpression | LuaIndexExpression): StaticNumericValue<Link> | undefined;
	numericLength(scope: Scope, expression: LuaExpression): number | undefined;
	numericSize(scope: Scope, expression: LuaSizeOfExpression): number;
	numericOffset(scope: Scope, expression: LuaOffsetOfExpression): number;
	numericLinkUnary(operator: LuaUnaryOperator.Negate | LuaUnaryOperator.BitwiseNot, operand: Link): Link | undefined;
	numericLinkBinary(operator: LuaBinaryOperator, link: Link, other: StaticNumericValue<Link>, linkOnLeft: boolean): Link | undefined;
}

export function evaluateStaticNumeric<Scope, Link extends { readonly kind: 'link_value' }>(context: StaticNumericContext<Scope, Link>,
	scope: Scope, expression: LuaExpression): StaticNumericValue<Link> | undefined {
	switch (expression.kind) {
		case LuaSyntaxKind.NumericLiteralExpression: return { kind: 'number', value: expression.value };
		case LuaSyntaxKind.IdentifierExpression:
		case LuaSyntaxKind.MemberExpression:
		case LuaSyntaxKind.IndexExpression: return context.resolveNumeric(scope, expression);
		case LuaSyntaxKind.SizeOfExpression: return { kind: 'number', value: context.numericSize(scope, expression) };
		case LuaSyntaxKind.OffsetOfExpression: return { kind: 'number', value: context.numericOffset(scope, expression) };
		case LuaSyntaxKind.UnaryExpression: {
			if (expression.operator === LuaUnaryOperator.Length) {
				const value = context.numericLength(scope, expression.operand);
				return value === undefined ? undefined : { kind: 'number', value };
			}
			if (expression.operator !== LuaUnaryOperator.Negate && expression.operator !== LuaUnaryOperator.BitwiseNot) return;
			const operand = evaluateStaticNumeric(context, scope, expression.operand);
			if (operand === undefined) return;
			return operand.kind === 'number'
				? { kind: 'number', value: expression.operator === LuaUnaryOperator.Negate ? -operand.value : ~operand.value }
				: context.numericLinkUnary(expression.operator, operand);
		}
		case LuaSyntaxKind.BinaryExpression: {
			const left = evaluateStaticNumeric(context, scope, expression.left);
			const right = evaluateStaticNumeric(context, scope, expression.right);
			if (left === undefined || right === undefined) return;
			if (left.kind === 'number') {
				if (right.kind === 'number') {
					const value = evaluateStaticNumberBinaryOperator(expression.operator, left.value, right.value);
					return value === undefined ? undefined : { kind: 'number', value };
				}
				return context.numericLinkBinary(expression.operator, right, left, false);
			}
			return context.numericLinkBinary(expression.operator, left, right, true);
		}
	}
}
