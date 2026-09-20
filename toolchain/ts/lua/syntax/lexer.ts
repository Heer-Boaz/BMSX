import { createLuaSourceUnit, type LuaSourceUnitPlacement } from './source_layout';
import { LuaTokenSequence, LUA_LEXICAL_BLOCK_CAPACITY, type LuaTokenBlock } from './token_sequence';
import { LuaSyntaxError } from '../errors';
import type { LuaToken, LuaTokenLiteral } from './token';
import { LuaTokenType, resolveKeyword } from './token';

export class LuaLexer {
	private readonly source: string;
	private readonly path: string;
	private readonly blocks: LuaTokenBlock[] = [];
	private items: LuaToken[] = [];
	private unit: LuaSourceUnitPlacement = { unit: createLuaSourceUnit(), offset: 0 };
	private readEnd = 0;
	private currentIndex: number;
	private line: number;
	private column: number;
	private tokenStartIndex: number;
	private tokenStartLine: number;
	private tokenStartColumn: number;

	constructor(source: string, path: string) {
		this.source = source;
		this.path = path;
		this.blocks.push({ unit: this.unit.unit, items: this.items });
		this.currentIndex = 0;
		this.line = 1;
		this.column = 1;
		this.tokenStartIndex = 0;
		this.tokenStartLine = 1;
		this.tokenStartColumn = 1;
	}

	public scanTokens(): LuaTokenSequence {
		while (!this.isAtEnd()) {
			this.beginToken();
			this.scanToken();
		}
		this.emitEof(null);
		return LuaTokenSequence.fromBlocks(this.blocks);
	}

	public scanTokensWithRecovery(): { tokens: LuaTokenSequence; syntaxError: LuaSyntaxError | null } {
		let syntaxError: LuaSyntaxError | null = null;
		try {
			while (!this.isAtEnd()) {
				this.beginToken();
				this.scanToken();
			}
		} catch (error) {
			if (!(error instanceof LuaSyntaxError)) throw error;
			syntaxError = error;
		}
		this.emitEof(syntaxError);
		return { tokens: LuaTokenSequence.fromBlocks(this.blocks), syntaxError };
	}

	private emitEof(error: LuaSyntaxError | null): void {
		const start = error === null ? this.currentIndex : this.tokenStartIndex;
		let breaks = 0;
		if (error !== null) {
			breaks = this.line - this.tokenStartLine;
			for (let index = this.currentIndex; index < this.source.length; index++) {
				if (this.source.charCodeAt(index) === 10) breaks++;
			}
		}
		this.beginItem(start);
		const relative = start - this.unit.offset;
		this.items.push({
			type: LuaTokenType.Eof, lexeme: '', literal: null,
			unit: this.unit.unit, start: relative, end: relative,
			width: this.source.length - start,
			readWidth: Math.max(this.readEnd, this.source.length + 1) - start,
			breaks,
			error: error === null ? undefined : error.message,
		});
	}

	private beginToken(): void {
		this.tokenStartIndex = this.currentIndex;
		this.readEnd = this.currentIndex;
		this.tokenStartLine = this.line;
		this.tokenStartColumn = this.column;
	}

