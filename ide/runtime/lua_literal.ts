import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { valueBool, valueFromTag, valueInteger, valueNil, valueString, valueTable, ValueTag, type Value } from '../../machine/ts/machine/cpu/value';
import { evaluateNumberUnary } from '../../toolchain/ts/lua/number';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxKind, LuaTableFieldKind, LuaUnaryOperator, type LuaExpression } from '../../toolchain/ts/lua/syntax/ast';

export type PreparedLuaLiteral = (cpu: CPU) => Value;

/** User input only. Parsing performs no guest allocation or evaluation. */
export function prepareLuaLiteral(text: string): PreparedLuaLiteral {
	const expressions = literalExpressions(text);
	if (expressions.length !== 1) throw new Error('Enter one Lua literal.');
	return prepareLiteral(expressions[0]);
}

/** A method's argument list uses the same Lua grammar and guest materialization. */
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

function prepareLiteral(expression: LuaExpression): PreparedLuaLiteral {
	switch (expression.kind) {
		case LuaSyntaxKind.NilLiteralExpression: return valueNil;
		case LuaSyntaxKind.NumericLiteralExpression: {
			const constant = expression.value;
			const value = valueFromTag(constant.kind === 'integer' ? ValueTag.Integer : ValueTag.Float, constant.word);
			return () => value;
		}
		case LuaSyntaxKind.BooleanLiteralExpression: {
			const value = valueBool(expression.value);
			return () => value;
		}
		case LuaSyntaxKind.StringLiteralExpression: return cpu => valueString(cpu.stringPool.intern(expression.value));
		case LuaSyntaxKind.UnaryExpression:
			if (expression.operator === LuaUnaryOperator.Negate && expression.operand.kind === LuaSyntaxKind.NumericLiteralExpression) {
				const constant = evaluateNumberUnary(expression.operator, expression.operand.value)!;
				const value = valueFromTag(constant.kind === 'integer' ? ValueTag.Integer : ValueTag.Float, constant.word);
				return () => value;
			}
			break;
		case LuaSyntaxKind.TableConstructorExpression: {
			let arrayIndex = 0;
			const fields = expression.fields.map(field => {
				let key: PreparedLuaLiteral;
				switch (field.kind) {
					case LuaTableFieldKind.Array: {
						const index = valueInteger(++arrayIndex);
						key = () => index;
						break;
					}
					case LuaTableFieldKind.IdentifierKey: key = cpu => valueString(cpu.stringPool.intern(field.name)); break;
					case LuaTableFieldKind.ExpressionKey:
						if (field.key.kind === LuaSyntaxKind.NilLiteralExpression) throw new Error('A Lua table key cannot be nil.');
						key = prepareLiteral(field.key);
						break;
				}
				return { key, value: prepareLiteral(field.value) };
			});
			return cpu => {
				const table = cpu.createTable(arrayIndex, fields.length - arrayIndex);
				for (const field of fields) table.records.set(table.address, field.key(cpu), field.value(cpu));
				return valueTable(cpu.gc.reference(table));
			};
		}
	}
	throw new Error('Use nil, a boolean, number, string or table literal; expressions execute in the source editor.');
}
