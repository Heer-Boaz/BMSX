import { valueBool, valueFromTag, valueNil, valuePayload, valueTag, ValueTag, type Value } from '../../machine/ts/machine/cpu/value';
import { evaluateNumberUnary } from '../../toolchain/ts/lua/number';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxKind, LuaTableFieldKind, LuaUnaryOperator, type LuaExpression } from '../../toolchain/ts/lua/syntax/ast';
import { formatLuaNumberConstant } from '../../toolchain/ts/lua/syntax/number_expression';
import { quoteLuaByteString } from '../../toolchain/ts/lua/syntax/string_literal';

export type PreparedLuaLiteral =
	| { readonly kind: 'scalar'; readonly value: Value }
	| { readonly kind: 'string'; readonly bytes: string }
	| { readonly kind: 'table'; readonly source: string };

/** User input only. Parsing performs no guest allocation or evaluation. */
export function prepareLuaLiteral(text: string): PreparedLuaLiteral {
	const expressions = literalExpressions(text);
	if (expressions.length !== 1) throw new Error('Enter one Lua literal.');
	return prepareLiteral(expressions[0]);
}

/** A method's argument list uses the same literal grammar. */
export function prepareLuaArguments(text: string): readonly PreparedLuaLiteral[] {
	return literalExpressions(text).map(prepareLiteral);
}

function literalExpressions(text: string): readonly LuaExpression[] {
	const chunk = parseLuaChunk(`return ${text}`, '=input').chunk!;
	if (chunk.body.length !== 1) throw new Error('Enter Lua literals, not statements.');
	const statement = chunk.body.get(0);
	if (statement.kind !== LuaSyntaxKind.ReturnStatement) {
		throw new Error('Enter Lua literals, not statements.');
	}
	return statement.expressions;
}

/** Re-emit guest bytes and Float words without applying host text or numeric coercion. */
export function luaLiteralSource(literal: PreparedLuaLiteral): string {
	switch (literal.kind) {
		case 'table': return literal.source;
		case 'string': return quoteLuaByteString(literal.bytes);
		case 'scalar': {
			const kind = valueTag(literal.value);
			if (kind === ValueTag.Nil) return 'nil';
			if (kind === ValueTag.False) return 'false';
			if (kind === ValueTag.True) return 'true';
			return formatLuaNumberConstant({ kind: kind === ValueTag.Integer ? 'integer' : 'float', word: valuePayload(literal.value) }, false);
		}
	}
}

function prepareLiteral(expression: LuaExpression): PreparedLuaLiteral {
	switch (expression.kind) {
		case LuaSyntaxKind.NilLiteralExpression: return { kind: 'scalar', value: valueNil() };
		case LuaSyntaxKind.NumericLiteralExpression: {
			const constant = expression.value;
			return { kind: 'scalar', value: valueFromTag(constant.kind === 'integer' ? ValueTag.Integer : ValueTag.Float, constant.word) };
		}
		case LuaSyntaxKind.BooleanLiteralExpression: return { kind: 'scalar', value: valueBool(expression.value) };
		case LuaSyntaxKind.StringLiteralExpression: return { kind: 'string', bytes: expression.value };
		case LuaSyntaxKind.UnaryExpression:
			if (expression.operator === LuaUnaryOperator.Negate && expression.operand.kind === LuaSyntaxKind.NumericLiteralExpression) {
				const constant = evaluateNumberUnary(expression.operator, expression.operand.value)!;
				return { kind: 'scalar', value: valueFromTag(constant.kind === 'integer' ? ValueTag.Integer : ValueTag.Float, constant.word) };
			}
			break;
		case LuaSyntaxKind.TableConstructorExpression: {
			const fields = expression.fields.map(field => {
				let key: string;
				switch (field.kind) {
					case LuaTableFieldKind.Array: key = ''; break;
					case LuaTableFieldKind.IdentifierKey: key = '[' + quoteLuaByteString(field.name) + ']='; break;
					case LuaTableFieldKind.ExpressionKey:
						if (field.key.kind === LuaSyntaxKind.NilLiteralExpression) throw new Error('A Lua table key cannot be nil.');
						key = '[' + luaLiteralSource(prepareLiteral(field.key)) + ']='; break;
				}
				return key + luaLiteralSource(prepareLiteral(field.value));
			});
			return { kind: 'table', source: '{' + fields.join(',') + '}' };
		}
	}
	throw new Error('Use nil, a boolean, number, string or table literal; expressions execute in the source editor.');
}
