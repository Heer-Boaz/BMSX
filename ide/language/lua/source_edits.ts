import { LuaSourceLocations } from '../../../toolchain/ts/lua/syntax/source_locations';
import {
	LuaSyntaxKind,
	type LuaNumericLiteralExpression,
	type LuaBooleanLiteralExpression,
	type LuaNilLiteralExpression,
	type LuaStringLiteralExpression,
	type LuaSourcePosition,
	type LuaSourceRange,
	type LuaTableField,
	type LuaExpression,
} from '../../../toolchain/ts/lua/syntax/ast';
import { findLuaTableFieldSeparator } from '../../../toolchain/ts/lua/syntax/table_fields';
import { quoteLuaString } from '../../../toolchain/ts/lua/syntax/string_literal';
import { formatLuaNumberExpression, luaNumericLiteral, readLuaEncodedNumber, readLuaNumberLiteral } from '../../../toolchain/ts/lua/syntax/number_expression';
import { LuaTokenType } from '../../../toolchain/ts/lua/syntax/token';
import type { LuaTokenSequence } from '../../../toolchain/ts/lua/syntax/token_sequence';
import type { EditorTextEdit } from '../../editor/model/text_model';
import type { TextBuffer } from '../../editor/text/text_buffer';
import type { TrackedTextRange } from '../../editor/text/text_change';
import { ELLIPSIS } from '../../common/text';
import { LuaSyntaxError } from '../../../toolchain/ts/lua/errors';
import { LuaLexer } from '../../../toolchain/ts/lua/syntax/lexer';
import { LuaParser } from '../../../toolchain/ts/lua/syntax/parser';

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
	locations: LuaSourceLocations,
	tokens: LuaTokenSequence,
	field: LuaTableField,
): EditorTextEdit[] {
	const start = buffer.offsetAt(locations.range(field.span).start.line - 1, locations.range(field.span).start.column - 1);
	const end = buffer.offsetAt(locations.range(field.span).end.line - 1, locations.range(field.span).end.column);
	const edits: EditorTextEdit[] = [{ offset: start, deleteLength: end - start, text: '' }];
	const separator = findLuaTableFieldSeparator(locations, tokens, field);
	if (separator !== null) {
		edits.push({ offset: locations.offset(separator.unit, separator.start), deleteLength: separator.lexeme.length, text: '' });
	}
	return edits;
}

export function readLuaSourceRange(buffer: TextBuffer, range: LuaSourceRange): string {
	return buffer.getTextRange(
		buffer.offsetAt(range.start.line - 1, range.start.column - 1),
		buffer.offsetAt(range.end.line - 1, range.end.column),
	);
}

export type LuaScalarLiteral = LuaStringLiteralExpression | LuaNilLiteralExpression | LuaBooleanLiteralExpression | LuaNumericLiteralExpression;

/** Replace one atomic value, not its grouping/trivia or a referenced initializer. */
export function createLuaStringValueEdit(buffer: TextBuffer, locations: LuaSourceLocations, literal: LuaScalarLiteral, value: string): EditorTextEdit {
	const start = buffer.offsetAt(locations.range(literal.span).start.line - 1, locations.range(literal.span).start.column - 1);
	const end = buffer.offsetAt(locations.range(literal.span).end.line - 1, locations.range(literal.span).end.column);
	// Retain short-string quote style; long strings become a properly quoted token.
	const quote = buffer.charCodeAt(start) === 34 ? '"' : "'";
	return { offset: start, deleteLength: end - start, text: quoteLuaString(value, quote) };
}

/** Replace the authored boolean token without rewriting its enclosing expression or trivia. */
export function createLuaBooleanValueEdit(buffer: TextBuffer, locations: LuaSourceLocations, literal: LuaBooleanLiteralExpression, value: boolean): EditorTextEdit {
	const range = luaSourceRangeToTextRange(buffer, locations.range(literal.span));
	return { offset: range.start, deleteLength: range.end - range.start, text: value ? 'true' : 'false' };
}

/** A single-line source excerpt, not reprinted Lua. Multiline syntax is explicitly truncated. */
export function readLuaSourceLinePreview(buffer: TextBuffer, range: LuaSourceRange): string {
	if (range.start.line === range.end.line) return readLuaSourceRange(buffer, range);
	const row = range.start.line - 1;
	return buffer.getTextRange(buffer.offsetAt(row, range.start.column - 1), buffer.getLineEndOffset(row)) + ELLIPSIS;
}

