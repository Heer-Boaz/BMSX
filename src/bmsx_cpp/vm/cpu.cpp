#include "cpu.h"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <limits>
#include <sstream>
#include <stdexcept>

namespace bmsx {

// =============================================================================
// Value utilities
// =============================================================================

std::string valueToString(const Value& v) {
	return std::visit([](auto&& arg) -> std::string {
		using T = std::decay_t<decltype(arg)>;
		if constexpr (std::is_same_v<T, std::monostate>) {
			return "null";
		} else if constexpr (std::is_same_v<T, bool>) {
			return arg ? "true" : "false";
		} else if constexpr (std::is_same_v<T, double>) {
			if (!std::isfinite(arg)) {
				if (std::isnan(arg)) {
					return "NaN";
				}
				return arg < 0 ? "-Infinity" : "Infinity";
			}
			std::ostringstream oss;
			oss << arg;
			return oss.str();
		} else if constexpr (std::is_same_v<T, StringValue>) {
			return arg->value;
		} else if constexpr (std::is_same_v<T, std::shared_ptr<Table>>) {
			return "[object Object]";
		} else if constexpr (std::is_same_v<T, std::shared_ptr<Closure>>) {
			return "[object Object]";
		} else if constexpr (std::is_same_v<T, std::shared_ptr<NativeFunction>>) {
			return "[object Object]";
		} else if constexpr (std::is_same_v<T, std::shared_ptr<NativeObject>>) {
			return "[object Object]";
		} else {
			return "unknown";
		}
	}, v);
}

const char* valueTypeName(const Value& v) {
	return std::visit([](auto&& arg) -> const char* {
		using T = std::decay_t<decltype(arg)>;
		if constexpr (std::is_same_v<T, std::monostate>) {
			return "nil";
		} else if constexpr (std::is_same_v<T, bool>) {
			return "boolean";
		} else if constexpr (std::is_same_v<T, double>) {
			return "number";
		} else if constexpr (std::is_same_v<T, StringValue>) {
			return "string";
		} else if constexpr (std::is_same_v<T, std::shared_ptr<Table>>) {
			return "table";
		} else if constexpr (std::is_same_v<T, std::shared_ptr<Closure>>) {
			return "closure";
		} else if constexpr (std::is_same_v<T, std::shared_ptr<NativeFunction>>) {
			return "native_function";
		} else if constexpr (std::is_same_v<T, std::shared_ptr<NativeObject>>) {
			return "native_object";
		} else {
			return "unknown";
		}
	}, v);
}

// =============================================================================
// Table implementation
// =============================================================================

Table::Table(int arraySize, int hashSize) {
	if (arraySize > 0) {
		m_array.resize(arraySize);
	}
	m_stringMap.reserve(static_cast<size_t>(hashSize));
	m_otherMap.reserve(static_cast<size_t>(hashSize));
}

bool Table::isArrayIndex(const Value& key) const {
	if (auto* n = std::get_if<double>(&key)) {
		double intpart;
		if (std::modf(*n, &intpart) == 0.0 && *n >= 1.0) {
			return true;
		}
	}
	return false;
}

int Table::toArrayIndex(const Value& key) const {
	return static_cast<int>(std::get<double>(key)) - 1; // 1-based to 0-based
}

Value Table::get(const Value& key) const {
	if (isArrayIndex(key)) {
		int index = toArrayIndex(key);
		if (index >= 0 && index < static_cast<int>(m_array.size())) {
			return m_array[index];
		}
		return std::monostate{};
	}

	if (auto* str = std::get_if<StringValue>(&key)) {
		auto mapIt = m_stringMap.find(*str);
		if (mapIt != m_stringMap.end()) {
			return mapIt->second;
		}
		return std::monostate{};
	}

	auto mapIt = m_otherMap.find(key);
	if (mapIt != m_otherMap.end()) {
		return mapIt->second;
	}
	return std::monostate{};
}

Value Table::getString(std::string_view key) const {
	for (const auto& [stringKey, value] : m_stringMap) {
		if (stringKey->value == key) {
			return value;
		}
	}
	return std::monostate{};
}

void Table::set(const Value& key, const Value& value) {
	if (isArrayIndex(key)) {
		int index = toArrayIndex(key);
		if (index >= 0) {
			if (index >= static_cast<int>(m_array.size())) {
				m_array.resize(index + 1);
			}
			m_array[index] = value;
			return;
		}
	}

	if (auto* str = std::get_if<StringValue>(&key)) {
		if (isNil(value)) {
			m_stringMap.erase(*str);
			return;
		}
		m_stringMap[*str] = value;
		return;
	}
	if (isNil(value)) {
		m_otherMap.erase(key);
		return;
	}
	m_otherMap[key] = value;
}

int Table::length() const {
	// Lua-style length: count consecutive array elements from 1
	int count = 0;
	for (size_t i = 0; i < m_array.size(); ++i) {
		if (isNil(m_array[i])) {
			break;
		}
		count = static_cast<int>(i) + 1;
	}
	return count;
}

void Table::clear() {
	m_array.clear();
	m_stringMap.clear();
	m_otherMap.clear();
}

std::vector<std::pair<Value, Value>> Table::entries() const {
	std::vector<std::pair<Value, Value>> result;

	// Array entries (1-based keys)
	for (size_t i = 0; i < m_array.size(); ++i) {
		if (!isNil(m_array[i])) {
			result.emplace_back(static_cast<double>(i + 1), m_array[i]);
		}
	}

	for (const auto& entry : m_stringMap) {
		result.emplace_back(entry.first, entry.second);
	}
	for (const auto& entry : m_otherMap) {
		result.emplace_back(entry.first, entry.second);
	}

	return result;
}

std::optional<std::pair<Value, Value>> Table::nextEntry(const Value& after) const {
	if (isNil(after)) {
		for (size_t i = 0; i < m_array.size(); ++i) {
			if (!isNil(m_array[i])) {
				return std::make_pair(static_cast<double>(i + 1), m_array[i]);
			}
		}
		if (!m_stringMap.empty()) {
			const auto& entry = *m_stringMap.begin();
			return std::make_pair(Value{entry.first}, entry.second);
		}
		if (!m_otherMap.empty()) {
			const auto& entry = *m_otherMap.begin();
			return std::make_pair(entry.first, entry.second);
		}
		return std::nullopt;
	}
	if (isArrayIndex(after)) {
		int startIndex = static_cast<int>(std::get<double>(after));
		for (int i = startIndex; i < static_cast<int>(m_array.size()); ++i) {
			if (!isNil(m_array[static_cast<size_t>(i)])) {
				return std::make_pair(static_cast<double>(i + 1), m_array[static_cast<size_t>(i)]);
			}
		}
		if (!m_stringMap.empty()) {
			const auto& entry = *m_stringMap.begin();
			return std::make_pair(Value{entry.first}, entry.second);
		}
		if (!m_otherMap.empty()) {
			const auto& entry = *m_otherMap.begin();
			return std::make_pair(entry.first, entry.second);
		}
		return std::nullopt;
	}
	if (auto* str = std::get_if<StringValue>(&after)) {
		auto found = m_stringMap.find(*str);
		if (found == m_stringMap.end()) {
			return std::nullopt;
		}
		bool seen = false;
		for (const auto& entry : m_stringMap) {
			if (!seen) {
				if (entry.first == *str) {
					seen = true;
				}
				continue;
			}
			return std::make_pair(Value{entry.first}, entry.second);
		}
		if (seen && !m_otherMap.empty()) {
			const auto& entry = *m_otherMap.begin();
			return std::make_pair(entry.first, entry.second);
		}
		return std::nullopt;
	}
	bool seen = false;
	for (const auto& entry : m_otherMap) {
		if (!seen) {
			if (entry.first == after) {
				seen = true;
			}
			continue;
		}
		return std::make_pair(entry.first, entry.second);
	}
	return std::nullopt;
}

// =============================================================================
// VMCPU implementation
// =============================================================================

namespace {
const Value kNilValue{std::monostate{}};

inline size_t registerBucket(size_t size) {
	size_t bucket = 8;
	while (bucket < size) {
		bucket <<= 1;
	}
	return bucket;
}
}

VMCPU::VMCPU(std::vector<Value>& memory)
	: globals(0, 0)
	, m_memory(memory)
{
	m_valueScratch.reserve(64);
	m_returnScratch.reserve(64);
	m_nativeReturnPool.reserve(8);
}

void VMCPU::setProgram(Program* program) {
	m_program = program;
	for (auto& entry : m_program->constPool) {
		if (auto* str = std::get_if<StringValue>(&entry)) {
			entry = m_stringPool.intern((*str)->value);
		}
	}
	m_indexKey = m_stringPool.intern("__index");
}

void VMCPU::start(int entryProtoIndex, const std::vector<Value>& args) {
	m_frames.clear();
	auto closure = std::make_shared<Closure>();
	closure->protoIndex = entryProtoIndex;
	pushFrame(closure, args, 0, 0, false, m_program->protos[entryProtoIndex].entryPC);
}

void VMCPU::call(std::shared_ptr<Closure> closure, const std::vector<Value>& args, int returnCount) {
	if (!closure) {
		throw std::runtime_error("Attempted to call a nil value.");
	}
	pushFrame(closure, args, 0, returnCount, false, m_program->protos[closure->protoIndex].entryPC);
}

void VMCPU::callExternal(std::shared_ptr<Closure> closure, const std::vector<Value>& args) {
	if (!closure) {
		throw std::runtime_error("Attempted to call a nil value.");
	}
	pushFrame(closure, args, 0, 0, true, m_program->protos[closure->protoIndex].entryPC);
}

RunResult VMCPU::run(std::optional<int> instructionBudget) {
	return runUntilDepth(0, instructionBudget);
}

RunResult VMCPU::runUntilDepth(int targetDepth, std::optional<int> instructionBudget) {
	bool ownsBudget = instructionBudget.has_value();
	std::optional<int> previousBudget = instructionBudgetRemaining;

	if (ownsBudget) {
		instructionBudgetRemaining = instructionBudget;
	}

	RunResult result = RunResult::Halted;
	try {
		while (static_cast<int>(m_frames.size()) > targetDepth) {
			if (instructionBudgetRemaining.has_value() && *instructionBudgetRemaining <= 0) {
				result = RunResult::Yielded;
				break;
			}
			step();
		}
	} catch (...) {
		if (ownsBudget) {
			instructionBudgetRemaining = previousBudget;
		}
		throw;
	}

	if (ownsBudget) {
		instructionBudgetRemaining = previousBudget;
	}
	return result;
}

void VMCPU::step() {
	CallFrame& frame = *m_frames.back();
	int pc = frame.pc;
	uint32_t instr = m_program->code[pc];
	frame.pc = pc + 1;
	lastPc = pc;
	lastInstruction = instr;

	if (instructionBudgetRemaining.has_value()) {
		--(*instructionBudgetRemaining);
	}

	executeInstruction(frame, instr);
}

std::optional<SourceRange> VMCPU::getDebugRange(int pc) const {
	if (pc < 0 || pc >= static_cast<int>(m_program->debugRanges.size())) {
		return std::nullopt;
	}
	return m_program->debugRanges[pc];
}

std::vector<std::pair<int, int>> VMCPU::getCallStack() const {
	std::vector<std::pair<int, int>> stack;
	int topIndex = static_cast<int>(m_frames.size()) - 1;
	for (int i = 0; i < static_cast<int>(m_frames.size()); ++i) {
		const auto& frame = m_frames[i];
		int pc = (i == topIndex) ? lastPc : frame->callSitePc;
		stack.emplace_back(frame->protoIndex, pc);
	}
	return stack;
}

void VMCPU::executeInstruction(CallFrame& frame, uint32_t instr) {
	uint8_t op = (instr >> 24) & 0xFF;
	uint8_t a = (instr >> 16) & 0xFF;
	uint8_t b = (instr >> 8) & 0xFF;
	uint8_t c = instr & 0xFF;
	uint16_t bx = instr & 0xFFFF;
	int16_t sbx = static_cast<int16_t>(bx);

	switch (static_cast<OpCode>(op)) {
		case OpCode::MOV:
			setRegister(frame, a, frame.registers[b]);
			return;

		case OpCode::LOADK:
			setRegister(frame, a, m_program->constPool[bx]);
			return;

		case OpCode::LOADNIL:
			for (int i = 0; i < b; ++i) {
				setRegister(frame, a + i, kNilValue);
			}
			return;

		case OpCode::LOADBOOL:
			setRegister(frame, a, b != 0);
			if (c != 0) {
				frame.pc += 1;
			}
			return;

		case OpCode::GETG: {
			const Value& key = m_program->constPool[bx];
			setRegister(frame, a, globals.get(key));
			return;
		}

		case OpCode::SETG: {
			const Value& key = m_program->constPool[bx];
			globals.set(key, frame.registers[a]);
			return;
		}

		case OpCode::GETT: {
			const Value& table = frame.registers[b];
			const Value& key = readRK(frame, c);
			if (auto tbl = std::get_if<std::shared_ptr<Table>>(&table)) {
				setRegister(frame, a, resolveTableIndex(*tbl, key));
				return;
			}
			if (auto obj = std::get_if<std::shared_ptr<NativeObject>>(&table)) {
				setRegister(frame, a, (*obj)->get(key));
				return;
			}
			std::string message = "Attempted to index field on a non-table value.";
			message += " base=" + std::string(valueTypeName(table)) + "(" + valueToString(table) + ")";
			message += " key=" + std::string(valueTypeName(key)) + "(" + valueToString(key) + ")";
			auto range = getDebugRange(frame.pc - 1);
			if (range.has_value()) {
				message += " at " + range->path + ":" + std::to_string(range->startLine);
			}
			throw std::runtime_error(message);
		}

		case OpCode::SETT: {
			const Value& table = frame.registers[a];
			const Value& key = readRK(frame, b);
			const Value& value = readRK(frame, c);
			if (auto tbl = std::get_if<std::shared_ptr<Table>>(&table)) {
				(*tbl)->set(key, value);
				return;
			}
			if (auto obj = std::get_if<std::shared_ptr<NativeObject>>(&table)) {
				(*obj)->set(key, value);
				return;
			}
			std::string message = "Attempted to assign to a non-table value.";
			message += " base=" + std::string(valueTypeName(table)) + "(" + valueToString(table) + ")";
			message += " key=" + std::string(valueTypeName(key)) + "(" + valueToString(key) + ")";
			message += " value=" + std::string(valueTypeName(value)) + "(" + valueToString(value) + ")";
			auto range = getDebugRange(frame.pc - 1);
			if (range.has_value()) {
				message += " at " + range->path + ":" + std::to_string(range->startLine);
			}
			throw std::runtime_error(message);
		}

		case OpCode::NEWT:
			setRegister(frame, a, std::make_shared<Table>(b, c));
			return;

		case OpCode::ADD: {
			double left = asNumber(readRK(frame, b));
			double right = asNumber(readRK(frame, c));
			setRegister(frame, a, left + right);
			return;
		}

		case OpCode::SUB: {
			double left = asNumber(readRK(frame, b));
			double right = asNumber(readRK(frame, c));
			setRegister(frame, a, left - right);
			return;
		}

		case OpCode::MUL: {
			double left = asNumber(readRK(frame, b));
			double right = asNumber(readRK(frame, c));
			setRegister(frame, a, left * right);
			return;
		}

		case OpCode::DIV: {
			double left = asNumber(readRK(frame, b));
			double right = asNumber(readRK(frame, c));
			setRegister(frame, a, left / right);
			return;
		}

		case OpCode::MOD: {
			double left = asNumber(readRK(frame, b));
			double right = asNumber(readRK(frame, c));
			setRegister(frame, a, std::fmod(left, right));
			return;
		}

		case OpCode::FLOORDIV: {
			double left = asNumber(readRK(frame, b));
			double right = asNumber(readRK(frame, c));
			setRegister(frame, a, std::floor(left / right));
			return;
		}

		case OpCode::POW: {
			double left = asNumber(readRK(frame, b));
			double right = asNumber(readRK(frame, c));
			setRegister(frame, a, std::pow(left, right));
			return;
		}

		case OpCode::BAND: {
			int left = static_cast<int>(asNumber(readRK(frame, b)));
			int right = static_cast<int>(asNumber(readRK(frame, c)));
			setRegister(frame, a, static_cast<double>(left & right));
			return;
		}

		case OpCode::BOR: {
			int left = static_cast<int>(asNumber(readRK(frame, b)));
			int right = static_cast<int>(asNumber(readRK(frame, c)));
			setRegister(frame, a, static_cast<double>(left | right));
			return;
		}

		case OpCode::BXOR: {
			int left = static_cast<int>(asNumber(readRK(frame, b)));
			int right = static_cast<int>(asNumber(readRK(frame, c)));
			setRegister(frame, a, static_cast<double>(left ^ right));
			return;
		}

		case OpCode::SHL: {
			int left = static_cast<int>(asNumber(readRK(frame, b)));
			int right = static_cast<int>(asNumber(readRK(frame, c))) & 31;
			setRegister(frame, a, static_cast<double>(left << right));
			return;
		}

		case OpCode::SHR: {
			int left = static_cast<int>(asNumber(readRK(frame, b)));
			int right = static_cast<int>(asNumber(readRK(frame, c))) & 31;
			setRegister(frame, a, static_cast<double>(left >> right));
			return;
		}

		case OpCode::CONCAT: {
			std::string text = valueToString(readRK(frame, b));
			text += valueToString(readRK(frame, c));
			setRegister(frame, a, m_program->stringPool.intern(text));
			return;
		}

		case OpCode::UNM: {
			double val = asNumber(frame.registers[b]);
			setRegister(frame, a, -val);
			return;
		}

		case OpCode::NOT:
			setRegister(frame, a, !isTruthy(frame.registers[b]));
			return;

		case OpCode::LEN: {
			const Value& val = frame.registers[b];
			if (auto* s = std::get_if<StringValue>(&val)) {
				setRegister(frame, a, static_cast<double>((*s)->value.length()));
				return;
			}
			if (auto tbl = std::get_if<std::shared_ptr<Table>>(&val)) {
				setRegister(frame, a, static_cast<double>((*tbl)->length()));
				return;
			}
			if (auto obj = std::get_if<std::shared_ptr<NativeObject>>(&val)) {
				if (!(*obj)->len) {
					std::string stack;
					auto callStack = getCallStack();
					for (auto it = callStack.rbegin(); it != callStack.rend(); ++it) {
						const auto& entry = *it;
						const auto range = getDebugRange(entry.second);
						if (!stack.empty()) {
							stack += " <- ";
						}
						if (range.has_value()) {
							stack += range->path + ":" + std::to_string(range->startLine) + ":" + std::to_string(range->startColumn);
						} else {
							stack += "<unknown>";
						}
					}
					throw std::runtime_error("Length operator expects a native object with a length. stack=" + stack);
				}
				setRegister(frame, a, static_cast<double>((*obj)->len()));
				return;
			}
			std::string stack;
			auto callStack = getCallStack();
			for (auto it = callStack.rbegin(); it != callStack.rend(); ++it) {
				const auto& entry = *it;
				const auto range = getDebugRange(entry.second);
				if (!stack.empty()) {
					stack += " <- ";
				}
				if (range.has_value()) {
					stack += range->path + ":" + std::to_string(range->startLine) + ":" + std::to_string(range->startColumn);
				} else {
					stack += "<unknown>";
				}
			}
			throw std::runtime_error("Length operator expects a string or table. stack=" + stack);
		}

		case OpCode::BNOT: {
			int val = static_cast<int>(asNumber(frame.registers[b]));
			setRegister(frame, a, static_cast<double>(~val));
			return;
		}

		case OpCode::EQ: {
			const Value& left = readRK(frame, b);
			const Value& right = readRK(frame, c);
			bool eq = (left == right);
			if (eq != (a != 0)) {
				frame.pc += 1;
			}
			return;
		}

		case OpCode::LT: {
			const Value& leftValue = readRK(frame, b);
			const Value& rightValue = readRK(frame, c);
			bool ok = false;
			if (std::holds_alternative<StringValue>(leftValue) && std::holds_alternative<StringValue>(rightValue)) {
				ok = std::get<StringValue>(leftValue)->value < std::get<StringValue>(rightValue)->value;
			} else {
				auto toNumber = [](const Value& value) -> double {
					if (auto* n = std::get_if<double>(&value)) {
						return *n;
					}
					if (auto* b = std::get_if<bool>(&value)) {
						return *b ? 1.0 : 0.0;
					}
					if (isNil(value)) {
						return 0.0;
					}
					if (auto* s = std::get_if<StringValue>(&value)) {
						const std::string& text = (*s)->value;
						char* end = nullptr;
						double parsed = std::strtod(text.c_str(), &end);
						if (end == text.c_str()) {
							return std::numeric_limits<double>::quiet_NaN();
						}
						return parsed;
					}
					return std::numeric_limits<double>::quiet_NaN();
				};
				double left = toNumber(leftValue);
				double right = toNumber(rightValue);
				ok = left < right;
			}
			if (ok != (a != 0)) {
				frame.pc += 1;
			}
			return;
		}

		case OpCode::LE: {
			const Value& leftValue = readRK(frame, b);
			const Value& rightValue = readRK(frame, c);
			bool ok = false;
			if (std::holds_alternative<StringValue>(leftValue) && std::holds_alternative<StringValue>(rightValue)) {
				ok = std::get<StringValue>(leftValue)->value <= std::get<StringValue>(rightValue)->value;
			} else {
				auto toNumber = [](const Value& value) -> double {
					if (auto* n = std::get_if<double>(&value)) {
						return *n;
					}
					if (auto* b = std::get_if<bool>(&value)) {
						return *b ? 1.0 : 0.0;
					}
					if (isNil(value)) {
						return 0.0;
					}
					if (auto* s = std::get_if<StringValue>(&value)) {
						const std::string& text = (*s)->value;
						char* end = nullptr;
						double parsed = std::strtod(text.c_str(), &end);
						if (end == text.c_str()) {
							return std::numeric_limits<double>::quiet_NaN();
						}
						return parsed;
					}
					return std::numeric_limits<double>::quiet_NaN();
				};
				double left = toNumber(leftValue);
				double right = toNumber(rightValue);
				ok = left <= right;
			}
			if (ok != (a != 0)) {
				frame.pc += 1;
			}
			return;
		}

		case OpCode::TEST: {
			bool ok = isTruthy(frame.registers[a]);
			if (ok != (c != 0)) {
				frame.pc += 1;
			}
			return;
		}

		case OpCode::TESTSET: {
			bool ok = isTruthy(frame.registers[b]);
			if (ok == (c != 0)) {
				setRegister(frame, a, frame.registers[b]);
			} else {
				frame.pc += 1;
			}
			return;
		}

		case OpCode::JMP:
			frame.pc += sbx;
			return;

		case OpCode::CLOSURE:
			setRegister(frame, a, createClosure(frame, bx));
			return;

		case OpCode::GETUP: {
			const auto& upvalue = frame.closure->upvalues[b];
			setRegister(frame, a, readUpvalue(upvalue));
			return;
		}

		case OpCode::SETUP: {
			const auto& upvalue = frame.closure->upvalues[b];
			writeUpvalue(upvalue, frame.registers[a]);
			return;
		}

		case OpCode::VARARG: {
			int count = (b == 0) ? static_cast<int>(frame.varargs.size()) : b;
			const size_t varargCount = frame.varargs.size();
			for (int i = 0; i < count; ++i) {
				const Value& val = (i < static_cast<int>(varargCount)) ? frame.varargs[static_cast<size_t>(i)] : kNilValue;
				setRegister(frame, a + i, val);
			}
			return;
		}

		case OpCode::CALL: {
			const Value& callee = frame.registers[a];
			int argCount = (b == 0) ? std::max(frame.top - a - 1, 0) : b;
			if (isNil(callee)) {
				throw std::runtime_error("Attempted to call a nil value.");
			}
			if (auto nfn = std::get_if<std::shared_ptr<NativeFunction>>(&callee)) {
				if (!*nfn) {
					throw std::runtime_error("Attempted to call a nil value.");
				}
				m_valueScratch.clear();
				for (int i = 0; i < argCount; ++i) {
					m_valueScratch.push_back(frame.registers[a + 1 + i]);
				}
				auto results = acquireNativeReturnScratch();
				try {
					(*nfn)->invoke(m_valueScratch, results);
					writeReturnValues(frame, a, c, results);
				} catch (...) {
					releaseNativeReturnScratch(std::move(results));
					throw;
				}
				releaseNativeReturnScratch(std::move(results));
				return;
			}
			if (auto cls = std::get_if<std::shared_ptr<Closure>>(&callee)) {
				if (!*cls) {
					throw std::runtime_error("Attempted to call a nil value.");
				}
				const Value* argsBase = frame.registers.data() + a + 1;
				pushFrame(*cls, argsBase, static_cast<size_t>(argCount), a, c, false, frame.pc - 1);
				return;
			}
			std::string message = "Attempted to call a non-function value.";
			auto range = getDebugRange(frame.pc - 1);
			if (range.has_value()) {
				message += " at " + range->path + ":" + std::to_string(range->startLine);
			}
			throw std::runtime_error(message);
		}

		case OpCode::RET: {
			m_returnScratch.clear();
			int total = (b == 0) ? std::max(frame.top - a, 0) : b;
			for (int i = 0; i < total; ++i) {
				m_returnScratch.push_back(frame.registers[a + i]);
			}
			lastReturnValues = m_returnScratch;
			closeUpvalues(frame);

			int returnBase = frame.returnBase;
			int returnCount = frame.returnCount;
			bool captureReturns = frame.captureReturns;

			auto framePtr = std::move(m_frames.back());
			m_frames.pop_back();
			releaseFrame(std::move(framePtr));

			if (m_frames.empty()) {
				return;
			}
			if (captureReturns) {
				return;
			}
			CallFrame& caller = *m_frames.back();
			writeReturnValues(caller, returnBase, returnCount, m_returnScratch);
			return;
		}

		case OpCode::LOAD_MEM: {
			int addr = static_cast<int>(asNumber(frame.registers[b]));
			setRegister(frame, a, m_memory[addr]);
			return;
		}

		case OpCode::STORE_MEM: {
			int addr = static_cast<int>(asNumber(frame.registers[b]));
			m_memory[addr] = frame.registers[a];
			return;
		}

		default:
			throw std::runtime_error("Unknown opcode.");
	}
}

void VMCPU::pushFrame(std::shared_ptr<Closure> closure, const Value* args, size_t argCount,
                      int returnBase, int returnCount, bool captureReturns, int callSitePc) {
	const Proto& proto = m_program->protos[closure->protoIndex];
	auto frame = acquireFrame();
	frame->protoIndex = closure->protoIndex;
	frame->pc = proto.entryPC;
	frame->registers = acquireRegisters(static_cast<size_t>(proto.maxStack));
	frame->closure = closure;
	frame->returnBase = returnBase;
	frame->returnCount = returnCount;
	frame->top = proto.numParams;
	frame->captureReturns = captureReturns;
	frame->callSitePc = callSitePc;
	frame->varargs.clear();
	frame->openUpvalues.clear();

	// Copy args into registers
	size_t argIndex = 0;
	for (int i = 0; i < proto.numParams; ++i) {
		frame->registers[i] = (argIndex < argCount) ? args[argIndex] : kNilValue;
		++argIndex;
	}

	// Handle varargs
	if (proto.isVararg) {
		for (size_t i = argIndex; i < argCount; ++i) {
			frame->varargs.push_back(args[i]);
		}
	}

	m_frames.push_back(std::move(frame));
}

void VMCPU::pushFrame(std::shared_ptr<Closure> closure, const std::vector<Value>& args,
                      int returnBase, int returnCount, bool captureReturns, int callSitePc) {
	const Value* data = args.empty() ? nullptr : args.data();
	pushFrame(closure, data, args.size(), returnBase, returnCount, captureReturns, callSitePc);
}

std::shared_ptr<Closure> VMCPU::createClosure(CallFrame& frame, int protoIndex) {
	const Proto& proto = m_program->protos[protoIndex];
	auto closure = std::make_shared<Closure>();
	closure->protoIndex = protoIndex;
	closure->upvalues.resize(proto.upvalues.size());

	for (size_t i = 0; i < proto.upvalues.size(); ++i) {
		const UpvalueDesc& desc = proto.upvalues[i];
		if (desc.isLocal) {
			auto it = frame.openUpvalues.find(desc.index);
			if (it != frame.openUpvalues.end()) {
				closure->upvalues[i] = it->second;
			} else {
				auto upvalue = std::make_shared<Upvalue>();
				upvalue->open = true;
				upvalue->index = desc.index;
				upvalue->frame = &frame;
				frame.openUpvalues[desc.index] = upvalue;
				closure->upvalues[i] = upvalue;
			}
		} else {
			closure->upvalues[i] = frame.closure->upvalues[desc.index];
		}
	}

	return closure;
}

void VMCPU::closeUpvalues(CallFrame& frame) {
	for (auto& [index, upvalue] : frame.openUpvalues) {
		upvalue->value = frame.registers[upvalue->index];
		upvalue->open = false;
		upvalue->frame = nullptr;
	}
	frame.openUpvalues.clear();
}

const Value& VMCPU::readUpvalue(const std::shared_ptr<Upvalue>& upvalue) {
	if (upvalue->open) {
		return upvalue->frame->registers[upvalue->index];
	}
	return upvalue->value;
}

Value VMCPU::resolveTableIndex(const std::shared_ptr<Table>& table, const Value& key) {
	std::shared_ptr<Table> current = table;
	for (int depth = 0; depth < 32; ++depth) {
		Value value = current->get(key);
		if (!isNil(value)) {
			return value;
		}
		auto mt = current->getMetatable();
		if (!mt) {
			return std::monostate{};
		}
		Value indexer = mt->get(m_indexKey);
		if (!std::holds_alternative<std::shared_ptr<Table>>(indexer)) {
			return std::monostate{};
		}
		current = std::get<std::shared_ptr<Table>>(indexer);
	}
	throw std::runtime_error("Metatable __index loop detected.");
}

void VMCPU::writeUpvalue(const std::shared_ptr<Upvalue>& upvalue, const Value& value) {
	if (upvalue->open) {
		upvalue->frame->registers[upvalue->index] = value;
	} else {
		upvalue->value = value;
	}
}

void VMCPU::writeReturnValues(CallFrame& frame, int base, int count, const std::vector<Value>& values) {
	if (count == 0) {
		for (size_t i = 0; i < values.size(); ++i) {
			setRegister(frame, base + static_cast<int>(i), values[i]);
		}
		frame.top = base + static_cast<int>(values.size());
		return;
	}
	for (int i = 0; i < count; ++i) {
		const Value& val = (i < static_cast<int>(values.size())) ? values[static_cast<size_t>(i)] : kNilValue;
		setRegister(frame, base + i, val);
	}
	frame.top = base + count;
}

void VMCPU::setRegister(CallFrame& frame, int index, const Value& value) {
	if (index >= static_cast<int>(frame.registers.size())) {
		const size_t needed = static_cast<size_t>(index + 1);
		const size_t bucket = registerBucket(needed);
		const size_t target = (bucket > MAX_REGISTER_ARRAY_SIZE) ? needed : bucket;
		frame.registers.resize(target, kNilValue);
	}
	frame.registers[index] = value;
	int nextTop = index + 1;
	if (nextTop > frame.top) {
		frame.top = nextTop;
	}
}

const Value& VMCPU::readRK(CallFrame& frame, int operand) {
	if ((operand & 0x80) != 0) {
		int index = operand & 0x7F;
		return m_program->constPool[index];
	}
	return frame.registers[operand];
}

std::unique_ptr<CallFrame> VMCPU::acquireFrame() {
	if (!m_framePool.empty()) {
		auto frame = std::move(m_framePool.back());
		m_framePool.pop_back();
		return frame;
	}
	return std::make_unique<CallFrame>();
}

void VMCPU::releaseFrame(std::unique_ptr<CallFrame> frame) {
	releaseRegisters(std::move(frame->registers));
	frame->registers = {};
	frame->varargs.clear();
	frame->openUpvalues.clear();
	frame->closure.reset();

	if (m_framePool.size() < MAX_POOLED_FRAMES) {
		m_framePool.push_back(std::move(frame));
	}
}

std::vector<Value> VMCPU::acquireRegisters(size_t size) {
	size_t bucket = registerBucket(size);
	if (bucket > MAX_REGISTER_ARRAY_SIZE) {
		std::vector<Value> regs(size);
		return regs;
	}
	auto& pool = m_registerPool[bucket];
	if (!pool.empty()) {
		std::vector<Value> regs = std::move(pool.back());
		pool.pop_back();
		std::fill_n(regs.begin(), size, std::monostate{});
		return regs;
	}
	std::vector<Value> regs(bucket);
	std::fill_n(regs.begin(), size, std::monostate{});
	return regs;
}

void VMCPU::releaseRegisters(std::vector<Value>&& regs) {
	const size_t size = regs.size();
	if (size == 0) {
		return;
	}
	const size_t bucket = registerBucket(size);
	if (bucket == 0 || bucket > MAX_REGISTER_ARRAY_SIZE) {
		return;
	}
	if (regs.size() != bucket) {
		regs.resize(bucket);
	}
	auto& pool = m_registerPool[bucket];
	if (pool.size() < MAX_POOLED_REGISTER_ARRAYS) {
		pool.push_back(std::move(regs));
	}
}

std::vector<Value> VMCPU::acquireNativeReturnScratch() {
	if (!m_nativeReturnPool.empty()) {
		auto out = std::move(m_nativeReturnPool.back());
		m_nativeReturnPool.pop_back();
		out.clear();
		return out;
	}
	return {};
}

void VMCPU::releaseNativeReturnScratch(std::vector<Value>&& out) {
	if (m_nativeReturnPool.size() < MAX_POOLED_NATIVE_RETURN_ARRAYS) {
		m_nativeReturnPool.push_back(std::move(out));
	}
}

} // namespace bmsx
