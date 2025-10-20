import { LuaSyntaxError } from './errors.ts';
import type { LuaToken, LuaTokenLiteral } from './token.ts';
import { LuaTokenType, resolveKeyword } from './token.ts';

export class LuaLexer {
	private readonly source: string;
	private readonly chunkName: string;
	private currentIndex: number;
	private line: number;
	private column: number;
	private tokenStartIndex: number;
	private tokenStartLine: number;
	private tokenStartColumn: number;

	constructor(source: string, chunkName: string) {
		this.source = source;
		this.chunkName = chunkName;
		this.currentIndex = 0;
		this.line = 1;
		this.column = 1;
		this.tokenStartIndex = 0;
		this.tokenStartLine = 1;
		this.tokenStartColumn = 1;
	}

	public scanTokens(): LuaToken[] {
		const tokens: LuaToken[] = [];
		while (!this.isAtEnd()) {
			this.beginToken();
			this.scanToken(tokens);
		}
		tokens.push({
			type: LuaTokenType.Eof,
			lexeme: '',
			line: this.line,
			column: this.column,
			literal: null,
		});
		return tokens;
	}

	private beginToken(): void {
		this.tokenStartIndex = this.currentIndex;
		this.tokenStartLine = this.line;
		this.tokenStartColumn = this.column;
	}

	private scanToken(tokens: LuaToken[]): void {
		const char = this.advance();
		switch (char) {
			case '(':
				this.pushToken(tokens, LuaTokenType.LeftParen, null);
				return;
			case ')':
				this.pushToken(tokens, LuaTokenType.RightParen, null);
				return;
			case '{':
				this.pushToken(tokens, LuaTokenType.LeftBrace, null);
				return;
			case '}':
				this.pushToken(tokens, LuaTokenType.RightBrace, null);
				return;
			case '[': {
				const level = this.determineLongBracketLevelAt(this.currentIndex - 1);
				if (level >= 0) {
					this.consumeLongBracketOpening(level);
					const value = this.readLongString(level);
					this.pushToken(tokens, LuaTokenType.String, value);
					return;
				}
				this.pushToken(tokens, LuaTokenType.LeftBracket, null);
				return;
			}
			case ']':
				this.pushToken(tokens, LuaTokenType.RightBracket, null);
				return;
			case ',':
				this.pushToken(tokens, LuaTokenType.Comma, null);
				return;
			case ';':
				this.pushToken(tokens, LuaTokenType.Semicolon, null);
				return;
			case '+':
				if (this.match('=')) {
					this.pushToken(tokens, LuaTokenType.PlusEqual, null);
					return;
				}
				this.pushToken(tokens, LuaTokenType.Plus, null);
				return;
			case '-':
				if (this.match('-')) {
					this.skipComment();
					return;
				}
				if (this.match('=')) {
					this.pushToken(tokens, LuaTokenType.MinusEqual, null);
					return;
				}
				this.pushToken(tokens, LuaTokenType.Minus, null);
				return;
			case '*':
				if (this.match('=')) {
					this.pushToken(tokens, LuaTokenType.StarEqual, null);
					return;
				}
				this.pushToken(tokens, LuaTokenType.Star, null);
				return;
			case '/':
				if (this.match('/')) {
					this.pushToken(tokens, LuaTokenType.FloorDivide, null);
					return;
				}
				if (this.match('=')) {
					this.pushToken(tokens, LuaTokenType.SlashEqual, null);
					return;
				}
				this.pushToken(tokens, LuaTokenType.Slash, null);
				return;
			case '%':
				if (this.match('=')) {
					this.pushToken(tokens, LuaTokenType.PercentEqual, null);
					return;
				}
				this.pushToken(tokens, LuaTokenType.Percent, null);
				return;
			case '^':
				if (this.match('=')) {
					this.pushToken(tokens, LuaTokenType.CaretEqual, null);
					return;
				}
				this.pushToken(tokens, LuaTokenType.Caret, null);
				return;
			case '#':
				this.pushToken(tokens, LuaTokenType.Hash, null);
				return;
			case '=':
				if (this.match('=')) {
					this.pushToken(tokens, LuaTokenType.EqualEqual, null);
					return;
				}
				this.pushToken(tokens, LuaTokenType.Equal, null);
				return;
			case '<':
				if (this.match('<')) {
					this.pushToken(tokens, LuaTokenType.ShiftLeft, null);
					return;
				}
				if (this.match('=')) {
					this.pushToken(tokens, LuaTokenType.LessEqual, null);
					return;
				}
				this.pushToken(tokens, LuaTokenType.Less, null);
				return;
			case '>':
				if (this.match('>')) {
					this.pushToken(tokens, LuaTokenType.ShiftRight, null);
					return;
				}
				if (this.match('=')) {
					this.pushToken(tokens, LuaTokenType.GreaterEqual, null);
					return;
				}
				this.pushToken(tokens, LuaTokenType.Greater, null);
				return;
			case '~':
				if (this.match('=')) {
					this.pushToken(tokens, LuaTokenType.TildeEqual, null);
					return;
				}
				this.pushToken(tokens, LuaTokenType.Tilde, null);
				return;
			case '&':
				this.pushToken(tokens, LuaTokenType.Ampersand, null);
				return;
			case '|':
				this.pushToken(tokens, LuaTokenType.Pipe, null);
				return;
			case ':':
				if (this.match(':')) {
					this.pushToken(tokens, LuaTokenType.DoubleColon, null);
					return;
				}
				this.pushToken(tokens, LuaTokenType.Colon, null);
				return;
			case '.':
				if (this.peekIsDigit()) {
					this.scanNumber(tokens, true);
					return;
				}
				if (this.match('.')) {
					if (this.match('.')) {
						this.pushToken(tokens, LuaTokenType.Vararg, null);
						return;
					}
					this.pushToken(tokens, LuaTokenType.DotDot, null);
					return;
				}
				this.pushToken(tokens, LuaTokenType.Dot, null);
				return;
			case '"':
			case '\'':
				this.scanString(tokens, char);
				return;
			case ' ':
			case '\r':
			case '\t':
			case '\v':
				return;
			case '\n':
				return;
			default:
				if (this.isDigit(char)) {
					this.scanNumber(tokens, false);
					return;
				}
				if (this.isIdentifierStart(char)) {
					this.scanIdentifier(tokens);
					return;
				}
				throw new LuaSyntaxError(`[LuaLexer] Unexpected character '${char}'.`, this.chunkName, this.tokenStartLine, this.tokenStartColumn);
		}
	}

