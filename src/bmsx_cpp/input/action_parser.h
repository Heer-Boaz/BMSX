/*
 * action_parser.h - Action definition parser for BMSX
 *
 * Parses action definition expressions like "left[jp] && a[p]" into
 * an AST that can be evaluated against current input state.
 */

#ifndef BMSX_ACTIONPARSER_H
#define BMSX_ACTIONPARSER_H

#include "models.h"
#include <string>
#include <string_view>
#include <vector>
#include <memory>
#include <unordered_map>
#include <regex>

namespace bmsx {

/* ============================================================================
 * AST Node types
 * ============================================================================ */

// Forward declaration
struct AstNode;

// Type alias for evaluation function
using GetterFn = std::function<ActionState(const std::string&, std::optional<f64>)>;
using EvalFn = std::function<bool(const GetterFn&)>;

/* ============================================================================
 * Token types
 * ============================================================================ */

enum class TokenType {
	Sym,      // Symbols: (, ), [, ], &&, ||, !, ,
	Ident,    // Identifier (action name)
	FuncWin,  // Windowed function: ?wp{6}, &wp{6}
	Func,     // Function: &, ?, &jp, ?jp, etc.
	ModTok,   // Modifier token
	Cmp,      // Comparator: <, >, <=, >=, ==, !=
	End       // End of input
};

struct Token {
	TokenType kind = TokenType::End;
	std::string value;

	Token() = default;
	Token(TokenType k, std::string v) : kind(k), value(std::move(v)) {}
};

/* ============================================================================
 * AST Nodes
 * ============================================================================ */

enum class NodeType {
	Action,     // Simple action with modifiers
	Operation,  // AND, OR, NOT
	Function    // Function call like &(a, b) or ?jp(left, right)
};

struct ActNode;
struct OpNode;
struct FunNode;

struct AstNode {
	NodeType type;
	EvalFn eval;

	virtual ~AstNode() = default;

	// Check if this is an action node
	ActNode* asAction();
	const ActNode* asAction() const;

	// Check if this is an operation node
	OpNode* asOperation();
	const OpNode* asOperation() const;

	// Check if this is a function node
	FunNode* asFunction();
	const FunNode* asFunction() const;
};

// Action node: represents a single action with modifiers
struct ActNode : AstNode {
	std::string name;
	std::vector<std::string> mods;

	// Edge tracking flags (for jp/jr/gp/rp edge detection)
	bool edgeForJP = false;
	bool edgeForJR = false;
	bool edgeForWP = false;
	bool edgeForWR = false;
	bool edgeForGP = false;
	bool edgeForRP = false;

	ActNode() { type = NodeType::Action; }
};

// Operation node: AND, OR, NOT
struct OpNode : AstNode {
	enum class Op { AND, OR, NOT };
	Op op;
	std::unique_ptr<AstNode> left;
	std::unique_ptr<AstNode> right;  // nullptr for NOT

	OpNode() { type = NodeType::Operation; }
};

// Function node: &(a, b), ?jp(left, right), etc.
struct FunNode : AstNode {
	std::string fname;
	std::vector<std::unique_ptr<AstNode>> args;
	std::optional<i32> window;

	FunNode() { type = NodeType::Function; }
};

/* ============================================================================
 * Tokenizer
 * ============================================================================ */

class Tokenizer {
public:
	explicit Tokenizer(std::string_view input);

	Token next();
	Token preview();
	bool hasMore() const;

private:
	std::string_view m_input;
	size_t m_pos = 0;
		std::optional<Token> m_bufferedToken;

		void skipWhitespace();
		std::string tokenText(size_t start) const;
		Token scanToken();
	};

/* ============================================================================
 * InputActionParser
 *
 * Recursive descent parser for action expressions.
 * Grammar:
 *   expr   -> term (('&&' | '||') term)*
 *   term   -> factor | '!' factor
 *   factor -> func | action | '(' expr ')'
 *   func   -> FUNC '(' args ')'
 *   action -> IDENT ('[' mods ']')?
 *   mods   -> mod (',' mod)*
 *   mod    -> IDENT | '!' IDENT
 * ============================================================================ */

class InputActionParser {
public:
	// Parse an action definition string into an AST
	static std::unique_ptr<AstNode> parse(const std::string& def);

private:
	Tokenizer m_tokenizer;

	explicit InputActionParser(std::string_view input);

	std::unique_ptr<AstNode> expr();
	std::unique_ptr<AstNode> term();
	std::unique_ptr<AstNode> factor();
	std::unique_ptr<AstNode> func();
	std::unique_ptr<AstNode> action();
	std::vector<std::string> parseModifierList();

	Token current();
	Token eat();
	Token take(TokenType expected, const std::string& expectedValue = "");

	void annotateActNode(ActNode& node);
	void applyModifiersInPlace(AstNode* node, const std::vector<std::string>& mods);
};

/* ============================================================================
 * Modifier predicates
 * ============================================================================ */

// Type for modifier evaluation function
using ModFn = std::function<bool(const GetterFn&, const std::string&, std::optional<f64>)>;

// Create modifier predicate from token
ModFn makeModPred(const std::string& tok);

// Compile action with modifiers into evaluation function
EvalFn compileAction(const std::string& name, const std::vector<std::string>& mods);

// Compile function into evaluation function
EvalFn compileFunction(const std::string& fname,
						const std::vector<std::unique_ptr<AstNode>>& args,
						std::optional<i32> window);

/* ============================================================================
 * ActionDefinitionEvaluator
 *
 * Caches parsed action definitions and provides evaluation.
 * ============================================================================ */

class ActionDefinitionEvaluator {
public:
	// Check if action definition is triggered
	static bool checkActionTriggered(const std::string& def, const GetterFn& get);

	// Get all action names referenced by a definition
	static std::vector<std::string> getReferencedActions(const std::string& def);

private:
	static std::unordered_map<std::string, std::unique_ptr<AstNode>> s_cache;

	static AstNode* getCachedOrParse(const std::string& def);
};

} // namespace bmsx

#endif // BMSX_ACTIONPARSER_H
