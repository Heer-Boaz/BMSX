import { LuaSyntaxError } from './errors';
import type { LuaToken, LuaTokenLiteral } from './token';
import { LuaTokenType, resolveKeyword } from './token';

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
			case '[':
				this.pushToken(tokens, LuaTokenType.LeftBracket, null);
				return;
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
				this.pushToken(tokens, LuaTokenType.Plus, null);
				return;
			case '-':
				if (this.match('-')) {
					this.skipComment();
					return;
				}
				this.pushToken(tokens, LuaTokenType.Minus, null);
				return;
			case '*':
				this.pushToken(tokens, LuaTokenType.Star, null);
				return;
			case '/':
				this.pushToken(tokens, LuaTokenType.Slash, null);
				return;
			case '%':
				this.pushToken(tokens, LuaTokenType.Percent, null);
				return;
			case '^':
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
				if (this.match('=')) {
					this.pushToken(tokens, LuaTokenType.LessEqual, null);
					return;
				}
				this.pushToken(tokens, LuaTokenType.Less, null);
				return;
			case '>':
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
				throw new LuaSyntaxError(`[LuaLexer] Unexpected character '~'.`, this.chunkName, this.tokenStartLine, this.tokenStartColumn);
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
		if (this.peek() === '[' && this.peekNext() === '[') {
			this.advance();
			this.advance();
			this.skipBlockComment();
			return;
		}
		this.skipLineComment();
	}

	private skipLineComment(): void {
		while (!this.isAtEnd() && this.peek() !== '\n') {
			this.advance();
		}
	}

	private skipBlockComment(): void {
		while (!this.isAtEnd()) {
			if (this.peek() === ']' && this.peekNext() === ']') {
				this.advance();
				this.advance();
				return;
			}
			this.advance();
		}
		throw new LuaSyntaxError('[LuaLexer] Unterminated block comment.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
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
		if (startedWithDot) {
			while (this.isDigit(this.peek())) {
				this.advance();
			}
		}
		else {
			while (this.isDigit(this.peek())) {
				this.advance();
			}
			if (this.peek() === '.' && this.peekNextIsDigit()) {
				this.advance();
				while (this.isDigit(this.peek())) {
					this.advance();
				}
			}
		}
		if (this.peek() === 'e' || this.peek() === 'E') {
			const exponentMarkerIndex = this.currentIndex;
			this.advance();
			if (this.peek() === '+' || this.peek() === '-') {
				this.advance();
			}
			if (!this.isDigit(this.peek())) {
				throw new LuaSyntaxError('[LuaLexer] Invalid numeric literal exponent.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
			}
			while (this.isDigit(this.peek())) {
				this.advance();
			}
			if (this.currentIndex === exponentMarkerIndex + 1) {
				throw new LuaSyntaxError('[LuaLexer] Invalid numeric literal exponent.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
			}
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
				const escaped = this.advance();
				value += this.translateEscape(escaped);
				continue;
			}
			value += char;
		}
		if (!terminated) {
			throw new LuaSyntaxError('[LuaLexer] Unterminated string literal.', this.chunkName, this.tokenStartLine, this.tokenStartColumn);
		}
		this.pushToken(tokens, LuaTokenType.String, value);
	}

	private translateEscape(code: string): string {
		switch (code) {
			case 'n':
				return '\n';
			case 'r':
				return '\r';
			case 't':
				return '\t';
			case '\\':
				return '\\';
			case '"':
				return '"';
			case '\'':
				return '\'';
			case '0':
				return '\0';
			default:
				throw new LuaSyntaxError(`[LuaLexer] Unsupported escape sequence '\\${code}'.`, this.chunkName, this.line, this.column);
		}
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