/** Expression display, not printed replacement source. Function bodies stay in full inspection. */
export function readLuaExpressionPreview(buffer: TextBuffer, locations: LuaSourceLocations, expression: LuaExpression): string {
	if (expression.kind !== LuaSyntaxKind.FunctionExpression) return readLuaSourceLinePreview(buffer, locations.range(expression.span));
	let signature = 'function(';
	for (let index = 0; index < expression.parameters.length; index += 1) {
		if (index > 0) signature += ', ';
		signature += expression.parameters[index].name;
	}
	if (expression.hasVararg) signature += expression.parameters.length === 0 ? '...' : ', ...';
	return signature + ')';
}

/** Human scalar entry uses the language's numeric syntax and range, not a host word parser. */
export function parseLuaNumberInput(text: string): { readonly value: number } | { readonly error: string } {
	try {
		const path = '<number input>';
		const tokens = new LuaLexer(text, path).scanTokens();
		const fragment = new LuaParser(tokens, path, text).parseExpressionOnly();
		const value = readLuaNumberLiteral(fragment.expression);
		return value === null ? { error: 'Enter a Lua number literal' } : { value };
	} catch (error) {
		if (!(error instanceof LuaSyntaxError)) throw error;
		return { error: error.message };
	}
}

/**
 * Replaces a complete table-field value consisting of a numeric literal, its
 * unary negation, or a closed non-finite Number encoding. Source grouping and
 * trivia remain except for grouping specific to a removed division operand.
 *
 * The field is the syntax boundary: replacing an arbitrary literal subtree
 * with a negative expression could change its parent's operator binding.
 */
export function createLuaTableFieldNumberEdits(
	buffer: TextBuffer,
	locations: LuaSourceLocations,
	field: LuaTableField,
	value: number,
): EditorTextEdit[] | null {
	const expression = field.value;
	const literal = luaNumericLiteral(expression);
	if (literal === null) {
		const previous = readLuaEncodedNumber(expression);
		if (previous === null) return null;
		if (Object.is(previous, value)) return [];
		return createLuaClosedNumberEdits(buffer, locations, field, value);
	}
	const negated = expression.kind === LuaSyntaxKind.UnaryExpression;
	const previousValue = negated ? -literal.value : literal.value;
	if (Object.is(value, previousValue)) {
		return [];
	}

	const literalStart = buffer.offsetAt(locations.range(literal.span).start.line - 1, locations.range(literal.span).start.column - 1);
	const literalEnd = buffer.offsetAt(locations.range(literal.span).end.line - 1, locations.range(literal.span).end.column);
	const literalSource = buffer.getTextRange(literalStart, literalEnd);
	const negative = value < 0 || Object.is(value, -0);
	const magnitude = negative ? -value : value;
	const digits = magnitude % 1 === 0 ? formatIntegerLiteral(magnitude, literalSource) : formatLuaNumberExpression(magnitude, false);
	const edits: EditorTextEdit[] = [];
	let replacement = digits;
	if (negated) {
		if (!negative) {
			edits.push({
				offset: buffer.offsetAt(locations.range(expression.span).start.line - 1, locations.range(expression.span).start.column - 1),
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

/** Rewrite the closed Number-source syntax, keeping all source trivia and
 * grouping outside the removed division operand. Human input remains literal-only. */
function createLuaClosedNumberEdits(buffer: TextBuffer, locations: LuaSourceLocations, field: LuaTableField, value: number): EditorTextEdit[] {
	const expression = locations.range(field.value.span), fieldRange = locations.range(field.span);
	const start = buffer.offsetAt(expression.start.line - 1, expression.start.column - 1);
	const end = buffer.offsetAt(fieldRange.end.line - 1, fieldRange.end.column);
	const text = buffer.getTextRange(start, end), tokens = new LuaLexer(text, locations.path).scanTokens();
	const lexical = LuaSourceLocations.fromLexical(locations.path, text, tokens), edits: EditorTextEdit[] = [];
	let divided = false, denominator = false, rightGroups = 0;
	for (const cursor = tokens.cursor(); cursor.token !== undefined; cursor.advance()) {
		const token = cursor.token, offset = start + lexical.offset(token.unit, token.start);
		switch (token.type) {
			case LuaTokenType.Minus:
				edits.push({ offset, deleteLength: token.width, text: '' }); break;
			case LuaTokenType.Slash:
				divided = true; edits.push({ offset, deleteLength: token.width, text: '' }); break;
			case LuaTokenType.Number:
				if (divided) denominator = true;
				edits.push({ offset, deleteLength: token.width, text: divided ? '' : formatLuaNumberExpression(value, false) }); break;
			case LuaTokenType.LeftParen:
				if (divided && !denominator) { rightGroups++; edits.push({ offset, deleteLength: token.width, text: '' }); }
				break;
			case LuaTokenType.RightParen:
				if (denominator && rightGroups > 0) { rightGroups--; edits.push({ offset, deleteLength: token.width, text: '' }); }
				break;
		}
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