	private scanToken(): void {
		const char = this.advance();
		switch (char) {
			case '(':
				this.pushToken(LuaTokenType.LeftParen, null);
				return;
			case ')':
				this.pushToken(LuaTokenType.RightParen, null);
				return;
			case '{':
				this.pushToken(LuaTokenType.LeftBrace, null);
				return;
			case '}':
				this.pushToken(LuaTokenType.RightBrace, null);
				return;
			case '[': {
				const level = this.determineLongBracketLevelAt(this.currentIndex - 1);
				if (level >= 0) {
					this.consumeLongBracketDelimiterTail(level, '[');
					const value = this.readLongString(level);
					this.pushToken(LuaTokenType.String, value);
					return;
				}
				this.pushToken(LuaTokenType.LeftBracket, null);
				return;
			}
			case ']':
				this.pushToken(LuaTokenType.RightBracket, null);
				return;
			case ',':
				this.pushToken(LuaTokenType.Comma, null);
				return;
			case ';':
				this.pushToken(LuaTokenType.Semicolon, null);
				return;
			case '+':
				this.pushToken(this.match('=') ? LuaTokenType.PlusEqual : LuaTokenType.Plus, null);
				return;
			case '-':
				if (this.match('-')) {
					this.scanComment();
					return;
				}
				if (this.match('>')) {
					this.pushToken(LuaTokenType.Arrow, null);
					return;
				}
				this.pushToken(this.match('=') ? LuaTokenType.MinusEqual : LuaTokenType.Minus, null);
				return;
			case '*':
				this.pushToken(this.match('=') ? LuaTokenType.StarEqual : LuaTokenType.Star, null);
				return;
			case '/':
				if (this.match('/')) {
					this.pushToken(LuaTokenType.FloorDivide, null);
					return;
				}
				this.pushToken(this.match('=') ? LuaTokenType.SlashEqual : LuaTokenType.Slash, null);
				return;
			case '%':
				this.pushToken(this.match('=') ? LuaTokenType.PercentEqual : LuaTokenType.Percent, null);
				return;
			case '^':
				this.pushToken(this.match('=') ? LuaTokenType.CaretEqual : LuaTokenType.Caret, null);
				return;
			case '#':
				this.pushToken(LuaTokenType.Hash, null);
				return;
			case '=':
				this.pushToken(this.match('=') ? LuaTokenType.EqualEqual : LuaTokenType.Equal, null);
				return;
			case '<':
				if (this.match('<')) {
					this.pushToken(LuaTokenType.ShiftLeft, null);
					return;
				}
				this.pushToken(this.match('=') ? LuaTokenType.LessEqual : LuaTokenType.Less, null);
				return;
			case '>':
				if (this.match('>')) {
					this.pushToken(LuaTokenType.ShiftRight, null);
					return;
				}
				this.pushToken(this.match('=') ? LuaTokenType.GreaterEqual : LuaTokenType.Greater, null);
				return;
			case '~':
				this.pushToken(this.match('=') ? LuaTokenType.TildeEqual : LuaTokenType.Tilde, null);
				return;
			case '&':
				this.pushToken(LuaTokenType.Ampersand, null);
				return;
			case '|':
				this.pushToken(LuaTokenType.Pipe, null);
				return;
			case ':':
				this.pushToken(this.match(':') ? LuaTokenType.DoubleColon : LuaTokenType.Colon, null);
				return;
			case '.':
				if (LuaLexer.isDigit(this.currentChar())) {
					this.scanNumber(true);
					return;
				}
				if (this.match('.')) {
					this.pushToken(this.match('.') ? LuaTokenType.Vararg : LuaTokenType.DotDot, null);
					return;
				}
				this.pushToken(LuaTokenType.Dot, null);
				return;
			case '"':
			case '\'':
				this.scanString(char);
				return;
			case ' ':
			case '\r':
			case '\t':
			case '\v':
				while (this.currentChar() === char) this.advance();
				this.pushToken(LuaTokenType.WhitespaceTrivia, null);
				return;
			case '\n':
				this.pushToken(LuaTokenType.NewLineTrivia, null);
				return;
			default:
				if (LuaLexer.isDigit(char)) {
					this.scanNumber(false);
					return;
				}
				if (LuaLexer.isIdentifierStart(char)) {
					this.scanIdentifier();
					return;
				}
				throw new LuaSyntaxError(`[LuaLexer] Unexpected character '${char}'.`, this.path, this.tokenStartLine, this.tokenStartColumn);
		}
	}

	private scanComment(): void {
		if (this.currentChar() === '[') {
			const level = this.determineLongBracketLevelAt(this.currentIndex);
			if (level >= 0) {
				this.advance();
				this.consumeLongBracketDelimiterTail(level, '[');
				this.skipLongBracketContent(level);
				this.pushToken(LuaTokenType.MultiLineCommentTrivia, null);
				return;
			}
		}
		this.skipLineComment();
		this.pushToken(LuaTokenType.SingleLineCommentTrivia, null);
	}

	private skipLineComment(): void {
		while (!this.isAtEnd() && this.currentChar() !== '\n') {
			this.advance();
		}
	}

	private scanIdentifier(): void {
		while (LuaLexer.isIdentifierPart(this.currentChar())) {
			this.advance();
		}
		const lexeme = this.currentLexeme();
		if (LuaLexer.hasUppercaseAscii(lexeme)) {
			throw new LuaSyntaxError(`[LuaLexer] Upper-case identifiers are not allowed in cart Lua: '${lexeme}'.`, this.path, this.tokenStartLine, this.tokenStartColumn);
		}
		const keywordType = resolveKeyword(lexeme);
		if (keywordType === LuaTokenType.True) {
			this.pushToken(keywordType, true, lexeme);
			return;
		}
		if (keywordType === LuaTokenType.False) {
			this.pushToken(keywordType, false, lexeme);
			return;
		}
		if (keywordType === LuaTokenType.Nil) {
			this.pushToken(keywordType, null, lexeme);
			return;
		}
		this.pushToken(keywordType ?? LuaTokenType.Identifier, null, lexeme);
	}