	private skipComment(): void {
		if (this.peek() === '[') {
			const level = this.determineLongBracketLevelAt(this.currentIndex);
			if (level >= 0) {
				this.advance();
				this.consumeLongBracketOpening(level);
				this.skipLongBracketContent(level);
				return;
			}
		}
		this.skipLineComment();
	}

	private skipLineComment(): void {
		while (!this.isAtEnd() && this.peek() !== '\n') {
			this.advance();
		}
	}

	private scanIdentifier(tokens: LuaToken[]): void {
		while (this.isIdentifierPart(this.peek())) {
			this.advance();
		}
		const lexeme = this.currentLexeme();
		const keywordType = resolveKeyword(lexeme);
		if (keywordType !== null) {
			if (keywordType === LuaTokenType.True) {
				this.pushToken(tokens, keywordType, true);
				return;
			}
			if (keywordType === LuaTokenType.False) {
				this.pushToken(tokens, keywordType, false);
				return;
			}
			if (keywordType === LuaTokenType.Nil) {
				this.pushToken(tokens, keywordType, null);
				return;
			}
			this.pushToken(tokens, keywordType, null);
			return;
		}
		this.pushToken(tokens, LuaTokenType.Identifier, null);
	}

	private scanNumber(tokens: LuaToken[], startedWithDot: boolean): void {
		if (!startedWithDot && this.source.charAt(this.tokenStartIndex) === '0' && (this.peek() === 'x' || this.peek() === 'X')) {
			this.advance();
			this.scanHexadecimalLiteral(tokens);
			return;
		}
		if (startedWithDot) {
			this.consumeDigits();
		}
		else {
			this.consumeDigits();
			if (this.peek() === '.' && this.peekNextIsDigit()) {
				this.advance();
				this.consumeDigits();
			}
		}
		if (this.peek() === 'e' || this.peek() === 'E') {
			this.scanDecimalExponent();
		}
		const lexeme = this.currentLexeme();
		const parsed = Number(lexeme);
		if (!Number.isFinite(parsed)) {
			throw new LuaSyntaxError('[LuaLexer] Numeric literal is not finite.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
		}
		this.pushToken(tokens, LuaTokenType.Number, parsed);
	}

	private scanString(tokens: LuaToken[], delimiter: string): void {
		let value = '';
		let terminated = false;
		while (!this.isAtEnd()) {
			const char = this.advance();
			if (char === delimiter) {
				terminated = true;
				break;
			}
			if (char === '\n') {
				throw new LuaSyntaxError('[LuaLexer] Unterminated string literal.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
			}
			if (char === '\\') {
				value += this.translateEscape();
				continue;
			}
			value += char;
		}
		if (!terminated) {
			throw new LuaSyntaxError('[LuaLexer] Unterminated string literal.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
		}
		this.pushToken(tokens, LuaTokenType.String, value);
	}

	private translateEscape(): string {
		if (this.isAtEnd()) {
			throw new LuaSyntaxError('[LuaLexer] Unterminated escape sequence.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
		}
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
				if (this.isDigit(code)) {
					let digits = code;
					for (let index = 0; index < 2 && this.isDigit(this.peek()); index += 1) {
						digits += this.advance();
					}
					const value = Number.parseInt(digits, 10);
					if (!Number.isFinite(value) || value > 255) {
						throw new LuaSyntaxError('[LuaLexer] Invalid decimal escape sequence.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
					}
					return String.fromCharCode(value);
				}
				throw new LuaSyntaxError(`[LuaLexer] Unsupported escape sequence '\\${code}'.`, this.chunkName, this.tokenStartLine, this.tokenStartColumn);
		}
	}

	private consumeDigits(): void {
		while (this.isDigit(this.peek())) {
			this.advance();
		}
	}

	private scanDecimalExponent(): void {
		const markerIndex = this.currentIndex;
		this.advance();
		if (this.peek() === '+' || this.peek() === '-') {
			this.advance();
		}
		if (!this.isDigit(this.peek())) {
			throw new LuaSyntaxError('[LuaLexer] Invalid numeric literal exponent.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
		}
		this.consumeDigits();
		if (this.currentIndex === markerIndex + 1) {
			throw new LuaSyntaxError('[LuaLexer] Invalid numeric literal exponent.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
		}
	}

	private scanHexadecimalLiteral(tokens: LuaToken[]): void {
		let hasDigits = false;
		while (this.isHexDigit(this.peek())) {
			this.advance();
			hasDigits = true;
		}
		if (this.peek() === '.') {
			this.advance();
			while (this.isHexDigit(this.peek())) {
				this.advance();
				hasDigits = true;
			}
		}
		if (!hasDigits) {
			throw new LuaSyntaxError('[LuaLexer] Hexadecimal literal requires digits.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
		}
		if (this.peek() === 'p' || this.peek() === 'P') {
			this.advance();
			if (this.peek() === '+' || this.peek() === '-') {
				this.advance();
			}
			if (!this.isDigit(this.peek())) {
				throw new LuaSyntaxError('[LuaLexer] Hexadecimal literal requires binary exponent.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
			}
			this.consumeDigits();
		}
		const lexeme = this.currentLexeme();
		const parsed = this.parseHexLiteral(lexeme);
		if (!Number.isFinite(parsed)) {
			throw new LuaSyntaxError('[LuaLexer] Numeric literal is not finite.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
		}
		this.pushToken(tokens, LuaTokenType.Number, parsed);
	}

	private skipWhitespaceSequence(): void {
		while (!this.isAtEnd()) {
			const next = this.peek();
			if (next === ' ' || next === '\t' || next === '\r' || next === '\n' || next === '\v' || next === '\f') {
				this.advance();
			}
			else {
				break;
			}
		}
	}

	private readHexEscapeDigits(required: number): string {
		let digits = '';
		for (let index = 0; index < required; index += 1) {
			const next = this.peek();
			if (!this.isHexDigit(next)) {
				throw new LuaSyntaxError('[LuaLexer] Invalid hexadecimal escape sequence.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
			}
			digits += this.advance();
		}
		return digits;
	}

	private determineLongBracketLevelAt(index: number): number {
		if (index < 0 || index >= this.source.length || this.source.charAt(index) !== '[') {
			return -1;
		}
		let level = 0;
		let cursor = index + 1;
		while (cursor < this.source.length && this.source.charAt(cursor) === '=') {
			level += 1;
			cursor += 1;
		}
		if (cursor < this.source.length && this.source.charAt(cursor) === '[') {
			return level;
		}
		return -1;
	}

	private consumeLongBracketOpening(level: number): void {
		for (let index = 0; index < level; index += 1) {
			const char = this.advance();
			if (char !== '=') {
				throw new LuaSyntaxError('[LuaLexer] Malformed long string delimiter.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
			}
		}
		const finalChar = this.advance();
		if (finalChar !== '[') {
			throw new LuaSyntaxError('[LuaLexer] Malformed long string delimiter.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
		}
	}

	private readLongString(level: number): string {
		this.consumeOptionalLineBreak();
		let value = '';
		while (!this.isAtEnd()) {
			const char = this.advance();
			if (char === ']') {
				if (this.checkLongBracketClose(level)) {
					this.consumeLongBracketClose(level);
					return value;
				}
				value += char;
				continue;
			}
			value += char;
		}
		throw new LuaSyntaxError('[LuaLexer] Unterminated long string literal.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
	}

	private skipLongBracketContent(level: number): void {
		this.consumeOptionalLineBreak();
		while (!this.isAtEnd()) {
			const char = this.advance();
			if (char === ']') {
				if (this.checkLongBracketClose(level)) {
					this.consumeLongBracketClose(level);
					return;
				}
			}
		}
		throw new LuaSyntaxError('[LuaLexer] Unterminated block comment.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
	}

	private checkLongBracketClose(level: number): boolean {
		let index = this.currentIndex;
		for (let count = 0; count < level; count += 1) {
			if (this.peekAt(index) !== '=') {
				return false;
			}
			index += 1;
		}
		return this.peekAt(index) === ']';
	}

	private consumeLongBracketClose(level: number): void {
		for (let count = 0; count < level; count += 1) {
			const char = this.advance();
			if (char !== '=') {
				throw new LuaSyntaxError('[LuaLexer] Malformed long string delimiter.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
			}
		}
		const closing = this.advance();
		if (closing !== ']') {
			throw new LuaSyntaxError('[LuaLexer] Malformed long string delimiter.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
		}
	}

	private consumeOptionalLineBreak(): void {
		const next = this.peek();
		if (next === '\r') {
			this.advance();
			if (this.peek() === '\n') {
				this.advance();
			}
			return;
		}
		if (next === '\n') {
			this.advance();
		}
	}

	private isHexDigit(char: string): boolean {
		return (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F');
	}

	private peekAt(index: number): string {
		if (index < 0 || index >= this.source.length) {
			return '\0';
		}
		return this.source.charAt(index);
	}

	private parseHexLiteral(lexeme: string): number {
		const match = /^0[xX]([0-9A-Fa-f]*)(?:\.([0-9A-Fa-f]*))?(?:[pP]([+-]?[0-9]+))?$/.exec(lexeme);
		if (match === null) {
			throw new LuaSyntaxError('[LuaLexer] Invalid hexadecimal literal.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
		}
		const integerPart = match[1] ?? '';
		const fractionalPart = match[2] ?? '';
		const exponentPart = match[3] ?? '0';
		if (integerPart.length === 0 && fractionalPart.length === 0) {
			throw new LuaSyntaxError('[LuaLexer] Hexadecimal literal requires digits.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
		}
		let value = 0;
		for (let index = 0; index < integerPart.length; index += 1) {
			value = value * 16 + Number.parseInt(integerPart.charAt(index), 16);
		}
		let fraction = 0;
		for (let index = 0; index < fractionalPart.length; index += 1) {
			const digit = Number.parseInt(fractionalPart.charAt(index), 16);
			fraction += digit / Math.pow(16, index + 1);
		}
		const exponent = Number.parseInt(exponentPart, 10);
		return (value + fraction) * Math.pow(2, exponent);
	}

	private pushToken(tokens: LuaToken[], type: LuaTokenType, literal: LuaTokenLiteral): void {
		const token: LuaToken = {
			type,
			lexeme: this.currentLexeme(),
			line: this.tokenStartLine,
			column: this.tokenStartColumn,
			literal,
		};
		tokens.push(token);
	}

	private advance(): string {
		if (this.isAtEnd()) {
			return '\0';
		}
		const char = this.source.charAt(this.currentIndex);
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
		if (this.isAtEnd()) {
			return false;
		}
		if (this.source.charAt(this.currentIndex) !== expected) {
			return false;
		}
		this.advance();
		return true;
	}

	private peek(): string {
		if (this.isAtEnd()) {
			return '\0';
		}
		return this.source.charAt(this.currentIndex);
	}

	private peekNext(): string {
		if (this.currentIndex + 1 >= this.source.length) {
			return '\0';
		}
		return this.source.charAt(this.currentIndex + 1);
	}

	private peekIsDigit(): boolean {
		return this.isDigit(this.peek());
	}

	private peekNextIsDigit(): boolean {
		return this.isDigit(this.peekNext());
	}

	private isDigit(char: string): boolean {
		return char >= '0' && char <= '9';
	}

	private isIdentifierStart(char: string): boolean {
		return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '_';
	}

	private isIdentifierPart(char: string): boolean {
		return this.isIdentifierStart(char) || this.isDigit(char);
	}

	private isAtEnd(): boolean {
		return this.currentIndex >= this.source.length;
	}

	private currentLexeme(): string {
		return this.source.slice(this.tokenStartIndex, this.currentIndex);
	}

	public getChunkName(): string {
		return this.chunkName;
	}
}
