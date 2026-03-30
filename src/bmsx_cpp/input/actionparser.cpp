/*
 * actionparser.cpp - Action definition parser implementation
 *
 * Mirrors TypeScript input/actionparser.ts
 */

#include "actionparser.h"
#include <stdexcept>
#include <regex>
#include <cmath>

namespace bmsx {

/* ============================================================================
 * Static cache
 * ============================================================================ */

std::unordered_map<std::string, std::unique_ptr<AstNode>> ActionDefinitionEvaluator::s_cache;

/* ============================================================================
 * AstNode type checking
 * ============================================================================ */

ActNode* AstNode::asAction() {
	return type == NodeType::Action ? static_cast<ActNode*>(this) : nullptr;
}

const ActNode* AstNode::asAction() const {
	return type == NodeType::Action ? static_cast<const ActNode*>(this) : nullptr;
}

OpNode* AstNode::asOperation() {
	return type == NodeType::Operation ? static_cast<OpNode*>(this) : nullptr;
}

const OpNode* AstNode::asOperation() const {
	return type == NodeType::Operation ? static_cast<const OpNode*>(this) : nullptr;
}

FunNode* AstNode::asFunction() {
	return type == NodeType::Function ? static_cast<FunNode*>(this) : nullptr;
}

const FunNode* AstNode::asFunction() const {
	return type == NodeType::Function ? static_cast<const FunNode*>(this) : nullptr;
}

/* ============================================================================
 * Tokenizer
 * ============================================================================ */

Tokenizer::Tokenizer(std::string_view input) : m_input(input) {}

void Tokenizer::skipWhitespace() {
	while (m_pos < m_input.size() && std::isspace(m_input[m_pos])) {
		m_pos++;
	}
}

Token Tokenizer::scanToken() {
	skipWhitespace();
	
	if (m_pos >= m_input.size()) {
		return {TokenType::End, ""};
	}
	
	char c = m_input[m_pos];
	
	// Two-character operators
	if (m_pos + 1 < m_input.size()) {
		std::string_view two = m_input.substr(m_pos, 2);
		if (two == "&&" || two == "||" || two == "<=" || two == ">=" || 
			two == "==" || two == "!=") {
			m_pos += 2;
			return {two[0] == '&' || two[0] == '|' ? TokenType::Sym : TokenType::Cmp, 
					std::string(two)};
		}
	}
	
	// Single-character symbols
	if (c == '(' || c == ')' || c == '[' || c == ']' || c == ',' || c == '!') {
		m_pos++;
		return {TokenType::Sym, std::string(1, c)};
	}
	
	// Single-character comparators
	if (c == '<' || c == '>') {
		m_pos++;
		return {TokenType::Cmp, std::string(1, c)};
	}
	
	// Function identifiers: &, ?, &jp, ?jp, &wp{n}, ?wp{n}, etc.
	if (c == '&' || c == '?') {
		size_t start = m_pos;
		m_pos++;
		
		// Check for function name after & or ?
		while (m_pos < m_input.size() && std::isalpha(m_input[m_pos])) {
			m_pos++;
		}
		
		// Check for windowed function: &wp{n} or ?wp{n}
		if (m_pos < m_input.size() && m_input[m_pos] == '{') {
			m_pos++;  // Skip '{'
			while (m_pos < m_input.size() && std::isdigit(m_input[m_pos])) {
				m_pos++;
			}
			if (m_pos < m_input.size() && m_input[m_pos] == '}') {
				m_pos++;  // Skip '}'
				std::string value(m_input.substr(start, m_pos - start));
				return {TokenType::FuncWin, value};
			}
		}
		
		std::string value(m_input.substr(start, m_pos - start));
		return {TokenType::Func, value};
	}
	
	// Identifiers and modifier tokens
	if (std::isalpha(c) || c == '_') {
		size_t start = m_pos;
		while (m_pos < m_input.size() && 
				(std::isalnum(m_input[m_pos]) || m_input[m_pos] == '_')) {
			m_pos++;
		}
		
		// Check for windowed modifiers: wp{n}, wr{n}, t{...}, rc{...}
		if (m_pos < m_input.size() && m_input[m_pos] == '{') {
			m_pos++;  // Skip '{'
			int braceDepth = 1;
			while (m_pos < m_input.size() && braceDepth > 0) {
				if (m_input[m_pos] == '{') braceDepth++;
				else if (m_input[m_pos] == '}') braceDepth--;
				m_pos++;
			}
			std::string value(m_input.substr(start, m_pos - start));
			return {TokenType::ModTok, value};
		}
		
		std::string value(m_input.substr(start, m_pos - start));
		return {TokenType::Ident, value};
	}
	
	// Digits (for modifiers and comparisons)
	if (std::isdigit(c) || (c == '.' && m_pos + 1 < m_input.size() && 
							std::isdigit(m_input[m_pos + 1]))) {
		size_t start = m_pos;
		while (m_pos < m_input.size() && 
				(std::isdigit(m_input[m_pos]) || m_input[m_pos] == '.')) {
			m_pos++;
		}
		return {TokenType::Ident, std::string(m_input.substr(start, m_pos - start))};
	}
	
	throw BMSX_RUNTIME_ERROR("[Action Parser] Unexpected character: " + std::string(1, c));
}

Token Tokenizer::next() {
	if (m_bufferedToken) {
		Token t = std::move(*m_bufferedToken);
		m_bufferedToken.reset();
		return t;
	}
	return scanToken();
}

Token Tokenizer::preview() {
	if (!m_bufferedToken) {
		m_bufferedToken = scanToken();
	}
	return *m_bufferedToken;
}

bool Tokenizer::hasMore() const {
	return m_pos < m_input.size() || m_bufferedToken.has_value();
}

/* ============================================================================
 * InputActionParser
 * ============================================================================ */

InputActionParser::InputActionParser(std::string_view input) : m_tokenizer(input) {}

std::unique_ptr<AstNode> InputActionParser::parse(const std::string& def) {
	InputActionParser parser(def);
	auto ast = parser.expr();
	
	// Verify end of input
	Token end = parser.current();
	if (end.kind != TokenType::End) {
		throw BMSX_RUNTIME_ERROR("[Action Parser] Unexpected token at end: " + end.value);
	}
	
	return ast;
}

Token InputActionParser::current() {
	return m_tokenizer.preview();
}

Token InputActionParser::eat() {
	return m_tokenizer.next();
}

Token InputActionParser::take(TokenType expected, const std::string& expectedValue) {
	Token t = eat();
	if (t.kind != expected) {
		throw BMSX_RUNTIME_ERROR("[Action Parser] Expected token type " + 
									std::to_string(static_cast<int>(expected)) +
									" but got " + std::to_string(static_cast<int>(t.kind)));
	}
	if (!expectedValue.empty() && t.value != expectedValue) {
		throw BMSX_RUNTIME_ERROR("[Action Parser] Expected '" + expectedValue + 
									"' but got '" + t.value + "'");
	}
	return t;
}

// expr -> term (('&&' | '||') term)*
std::unique_ptr<AstNode> InputActionParser::expr() {
	auto left = term();
	
	while (true) {
		Token t = current();
		if (t.kind == TokenType::Sym && (t.value == "&&" || t.value == "||")) {
			eat();
			auto right = term();
			
			auto op = std::make_unique<OpNode>();
			op->op = (t.value == "&&") ? OpNode::Op::AND : OpNode::Op::OR;
			op->left = std::move(left);
			op->right = std::move(right);
			
			// Set up evaluation function
			if (op->op == OpNode::Op::AND) {
				AstNode* l = op->left.get();
				AstNode* r = op->right.get();
				op->eval = [l, r](const GetterFn& gs) {
					return l->eval(gs) && r->eval(gs);
				};
			} else {
				AstNode* l = op->left.get();
				AstNode* r = op->right.get();
				op->eval = [l, r](const GetterFn& gs) {
					return l->eval(gs) || r->eval(gs);
				};
			}
			
			left = std::move(op);
		} else {
			break;
		}
	}
	
	return left;
}

// term -> factor | '!' factor
std::unique_ptr<AstNode> InputActionParser::term() {
	Token t = current();
	
	if (t.kind == TokenType::Sym && t.value == "!") {
		eat();
		auto operand = factor();
		
		auto op = std::make_unique<OpNode>();
		op->op = OpNode::Op::NOT;
		op->left = std::move(operand);
		
		AstNode* l = op->left.get();
		op->eval = [l](const GetterFn& gs) {
			return !l->eval(gs);
		};
		
		return op;
	}
	
	return factor();
}

// factor -> func | action | '(' expr ')'
std::unique_ptr<AstNode> InputActionParser::factor() {
	Token t = current();
	
	// Parenthesized expression
	if (t.kind == TokenType::Sym && t.value == "(") {
		eat();
		auto inner = expr();
		take(TokenType::Sym, ")");
		
		// Check for trailing modifiers: (a || b)[jp]
		if (current().value == "[") {
			auto mods = parseModifierList();
			applyModifiersInPlace(inner.get(), mods);
		}
		
		return inner;
	}
	
	// Function call
	if (t.kind == TokenType::Func || t.kind == TokenType::FuncWin) {
		return func();
	}
	
	// Action identifier
	if (t.kind == TokenType::Ident) {
		return action();
	}
	
	throw BMSX_RUNTIME_ERROR("[Action Parser] Unexpected token: " + t.value);
}

// func -> FUNC '(' args ')'
std::unique_ptr<AstNode> InputActionParser::func() {
	Token tok = eat();
	std::string base = tok.value;
	std::optional<i32> win;
	
	// Extract window for windowed functions
	if (tok.kind == TokenType::FuncWin) {
		static const std::regex winRe(R"(^([?&]\w+)\{(\d+)\})");
		std::smatch m;
		if (std::regex_match(base, m, winRe)) {
			base = m[1].str();
			win = std::stoi(m[2].str());
		}
	}
	
	take(TokenType::Sym, "(");
	
	std::vector<std::unique_ptr<AstNode>> args;
	if (current().value != ")") {
		args.push_back(expr());
		while (current().value == ",") {
			eat();  // consume comma
			args.push_back(expr());
		}
	}
	
	take(TokenType::Sym, ")");
	
	auto node = std::make_unique<FunNode>();
	node->fname = base;
	node->window = win;
	node->args = std::move(args);
	node->eval = compileFunction(base, node->args, win);
	
	return node;
}

// action -> IDENT ('[' mods ']')?
std::unique_ptr<AstNode> InputActionParser::action() {
	std::string name = take(TokenType::Ident).value;
	
	std::vector<std::string> mods;
	if (current().value == "[") {
		mods = parseModifierList();
	}
	
	auto node = std::make_unique<ActNode>();
	node->name = name;
	node->mods = mods;
	annotateActNode(*node);
	node->eval = compileAction(name, mods);
	
	return node;
}

std::vector<std::string> InputActionParser::parseModifierList() {
	std::vector<std::string> mods;
	take(TokenType::Sym, "[");
	
	while (current().kind != TokenType::End && current().value != "]") {
		Token t = eat();
		if (t.value == ",") continue;
		if (t.value == "!") {
			Token next = eat();
			mods.push_back("!" + next.value);
			continue;
		}
		mods.push_back(t.value);
	}
	
	take(TokenType::Sym, "]");
	return mods;
}

void InputActionParser::annotateActNode(ActNode& n) {
	// Empty mods = implicit press-positive
	if (n.mods.empty()) {
		n.edgeForJP = n.edgeForWP = n.edgeForGP = n.edgeForRP = true;
		n.edgeForJR = n.edgeForWR = false;
		return;
	}
	
	bool pressPos = false;
	bool releasePos = false;
	bool guardPos = false;
	bool repeatPos = false;
	bool guardExplicit = false;
	bool repeatExplicit = false;
	
	static const std::regex wpRe(R"(^wp\{\d+\})");
	static const std::regex wrRe(R"(^wr\{\d+\})");
	
	for (const auto& m : n.mods) {
		bool neg = !m.empty() && m[0] == '!';
		std::string raw = neg ? m.substr(1) : m;
		
		if (raw == "gp") {
			guardExplicit = true;
			if (!neg) guardPos = true;
			continue;
		}
		if (raw == "rp") {
			repeatExplicit = true;
			if (!neg) repeatPos = true;
			continue;
		}
		
		bool pressish = (raw == "p" || raw == "jp" || std::regex_match(raw, wpRe));
		bool releaseish = (raw == "jr" || std::regex_match(raw, wrRe));
		
		if (pressish && !neg) pressPos = true;
		if (releaseish && !neg) releasePos = true;
	}
	
	if (!guardExplicit) guardPos = pressPos;
	if (!repeatExplicit) repeatPos = pressPos;
	
	n.edgeForJP = n.edgeForWP = pressPos;
	n.edgeForJR = n.edgeForWR = releasePos;
	n.edgeForGP = guardPos;
	n.edgeForRP = repeatPos;
}

void InputActionParser::applyModifiersInPlace(AstNode* node, const std::vector<std::string>& mods) {
	if (mods.empty()) return;
	
	if (auto* act = node->asAction()) {
		for (const auto& m : mods) {
			act->mods.push_back(m);
		}
		annotateActNode(*act);
		act->eval = compileAction(act->name, act->mods);
		return;
	}
	
	if (auto* op = node->asOperation()) {
		if (op->left) applyModifiersInPlace(op->left.get(), mods);
		if (op->right) applyModifiersInPlace(op->right.get(), mods);
		return;
	}
	
	if (auto* fn = node->asFunction()) {
		for (auto& arg : fn->args) {
			applyModifiersInPlace(arg.get(), mods);
		}
	}
}

/* ============================================================================
 * Modifier predicate creation
 * ============================================================================ */

ModFn makeModPred(const std::string& tok) {
	bool neg = !tok.empty() && tok[0] == '!';
	std::string raw = neg ? tok.substr(1) : tok;
	ModFn fn;
	
	// Static modifiers
	if (raw == "p") {
		fn = [](const GetterFn& get, const std::string& n, std::optional<f64> win) {
			return get(n, win).pressed;
		};
	} else if (raw == "r") {
		fn = [](const GetterFn& get, const std::string& n, std::optional<f64> win) {
			return !get(n, win).pressed;
		};
	} else if (raw == "jp") {
		fn = [](const GetterFn& get, const std::string& n, std::optional<f64> win) {
			return get(n, win).justpressed;
		};
	} else if (raw == "&jp") {
		fn = [](const GetterFn& get, const std::string& n, std::optional<f64> win) {
			return get(n, win).alljustpressed;
		};
	} else if (raw == "jr") {
		fn = [](const GetterFn& get, const std::string& n, std::optional<f64> win) {
			return get(n, win).justreleased;
		};
	} else if (raw == "&jr") {
		fn = [](const GetterFn& get, const std::string& n, std::optional<f64> win) {
			return get(n, win).alljustreleased;
		};
	} else if (raw == "gp") {
		fn = [](const GetterFn& get, const std::string& n, std::optional<f64> win) {
			return get(n, win).guardedjustpressed.value_or(false);
		};
	} else if (raw == "rp") {
		fn = [](const GetterFn& get, const std::string& n, std::optional<f64> win) {
			return get(n, win).repeatpressed.value_or(false);
		};
	} else if (raw == "c") {
		fn = [](const GetterFn& get, const std::string& n, std::optional<f64> win) {
			return get(n, win).consumed;
		};
	} else if (raw == "h") {
		// Hold: pressed for more than 1 frame
		fn = [](const GetterFn& get, const std::string& n, std::optional<f64> win) {
			return get(n, win).presstime.value_or(0.0) >= 1.0;
		};
	} else {
		// Windowed modifiers
		static const std::regex wpRe(R"(^wp\{(\d+)\})");
		static const std::regex wrRe(R"(^wr\{(\d+)\})");
		static const std::regex tRe(R"(^t\{([^}]+)\})");
		static const std::regex rcRe(R"(^rc\{([^}]+)\})");
		static const std::regex numRe(R"(^(<|>|<=|>=|==|!=)\s*(\d+(?:\.\d+)?))");
		
		std::smatch m;
		
		if (std::regex_match(raw, m, wpRe)) {
			f64 ms = std::stod(m[1].str());
			fn = [ms](const GetterFn& get, const std::string& n, std::optional<f64>) {
				return get(n, ms).waspressed;
			};
		} else if (std::regex_match(raw, m, wrRe)) {
			f64 ms = std::stod(m[1].str());
			fn = [ms](const GetterFn& get, const std::string& n, std::optional<f64>) {
				return get(n, ms).wasreleased;
			};
		} else if (std::regex_match(raw, m, tRe)) {
			std::string cmpRaw = m[1].str();
			std::string op;
			f64 val;
			
			std::smatch numMatch;
			if (std::regex_match(cmpRaw, numMatch, numRe)) {
				op = numMatch[1].str();
				val = std::stod(numMatch[2].str());
			} else {
				// Shorthand: just a number = ">= number"
				op = ">=";
				val = std::stod(cmpRaw);
			}
			
			fn = [op, val](const GetterFn& get, const std::string& n, std::optional<f64> win) {
				f64 pt = get(n, win).presstime.value_or(0.0);
				if (op == "<") return pt < val;
				if (op == ">") return pt > val;
				if (op == "<=") return pt <= val;
				if (op == ">=") return pt >= val;
				if (op == "==") return pt == val;
				if (op == "!=") return pt != val;
				return false;
			};
		} else if (std::regex_match(raw, m, rcRe)) {
			std::string cmpRaw = m[1].str();
			std::string op;
			i32 val;
			
			std::smatch numMatch;
			if (std::regex_match(cmpRaw, numMatch, numRe)) {
				op = numMatch[1].str();
				val = std::stoi(numMatch[2].str());
			} else {
				op = ">=";
				val = std::stoi(cmpRaw);
			}
			
			fn = [op, val](const GetterFn& get, const std::string& n, std::optional<f64> win) {
				i32 count = get(n, win).repeatcount.value_or(0);
				if (op == "<") return count < val;
				if (op == ">") return count > val;
				if (op == "<=") return count <= val;
				if (op == ">=") return count >= val;
				if (op == "==") return count == val;
				if (op == "!=") return count != val;
				return false;
			};
		} else {
			throw BMSX_RUNTIME_ERROR("[Action Parser] Unknown modifier '" + raw + "'");
		}
	}
	
	// Apply negation if needed
	if (neg) {
		return [fn](const GetterFn& get, const std::string& n, std::optional<f64> win) {
			return !fn(get, n, win);
		};
	}
	return fn;
}

/* ============================================================================
 * Compile action
 * ============================================================================ */

EvalFn compileAction(const std::string& name, const std::vector<std::string>& mods) {
	std::vector<ModFn> modPreds;
	for (const auto& m : mods) {
		modPreds.push_back(makeModPred(m));
	}
	
	// If no 'c' or '!c' modifier, add implicit not-consumed check
	bool hasConsumedMod = false;
	for (const auto& m : mods) {
		if (m == "c" || m == "!c") {
			hasConsumedMod = true;
			break;
		}
	}
	if (!hasConsumedMod) {
		modPreds.push_back([](const GetterFn& get, const std::string& n, std::optional<f64> win) {
			return !get(n, win).consumed;
		});
	}
	
	return [name, modPreds](const GetterFn& get) {
		for (const auto& pred : modPreds) {
			if (!pred(get, name, std::nullopt)) return false;
		}
		return true;
	};
}

/* ============================================================================
 * Compile function
 * ============================================================================ */

EvalFn compileFunction(const std::string& fname, 
						const std::vector<std::unique_ptr<AstNode>>& args, 
						std::optional<i32> window) {
	// Get raw pointers for lambda capture (nodes are owned by FunNode)
	std::vector<AstNode*> argPtrs;
	for (const auto& arg : args) {
		argPtrs.push_back(arg.get());
	}
	
	// Plain logical helpers
	if (fname == "&") {
		return [argPtrs](const GetterFn& gs) {
			for (auto* arg : argPtrs) {
				if (!arg->eval(gs)) return false;
			}
			return true;
		};
	}
	
	if (fname == "?") {
		return [argPtrs](const GetterFn& gs) {
			for (auto* arg : argPtrs) {
				if (arg->eval(gs)) return true;
			}
			return false;
		};
	}
	
	// Just-pressed helpers
	if (fname == "?jp") {
		return [argPtrs](const GetterFn& gs) {
			for (auto* arg : argPtrs) {
				if (arg->eval(gs)) {
					if (auto* act = arg->asAction()) {
						if (act->edgeForJP && gs(act->name, std::nullopt).justpressed) {
							return true;
						}
					}
				}
			}
			return false;
		};
	}
	
	if (fname == "&jp") {
		return [argPtrs](const GetterFn& gs) {
			for (auto* arg : argPtrs) {
				if (!arg->eval(gs)) return false;
				if (auto* act = arg->asAction()) {
					if (act->edgeForJP && !gs(act->name, std::nullopt).justpressed) {
						return false;
					}
				}
			}
			return true;
		};
	}
	
	// Guarded press helpers
	if (fname == "?gp") {
		return [argPtrs](const GetterFn& gs) {
			for (auto* arg : argPtrs) {
				if (arg->eval(gs)) {
					if (auto* act = arg->asAction()) {
						if (act->edgeForGP && 
							gs(act->name, std::nullopt).guardedjustpressed.value_or(false)) {
							return true;
						}
					}
				}
			}
			return false;
		};
	}
	
	if (fname == "&gp") {
		return [argPtrs](const GetterFn& gs) {
			for (auto* arg : argPtrs) {
				if (!arg->eval(gs)) return false;
				if (auto* act = arg->asAction()) {
					if (act->edgeForGP && 
						!gs(act->name, std::nullopt).guardedjustpressed.value_or(false)) {
						return false;
					}
				}
			}
			return true;
		};
	}
	
	// Repeat press helpers
	if (fname == "?rp") {
		return [argPtrs](const GetterFn& gs) {
			for (auto* arg : argPtrs) {
				if (arg->eval(gs)) {
					if (auto* act = arg->asAction()) {
						if (act->edgeForRP && 
							gs(act->name, std::nullopt).repeatpressed.value_or(false)) {
							return true;
						}
					}
				}
			}
			return false;
		};
	}
	
	if (fname == "&rp") {
		return [argPtrs](const GetterFn& gs) {
			for (auto* arg : argPtrs) {
				if (!arg->eval(gs)) return false;
				if (auto* act = arg->asAction()) {
					if (act->edgeForRP && 
						!gs(act->name, std::nullopt).repeatpressed.value_or(false)) {
						return false;
					}
				}
			}
			return true;
		};
	}
	
	// Just-released helpers
	if (fname == "?jr") {
		return [argPtrs](const GetterFn& gs) {
			for (auto* arg : argPtrs) {
				if (arg->eval(gs)) {
					if (auto* act = arg->asAction()) {
						if (act->edgeForJR && gs(act->name, std::nullopt).justreleased) {
							return true;
						}
					}
				}
			}
			return false;
		};
	}
	
	if (fname == "&jr") {
		return [argPtrs](const GetterFn& gs) {
			for (auto* arg : argPtrs) {
				if (!arg->eval(gs)) return false;
				if (auto* act = arg->asAction()) {
					if (act->edgeForJR && !gs(act->name, std::nullopt).justreleased) {
						return false;
					}
				}
			}
			return true;
		};
	}
	
	// Windowed press helpers
	if (fname == "?wp") {
		return [argPtrs, window](const GetterFn& gs) {
			GetterFn g = [&gs, window](const std::string& n, std::optional<f64>) -> ActionState {
				return gs(n, window ? std::make_optional(static_cast<f64>(*window)) : std::nullopt);
			};
			for (auto* arg : argPtrs) {
				if (arg->eval(g)) {
					if (auto* act = arg->asAction()) {
						if (act->edgeForWP && g(act->name, std::nullopt).waspressed) {
							return true;
						}
					}
				}
			}
			return false;
		};
	}
	
	if (fname == "&wp") {
		return [argPtrs, window](const GetterFn& gs) {
			GetterFn g = [&gs, window](const std::string& n, std::optional<f64>) -> ActionState {
				return gs(n, window ? std::make_optional(static_cast<f64>(*window)) : std::nullopt);
			};
			for (auto* arg : argPtrs) {
				if (!arg->eval(g)) return false;
				if (auto* act = arg->asAction()) {
					if (act->edgeForWP && !g(act->name, std::nullopt).waspressed) {
						return false;
					}
				}
			}
			return true;
		};
	}
	
	// Windowed release helpers
	if (fname == "?wr") {
		return [argPtrs, window](const GetterFn& gs) {
			GetterFn g = [&gs, window](const std::string& n, std::optional<f64>) -> ActionState {
				return gs(n, window ? std::make_optional(static_cast<f64>(*window)) : std::nullopt);
			};
			for (auto* arg : argPtrs) {
				if (arg->eval(g)) {
					if (auto* act = arg->asAction()) {
						if (act->edgeForWR && g(act->name, std::nullopt).wasreleased) {
							return true;
						}
					}
				}
			}
			return false;
		};
	}
	
	if (fname == "&wr") {
		return [argPtrs, window](const GetterFn& gs) {
			GetterFn g = [&gs, window](const std::string& n, std::optional<f64>) -> ActionState {
				return gs(n, window ? std::make_optional(static_cast<f64>(*window)) : std::nullopt);
			};
			for (auto* arg : argPtrs) {
				if (!arg->eval(g)) return false;
				if (auto* act = arg->asAction()) {
					if (act->edgeForWR && !g(act->name, std::nullopt).wasreleased) {
						return false;
					}
				}
			}
			return true;
		};
	}
	
	throw BMSX_RUNTIME_ERROR("[Action Parser] Unknown function helper '" + fname + "'");
}

/* ============================================================================
 * ActionDefinitionEvaluator
 * ============================================================================ */

void ActionDefinitionEvaluator::clearCache() {
	s_cache.clear();
}

AstNode* ActionDefinitionEvaluator::getCachedOrParse(const std::string& def) {
	auto it = s_cache.find(def);
	if (it != s_cache.end()) {
		return it->second.get();
	}
	
	auto ast = InputActionParser::parse(def);
	AstNode* ptr = ast.get();
	s_cache[def] = std::move(ast);
	return ptr;
}

bool ActionDefinitionEvaluator::checkActionTriggered(const std::string& def, const GetterFn& get) {
	AstNode* ast = getCachedOrParse(def);
	return ast->eval(get);
}

std::vector<std::string> ActionDefinitionEvaluator::getReferencedActions(const std::string& def) {
	AstNode* ast = getCachedOrParse(def);
	std::vector<std::string> out;
	
	std::function<void(AstNode*)> walk = [&walk, &out](AstNode* node) {
		if (auto* act = node->asAction()) {
			out.push_back(act->name);
			return;
		}
		if (auto* fn = node->asFunction()) {
			for (auto& arg : fn->args) {
				walk(arg.get());
			}
			return;
		}
		if (auto* op = node->asOperation()) {
			if (op->left) walk(op->left.get());
			if (op->right) walk(op->right.get());
		}
	};
	
	walk(ast);
	return out;
}

} // namespace bmsx
