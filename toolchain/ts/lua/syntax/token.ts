import type { LuaSyntaxSpan } from './source_locations';

export const enum LuaTokenType {
	LeftParen,
	RightParen,
	LeftBrace,
	RightBrace,
	LeftBracket,
	RightBracket,
	Plus,
	PlusEqual,
	Minus,
	Arrow,
	MinusEqual,
	Star,
	StarEqual,
	Slash,
	SlashEqual,
	Percent,
	PercentEqual,
	Caret,
	CaretEqual,
	Hash,
	Ampersand,
	Pipe,
	Tilde,
	Equal,
	EqualEqual,
	TildeEqual,
	Less,
	LessEqual,
	Greater,
	GreaterEqual,
	ShiftLeft,
	ShiftRight,
	FloorDivide,
	Colon,
	DoubleColon,
	Semicolon,
	Comma,
	Dot,
	DotDot,
	String,
	Number,
	Identifier,
	And,
	Break,
	Do,
	Else,
	ElseIf,
	End,
	False,
	For,
	Function,
	Goto,
	HaltUntilIrq,
	If,
	In,
	Local,
	Nil,
	Not,
	Or,
	Repeat,
	Return,
	Then,
	True,
	Until,
	While,
	Vararg,
	Eof,
	WhitespaceTrivia,
	NewLineTrivia,
	SingleLineCommentTrivia,
	MultiLineCommentTrivia,
}

export function isLuaTrivia(type: LuaTokenType): boolean {
	return type >= LuaTokenType.WhitespaceTrivia && type <= LuaTokenType.MultiLineCommentTrivia;
}

export type LuaTokenLiteral = number | string | boolean;

/** A token is a lexical-block-relative span, not a node wrapping another span. */
export type LuaToken = LuaSyntaxSpan & {
	readonly type: LuaTokenType;
	/** Grammar spelling; terminal failure text belongs to the source, not EOF. */
	readonly lexeme: string;
	readonly literal: LuaTokenLiteral;
	/** Full source coverage; a failed lexer's EOF also owns its skipped suffix. */
	readonly width: number;
	/** Exclusive farthest inspected UTF-16 offset, relative to this item start. */
	readonly readWidth: number;
	/** LF count across full coverage, including a terminal failure suffix. */
	readonly breaks: number;
	/** Raw lexical failure on EOF, formatted against its source generation. */
	readonly error?: string;
};

export function resolveKeyword(identifier: string): LuaTokenType {
	switch (identifier) {
		case 'and':
			return LuaTokenType.And;
		case 'break':
			return LuaTokenType.Break;
		case 'do':
			return LuaTokenType.Do;
		case 'else':
			return LuaTokenType.Else;
		case 'elseif':
			return LuaTokenType.ElseIf;
		case 'end':
			return LuaTokenType.End;
		case 'false':
			return LuaTokenType.False;
		case 'for':
			return LuaTokenType.For;
		case 'function':
			return LuaTokenType.Function;
		case 'goto':
			return LuaTokenType.Goto;
		case 'halt_until_irq':
			return LuaTokenType.HaltUntilIrq;
		case 'if':
			return LuaTokenType.If;
		case 'in':
			return LuaTokenType.In;
		case 'local':
			return LuaTokenType.Local;
		case 'nil':
			return LuaTokenType.Nil;
		case 'not':
			return LuaTokenType.Not;
		case 'or':
			return LuaTokenType.Or;
		case 'repeat':
			return LuaTokenType.Repeat;
		case 'return':
			return LuaTokenType.Return;
		case 'then':
			return LuaTokenType.Then;
		case 'true':
			return LuaTokenType.True;
		case 'until':
			return LuaTokenType.Until;
		case 'while':
			return LuaTokenType.While;
		default:
			return null;
	}
}
export const KEYWORDS = new Set([
	'and',
	'break',
	'do',
	'else',
	'elseif',
	'end',
	'false',
	'for',
	'function',
	'goto',
	'halt_until_irq',
	'if',
	'in',
	'local',
	'nil',
	'not',
	'or',
	'repeat',
	'return',
	'then',
	'true',
	'until',
	'while',
]);
