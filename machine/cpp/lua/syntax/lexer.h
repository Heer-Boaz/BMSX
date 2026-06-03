#pragma once

#include <string>
#include <string_view>
#include <vector>
#include <variant>

namespace bmsx {

enum class LuaTokenType {
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
};

using LuaTokenLiteral = std::variant<std::monostate, double, std::string, bool>;

struct LuaToken {
	LuaTokenType type = LuaTokenType::Eof;
	std::string lexeme;
	int line = 1;
	int column = 1;
	LuaTokenLiteral literal;
};

LuaTokenType resolveKeyword(std::string_view identifier);

class LuaLexer {
public:
	LuaLexer(std::string_view source, std::string_view path);

	std::vector<LuaToken> scanTokens();

	static bool isWhitespace(char ch);
	static bool isDigit(char ch);
	static bool isHexDigit(char ch);
	static bool isIdentifierStart(char ch);
	static bool isIdentifierPart(char ch);

private:
	std::string_view m_source;
	std::string m_path;
	size_t m_currentIndex = 0;
	int m_line = 1;
	int m_column = 1;
	size_t m_tokenStartIndex = 0;
	int m_tokenStartLine = 1;
	int m_tokenStartColumn = 1;

	void beginToken();
	void scanToken(std::vector<LuaToken>& tokens);
	void skipComment();
	void skipLineComment();
	void scanIdentifier(std::vector<LuaToken>& tokens);
	void scanNumber(std::vector<LuaToken>& tokens, bool startedWithDot);
	void scanString(std::vector<LuaToken>& tokens, char delimiter);
	std::string translateEscape();
	void consumeDigits();
	void scanDecimalExponent();
	void scanHexadecimalLiteral(std::vector<LuaToken>& tokens);
	void skipWhitespaceSequence();
		std::string readHexEscapeDigits(int required);
		int determineLongBracketLevelAt(size_t index) const;
		void consumeLongBracketDelimiter(int level, char edge);
		std::string readLongString(int level);
		void skipLongBracketContent(int level);
		bool checkLongBracketClose(int level) const;
		void consumeOptionalLineBreak();
		char charAtIndex(size_t index) const;

		double parseHexLiteral(const std::string& lexeme) const;
		void pushToken(std::vector<LuaToken>& tokens, LuaTokenType type);
		void pushLiteralToken(std::vector<LuaToken>& tokens, LuaTokenType type, LuaTokenLiteral literal);
	void pushBooleanToken(std::vector<LuaToken>& tokens, LuaTokenType type, bool value);
	void pushIdentifierToken(std::vector<LuaToken>& tokens, LuaTokenType type, const std::string& lexeme, bool hasBooleanLiteral, bool booleanLiteral);
	char advance();
	bool match(char expected);
	char currentChar() const;
	char nextChar() const;
	bool isAtEnd() const;
	std::string currentLexeme() const;
	[[noreturn]] void fail(const std::string& message) const;
};

} // namespace bmsx
