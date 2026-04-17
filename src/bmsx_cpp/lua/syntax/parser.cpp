#include "parser.h"
#include "core/primitives.h"

namespace bmsx {

LuaParser::LuaParser(const std::vector<LuaToken>& tokens, std::string_view path, std::string_view source)
	: m_tokens(tokens)
	, m_path(path) {
	(void)source;
}

LuaChunk LuaParser::parseChunk() {
	LuaBlock block = parseBlock({ LuaTokenType::Eof });
	const LuaToken& eofToken = consume(LuaTokenType::Eof, "expected end of input.");
	LuaChunk chunk;
	chunk.range = rangeFromPositions(block.range.start, positionFromToken(eofToken));
	chunk.body = std::move(block.body);
	return chunk;
}

LuaBlock LuaParser::parseBlock(const std::vector<LuaTokenType>& terminators) {
	const LuaToken& startToken = current();
	LuaBlock block;
	while (!isAtEnd() && !checkAny(terminators)) {
		if (match(LuaTokenType::Semicolon)) {
			continue;
		}
		block.body.push_back(parseStatement());
	}
	if (block.body.empty()) {
		const LuaSourcePosition position = positionFromToken(startToken);
		block.range = rangeFromPositions(position, position);
		return block;
	}
	block.range = rangeFromPositions(block.body.front().range.start, block.body.back().range.end);
	return block;
}

LuaStatement LuaParser::parseStatement() {
	if (current().type == LuaTokenType::Return) {
		return parseReturnStatement();
	}
	return parseAssignmentOrCall();
}

LuaStatement LuaParser::parseReturnStatement() {
	const LuaToken& returnToken = advance();
	LuaStatement statement;
	statement.kind = LuaSyntaxKind::ReturnStatement;
	if (isReturnTerminator(current().type)) {
		const LuaSourcePosition position = positionFromToken(returnToken);
		statement.range = rangeFromPositions(position, position);
		return statement;
	}
	statement.expressions.push_back(parseExpression());
	while (match(LuaTokenType::Comma)) {
		statement.expressions.push_back(parseExpression());
	}
	statement.range = rangeFromTokenAndExpression(returnToken, statement.expressions.back());
	return statement;
}

LuaStatement LuaParser::parseAssignmentOrCall() {
	LuaStatement statement;
	statement.kind = LuaSyntaxKind::AssignmentStatement;
	statement.assignmentOperator = LuaAssignmentOperator::Assign;
	statement.left.push_back(parseSuffixedExpression());
	ensureAssignable(statement.left.back());
	while (match(LuaTokenType::Comma)) {
		statement.left.push_back(parseSuffixedExpression());
		ensureAssignable(statement.left.back());
	}
	consume(LuaTokenType::Equal, "expected '='.");
	statement.right.push_back(parseExpression());
	while (match(LuaTokenType::Comma)) {
		statement.right.push_back(parseExpression());
	}
	statement.range = rangeFromExpressionAndExpression(statement.left.front(), statement.right.back());
	return statement;
}

LuaExpression LuaParser::parseExpression() {
	if (current().type == LuaTokenType::Function) {
		return parseFunctionExpression();
	}
	return parseUnaryExpression();
}

LuaExpression LuaParser::parseUnaryExpression() {
	if (check(LuaTokenType::Ampersand) && m_index + 1 < m_tokens.size() && m_tokens[m_index + 1].type == LuaTokenType::String) {
		const LuaToken& ampersandToken = advance();
		const LuaToken& stringToken = advance();
		LuaExpression expression;
		expression.kind = LuaSyntaxKind::StringRefLiteralExpression;
		expression.stringValue = std::get<std::string>(stringToken.literal);
		expression.range = rangeFromTokenAndToken(ampersandToken, stringToken);
		return expression;
	}
	if (match(LuaTokenType::Minus)) {
		const LuaToken& operatorToken = m_tokens[m_index - 1];
		LuaExpression operand = parseUnaryExpression();
		LuaExpression expression;
		expression.kind = LuaSyntaxKind::UnaryExpression;
		expression.unaryOperator = LuaUnaryOperator::Negate;
		expression.operand = std::make_unique<LuaExpression>(std::move(operand));
		expression.range = rangeFromPositions(positionFromToken(operatorToken), expression.operand->range.end);
		return expression;
	}
	switch (current().type) {
		case LuaTokenType::Nil: {
			const LuaToken& token = advance();
			LuaExpression expression;
			expression.kind = LuaSyntaxKind::NilLiteralExpression;
			expression.range = rangeFromTokenAndToken(token, token);
			return expression;
		}
		case LuaTokenType::True:
		case LuaTokenType::False: {
			const LuaToken& token = advance();
			LuaExpression expression;
			expression.kind = LuaSyntaxKind::BooleanLiteralExpression;
			expression.boolValue = std::get<bool>(token.literal);
			expression.range = rangeFromTokenAndToken(token, token);
			return expression;
		}
		case LuaTokenType::Number: {
			const LuaToken& token = advance();
			LuaExpression expression;
			expression.kind = LuaSyntaxKind::NumericLiteralExpression;
			expression.numberValue = std::get<double>(token.literal);
			expression.range = rangeFromTokenAndToken(token, token);
			return expression;
		}
		case LuaTokenType::String: {
			const LuaToken& token = advance();
			LuaExpression expression;
			expression.kind = LuaSyntaxKind::StringLiteralExpression;
			expression.stringValue = std::get<std::string>(token.literal);
			expression.range = rangeFromTokenAndToken(token, token);
			return expression;
		}
		default:
			return parseSuffixedExpression();
	}
}

LuaExpression LuaParser::parseSuffixedExpression() {
	LuaExpression expression = parsePrimaryExpression();
	for (;;) {
		if (match(LuaTokenType::Dot)) {
			const LuaToken& keyToken = consume(LuaTokenType::Identifier, "expected identifier after '.'.");
			LuaExpression member;
			member.kind = LuaSyntaxKind::MemberExpression;
			member.base = std::make_unique<LuaExpression>(std::move(expression));
			member.name = keyToken.lexeme;
			member.range = rangeFromPositions(member.base->range.start, positionFromToken(keyToken));
			expression = std::move(member);
			continue;
		}
		if (match(LuaTokenType::LeftBracket)) {
			LuaExpression index = parseExpression();
			const LuaToken& rightBracket = consume(LuaTokenType::RightBracket, "expected ']'.");
			LuaExpression indexed;
			indexed.kind = LuaSyntaxKind::IndexExpression;
			indexed.base = std::make_unique<LuaExpression>(std::move(expression));
			indexed.index = std::make_unique<LuaExpression>(std::move(index));
			indexed.range = rangeFromPositions(indexed.base->range.start, positionFromToken(rightBracket));
			expression = std::move(indexed);
			continue;
		}
		return expression;
	}
}

LuaExpression LuaParser::parsePrimaryExpression() {
	const LuaToken& token = current();
	if (token.type != LuaTokenType::Identifier) {
		fail(token, "expected an expression.");
	}
	advance();
	LuaExpression expression;
	expression.kind = LuaSyntaxKind::IdentifierExpression;
	expression.name = token.lexeme;
	expression.range = rangeFromTokenAndToken(token, token);
	return expression;
}

LuaExpression LuaParser::parseFunctionExpression() {
	const LuaToken& functionToken = consume(LuaTokenType::Function, "expected 'function'.");
	auto functionValue = std::make_unique<LuaFunctionExpression>();
	consume(LuaTokenType::LeftParen, "expected '('.");
	parseFunctionParameters(*functionValue);
	functionValue->body = parseBlock({ LuaTokenType::End });
	const LuaToken& endToken = consume(LuaTokenType::End, "expected 'end'.");
	functionValue->range = rangeFromTokenAndToken(functionToken, endToken);
	LuaExpression expression;
	expression.kind = LuaSyntaxKind::FunctionExpression;
	expression.range = functionValue->range;
	expression.functionValue = std::move(functionValue);
	return expression;
}

void LuaParser::parseFunctionParameters(LuaFunctionExpression& fn) {
	if (match(LuaTokenType::RightParen)) {
		return;
	}
	for (;;) {
		if (match(LuaTokenType::Vararg)) {
			fn.hasVararg = true;
			consume(LuaTokenType::RightParen, "expected ')' after '...'.");
			return;
		}
		const LuaToken& nameToken = consume(LuaTokenType::Identifier, "expected parameter name.");
		for (const LuaIdentifier& parameter : fn.parameters) {
			if (parameter.name == nameToken.lexeme) {
				fail(nameToken, "duplicate function parameter '" + nameToken.lexeme + "'.");
			}
		}
		fn.parameters.push_back({
			.name = nameToken.lexeme,
			.range = rangeFromTokenAndToken(nameToken, nameToken),
		});
		if (match(LuaTokenType::RightParen)) {
			return;
		}
		consume(LuaTokenType::Comma, "expected ',' after parameter.");
	}
}

void LuaParser::ensureAssignable(const LuaExpression& expression) {
	if (
		expression.kind == LuaSyntaxKind::IdentifierExpression
		|| expression.kind == LuaSyntaxKind::MemberExpression
		|| expression.kind == LuaSyntaxKind::IndexExpression
	) {
		return;
	}
	fail(current(), "expected an assignable expression.");
}

bool LuaParser::isReturnTerminator(LuaTokenType type) const {
	return type == LuaTokenType::End
		|| type == LuaTokenType::Else
		|| type == LuaTokenType::ElseIf
		|| type == LuaTokenType::Until
		|| type == LuaTokenType::Eof
		|| type == LuaTokenType::Semicolon;
}

const LuaToken& LuaParser::current() const {
	return m_tokens[m_index];
}

const LuaToken& LuaParser::advance() {
	const LuaToken& token = m_tokens[m_index];
	if (!isAtEnd()) {
		m_index += 1;
	}
	return token;
}

bool LuaParser::match(LuaTokenType type) {
	if (!check(type)) {
		return false;
	}
	advance();
	return true;
}

const LuaToken& LuaParser::consume(LuaTokenType type, const std::string& message) {
	if (!check(type)) {
		fail(current(), message);
	}
	return advance();
}

bool LuaParser::isAtEnd() const {
	return current().type == LuaTokenType::Eof;
}

bool LuaParser::check(LuaTokenType type) const {
	return current().type == type;
}

bool LuaParser::checkAny(const std::vector<LuaTokenType>& types) const {
	for (LuaTokenType type : types) {
		if (check(type)) {
			return true;
		}
	}
	return false;
}

LuaSourcePosition LuaParser::positionFromToken(const LuaToken& token) const {
	return {
		.line = token.line,
		.column = token.column,
	};
}

LuaSourceRange LuaParser::rangeFromPositions(const LuaSourcePosition& start, const LuaSourcePosition& end) const {
	return {
		.path = m_path,
		.start = start,
		.end = end,
	};
}

LuaSourceRange LuaParser::rangeFromTokenAndToken(const LuaToken& start, const LuaToken& end) const {
	return rangeFromPositions(positionFromToken(start), positionFromToken(end));
}

LuaSourceRange LuaParser::rangeFromTokenAndExpression(const LuaToken& start, const LuaExpression& end) const {
	return rangeFromPositions(positionFromToken(start), end.range.end);
}

LuaSourceRange LuaParser::rangeFromExpressionAndExpression(const LuaExpression& start, const LuaExpression& end) const {
	return rangeFromPositions(start.range.start, end.range.end);
}

void LuaParser::fail(const LuaToken& token, const std::string& message) const {
	throw BMSX_RUNTIME_ERROR("[parser:" + m_path + "] " + message + " at " + std::to_string(token.line) + ":" + std::to_string(token.column) + ".");
}

} // namespace bmsx
