import {
	LuaSyntaxKind,
	LuaUnaryOperator,
	type LuaNumericLiteralExpression,
	type LuaTableField,
} from '../../../toolchain/ts/lua/syntax/ast';
import type { EditorTextEdit } from '../../editor/model/text_model';
import type { TextBuffer } from '../../editor/text/text_buffer';

/**
 * Replaces a complete table-field value consisting of a numeric literal or
 * its unary negation. Only the numeric and sign tokens change; intervening
 * parentheses, comments and whitespace remain in the canonical document.
 *
 * The field is the syntax boundary: replacing an arbitrary literal subtree
 * with a negative expression could change its parent's operator binding.
 */
export function createLuaTableFieldIntegerEdits(
	buffer: TextBuffer,
	field: LuaTableField,
	value: number,
): EditorTextEdit[] | null {
	const expression = field.value;
	let literal: LuaNumericLiteralExpression;
	if (expression.kind === LuaSyntaxKind.NumericLiteralExpression) {
		literal = expression;
	} else if (expression.kind === LuaSyntaxKind.UnaryExpression
		&& expression.operator === LuaUnaryOperator.Negate
		&& expression.operand.kind === LuaSyntaxKind.NumericLiteralExpression) {
		literal = expression.operand;
	} else {
		return null;
	}
	const previousValue = expression.kind === LuaSyntaxKind.UnaryExpression ? -literal.value : literal.value;
	if (value === previousValue) {
		return [];
	}

	const literalStart = buffer.offsetAt(literal.range.start.line - 1, literal.range.start.column - 1);
	const literalEnd = buffer.offsetAt(literal.range.end.line - 1, literal.range.end.column);
	const literalSource = buffer.getTextRange(literalStart, literalEnd);
	const negative = value < 0;
	const magnitude = negative ? -value : value;
	const digits = formatIntegerLiteral(magnitude, literalSource);
	const edits: EditorTextEdit[] = [];
	let replacement = digits;
	if (expression.kind === LuaSyntaxKind.UnaryExpression) {
		if (!negative) {
			edits.push({
				offset: buffer.offsetAt(expression.range.start.line - 1, expression.range.start.column - 1),
				deleteLength: 1,
				text: '',
			});
		}
	} else if (negative) {
		replacement = '-' + digits;
	}
	if (replacement !== literalSource) {
		edits.push({
			offset: literalStart,
			deleteLength: literalEnd - literalStart,
			text: replacement,
		});
	}
	return edits;
}

function formatIntegerLiteral(value: number, previous: string): string {
	const hexadecimal = /^0([xX])([0-9a-fA-F]+)$/.exec(previous);
	if (hexadecimal !== null) {
		const previousDigits = hexadecimal[2];
		let digits = value.toString(16).padStart(previousDigits.length, '0');
		if (previousDigits === previousDigits.toUpperCase()) {
			digits = digits.toUpperCase();
		}
		return `0${hexadecimal[1]}${digits}`;
	}
	if (/^[0-9]+$/.test(previous)) {
		return value.toString(10).padStart(previous.length, '0');
	}
	return String(value);
}