	private scanNumber(startedWithDot: boolean): void {
		if (!startedWithDot && this.source.charAt(this.tokenStartIndex) === '0' && (this.currentChar() === 'x' || this.currentChar() === 'X')) {
			this.advance();
			this.scanHexadecimalLiteral();
			return;
		}
		if (startedWithDot) {
			this.consumeDigits();
		}
		else {
			this.consumeDigits();
			if (this.currentChar() === '.' && LuaLexer.isDigit(this.nextChar())) {
				this.advance();
				this.consumeDigits();
			}
		}
		if (this.currentChar() === 'e' || this.currentChar() === 'E') {
			this.scanDecimalExponent();
		}
		const lexeme = this.currentLexeme();
		const parsed = Number(lexeme);
		if (!Number.isFinite(parsed)) {
			throw new LuaSyntaxError('[LuaLexer] Numeric literal is not finite.', this.path, this.tokenStartLine, this.tokenStartColumn);
		}
		this.pushToken(LuaTokenType.Number, parsed);
	}

	private scanString(delimiter: string): void {
		let value = '';
		let terminated = false;
		while (!this.isAtEnd()) {
			const char = this.advance();
			if (char === delimiter) {
				terminated = true;
				break;
			}
			if (char === '\n') {
				throw new LuaSyntaxError('[LuaLexer] Unterminated string literal.', this.path, this.tokenStartLine, this.tokenStartColumn);
			}
			if (char === '\\') {
				value += this.translateEscape();
				continue;
			}
			value += char;
		}
		if (!terminated) {
			throw new LuaSyntaxError('[LuaLexer] Unterminated string literal.', this.path, this.tokenStartLine, this.tokenStartColumn);
		}
		this.pushToken(LuaTokenType.String, value);
	}

	private translateEscape(): string {
		const code = this.advance();
		switch (code) {
			case 'a':
				return '\u0007';
			case 'b':
				return '\b';
			case 'f':
				return '\f';
			case 'n':
				return '\n';
			case 'r':
				return '\r';
			case 't':
				return '\t';
			case 'v':
				return '\v';
			case '\\':
				return '\\';
			case '"':
				return '"';
			case '\'':
				return '\'';
			case 'z':
				this.skipWhitespaceSequence();
				return '';
			case 'x': {
				const hexDigits = this.readHexEscapeDigits(2);
				const value = Number.parseInt(hexDigits, 16);
				return String.fromCharCode(value);
			}
			default:
				if (LuaLexer.isDigit(code)) {
					let digits = code;
					for (let index = 0; index < 2 && LuaLexer.isDigit(this.currentChar()); index += 1) {
						digits += this.advance();
					}
					const value = Number.parseInt(digits, 10);
					if (!Number.isFinite(value) || value > 255) {
						throw new LuaSyntaxError('[LuaLexer] Invalid decimal escape sequence.', this.path, this.tokenStartLine, this.tokenStartColumn);
					}
					return String.fromCharCode(value);
				}
				throw new LuaSyntaxError(`[LuaLexer] Unsupported escape sequence '\\${code}'.`, this.path, this.tokenStartLine, this.tokenStartColumn);
		}
	}

	private consumeDigits(): void {
		while (LuaLexer.isDigit(this.currentChar())) {
			this.advance();
		}
	}

	private scanDecimalExponent(): void {
		const markerIndex = this.currentIndex;
		this.advance();
		if (this.currentChar() === '+' || this.currentChar() === '-') {
			this.advance();
		}
		if (!LuaLexer.isDigit(this.currentChar())) {
			throw new LuaSyntaxError('[LuaLexer] Invalid numeric literal exponent.', this.path, this.tokenStartLine, this.tokenStartColumn);
		}
		this.consumeDigits();
		if (this.currentIndex === markerIndex + 1) {
			throw new LuaSyntaxError('[LuaLexer] Invalid numeric literal exponent.', this.path, this.tokenStartLine, this.tokenStartColumn);
		}
	}

