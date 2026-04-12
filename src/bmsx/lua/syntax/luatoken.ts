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
}

export type LuaTokenLiteral = number | string | boolean;

export type LuaToken = {
	readonly type: LuaTokenType;
	readonly lexeme: string;
	readonly line: number;
	readonly column: number;
	readonly literal: LuaTokenLiteral;
};

export function resolveKeyword(identifier: string): LuaTokenType {
	const key = identifier.toLowerCase();
	switch (key) {
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
