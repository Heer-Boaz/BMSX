import {
	LuaSyntaxKind,
	LuaUnaryOperator,
	type LuaNumericLiteralExpression,
	type LuaSourcePosition,
	type LuaSourceRange,
	type LuaTableField,
} from '../../../toolchain/ts/lua/syntax/ast';
import { findLuaTableFieldSeparator } from '../../../toolchain/ts/lua/syntax/table_fields';
import type { LuaToken } from '../../../toolchain/ts/lua/syntax/token';
import type { EditorTextEdit } from '../../editor/model/text_model';
import type { TextBuffer } from '../../editor/text/text_buffer';
import type { TrackedTextRange } from '../../editor/text/text_change';

/** Lua ranges are one-based and inclusive; text markers are half-open UTF-16 offsets. */
export function luaSourceRangeToTextRange(buffer: TextBuffer, range: LuaSourceRange): TrackedTextRange {
	return {
		start: buffer.offsetAt(range.start.line - 1, range.start.column - 1),
		end: buffer.offsetAt(range.end.line - 1, range.end.column),
	};
}

/** Compare current syntax with an edit-mapped marker without allocating another span. */
export function luaSourceRangeMatchesTextRange(buffer: TextBuffer, range: LuaSourceRange, tracked: TrackedTextRange): boolean {
	return tracked.start !== tracked.end && buffer.offsetAt(range.start.line - 1, range.start.column - 1) === tracked.start
		&& buffer.offsetAt(range.end.line - 1, range.end.column) === tracked.end;
}

/** Character-affine syntax anchor (CodeMirror TrackAfter), using the same edit mapper. */
export function luaSourcePositionToTextRange(buffer: TextBuffer, position: LuaSourcePosition): TrackedTextRange {
	const start = buffer.offsetAt(position.line - 1, position.column - 1);
	return { start, end: start + 1 };
}

export function luaSourcePositionMatchesTextRange(buffer: TextBuffer, position: LuaSourcePosition, tracked: TrackedTextRange): boolean {
	return tracked.start !== tracked.end && buffer.offsetAt(position.line - 1, position.column - 1) === tracked.start;
}

/**
 * Removes a field and its following separator, retaining all exterior trivia.
 * The field and tokens belong to a complete parse of the current buffer version.
 */
export function createLuaTableFieldRemovalEdits(
	buffer: TextBuffer,
	tokens: readonly LuaToken[],
	field: LuaTableField,
): EditorTextEdit[] {
	const start = buffer.offsetAt(field.range.start.line - 1, field.range.start.column - 1);
	const end = buffer.offsetAt(field.range.end.line - 1, field.range.end.column);
	const edits: EditorTextEdit[] = [{ offset: start, deleteLength: end - start, text: '' }];
	const separator = findLuaTableFieldSeparator(tokens, field);
	if (separator !== null) {
		edits.push({ offset: buffer.offsetAt(separator.line - 1, separator.column - 1), deleteLength: separator.lexeme.length, text: '' });
	}
	return edits;
}

export function readLuaSourceRange(buffer: TextBuffer, range: LuaSourceRange): string {
	return buffer.getTextRange(
		buffer.offsetAt(range.start.line - 1, range.start.column - 1),
		buffer.offsetAt(range.end.line - 1, range.end.column),
	);
}

/** Reads an authored literal accepted by the integer control, never evaluates Lua. */
export function readLuaTableFieldInteger(field: LuaTableField): number | null {
	const literal = numericFieldLiteral(field);
	if (literal === null) return null;
	const value = field.value.kind === LuaSyntaxKind.UnaryExpression ? -literal.value : literal.value;
	return value === (value | 0) ? value : null;
}

function numericFieldLiteral(field: LuaTableField): LuaNumericLiteralExpression | null {
	const expression = field.value;
	if (expression.kind === LuaSyntaxKind.NumericLiteralExpression) return expression;
	if (expression.kind === LuaSyntaxKind.UnaryExpression
		&& expression.operator === LuaUnaryOperator.Negate
		&& expression.operand.kind === LuaSyntaxKind.NumericLiteralExpression) return expression.operand;
	return null;
}

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
	const literal = numericFieldLiteral(field);
	if (literal === null) return null;
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