	private scanHexadecimalLiteral(): void {
		let hasDigits = false;
		while (LuaLexer.isHexDigit(this.currentChar())) {
			this.advance();
			hasDigits = true;
		}
		if (this.currentChar() === '.') {
			this.advance();
			while (LuaLexer.isHexDigit(this.currentChar())) {
				this.advance();
				hasDigits = true;
			}
		}
		if (!hasDigits) {
			throw new LuaSyntaxError('[LuaLexer] Hexadecimal literal requires digits.', this.path, this.tokenStartLine, this.tokenStartColumn);
		}
		if (this.currentChar() === 'p' || this.currentChar() === 'P') {
			this.advance();
			if (this.currentChar() === '+' || this.currentChar() === '-') {
				this.advance();
			}
			if (!LuaLexer.isDigit(this.currentChar())) {
				throw new LuaSyntaxError('[LuaLexer] Hexadecimal literal requires binary exponent.', this.path, this.tokenStartLine, this.tokenStartColumn);
			}
			this.consumeDigits();
		}
		const lexeme = this.currentLexeme();
		const parsed = this.parseHexLiteral(lexeme);
		if (!Number.isFinite(parsed)) {
			throw new LuaSyntaxError('[LuaLexer] Numeric literal is not finite.', this.path, this.tokenStartLine, this.tokenStartColumn);
		}
		this.pushToken(LuaTokenType.Number, parsed);
	}

	private skipWhitespaceSequence(): void {
		while (!this.isAtEnd() && LuaLexer.isWhitespace(this.currentChar())) {
			this.advance();
		}
	}

	private readHexEscapeDigits(required: number): string {
		let digits = '';
		for (let index = 0; index < required; index += 1) {
			const next = this.currentChar();
			if (!LuaLexer.isHexDigit(next)) {
				throw new LuaSyntaxError('[LuaLexer] Invalid hexadecimal escape sequence.', this.path, this.tokenStartLine, this.tokenStartColumn);
			}
			digits += this.advance();
		}
		return digits;
	}

	private determineLongBracketLevelAt(index: number): number {
		if (this.charAtIndex(index) !== '[') {
			return -1;
		}
		let level = 0;
		let cursor = index + 1;
		while (this.charAtIndex(cursor) === '=') {
			level += 1;
			cursor += 1;
		}
		return (this.charAtIndex(cursor) === '[') ? level : -1;
	}

		private consumeLongBracketDelimiterTail(level: number, finalExpected: '[' | ']'): void {
			for (let index = 0; index < level; index += 1) {
				const char = this.advance();
				if (char !== '=') {
					throw new LuaSyntaxError('[LuaLexer] Malformed long string delimiter.', this.path, this.tokenStartLine, this.tokenStartColumn);
				}
			}
			const finalChar = this.advance();
			if (finalChar !== finalExpected) {
				throw new LuaSyntaxError('[LuaLexer] Malformed long string delimiter.', this.path, this.tokenStartLine, this.tokenStartColumn);
			}
		}

	private readLongString(level: number): string {
		this.consumeOptionalLineBreak();
		let value = '';
		while (!this.isAtEnd()) {
				const char = this.advance();
				if (char === ']' && this.checkLongBracketClose(level)) {
					this.consumeLongBracketDelimiterTail(level, ']');
					return value;
				}
			value += char;
		}
		throw new LuaSyntaxError('[LuaLexer] Unterminated long string literal.', this.path, this.tokenStartLine, this.tokenStartColumn);
	}

	private skipLongBracketContent(level: number): void {
		this.consumeOptionalLineBreak();
		while (!this.isAtEnd()) {
				const char = this.advance();
				if (char === ']' && this.checkLongBracketClose(level)) {
					this.consumeLongBracketDelimiterTail(level, ']');
					return;
				}
		}
		throw new LuaSyntaxError('[LuaLexer] Unterminated block comment.', this.path, this.tokenStartLine, this.tokenStartColumn);
	}

	private checkLongBracketClose(level: number): boolean {
		let index = this.currentIndex;
		for (let count = 0; count < level; count += 1) {
			if (this.charAtIndex(index) !== '=') {
				return false;
			}
			index += 1;
		}
		return this.charAtIndex(index) === ']';
	}

		private consumeOptionalLineBreak(): void {
		const next = this.currentChar();
		if (next === '\r') {
			this.advance();
			if (this.currentChar() === '\n') {
				this.advance();
			}
		} else if (next === '\n') {
			this.advance();
		}
	}

