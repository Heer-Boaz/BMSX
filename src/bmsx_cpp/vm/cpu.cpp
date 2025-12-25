#include "cpu.h"
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <iostream>
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
		} else if constexpr (std::is_same_v<T, std::string>) {
			return arg;
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
		} else if constexpr (std::is_same_v<T, std::string>) {
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

bool Table::s_caseInsensitiveKeys = false;

void Table::setCaseInsensitiveKeys(bool enabled) {
	s_caseInsensitiveKeys = enabled;
}

Table::Table(int arraySize, int /*hashSize*/) {
	if (arraySize > 0) {
		m_array.resize(arraySize);
	}
}

std::string Table::toUpperAscii(const std::string& value) {
	std::string result = value;
	for (char& ch : result) {
		ch = static_cast<char>(std::toupper(static_cast<unsigned char>(ch)));
	}
	return result;
}

void Table::ensureUppercaseIndex() const {
	if (!s_caseInsensitiveKeys || m_uppercaseIndexValid) {
		return;
	}
	m_uppercaseIndex.clear();
	m_uppercaseIndex.reserve(m_map.size());
	for (size_t i = 0; i < m_map.size(); ++i) {
		if (auto* str = std::get_if<std::string>(&m_map[i].first)) {
			m_uppercaseIndex[toUpperAscii(*str)] = i;
		}
	}
	m_uppercaseIndexValid = true;
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

	auto mapIndex = findMapIndex(key);
	if (mapIndex.has_value()) {
		return m_map[*mapIndex].second;
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

	auto mapIndex = findMapIndex(key);
	if (isNil(value)) {
		if (mapIndex.has_value()) {
			const bool wasStringKey = std::holds_alternative<std::string>(m_map[*mapIndex].first);
			m_map.erase(m_map.begin() + static_cast<std::ptrdiff_t>(*mapIndex));
			if (wasStringKey) {
				m_uppercaseIndexValid = false;
			}
		}
		return;
	}
	if (mapIndex.has_value()) {
		m_map[*mapIndex].second = value;
		return;
	}
	m_map.emplace_back(key, value);
	if (std::holds_alternative<std::string>(key)) {
		m_uppercaseIndexValid = false;
	}
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
	m_map.clear();
	m_uppercaseIndex.clear();
	m_uppercaseIndexValid = false;
}

std::vector<std::pair<Value, Value>> Table::entries() const {
	std::vector<std::pair<Value, Value>> result;

	// Array entries (1-based keys)
	for (size_t i = 0; i < m_array.size(); ++i) {
		if (!isNil(m_array[i])) {
			result.emplace_back(static_cast<double>(i + 1), m_array[i]);
		}
	}

	for (const auto& entry : m_map) {
		result.push_back(entry);
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
		if (!m_map.empty()) {
			return m_map.front();
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
		if (!m_map.empty()) {
			return m_map.front();
		}
		return std::nullopt;
	}
	bool seen = false;
	for (const auto& entry : m_map) {
		if (!seen) {
			if (entry.first == after) {
				seen = true;
			}
			continue;
		}
		return entry;
	}
	return std::nullopt;
}

std::optional<size_t> Table::findMapIndex(const Value& key) const {
	if (s_caseInsensitiveKeys) {
		if (auto* str = std::get_if<std::string>(&key)) {
			ensureUppercaseIndex();
			auto it = m_uppercaseIndex.find(toUpperAscii(*str));
			if (it != m_uppercaseIndex.end()) {
				return it->second;
			}
			return std::nullopt;
		}
	}
	for (size_t i = 0; i < m_map.size(); ++i) {
		if (m_map[i].first == key) {
			return i;
		}
	}
	return std::nullopt;
}

// =============================================================================
// VMCPU implementation
// =============================================================================

VMCPU::VMCPU(std::vector<Value>& memory)
	: globals(0, 0)
	, m_memory(memory)
{
	m_valueScratch.reserve(64);
	m_returnScratch.reserve(64);
}

void VMCPU::setProgram(Program* program) {
	m_program = program;
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
				setRegister(frame, a + i, std::monostate{});
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
			Value key = readRK(frame, c);
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
			Value key = readRK(frame, b);
			Value value = readRK(frame, c);
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
			std::string left = valueToString(readRK(frame, b));
			std::string right = valueToString(readRK(frame, c));
			setRegister(frame, a, left + right);
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
			if (auto* s = std::get_if<std::string>(&val)) {
				setRegister(frame, a, static_cast<double>(s->length()));
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
			Value left = readRK(frame, b);
			Value right = readRK(frame, c);
			bool eq = (left == right);
			if (eq != (a != 0)) {
				frame.pc += 1;
			}
			return;
		}

		case OpCode::LT: {
			Value leftValue = readRK(frame, b);
			Value rightValue = readRK(frame, c);
			bool ok = false;
			if (std::holds_alternative<std::string>(leftValue) && std::holds_alternative<std::string>(rightValue)) {
				ok = std::get<std::string>(leftValue) < std::get<std::string>(rightValue);
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
					if (auto* s = std::get_if<std::string>(&value)) {
						char* end = nullptr;
						double parsed = std::strtod(s->c_str(), &end);
						if (end == s->c_str()) {
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
			Value leftValue = readRK(frame, b);
			Value rightValue = readRK(frame, c);
			bool ok = false;
			if (std::holds_alternative<std::string>(leftValue) && std::holds_alternative<std::string>(rightValue)) {
				ok = std::get<std::string>(leftValue) <= std::get<std::string>(rightValue);
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
					if (auto* s = std::get_if<std::string>(&value)) {
						char* end = nullptr;
						double parsed = std::strtod(s->c_str(), &end);
						if (end == s->c_str()) {
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
			for (int i = 0; i < count; ++i) {
				Value val = (i < static_cast<int>(frame.varargs.size())) ? frame.varargs[i] : Value{std::monostate{}};
				setRegister(frame, a + i, val);
			}
			return;
		}

		case OpCode::CALL: {
			const Value& callee = frame.registers[a];
			int argCount = (b == 0) ? std::max(frame.top - a - 1, 0) : b;
			m_valueScratch.clear();
			for (int i = 0; i < argCount; ++i) {
				m_valueScratch.push_back(frame.registers[a + 1 + i]);
			}
			if (isNil(callee)) {
				throw std::runtime_error("Attempted to call a nil value.");
			}
			if (auto nfn = std::get_if<std::shared_ptr<NativeFunction>>(&callee)) {
				if (!*nfn) {
					throw std::runtime_error("Attempted to call a nil value.");
				}
				std::vector<Value> results = (*nfn)->invoke(m_valueScratch);
				writeReturnValues(frame, a, c, results);
				return;
			}
			if (auto cls = std::get_if<std::shared_ptr<Closure>>(&callee)) {
				if (!*cls) {
					throw std::runtime_error("Attempted to call a nil value.");
				}
				pushFrame(*cls, m_valueScratch, a, c, false, frame.pc - 1);
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

void VMCPU::pushFrame(std::shared_ptr<Closure> closure, const std::vector<Value>& args,
                      int returnBase, int returnCount, bool captureReturns, int callSitePc) {
	const Proto& proto = m_program->protos[closure->protoIndex];
	auto frame = acquireFrame();
	frame->protoIndex = closure->protoIndex;
	frame->pc = proto.entryPC;
	frame->registers.resize(proto.maxStack);
	std::fill(frame->registers.begin(), frame->registers.end(), std::monostate{});
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
		frame->registers[i] = (argIndex < args.size()) ? args[argIndex] : Value{std::monostate{}};
		++argIndex;
	}

	// Handle varargs
	if (proto.isVararg) {
		for (size_t i = argIndex; i < args.size(); ++i) {
			frame->varargs.push_back(args[i]);
		}
	}

	m_frames.push_back(std::move(frame));
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

Value VMCPU::readUpvalue(const std::shared_ptr<Upvalue>& upvalue) {
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
		Value indexer = mt->get(std::string("__index"));
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
		frame.top = std::max(frame.top, base + static_cast<int>(values.size()));
		return;
	}
	for (int i = 0; i < count; ++i) {
		Value val = (i < static_cast<int>(values.size())) ? values[i] : Value{std::monostate{}};
		setRegister(frame, base + i, val);
	}
}

void VMCPU::setRegister(CallFrame& frame, int index, const Value& value) {
	if (index >= static_cast<int>(frame.registers.size())) {
		frame.registers.resize(static_cast<size_t>(index) + 1);
	}
	frame.registers[index] = value;
	int nextTop = index + 1;
	if (nextTop > frame.top) {
		frame.top = nextTop;
	}
}

Value VMCPU::readRK(CallFrame& frame, int operand) {
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
	frame->registers.clear();
	frame->varargs.clear();
	frame->openUpvalues.clear();
	frame->closure.reset();

	if (m_framePool.size() < MAX_POOLED_FRAMES) {
		m_framePool.push_back(std::move(frame));
	}
}

} // namespace bmsx
