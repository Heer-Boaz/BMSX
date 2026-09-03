import {
	LuaSyntaxKind,
	LuaUnaryOperator,
	type LuaExpression,
	type LuaNumericLiteralExpression,
	type LuaSourceRange,
} from '../../../toolchain/ts/lua/syntax/ast';
import type { EditorTextEdit } from '../../editor/model/text_model';
import type { TextBuffer } from '../../editor/text/text_buffer';

/**
 * Creates the minimal text edit for an existing positive or negative integer
 * literal. Other expressions remain source-owned and are not rewritten.
 */
export function createLuaIntegerLiteralEdit(
	buffer: TextBuffer,
	expression: LuaExpression,
	value: number,
): EditorTextEdit | null {
	let literal: LuaNumericLiteralExpression;
	let range: LuaSourceRange;
	if (expression.kind === LuaSyntaxKind.NumericLiteralExpression) {
		literal = expression;
		range = expression.range;
	} else if (expression.kind === LuaSyntaxKind.UnaryExpression
		&& expression.operator === LuaUnaryOperator.Negate
		&& expression.operand.kind === LuaSyntaxKind.NumericLiteralExpression) {
		literal = expression.operand;
		range = expression.range;
	} else {
		return null;
	}

	const literalStart = buffer.offsetAt(literal.range.start.line - 1, literal.range.start.column - 1);
	const literalEnd = buffer.offsetAt(literal.range.end.line - 1, literal.range.end.column);
	const literalSource = buffer.getTextRange(literalStart, literalEnd);
	const replacement = formatIntegerLiteral(value, literalSource);
	const start = buffer.offsetAt(range.start.line - 1, range.start.column - 1);
	const end = buffer.offsetAt(range.end.line - 1, range.end.column);
	return {
		offset: start,
		deleteLength: end - start,
		text: replacement,
	};
}

function formatIntegerLiteral(value: number, previous: string): string {
	const negative = value < 0;
	const magnitude = negative ? -value : value;
	const sign = negative ? '-' : '';
	const hexadecimal = /^0([xX])([0-9a-fA-F]+)$/.exec(previous);
	if (hexadecimal !== null) {
		const previousDigits = hexadecimal[2];
		let digits = magnitude.toString(16).padStart(previousDigits.length, '0');
		if (previousDigits === previousDigits.toUpperCase()) {
			digits = digits.toUpperCase();
		}
		return `${sign}0${hexadecimal[1]}${digits}`;
	}
	if (/^[0-9]+$/.test(previous)) {
		return sign + magnitude.toString(10).padStart(previous.length, '0');
	}
	return String(value);
}
