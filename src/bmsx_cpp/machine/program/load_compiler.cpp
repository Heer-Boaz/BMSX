#include "machine/program/load_compiler.h"
#include "machine/runtime/runtime.h"
#include "lua/syntax/lexer.h"
#include "lua/syntax/parser.h"
#include <limits>
#include <unordered_map>
#include <vector>

namespace bmsx {
namespace {

struct LoadSubsetValueExpr {
	enum class Kind {
		Literal,
		Param,
	};

	Kind kind = Kind::Literal;
	int rootParamIndex = 0;
	std::vector<struct LoadSubsetPathStep> path;
	Value literal = valueNil();
};

struct LoadSubsetPathStep {
	enum class Kind {
		Key,
		Field,
		Index,
	};

	Kind kind = Kind::Key;
	Value key = valueNil();
	StringId fieldKey = 0;
	int index = 0;
};

struct LoadSubsetOp {
	int rootParamIndex = 0;
	std::vector<LoadSubsetPathStep> path;
	LoadSubsetValueExpr valueExpr;
};

struct LoadSubsetCompiledFunction {
	std::vector<LoadSubsetOp> ops;
};

std::string describeValueType(Value value) {
	if (isNil(value)) {
		return "nil";
	}
	if (valueIsBool(value)) {
		return "boolean";
	}
	if (valueIsNumber(value)) {
		return "number";
	}
	if (valueIsString(value)) {
		return "string";
	}
	if (valueIsTable(value)) {
		return "table";
	}
	if (valueIsNativeObject(value)) {
		return "native";
	}
	return "function";
}

Value getPathStepValue(Value target, const LoadSubsetPathStep& step) {
	if (valueIsTable(target)) {
		Table* table = asTable(target);
		switch (step.kind) {
			case LoadSubsetPathStep::Kind::Index:
				return table->getInteger(step.index);
			case LoadSubsetPathStep::Kind::Field:
				return table->getStringKey(step.fieldKey);
			case LoadSubsetPathStep::Kind::Key:
				return table->get(step.key);
		}
	}
	if (valueIsNativeObject(target)) {
		NativeObject* object = asNativeObject(target);
		switch (step.kind) {
			case LoadSubsetPathStep::Kind::Index:
				return object->get(valueNumber(static_cast<double>(step.index)));
			case LoadSubsetPathStep::Kind::Field:
				return object->get(valueString(step.fieldKey));
			case LoadSubsetPathStep::Kind::Key:
				return object->get(step.key);
		}
	}
	throw BMSX_RUNTIME_ERROR("[loadstring] attempted to index a non-table value (" + describeValueType(target) + ").");
}

void setPathStepValue(Value target, const LoadSubsetPathStep& step, Value value) {
	if (valueIsTable(target)) {
		Table* table = asTable(target);
		switch (step.kind) {
			case LoadSubsetPathStep::Kind::Index:
				table->setInteger(step.index, value);
				return;
			case LoadSubsetPathStep::Kind::Field:
				table->setStringKey(step.fieldKey, value);
				return;
			case LoadSubsetPathStep::Kind::Key:
				table->set(step.key, value);
				return;
		}
	}
	if (valueIsNativeObject(target)) {
		NativeObject* object = asNativeObject(target);
		switch (step.kind) {
			case LoadSubsetPathStep::Kind::Index:
				object->set(valueNumber(static_cast<double>(step.index)), value);
				return;
			case LoadSubsetPathStep::Kind::Field:
				object->set(valueString(step.fieldKey), value);
				return;
			case LoadSubsetPathStep::Kind::Key:
				object->set(step.key, value);
				return;
		}
	}
	throw BMSX_RUNTIME_ERROR("[loadstring] attempted to assign through a non-table value (" + describeValueType(target) + ").");
}

Value resolveValueExpr(NativeArgsView args, const LoadSubsetValueExpr& expr) {
	if (expr.kind == LoadSubsetValueExpr::Kind::Literal) {
		return expr.literal;
	}
	Value node = expr.rootParamIndex < static_cast<int>(args.size()) ? args[static_cast<size_t>(expr.rootParamIndex)] : valueNil();
	for (size_t index = 0; index < expr.path.size(); ++index) {
		node = getPathStepValue(node, expr.path[index]);
	}
	return node;
}

[[noreturn]] void fail(const std::string& chunkName, const std::string& message, const LuaSourceRange* range = nullptr) {
	if (range != nullptr) {
		throw BMSX_RUNTIME_ERROR("[loadstring:" + chunkName + "] " + message + " at " + std::to_string(range->start.line) + ":" + std::to_string(range->start.column) + ".");
	}
	throw BMSX_RUNTIME_ERROR("[loadstring:" + chunkName + "] " + message + ".");
}

LoadSubsetPathStep compilePathStep(Runtime& runtime, const std::string& chunkName, const LuaExpression& expression) {
	if (expression.kind == LuaSyntaxKind::UnaryExpression) {
		if (expression.unaryOperator != LuaUnaryOperator::Negate || expression.operand == nullptr || expression.operand->kind != LuaSyntaxKind::NumericLiteralExpression) {
			fail(chunkName, "index expressions must use string or numeric literals", &expression.range);
		}
		return {
			.kind = LoadSubsetPathStep::Kind::Key,
			.key = valueNumber(-expression.operand->numberValue),
		};
	}
	if (expression.kind == LuaSyntaxKind::NumericLiteralExpression) {
		if (
			expression.numberValue >= 1.0
			&& expression.numberValue <= static_cast<double>(std::numeric_limits<int>::max())
		) {
			const int index = static_cast<int>(expression.numberValue);
			if (static_cast<double>(index) == expression.numberValue) {
				return {
					.kind = LoadSubsetPathStep::Kind::Index,
					.index = index,
				};
			}
		}
		return {
			.kind = LoadSubsetPathStep::Kind::Key,
			.key = valueNumber(expression.numberValue),
		};
	}
	if (expression.kind == LuaSyntaxKind::StringLiteralExpression || expression.kind == LuaSyntaxKind::StringRefLiteralExpression) {
		return {
			.kind = LoadSubsetPathStep::Kind::Field,
			.fieldKey = runtime.machine.cpu.internString(expression.stringValue),
		};
	}
	fail(chunkName, "index expressions must use string or numeric literals", &expression.range);
}

struct CompiledParamPath {
	int rootParamIndex = 0;
	std::vector<LoadSubsetPathStep> path;
};

CompiledParamPath compileParamPath(
	Runtime& runtime,
	const std::string& chunkName,
	const LuaExpression& expression,
	const std::unordered_map<std::string, int>& paramIndexByName
) {
	if (expression.kind == LuaSyntaxKind::IdentifierExpression) {
		const auto it = paramIndexByName.find(expression.name);
		if (it == paramIndexByName.end()) {
			fail(chunkName, "unknown function parameter '" + expression.name + "'", &expression.range);
		}
		return {
			.rootParamIndex = it->second,
			.path = {},
		};
	}
	if (expression.kind == LuaSyntaxKind::MemberExpression) {
		CompiledParamPath base = compileParamPath(runtime, chunkName, *expression.base, paramIndexByName);
		base.path.push_back({
			.kind = LoadSubsetPathStep::Kind::Field,
			.fieldKey = runtime.machine.cpu.internString(expression.name),
		});
		return base;
	}
	if (expression.kind == LuaSyntaxKind::IndexExpression) {
		CompiledParamPath base = compileParamPath(runtime, chunkName, *expression.base, paramIndexByName);
		base.path.push_back(compilePathStep(runtime, chunkName, *expression.index));
		return base;
	}
	fail(chunkName, "expected a parameter path expression", &expression.range);
}

Value compileLiteralExpr(Runtime& runtime, const std::string& chunkName, const LuaExpression& expression) {
	(void)runtime;
	if (expression.kind == LuaSyntaxKind::UnaryExpression) {
		if (expression.unaryOperator != LuaUnaryOperator::Negate || expression.operand == nullptr || expression.operand->kind != LuaSyntaxKind::NumericLiteralExpression) {
			fail(chunkName, "unsupported literal expression", &expression.range);
		}
		return valueNumber(-expression.operand->numberValue);
	}
	switch (expression.kind) {
		case LuaSyntaxKind::NilLiteralExpression:
			return valueNil();
		case LuaSyntaxKind::BooleanLiteralExpression:
			return valueBool(expression.boolValue);
		case LuaSyntaxKind::NumericLiteralExpression:
			return valueNumber(expression.numberValue);
		case LuaSyntaxKind::StringLiteralExpression:
		case LuaSyntaxKind::StringRefLiteralExpression:
			return valueString(runtime.machine.cpu.internString(expression.stringValue));
		default:
			fail(chunkName, "unsupported literal expression", &expression.range);
	}
}

LoadSubsetValueExpr compileValueExpr(
	Runtime& runtime,
	const std::string& chunkName,
	const LuaExpression& expression,
	const std::unordered_map<std::string, int>& paramIndexByName
) {
	if (
		expression.kind == LuaSyntaxKind::NilLiteralExpression
		|| expression.kind == LuaSyntaxKind::BooleanLiteralExpression
		|| expression.kind == LuaSyntaxKind::NumericLiteralExpression
		|| expression.kind == LuaSyntaxKind::StringLiteralExpression
		|| expression.kind == LuaSyntaxKind::StringRefLiteralExpression
		|| expression.kind == LuaSyntaxKind::UnaryExpression
	) {
		return {
			.kind = LoadSubsetValueExpr::Kind::Literal,
			.rootParamIndex = 0,
			.path = {},
			.literal = compileLiteralExpr(runtime, chunkName, expression),
		};
	}
	CompiledParamPath paramPath = compileParamPath(runtime, chunkName, expression, paramIndexByName);
	return {
		.kind = LoadSubsetValueExpr::Kind::Param,
		.rootParamIndex = paramPath.rootParamIndex,
		.path = std::move(paramPath.path),
		.literal = valueNil(),
	};
}

LoadSubsetOp compileAssignment(
	Runtime& runtime,
	const std::string& chunkName,
	const LuaStatement& statement,
	const std::unordered_map<std::string, int>& paramIndexByName
) {
	if (statement.assignmentOperator != LuaAssignmentOperator::Assign) {
		fail(chunkName, "only plain assignment statements are supported", &statement.range);
	}
	if (statement.left.size() != 1 || statement.right.size() != 1) {
		fail(chunkName, "only single-target assignments are supported", &statement.range);
	}
	CompiledParamPath target = compileParamPath(runtime, chunkName, statement.left[0], paramIndexByName);
	if (target.path.empty()) {
		fail(chunkName, "direct parameter assignment is unsupported", &statement.left[0].range);
	}
	return {
		.rootParamIndex = target.rootParamIndex,
		.path = std::move(target.path),
		.valueExpr = compileValueExpr(runtime, chunkName, statement.right[0], paramIndexByName),
	};
}

LoadSubsetCompiledFunction compileFunctionExpression(Runtime& runtime, const std::string& chunkName, const LuaFunctionExpression& functionExpression) {
	if (functionExpression.hasVararg) {
		fail(chunkName, "vararg parameters are unsupported", &functionExpression.range);
	}
	std::unordered_map<std::string, int> paramIndexByName;
	paramIndexByName.reserve(functionExpression.parameters.size());
	for (size_t index = 0; index < functionExpression.parameters.size(); ++index) {
		const LuaIdentifier& parameter = functionExpression.parameters[index];
		if (paramIndexByName.find(parameter.name) != paramIndexByName.end()) {
			fail(chunkName, "duplicate function parameter '" + parameter.name + "'", &parameter.range);
		}
		paramIndexByName.emplace(parameter.name, static_cast<int>(index));
	}
	LoadSubsetCompiledFunction compiled;
	compiled.ops.reserve(functionExpression.body.body.size());
	for (const LuaStatement& statement : functionExpression.body.body) {
		if (statement.kind != LuaSyntaxKind::AssignmentStatement) {
			fail(chunkName, "only assignment statements are supported inside loadstring functions", &statement.range);
		}
		compiled.ops.push_back(compileAssignment(runtime, chunkName, statement, paramIndexByName));
	}
	return compiled;
}

LoadSubsetCompiledFunction compileReturnedFunction(Runtime& runtime, const std::string& chunkName, const LuaStatement& statement) {
	if (statement.expressions.size() != 1) {
		fail(chunkName, "chunk must return exactly one function expression", &statement.range);
	}
	const LuaExpression& expression = statement.expressions[0];
	if (expression.kind != LuaSyntaxKind::FunctionExpression || expression.functionValue == nullptr) {
		fail(chunkName, "chunk must return a function expression", &expression.range);
	}
	return compileFunctionExpression(runtime, chunkName, *expression.functionValue);
}

LoadSubsetCompiledFunction compileChunk(Runtime& runtime, const std::string& chunkName, const LuaChunk& chunk) {
	if (chunk.body.size() != 1) {
		fail(chunkName, "chunk must contain exactly one return statement", &chunk.range);
	}
	const LuaStatement& statement = chunk.body[0];
	if (statement.kind != LuaSyntaxKind::ReturnStatement) {
		fail(chunkName, "chunk must contain exactly one return statement", &statement.range);
	}
	return compileReturnedFunction(runtime, chunkName, statement);
}

Value buildNativeFunction(Runtime& runtime, const LoadSubsetCompiledFunction& compiled, const std::string& chunkName) {
	return runtime.machine.cpu.createNativeFunction("loadstring:" + chunkName, [&runtime, chunkName, compiled](NativeArgsView args, NativeResults& out) {
		(void)args;
		out.clear();
		out.push_back(runtime.machine.cpu.createNativeFunction(chunkName + ":inner", [compiled](NativeArgsView innerArgs, NativeResults& innerOut) {
			innerOut.clear();
			for (const LoadSubsetOp& op : compiled.ops) {
				Value node = op.rootParamIndex < static_cast<int>(innerArgs.size()) ? innerArgs[static_cast<size_t>(op.rootParamIndex)] : valueNil();
				for (size_t pathIndex = 0; pathIndex + 1 < op.path.size(); ++pathIndex) {
					node = getPathStepValue(node, op.path[pathIndex]);
				}
				setPathStepValue(node, op.path.back(), resolveValueExpr(innerArgs, op.valueExpr));
			}
		}));
	});
}

} // namespace

Value compileLoadChunk(Runtime& runtime, std::string_view source, std::string_view chunkName) {
	LuaLexer lexer(source, chunkName);
	const std::vector<LuaToken> tokens = lexer.scanTokens();
	LuaParser parser(tokens, chunkName, source);
	const LuaChunk chunk = parser.parseChunk();
	const std::string chunkNameString(chunkName);
	const LoadSubsetCompiledFunction compiled = compileChunk(runtime, chunkNameString, chunk);
	return buildNativeFunction(runtime, compiled, chunkNameString);
}

} // namespace bmsx
