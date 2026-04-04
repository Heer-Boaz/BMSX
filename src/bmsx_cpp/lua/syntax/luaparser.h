#pragma once

#include "lualexer.h"
#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace bmsx {

enum class LuaSyntaxKind {
	Chunk,
	Block,
	ReturnStatement,
	AssignmentStatement,
	FunctionExpression,
	IdentifierExpression,
	MemberExpression,
	IndexExpression,
	UnaryExpression,
	NilLiteralExpression,
	BooleanLiteralExpression,
	NumericLiteralExpression,
	StringLiteralExpression,
};

enum class LuaAssignmentOperator {
	Assign,
};

struct LuaSourcePosition {
	int line = 1;
	int column = 1;
};

struct LuaSourceRange {
	std::string path;
	LuaSourcePosition start;
	LuaSourcePosition end;
};

enum class LuaUnaryOperator {
	Negate,
};

struct LuaIdentifier {
	std::string name;
	LuaSourceRange range;
};

struct LuaFunctionExpression;

struct LuaExpression {
	LuaSyntaxKind kind = LuaSyntaxKind::NilLiteralExpression;
	LuaSourceRange range;
	std::string name;
	bool boolValue = false;
	double numberValue = 0.0;
	std::string stringValue;
	LuaUnaryOperator unaryOperator = LuaUnaryOperator::Negate;
	std::unique_ptr<LuaExpression> base;
	std::unique_ptr<LuaExpression> index;
	std::unique_ptr<LuaExpression> operand;
	std::unique_ptr<LuaFunctionExpression> functionValue;

	LuaExpression() = default;
	LuaExpression(const LuaExpression&) = delete;
	LuaExpression& operator=(const LuaExpression&) = delete;
	LuaExpression(LuaExpression&&) noexcept = default;
	LuaExpression& operator=(LuaExpression&&) noexcept = default;
};

struct LuaStatement {
	LuaSyntaxKind kind = LuaSyntaxKind::ReturnStatement;
	LuaSourceRange range;
	LuaAssignmentOperator assignmentOperator = LuaAssignmentOperator::Assign;
	std::vector<LuaExpression> left;
	std::vector<LuaExpression> right;
	std::vector<LuaExpression> expressions;

	LuaStatement() = default;
	LuaStatement(const LuaStatement&) = delete;
	LuaStatement& operator=(const LuaStatement&) = delete;
	LuaStatement(LuaStatement&&) noexcept = default;
	LuaStatement& operator=(LuaStatement&&) noexcept = default;
};

struct LuaBlock {
	LuaSyntaxKind kind = LuaSyntaxKind::Block;
	LuaSourceRange range;
	std::vector<LuaStatement> body;
};

struct LuaFunctionExpression {
	LuaSyntaxKind kind = LuaSyntaxKind::FunctionExpression;
	LuaSourceRange range;
	std::vector<LuaIdentifier> parameters;
	bool hasVararg = false;
	LuaBlock body;
};

struct LuaChunk {
	LuaSyntaxKind kind = LuaSyntaxKind::Chunk;
	LuaSourceRange range;
	std::vector<LuaStatement> body;
};

class LuaParser {
public:
	LuaParser(const std::vector<LuaToken>& tokens, std::string_view path, std::string_view source);

	LuaChunk parseChunk();

private:
	const std::vector<LuaToken>& m_tokens;
	std::string m_path;
	size_t m_index = 0;

	const LuaToken& current() const;
	const LuaToken& advance();
	bool match(LuaTokenType type);
	const LuaToken& consume(LuaTokenType type, const std::string& message);
	bool isAtEnd() const;
	bool check(LuaTokenType type) const;
	bool checkAny(const std::vector<LuaTokenType>& types) const;
	[[noreturn]] void fail(const LuaToken& token, const std::string& message) const;

	LuaBlock parseBlock(const std::vector<LuaTokenType>& terminators);
	LuaStatement parseStatement();
	LuaStatement parseReturnStatement();
	LuaStatement parseAssignmentOrCall();
	LuaExpression parseExpression();
	LuaExpression parseUnaryExpression();
	LuaExpression parseSuffixedExpression();
	LuaExpression parsePrimaryExpression();
	LuaExpression parseFunctionExpression();
	void parseFunctionParameters(LuaFunctionExpression& fn);
	void ensureAssignable(const LuaExpression& expression);
	bool isReturnTerminator(LuaTokenType type) const;

	LuaSourcePosition positionFromToken(const LuaToken& token) const;
	LuaSourceRange rangeFromPositions(const LuaSourcePosition& start, const LuaSourcePosition& end) const;
	LuaSourceRange rangeFromTokenAndToken(const LuaToken& start, const LuaToken& end) const;
	LuaSourceRange rangeFromTokenAndExpression(const LuaToken& start, const LuaExpression& end) const;
	LuaSourceRange rangeFromExpressionAndExpression(const LuaExpression& start, const LuaExpression& end) const;
};

} // namespace bmsx
