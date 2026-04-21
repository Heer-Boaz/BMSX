#include "lexer.h"
#include "core/primitives.h"
#include <cmath>
#include <cstdlib>
#include <utility>

namespace bmsx {

LuaTokenType resolveKeyword(std::string_view identifier) {
	if (identifier == "and") {
		return LuaTokenType::And;
	}
	if (identifier == "break") {
		return LuaTokenType::Break;
	}
	if (identifier == "do") {
		return LuaTokenType::Do;
	}
	if (identifier == "else") {
		return LuaTokenType::Else;
	}
	if (identifier == "elseif") {
		return LuaTokenType::ElseIf;
	}
	if (identifier == "end") {
		return LuaTokenType::End;
	}
	if (identifier == "false") {
		return LuaTokenType::False;
	}
	if (identifier == "for") {
		return LuaTokenType::For;
	}
	if (identifier == "function") {
		return LuaTokenType::Function;
	}
	if (identifier == "goto") {
		return LuaTokenType::Goto;
	}
	if (identifier == "if") {
		return LuaTokenType::If;
	}
	if (identifier == "in") {
		return LuaTokenType::In;
	}
	if (identifier == "local") {
		return LuaTokenType::Local;
	}
	if (identifier == "nil") {
		return LuaTokenType::Nil;
	}
	if (identifier == "not") {
		return LuaTokenType::Not;
	}
	if (identifier == "or") {
		return LuaTokenType::Or;
	}
	if (identifier == "repeat") {
		return LuaTokenType::Repeat;
	}
	if (identifier == "return") {
		return LuaTokenType::Return;
	}
	if (identifier == "then") {
		return LuaTokenType::Then;
	}
	if (identifier == "true") {
		return LuaTokenType::True;
	}
	if (identifier == "until") {
		return LuaTokenType::Until;
	}
	if (identifier == "while") {
		return LuaTokenType::While;
	}
	return LuaTokenType::Identifier;
}

LuaLexer::LuaLexer(std::string_view source, std::string_view path)
	: m_source(source)
	, m_path(path) {
}

std::vector<LuaToken> LuaLexer::scanTokens() {
	std::vector<LuaToken> tokens;
	while (!isAtEnd()) {
		beginToken();
		scanToken(tokens);
	}
	tokens.push_back({
		.type = LuaTokenType::Eof,
		.lexeme = std::string(),
		.line = m_line,
		.column = m_column,
		.literal = std::monostate(),
	});
	return tokens;
}

void LuaLexer::beginToken() {
	m_tokenStartIndex = m_currentIndex;
	m_tokenStartLine = m_line;
	m_tokenStartColumn = m_column;
}

void LuaLexer::scanToken(std::vector<LuaToken>& tokens) {
	const char ch = advance();
	switch (ch) {
		case '(':
			pushToken(tokens, LuaTokenType::LeftParen);
			return;
		case ')':
			pushToken(tokens, LuaTokenType::RightParen);
			return;
		case '{':
			pushToken(tokens, LuaTokenType::LeftBrace);
			return;
		case '}':
			pushToken(tokens, LuaTokenType::RightBrace);
			return;
		case '[': {
				const int level = determineLongBracketLevelAt(m_currentIndex - 1);
				if (level >= 0) {
					consumeLongBracketDelimiter(level, '[');
					pushLiteralToken(tokens, LuaTokenType::String, readLongString(level));
					return;
				}
			pushToken(tokens, LuaTokenType::LeftBracket);
			return;
		}
		case ']':
			pushToken(tokens, LuaTokenType::RightBracket);
			return;
		case ',':
			pushToken(tokens, LuaTokenType::Comma);
			return;
		case ';':
			pushToken(tokens, LuaTokenType::Semicolon);
			return;
		case '+':
			pushToken(tokens, match('=') ? LuaTokenType::PlusEqual : LuaTokenType::Plus);
			return;
		case '-':
			if (match('-')) {
				skipComment();
				return;
			}
			pushToken(tokens, match('=') ? LuaTokenType::MinusEqual : LuaTokenType::Minus);
			return;
		case '*':
			pushToken(tokens, match('=') ? LuaTokenType::StarEqual : LuaTokenType::Star);
			return;
		case '/':
			if (match('/')) {
				pushToken(tokens, LuaTokenType::FloorDivide);
				return;
			}
			pushToken(tokens, match('=') ? LuaTokenType::SlashEqual : LuaTokenType::Slash);
			return;
		case '%':
			pushToken(tokens, match('=') ? LuaTokenType::PercentEqual : LuaTokenType::Percent);
			return;
		case '^':
			pushToken(tokens, match('=') ? LuaTokenType::CaretEqual : LuaTokenType::Caret);
			return;
		case '#':
			pushToken(tokens, LuaTokenType::Hash);
			return;
		case '=':
			pushToken(tokens, match('=') ? LuaTokenType::EqualEqual : LuaTokenType::Equal);
			return;
		case '<':
			if (match('<')) {
				pushToken(tokens, LuaTokenType::ShiftLeft);
				return;
			}
			pushToken(tokens, match('=') ? LuaTokenType::LessEqual : LuaTokenType::Less);
			return;
		case '>':
			if (match('>')) {
				pushToken(tokens, LuaTokenType::ShiftRight);
				return;
			}
			pushToken(tokens, match('=') ? LuaTokenType::GreaterEqual : LuaTokenType::Greater);
			return;
		case '~':
			pushToken(tokens, match('=') ? LuaTokenType::TildeEqual : LuaTokenType::Tilde);
			return;
		case '&':
			pushToken(tokens, LuaTokenType::Ampersand);
			return;
		case '|':
			pushToken(tokens, LuaTokenType::Pipe);
			return;
		case ':':
			pushToken(tokens, match(':') ? LuaTokenType::DoubleColon : LuaTokenType::Colon);
			return;
		case '.':
			if (LuaLexer::isDigit(currentChar())) {
				scanNumber(tokens, true);
				return;
			}
			if (match('.')) {
				pushToken(tokens, match('.') ? LuaTokenType::Vararg : LuaTokenType::DotDot);
				return;
			}
			pushToken(tokens, LuaTokenType::Dot);
			return;
		case '"':
		case '\'':
			scanString(tokens, ch);
			return;
		case ' ':
		case '\r':
		case '\t':
		case '\v':
			return;
		case '\n':
			return;
		default:
			if (LuaLexer::isDigit(ch)) {
				scanNumber(tokens, false);
				return;
			}
			if (LuaLexer::isIdentifierStart(ch)) {
				scanIdentifier(tokens);
				return;
			}
			fail(std::string("Unexpected character '") + ch + "'.");
	}
}

void LuaLexer::skipComment() {
	if (currentChar() == '[') {
			const int level = determineLongBracketLevelAt(m_currentIndex);
			if (level >= 0) {
				advance();
				consumeLongBracketDelimiter(level, '[');
				skipLongBracketContent(level);
				return;
			}
	}
	skipLineComment();
}

void LuaLexer::skipLineComment() {
	while (!isAtEnd() && currentChar() != '\n') {
		advance();
	}
}

void LuaLexer::scanIdentifier(std::vector<LuaToken>& tokens) {
	while (LuaLexer::isIdentifierPart(currentChar())) {
		advance();
	}
	const std::string lexeme = currentLexeme();
	const LuaTokenType keywordType = resolveKeyword(lexeme);
	if (keywordType == LuaTokenType::True) {
		pushIdentifierToken(tokens, keywordType, lexeme, true, true);
		return;
	}
	if (keywordType == LuaTokenType::False) {
		pushIdentifierToken(tokens, keywordType, lexeme, true, false);
		return;
	}
	pushIdentifierToken(tokens, keywordType, lexeme, false, false);
}

void LuaLexer::scanNumber(std::vector<LuaToken>& tokens, bool startedWithDot) {
	if (!startedWithDot && charAtIndex(m_tokenStartIndex) == '0' && (currentChar() == 'x' || currentChar() == 'X')) {
		advance();
		scanHexadecimalLiteral(tokens);
		return;
	}
	if (startedWithDot) {
		consumeDigits();
	} else {
		consumeDigits();
		if (currentChar() == '.' && LuaLexer::isDigit(nextChar())) {
			advance();
			consumeDigits();
		}
	}
	if (currentChar() == 'e' || currentChar() == 'E') {
		scanDecimalExponent();
	}
	const std::string lexeme = currentLexeme();
	const double parsed = std::strtod(lexeme.c_str(), nullptr);
	if (!std::isfinite(parsed)) {
		fail("Numeric literal is not finite.");
	}
	pushLiteralToken(tokens, LuaTokenType::Number, parsed);
}

void LuaLexer::scanString(std::vector<LuaToken>& tokens, char delimiter) {
	std::string value;
	bool terminated = false;
	while (!isAtEnd()) {
		const char ch = advance();
		if (ch == delimiter) {
			terminated = true;
			break;
		}
		if (ch == '\n') {
			fail("Unterminated string literal.");
		}
		if (ch == '\\') {
			value += translateEscape();
			continue;
		}
		value.push_back(ch);
	}
	if (!terminated) {
		fail("Unterminated string literal.");
	}
	pushLiteralToken(tokens, LuaTokenType::String, value);
}

std::string LuaLexer::translateEscape() {
	const char code = advance();
	switch (code) {
		case 'a': return std::string(1, '\a');
		case 'b': return std::string(1, '\b');
		case 'f': return std::string(1, '\f');
		case 'n': return std::string(1, '\n');
		case 'r': return std::string(1, '\r');
		case 't': return std::string(1, '\t');
		case 'v': return std::string(1, '\v');
		case '\\': return std::string(1, '\\');
		case '"': return std::string(1, '"');
		case '\'': return std::string(1, '\'');
		case 'z':
			skipWhitespaceSequence();
			return std::string();
		case 'x': {
			const std::string hexDigits = readHexEscapeDigits(2);
			return std::string(1, static_cast<char>(std::stoi(hexDigits, nullptr, 16)));
		}
		default:
			if (LuaLexer::isDigit(code)) {
				std::string digits(1, code);
				for (int index = 0; index < 2 && LuaLexer::isDigit(currentChar()); index += 1) {
					digits.push_back(advance());
				}
				const int value = std::stoi(digits, nullptr, 10);
				if (value < 0 || value > 255) {
					fail("Invalid decimal escape sequence.");
				}
				return std::string(1, static_cast<char>(value));
			}
			fail(std::string("Unsupported escape sequence '\\") + code + "'.");
	}
}

void LuaLexer::consumeDigits() {
	while (LuaLexer::isDigit(currentChar())) {
		advance();
	}
}

void LuaLexer::scanDecimalExponent() {
	const size_t markerIndex = m_currentIndex;
	advance();
	if (currentChar() == '+' || currentChar() == '-') {
		advance();
	}
	if (!LuaLexer::isDigit(currentChar())) {
		fail("Invalid numeric literal exponent.");
	}
	consumeDigits();
	if (m_currentIndex == markerIndex + 1) {
		fail("Invalid numeric literal exponent.");
	}
}

void LuaLexer::scanHexadecimalLiteral(std::vector<LuaToken>& tokens) {
	bool hasDigits = false;
	while (LuaLexer::isHexDigit(currentChar())) {
		advance();
		hasDigits = true;
	}
	if (currentChar() == '.') {
		advance();
		while (LuaLexer::isHexDigit(currentChar())) {
			advance();
			hasDigits = true;
		}
	}
	if (!hasDigits) {
		fail("Hexadecimal literal requires digits.");
	}
	if (currentChar() == 'p' || currentChar() == 'P') {
		advance();
		if (currentChar() == '+' || currentChar() == '-') {
			advance();
		}
		if (!LuaLexer::isDigit(currentChar())) {
			fail("Hexadecimal literal requires binary exponent.");
		}
		consumeDigits();
	}
	const std::string lexeme = currentLexeme();
	const double parsed = parseHexLiteral(lexeme);
	if (!std::isfinite(parsed)) {
		fail("Numeric literal is not finite.");
	}
	pushLiteralToken(tokens, LuaTokenType::Number, parsed);
}

void LuaLexer::skipWhitespaceSequence() {
	while (!isAtEnd() && LuaLexer::isWhitespace(currentChar())) {
		advance();
	}
}

std::string LuaLexer::readHexEscapeDigits(int required) {
	std::string digits;
	for (int index = 0; index < required; index += 1) {
		const char next = currentChar();
		if (!LuaLexer::isHexDigit(next)) {
			fail("Invalid hexadecimal escape sequence.");
		}
		digits.push_back(advance());
	}
	return digits;
}

int LuaLexer::determineLongBracketLevelAt(size_t index) const {
	if (charAtIndex(index) != '[') {
		return -1;
	}
	int level = 0;
	size_t cursor = index + 1;
	while (cursor < m_source.size() && charAtIndex(cursor) == '=') {
		level += 1;
		cursor += 1;
	}
	return (cursor < m_source.size() && charAtIndex(cursor) == '[') ? level : -1;
}

void LuaLexer::consumeLongBracketDelimiter(int level, char edge) {
	for (int index = 0; index < level; index += 1) {
		if (advance() != '=') {
			fail("Malformed long string delimiter.");
		}
	}
	if (advance() != edge) {
		fail("Malformed long string delimiter.");
	}
}

std::string LuaLexer::readLongString(int level) {
	consumeOptionalLineBreak();
	std::string value;
	while (!isAtEnd()) {
		const char ch = advance();
		if (ch == ']' && checkLongBracketClose(level)) {
			consumeLongBracketDelimiter(level, ']');
			return value;
		}
		value.push_back(ch);
	}
	fail("Unterminated long string literal.");
}

void LuaLexer::skipLongBracketContent(int level) {
	consumeOptionalLineBreak();
	while (!isAtEnd()) {
		const char ch = advance();
		if (ch == ']' && checkLongBracketClose(level)) {
			consumeLongBracketDelimiter(level, ']');
			return;
		}
	}
	fail("Unterminated block comment.");
}

bool LuaLexer::checkLongBracketClose(int level) const {
	size_t index = m_currentIndex;
	for (int count = 0; count < level; count += 1) {
		if (charAtIndex(index) != '=') {
			return false;
		}
		index += 1;
	}
	return charAtIndex(index) == ']';
}

void LuaLexer::consumeOptionalLineBreak() {
	const char next = currentChar();
	if (next == '\r') {
		advance();
		if (currentChar() == '\n') {
			advance();
		}
	} else if (next == '\n') {
		advance();
	}
}

char LuaLexer::charAtIndex(size_t index) const {
	return index < m_source.size() ? m_source[index] : '\0';
}

double LuaLexer::parseHexLiteral(const std::string& lexeme) const {
	const size_t prefixSize = 2;
	size_t cursor = prefixSize;
	std::string integerPart;
	while (cursor < lexeme.size() && LuaLexer::isHexDigit(lexeme[cursor])) {
		integerPart.push_back(lexeme[cursor]);
		cursor += 1;
	}
	std::string fractionalPart;
	if (cursor < lexeme.size() && lexeme[cursor] == '.') {
		cursor += 1;
		while (cursor < lexeme.size() && LuaLexer::isHexDigit(lexeme[cursor])) {
			fractionalPart.push_back(lexeme[cursor]);
			cursor += 1;
		}
	}
	std::string exponentPart = "0";
	if (cursor < lexeme.size() && (lexeme[cursor] == 'p' || lexeme[cursor] == 'P')) {
		cursor += 1;
		exponentPart = lexeme.substr(cursor);
	}
	if (integerPart.empty() && fractionalPart.empty()) {
		fail("Hexadecimal literal requires digits.");
	}
	double value = 0.0;
	for (size_t index = 0; index < integerPart.size(); index += 1) {
		value = value * 16.0 + static_cast<double>(std::stoi(std::string(1, integerPart[index]), nullptr, 16));
	}
	double fraction = 0.0;
	for (size_t index = 0; index < fractionalPart.size(); index += 1) {
		const int digit = std::stoi(std::string(1, fractionalPart[index]), nullptr, 16);
		fraction += static_cast<double>(digit) / std::pow(16.0, static_cast<double>(index + 1));
	}
	const int exponent = std::stoi(exponentPart, nullptr, 10);
	return (value + fraction) * std::pow(2.0, static_cast<double>(exponent));
}

void LuaLexer::pushToken(std::vector<LuaToken>& tokens, LuaTokenType type) {
	tokens.push_back({
		.type = type,
		.lexeme = currentLexeme(),
		.line = m_tokenStartLine,
		.column = m_tokenStartColumn,
		.literal = std::monostate(),
	});
}

void LuaLexer::pushLiteralToken(std::vector<LuaToken>& tokens, LuaTokenType type, LuaTokenLiteral literal) {
	tokens.push_back({
		.type = type,
		.lexeme = currentLexeme(),
		.line = m_tokenStartLine,
		.column = m_tokenStartColumn,
		.literal = std::move(literal),
	});
}

void LuaLexer::pushBooleanToken(std::vector<LuaToken>& tokens, LuaTokenType type, bool value) {
	tokens.push_back({
		.type = type,
		.lexeme = currentLexeme(),
		.line = m_tokenStartLine,
		.column = m_tokenStartColumn,
		.literal = value,
	});
}

void LuaLexer::pushIdentifierToken(std::vector<LuaToken>& tokens, LuaTokenType type, const std::string& lexeme, bool hasBooleanLiteral, bool booleanLiteral) {
	tokens.push_back({
		.type = type,
		.lexeme = lexeme,
		.line = m_tokenStartLine,
		.column = m_tokenStartColumn,
		.literal = hasBooleanLiteral ? LuaTokenLiteral(booleanLiteral) : LuaTokenLiteral(std::monostate()),
	});
}

char LuaLexer::advance() {
	const char ch = m_source[m_currentIndex];
	m_currentIndex += 1;
	if (ch == '\n') {
		m_line += 1;
		m_column = 1;
	} else {
		m_column += 1;
	}
	return ch;
}

bool LuaLexer::match(char expected) {
	if (charAtIndex(m_currentIndex) != expected) {
		return false;
	}
	advance();
	return true;
}

char LuaLexer::currentChar() const {
	return charAtIndex(m_currentIndex);
}

char LuaLexer::nextChar() const {
	return charAtIndex(m_currentIndex + 1);
}

bool LuaLexer::isWhitespace(char ch) {
	const unsigned char code = static_cast<unsigned char>(ch);
	return code == 32 || code == 9 || code == 13 || code == 10 || code == 11 || code == 12;
}

bool LuaLexer::isDigit(char ch) {
	const unsigned char code = static_cast<unsigned char>(ch);
	return code >= 48 && code <= 57;
}

bool LuaLexer::isHexDigit(char ch) {
	const unsigned char code = static_cast<unsigned char>(ch);
	return (code >= 48 && code <= 57) || (code >= 97 && code <= 102) || (code >= 65 && code <= 70);
}

bool LuaLexer::isIdentifierStart(char ch) {
	const unsigned char code = static_cast<unsigned char>(ch);
	return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code == 95 || code == 36;
}

bool LuaLexer::isIdentifierPart(char ch) {
	const unsigned char code = static_cast<unsigned char>(ch);
	return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code == 95 || code == 36 || (code >= 48 && code <= 57);
}

bool LuaLexer::isAtEnd() const {
	return m_currentIndex >= m_source.size();
}

std::string LuaLexer::currentLexeme() const {
	return std::string(m_source.substr(m_tokenStartIndex, m_currentIndex - m_tokenStartIndex));
}

void LuaLexer::fail(const std::string& message) const {
	throw BMSX_RUNTIME_ERROR("[LuaLexer] " + message + " path=" + m_path + " line=" + std::to_string(m_tokenStartLine) + " column=" + std::to_string(m_tokenStartColumn) + ".");
}

} // namespace bmsx