	private charAtIndex(index: number): string {
		if (index >= this.readEnd) this.readEnd = index + 1;
		return this.source.charAt(index) || '\0';
	}

		private parseHexLiteral(lexeme: string): number {
			const match = /^0[xX]([0-9A-Fa-f]*)(?:\.([0-9A-Fa-f]*))?(?:[pP]([+-]?[0-9]+))?$/.exec(lexeme);
			const integerPart = match[1];
			const fractionalPart = match[2];
			const exponentPart = match[3];
			if (integerPart.length === 0 && (fractionalPart === undefined || fractionalPart.length === 0)) {
				throw new LuaSyntaxError('[LuaLexer] Hexadecimal literal requires digits.', this.path, this.tokenStartLine, this.tokenStartColumn);
			}
		let value = 0;
		for (let index = 0; index < integerPart.length; index += 1) {
			value = value * 16 + Number.parseInt(integerPart.charAt(index), 16);
		}
		let fraction = 0;
			if (fractionalPart !== undefined) {
				for (let index = 0; index < fractionalPart.length; index += 1) {
					const digit = Number.parseInt(fractionalPart.charAt(index), 16);
					fraction += digit / Math.pow(16, index + 1);
				}
			}
			const exponent = exponentPart === undefined ? 0 : Number.parseInt(exponentPart, 10);
		return (value + fraction) * Math.pow(2, exponent);
	}

	private beginItem(offset: number): void {
		if (this.items.length === LUA_LEXICAL_BLOCK_CAPACITY) {
			this.items = [];
			this.unit = { unit: createLuaSourceUnit(), offset };
			this.blocks.push({ unit: this.unit.unit, items: this.items });
		}
	}

	private pushToken(type: LuaTokenType, literal: LuaTokenLiteral, lexeme = this.currentLexeme()): void {
		this.beginItem(this.tokenStartIndex);
		const start = this.tokenStartIndex - this.unit.offset;
		const width = this.currentIndex - this.tokenStartIndex;
		this.items.push({
			type, lexeme, literal,
			unit: this.unit.unit, start, end: start + width - 1,
			width, readWidth: this.readEnd - this.tokenStartIndex,
			breaks: this.line - this.tokenStartLine,
		});
	}

	private advance(): string {
		const char = this.charAtIndex(this.currentIndex);
		this.currentIndex += 1;
		if (char === '\n') {
			this.line += 1;
			this.column = 1;
		}
		else {
			this.column += 1;
		}
		return char;
	}

	private match(expected: string): boolean {
		if (this.charAtIndex(this.currentIndex) !== expected) {
			return false;
		}
		this.advance();
		return true;
	}

	private currentChar(): string {
		return this.charAtIndex(this.currentIndex);
	}

	private nextChar(): string {
		return this.charAtIndex(this.currentIndex + 1);
	}

	public static isWhitespace(char: string): boolean {
		const code = char.charCodeAt(0);
		return code === 32 || code === 9 || code === 13 || code === 10 || code === 11 || code === 12; // space, tab, \r, \n, \v, \f
	}

	public static isDigit(char: string): boolean {
		const code = char.charCodeAt(0);
		return code >= 48 && code <= 57; // '0' to '9'
	}

	public static isHexDigit(char: string): boolean {
		const code = char.charCodeAt(0);
		return (code >= 48 && code <= 57) || (code >= 97 && code <= 102) || (code >= 65 && code <= 70); // 0-9, a-f, A-F
	}

	public static isIdentifierStart(char: string): boolean {
		const code = char.charCodeAt(0);
		return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code === 95 || code === 36; // a-z, A-Z, _, $
	}

	public static isIdentifierPart(char: string): boolean {
		const code = char.charCodeAt(0);
		return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code === 95 || code === 36 || (code >= 48 && code <= 57);
	}

	private static hasUppercaseAscii(value: string): boolean {
		for (let index = 0; index < value.length; index += 1) {
			const code = value.charCodeAt(index);
			if (code >= 65 && code <= 90) {
				return true;
			}
		}
		return false;
	}

	private isAtEnd(): boolean {
		if (this.currentIndex >= this.readEnd) this.readEnd = this.currentIndex + 1;
		return this.currentIndex >= this.source.length;
	}

	private currentLexeme(): string {
		return this.source.slice(this.tokenStartIndex, this.currentIndex);
	}
}
