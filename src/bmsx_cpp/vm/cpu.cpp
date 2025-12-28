#include "cpu.h"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <limits>
#include <sstream>
#include <stdexcept>

namespace bmsx {

std::string valueToString(const Value& v, const StringPool& stringPool) {
	if (isNil(v)) return "nil";
	if (valueIsTagged(v)) {
		switch (valueTag(v)) {
			case ValueTag::False: return "false";
			case ValueTag::True: return "true";
			case ValueTag::String: return stringPool.toString(asStringId(v));
			case ValueTag::Table: return "table";
			case ValueTag::Closure: return "function";
			case ValueTag::NativeFunction: return "function";
			case ValueTag::NativeObject: return "native";
			case ValueTag::Upvalue: return "upvalue";
			case ValueTag::Nil: return "nil";
			default: return "unknown";
		}
	}
	double num = valueToNumber(v);
	if (!std::isfinite(num)) {
		return std::isnan(num) ? "nan" : (num < 0 ? "-inf" : "inf");
	}
	std::ostringstream oss;
	oss << num;
	return oss.str();
}

const char* valueTypeName(Value v) {
	return valueTypeNameInline(v);
}

Table::Table(int arraySize, int hashSize) {
	if (arraySize > 0) {
		m_array.resize(arraySize, valueNil());
	}
	m_stringMap.reserve(static_cast<size_t>(hashSize));
	m_otherMap.reserve(static_cast<size_t>(hashSize));
}

bool Table::isArrayIndex(const Value& key) const {
	if (!valueIsNumber(key)) {
		return false;
	}
	double n = valueToNumber(key);
	double intpart;
	if (std::modf(n, &intpart) == 0.0 && n >= 1.0) {
		return true;
	}
	return false;
}

int Table::toArrayIndex(const Value& key) const {
	return static_cast<int>(valueToNumber(key)) - 1;
}

Value Table::get(const Value& key) const {
	if (isArrayIndex(key)) {
		int index = toArrayIndex(key);
		if (index >= 0 && index < static_cast<int>(m_array.size())) {
			return m_array[static_cast<size_t>(index)];
		}
		return valueNil();
	}

	if (valueIsString(key)) {
		StringId id = asStringId(key);
		auto mapIt = m_stringMap.find(id);
		if (mapIt != m_stringMap.end()) {
			return mapIt->second;
		}
		return valueNil();
	}

	auto mapIt = m_otherMap.find(key);
	if (mapIt != m_otherMap.end()) {
		return mapIt->second;
	}
	return valueNil();
}

void Table::set(const Value& key, const Value& value) {
	if (isArrayIndex(key)) {
		int index = toArrayIndex(key);
		if (index >= 0) {
			if (index >= static_cast<int>(m_array.size())) {
				m_array.resize(static_cast<size_t>(index) + 1, valueNil());
			}
			m_array[static_cast<size_t>(index)] = value;
			return;
		}
	}

	if (valueIsString(key)) {
		StringId id = asStringId(key);
		if (isNil(value)) {
			m_stringMap.erase(id);
			return;
		}
		m_stringMap[id] = value;
		return;
	}

	if (isNil(value)) {
		m_otherMap.erase(key);
		return;
	}
	m_otherMap[key] = value;
}

int Table::length() const {
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
	forEachEntry([&result](Value key, Value value) {
		result.emplace_back(key, value);
	});
	return result;
}

std::optional<std::pair<Value, Value>> Table::nextEntry(const Value& after) const {
	if (isNil(after)) {
		for (size_t i = 0; i < m_array.size(); ++i) {
			if (!isNil(m_array[i])) {
				return std::make_pair(valueNumber(static_cast<double>(i + 1)), m_array[i]);
			}
		}
		if (!m_stringMap.empty()) {
			const auto& entry = *m_stringMap.begin();
			return std::make_pair(valueString(entry.first), entry.second);
		}
		if (!m_otherMap.empty()) {
			const auto& entry = *m_otherMap.begin();
			return std::make_pair(entry.first, entry.second);
		}
		return std::nullopt;
	}
	if (isArrayIndex(after)) {
		int startIndex = static_cast<int>(valueToNumber(after));
		for (int i = startIndex; i < static_cast<int>(m_array.size()); ++i) {
			if (!isNil(m_array[static_cast<size_t>(i)])) {
				return std::make_pair(valueNumber(static_cast<double>(i + 1)), m_array[static_cast<size_t>(i)]);
			}
		}
		if (!m_stringMap.empty()) {
			const auto& entry = *m_stringMap.begin();
			return std::make_pair(valueString(entry.first), entry.second);
		}
		if (!m_otherMap.empty()) {
			const auto& entry = *m_otherMap.begin();
			return std::make_pair(entry.first, entry.second);
		}
		return std::nullopt;
	}
	if (valueIsString(after)) {
		StringId id = asStringId(after);
		auto found = m_stringMap.find(id);
		if (found == m_stringMap.end()) {
			return std::nullopt;
		}
		bool seen = false;
		for (const auto& entry : m_stringMap) {
			if (!seen) {
				if (entry.first == id) {
					seen = true;
				}
				continue;
			}
			return std::make_pair(valueString(entry.first), entry.second);
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

void VMHeap::markValue(Value v) {
	if (!valueIsTagged(v)) {
		return;
	}
	switch (valueTag(v)) {
		case ValueTag::Table:
			markObject(asTable(v));
			break;
		case ValueTag::Closure:
			markObject(asClosure(v));
			break;
		case ValueTag::NativeFunction:
			markObject(asNativeFunction(v));
			break;
		case ValueTag::NativeObject:
			markObject(asNativeObject(v));
			break;
		case ValueTag::Upvalue:
			markObject(asUpvalue(v));
			break;
		default:
			break;
	}
}

void VMHeap::markObject(GCObject* obj) {
	if (!obj || obj->marked) {
		return;
	}
	obj->marked = true;
	m_grayStack.push_back(obj);
}

void VMHeap::trace() {
	while (!m_grayStack.empty()) {
		GCObject* obj = m_grayStack.back();
		m_grayStack.pop_back();
		switch (obj->type) {
			case ObjType::Table: {
				auto* table = static_cast<Table*>(obj);
				if (table->getMetatable()) {
					markObject(table->getMetatable());
				}
				table->forEachEntry([this](Value key, Value value) {
					markValue(key);
					markValue(value);
				});
				break;
			}
			case ObjType::Closure: {
				auto* closure = static_cast<Closure*>(obj);
				for (auto* upvalue : closure->upvalues) {
					markObject(upvalue);
				}
				break;
			}
			case ObjType::NativeFunction:
				break;
			case ObjType::NativeObject: {
				auto* native = static_cast<NativeObject*>(obj);
				if (native->mark) {
					native->mark(*this);
				}
				break;
			}
			case ObjType::Upvalue: {
				auto* upvalue = static_cast<Upvalue*>(obj);
				if (!upvalue->open) {
					markValue(upvalue->value);
				}
				break;
			}
		}
	}
}

void VMHeap::sweep() {
	GCObject** current = &m_objects;
	while (*current) {
		GCObject* obj = *current;
		if (obj->marked) {
			obj->marked = false;
			current = &obj->next;
			continue;
		}
		switch (obj->type) {
			case ObjType::Table:
				m_bytesAllocated -= sizeof(Table);
				delete static_cast<Table*>(obj);
				break;
			case ObjType::Closure:
				m_bytesAllocated -= sizeof(Closure);
				delete static_cast<Closure*>(obj);
				break;
			case ObjType::NativeFunction:
				m_bytesAllocated -= sizeof(NativeFunction);
				delete static_cast<NativeFunction*>(obj);
				break;
			case ObjType::NativeObject:
				m_bytesAllocated -= sizeof(NativeObject);
				delete static_cast<NativeObject*>(obj);
				break;
			case ObjType::Upvalue:
				m_bytesAllocated -= sizeof(Upvalue);
				delete static_cast<Upvalue*>(obj);
				break;
		}
		*current = obj->next;
	}
}

void VMHeap::collect() {
	if (!m_collectRequested) {
		return;
	}
	m_collectRequested = false;
	if (m_rootMarker) {
		m_rootMarker(*this);
	}
	trace();
	sweep();
	m_nextGC = m_bytesAllocated * 2;
}

VMCPU::VMCPU(std::vector<Value>& memory)
	: m_memory(memory) {
	m_heap.setRootMarker([this](VMHeap& heap) { markRoots(heap); });
	m_externalRootMarker = [](VMHeap&) {};
	globals = m_heap.allocate<Table>(ObjType::Table, 0, 0);
	m_indexKey = valueString(m_stringPool.intern("__index"));
}

Value VMCPU::createNativeFunction(std::string_view name, NativeFunctionInvoke fn) {
	auto* native = m_heap.allocate<NativeFunction>(ObjType::NativeFunction);
	native->name = std::string(name);
	native->invoke = [invoke = std::move(fn)](const std::vector<Value>& args, std::vector<Value>& out) {
		out.clear();
		invoke(args, out);
	};
	return valueNativeFunction(native);
}

Value VMCPU::createNativeObject(
	void* raw,
	std::function<Value(const Value&)> get,
	std::function<void(const Value&, const Value&)> set,
	std::function<int()> len,
	std::function<std::optional<std::pair<Value, Value>>(const Value&)> next,
	std::function<void(VMHeap&)> mark
) {
	auto* native = m_heap.allocate<NativeObject>(ObjType::NativeObject);
	native->raw = raw;
	native->get = std::move(get);
	native->set = std::move(set);
	native->len = std::move(len);
	native->next = std::move(next);
	native->mark = std::move(mark);
	return valueNativeObject(native);
}

Table* VMCPU::createTable(int arraySize, int hashSize) {
	return m_heap.allocate<Table>(ObjType::Table, arraySize, hashSize);
}

Closure* VMCPU::createRootClosure(int protoIndex) {
	auto* closure = m_heap.allocate<Closure>(ObjType::Closure);
	closure->protoIndex = protoIndex;
	closure->upvalues.clear();
	return closure;
}

void VMCPU::setProgram(Program* program) {
	m_program = program;
	if (!m_program) {
		return;
	}
	const StringPool& programPool = m_program->stringPool;
	auto& constPool = m_program->constPool;
	for (size_t index = 0; index < constPool.size(); ++index) {
		Value value = constPool[index];
		if (valueIsString(value)) {
			StringId oldId = asStringId(value);
			StringId newId = m_stringPool.intern(programPool.toString(oldId));
			constPool[index] = valueString(newId);
		}
	}
	m_indexKey = valueString(m_stringPool.intern("__index"));
}

void VMCPU::start(int entryProtoIndex, const std::vector<Value>& args) {
	m_frames.clear();
	auto* closure = createRootClosure(entryProtoIndex);
	pushFrame(closure, args, 0, 0, false, m_program->protos[entryProtoIndex].entryPC);
}

void VMCPU::call(Closure* closure, const std::vector<Value>& args, int returnCount) {
	if (!closure) {
		throw std::runtime_error("Attempted to call a nil value.");
	}
	pushFrame(closure, args, 0, returnCount, false, m_program->protos[closure->protoIndex].entryPC);
}

void VMCPU::callExternal(Closure* closure, const std::vector<Value>& args) {
	if (!closure) {
		throw std::runtime_error("Attempted to call a nil value.");
	}
	pushFrame(closure, args, 0, 0, true, m_program->protos[closure->protoIndex].entryPC);
}

RunResult VMCPU::run(std::optional<int> instructionBudget) {
	instructionBudgetRemaining = instructionBudget;
	while (!m_frames.empty()) {
		if (m_heap.needsCollection()) {
			m_heap.collect();
		}
		CallFrame& frame = *m_frames.back();
		if (instructionBudgetRemaining.has_value() && *instructionBudgetRemaining <= 0) {
			return RunResult::Yielded;
		}
		uint32_t instr = m_program->code[frame.pc];
		frame.pc += 1;
		lastPc = frame.pc - 1;
		lastInstruction = instr;
		if (instructionBudgetRemaining.has_value()) {
			--(*instructionBudgetRemaining);
		}
		executeInstruction(frame, instr);
	}
	return RunResult::Halted;
}

RunResult VMCPU::runUntilDepth(int targetDepth, std::optional<int> instructionBudget) {
	instructionBudgetRemaining = instructionBudget;
	while (static_cast<int>(m_frames.size()) >= targetDepth && !m_frames.empty()) {
		if (m_heap.needsCollection()) {
			m_heap.collect();
		}
		CallFrame& frame = *m_frames.back();
		if (instructionBudgetRemaining.has_value() && *instructionBudgetRemaining <= 0) {
			return RunResult::Yielded;
		}
		uint32_t instr = m_program->code[frame.pc];
		frame.pc += 1;
		lastPc = frame.pc - 1;
		lastInstruction = instr;
		if (instructionBudgetRemaining.has_value()) {
			--(*instructionBudgetRemaining);
		}
		executeInstruction(frame, instr);
	}
	return RunResult::Halted;
}

void VMCPU::step() {
	if (m_frames.empty()) return;
	if (m_heap.needsCollection()) {
		m_heap.collect();
	}
	CallFrame& frame = *m_frames.back();
	uint32_t instr = m_program->code[frame.pc];
	frame.pc += 1;
	lastPc = frame.pc - 1;
	lastInstruction = instr;
	if (instructionBudgetRemaining.has_value()) {
		--(*instructionBudgetRemaining);
	}
	executeInstruction(frame, instr);
}

std::optional<SourceRange> VMCPU::getDebugRange(int pc) const {
	if (!m_program || pc < 0 || pc >= static_cast<int>(m_program->debugRanges.size())) {
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
				setRegister(frame, a + i, valueNil());
			}
			return;

		case OpCode::LOADBOOL:
			setRegister(frame, a, valueBool(b != 0));
			if (c != 0) {
				frame.pc += 1;
			}
			return;

		case OpCode::GETG: {
			const Value& key = m_program->constPool[bx];
			setRegister(frame, a, globals->get(key));
			return;
		}

		case OpCode::SETG: {
			const Value& key = m_program->constPool[bx];
			globals->set(key, frame.registers[a]);
			return;
		}

		case OpCode::GETT: {
			const Value& tableValue = frame.registers[b];
			const Value& key = readRK(frame, c);
			if (valueIsTable(tableValue)) {
				setRegister(frame, a, resolveTableIndex(asTable(tableValue), key));
				return;
			}
			if (valueIsNativeObject(tableValue)) {
				setRegister(frame, a, asNativeObject(tableValue)->get(key));
				return;
			}
			std::string message = "Attempted to index field on a non-table value.";
			message += " base=" + std::string(valueTypeName(tableValue)) + "(" + valueToString(tableValue, m_stringPool) + ")";
			message += " key=" + std::string(valueTypeName(key)) + "(" + valueToString(key, m_stringPool) + ")";
			auto range = getDebugRange(frame.pc - 1);
			if (range.has_value()) {
				message += " at " + range->path + ":" + std::to_string(range->startLine);
			}
			throw std::runtime_error(message);
		}

		case OpCode::SETT: {
			const Value& tableValue = frame.registers[a];
			const Value& key = readRK(frame, b);
			const Value& value = readRK(frame, c);
			if (valueIsTable(tableValue)) {
				asTable(tableValue)->set(key, value);
				return;
			}
			if (valueIsNativeObject(tableValue)) {
				asNativeObject(tableValue)->set(key, value);
				return;
			}
			std::string message = "Attempted to assign to a non-table value.";
			message += " base=" + std::string(valueTypeName(tableValue)) + "(" + valueToString(tableValue, m_stringPool) + ")";
			message += " key=" + std::string(valueTypeName(key)) + "(" + valueToString(key, m_stringPool) + ")";
			message += " value=" + std::string(valueTypeName(value)) + "(" + valueToString(value, m_stringPool) + ")";
			auto range = getDebugRange(frame.pc - 1);
			if (range.has_value()) {
				message += " at " + range->path + ":" + std::to_string(range->startLine);
			}
			throw std::runtime_error(message);
		}

		case OpCode::NEWT: {
			auto* table = m_heap.allocate<Table>(ObjType::Table, b, c);
			setRegister(frame, a, valueTable(table));
			return;
		}

		case OpCode::ADD: {
			double left = asNumber(readRK(frame, b));
			double right = asNumber(readRK(frame, c));
			setRegister(frame, a, valueNumber(left + right));
			return;
		}

		case OpCode::SUB: {
			double left = asNumber(readRK(frame, b));
			double right = asNumber(readRK(frame, c));
			setRegister(frame, a, valueNumber(left - right));
			return;
		}

		case OpCode::MUL: {
			double left = asNumber(readRK(frame, b));
			double right = asNumber(readRK(frame, c));
			setRegister(frame, a, valueNumber(left * right));
			return;
		}

		case OpCode::DIV: {
			double left = asNumber(readRK(frame, b));
			double right = asNumber(readRK(frame, c));
			setRegister(frame, a, valueNumber(left / right));
			return;
		}

		case OpCode::MOD: {
			double left = asNumber(readRK(frame, b));
			double right = asNumber(readRK(frame, c));
			setRegister(frame, a, valueNumber(std::fmod(left, right)));
			return;
		}

		case OpCode::FLOORDIV: {
			double left = asNumber(readRK(frame, b));
			double right = asNumber(readRK(frame, c));
			setRegister(frame, a, valueNumber(std::floor(left / right)));
			return;
		}

		case OpCode::POW: {
			double left = asNumber(readRK(frame, b));
			double right = asNumber(readRK(frame, c));
			setRegister(frame, a, valueNumber(std::pow(left, right)));
			return;
		}

		case OpCode::BAND: {
			int left = static_cast<int>(asNumber(readRK(frame, b)));
			int right = static_cast<int>(asNumber(readRK(frame, c)));
			setRegister(frame, a, valueNumber(static_cast<double>(left & right)));
			return;
		}

		case OpCode::BOR: {
			int left = static_cast<int>(asNumber(readRK(frame, b)));
			int right = static_cast<int>(asNumber(readRK(frame, c)));
			setRegister(frame, a, valueNumber(static_cast<double>(left | right)));
			return;
		}

		case OpCode::BXOR: {
			int left = static_cast<int>(asNumber(readRK(frame, b)));
			int right = static_cast<int>(asNumber(readRK(frame, c)));
			setRegister(frame, a, valueNumber(static_cast<double>(left ^ right)));
			return;
		}

		case OpCode::SHL: {
			int left = static_cast<int>(asNumber(readRK(frame, b)));
			int right = static_cast<int>(asNumber(readRK(frame, c))) & 31;
			setRegister(frame, a, valueNumber(static_cast<double>(left << right)));
			return;
		}

		case OpCode::SHR: {
			int left = static_cast<int>(asNumber(readRK(frame, b)));
			int right = static_cast<int>(asNumber(readRK(frame, c))) & 31;
			setRegister(frame, a, valueNumber(static_cast<double>(left >> right)));
			return;
		}

		case OpCode::CONCAT: {
			std::string text = valueToString(readRK(frame, b), m_stringPool);
			text += valueToString(readRK(frame, c), m_stringPool);
			setRegister(frame, a, valueString(m_stringPool.intern(text)));
			return;
		}

		case OpCode::UNM: {
			double val = asNumber(frame.registers[b]);
			setRegister(frame, a, valueNumber(-val));
			return;
		}

		case OpCode::NOT:
			setRegister(frame, a, valueBool(!isTruthy(frame.registers[b])));
			return;

		case OpCode::LEN: {
			const Value& val = frame.registers[b];
			if (valueIsString(val)) {
				const std::string& text = m_stringPool.toString(asStringId(val));
				setRegister(frame, a, valueNumber(static_cast<double>(text.length())));
				return;
			}
			if (valueIsTable(val)) {
				setRegister(frame, a, valueNumber(static_cast<double>(asTable(val)->length())));
				return;
			}
			if (valueIsNativeObject(val)) {
				auto* obj = asNativeObject(val);
				if (!obj->len) {
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
				setRegister(frame, a, valueNumber(static_cast<double>(obj->len())));
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
			setRegister(frame, a, valueNumber(static_cast<double>(~val)));
			return;
		}

		case OpCode::EQ: {
			const Value& left = readRK(frame, b);
			const Value& right = readRK(frame, c);
			bool eq = false;
			if (valueIsNumber(left) && valueIsNumber(right)) {
				eq = valueToNumber(left) == valueToNumber(right);
			} else if (valueIsTagged(left) && valueIsTagged(right)) {
				eq = left == right;
			}
			if (eq != (a != 0)) {
				frame.pc += 1;
			}
			return;
		}

		case OpCode::LT: {
			const Value& leftValue = readRK(frame, b);
			const Value& rightValue = readRK(frame, c);
			bool ok = false;
			if (valueIsString(leftValue) && valueIsString(rightValue)) {
				ok = m_stringPool.toString(asStringId(leftValue)) < m_stringPool.toString(asStringId(rightValue));
			} else {
				auto toNumber = [this](const Value& value) -> double {
					if (valueIsNumber(value)) {
						return valueToNumber(value);
					}
					if (valueIsTagged(value)) {
						switch (valueTag(value)) {
							case ValueTag::False: return 0.0;
							case ValueTag::True: return 1.0;
							case ValueTag::Nil: return 0.0;
							case ValueTag::String: {
								const std::string& text = m_stringPool.toString(asStringId(value));
								char* end = nullptr;
								double parsed = std::strtod(text.c_str(), &end);
								if (end == text.c_str()) {
									return std::numeric_limits<double>::quiet_NaN();
								}
								return parsed;
							}
							default:
								return std::numeric_limits<double>::quiet_NaN();
						}
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
			if (valueIsString(leftValue) && valueIsString(rightValue)) {
				ok = m_stringPool.toString(asStringId(leftValue)) <= m_stringPool.toString(asStringId(rightValue));
			} else {
				auto toNumber = [this](const Value& value) -> double {
					if (valueIsNumber(value)) {
						return valueToNumber(value);
					}
					if (valueIsTagged(value)) {
						switch (valueTag(value)) {
							case ValueTag::False: return 0.0;
							case ValueTag::True: return 1.0;
							case ValueTag::Nil: return 0.0;
							case ValueTag::String: {
								const std::string& text = m_stringPool.toString(asStringId(value));
								char* end = nullptr;
								double parsed = std::strtod(text.c_str(), &end);
								if (end == text.c_str()) {
									return std::numeric_limits<double>::quiet_NaN();
								}
								return parsed;
							}
							default:
								return std::numeric_limits<double>::quiet_NaN();
						}
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
			const Value& val = frame.registers[a];
			if (isTruthy(val) != (c != 0)) {
				frame.pc += 1;
			}
			return;
		}

		case OpCode::TESTSET: {
			const Value& val = frame.registers[b];
			if (isTruthy(val) == (c != 0)) {
				setRegister(frame, a, val);
			} else {
				frame.pc += 1;
			}
			return;
		}

		case OpCode::JMP:
			frame.pc += sbx;
			return;

		case OpCode::CLOSURE:
			setRegister(frame, a, valueClosure(createClosure(frame, bx)));
			return;

		case OpCode::GETUP: {
			Upvalue* upvalue = frame.closure->upvalues[b];
			setRegister(frame, a, readUpvalue(upvalue));
			return;
		}

		case OpCode::SETUP: {
			Upvalue* upvalue = frame.closure->upvalues[b];
			writeUpvalue(upvalue, frame.registers[a]);
			return;
		}

		case OpCode::VARARG: {
			int count = b == 0 ? static_cast<int>(frame.varargs.size()) : b;
			for (int i = 0; i < count; ++i) {
				Value value = i < static_cast<int>(frame.varargs.size()) ? frame.varargs[static_cast<size_t>(i)] : valueNil();
				setRegister(frame, a + i, value);
			}
			return;
		}

		case OpCode::CALL: {
			int argCount = b == 0 ? std::max(frame.top - a - 1, 0) : b;
			int retCount = c;
			const Value& callee = frame.registers[a];
			if (valueIsClosure(callee)) {
				Closure* closure = asClosure(callee);
				pushFrame(closure, &frame.registers[a + 1], static_cast<size_t>(argCount), a, retCount, false, frame.pc - 1);
				return;
			}
			if (valueIsNativeFunction(callee)) {
				NativeFunction* fn = asNativeFunction(callee);
				std::vector<Value> args = acquireArgScratch();
				args.clear();
				args.reserve(static_cast<size_t>(argCount));
				for (int i = 0; i < argCount; ++i) {
					args.push_back(frame.registers[a + 1 + i]);
				}
				std::vector<Value> out = acquireNativeReturnScratch();
				fn->invoke(args, out);
				writeReturnValues(frame, a, retCount, out);
				releaseNativeReturnScratch(std::move(out));
				releaseArgScratch(std::move(args));
				return;
			}
			throw std::runtime_error("Attempted to call a non-function value.");
		}

		case OpCode::RET: {
			auto& results = m_returnScratch;
			results.clear();
			int count = b == 0 ? std::max(frame.top - a, 0) : b;
			results.reserve(static_cast<size_t>(count));
			for (int i = 0; i < count; ++i) {
				results.push_back(frame.registers[a + i]);
			}
			lastReturnValues.assign(results.begin(), results.end());
			closeUpvalues(frame);
			auto finished = std::move(m_frames.back());
			m_frames.pop_back();
			if (m_frames.empty()) {
				releaseFrame(std::move(finished));
				return;
			}
			if (finished->captureReturns) {
				releaseFrame(std::move(finished));
				return;
			}
			CallFrame& caller = *m_frames.back();
			writeReturnValues(caller, finished->returnBase, finished->returnCount, results);
			releaseFrame(std::move(finished));
			return;
		}

		case OpCode::LOAD_MEM: {
			int addr = static_cast<int>(asNumber(frame.registers[b]));
			setRegister(frame, a, m_memory[static_cast<size_t>(addr)]);
			return;
		}

		case OpCode::STORE_MEM: {
			int addr = static_cast<int>(asNumber(frame.registers[b]));
			m_memory[static_cast<size_t>(addr)] = frame.registers[a];
			return;
		}
	}
}

Closure* VMCPU::createClosure(CallFrame& frame, int protoIndex) {
	const Proto& proto = m_program->protos[protoIndex];
	auto* closure = m_heap.allocate<Closure>(ObjType::Closure);
	closure->protoIndex = protoIndex;
	closure->upvalues.resize(proto.upvalues.size());
	for (size_t i = 0; i < proto.upvalues.size(); ++i) {
		const UpvalueDesc& uv = proto.upvalues[i];
		if (uv.isLocal) {
			Upvalue* upvalue = nullptr;
			auto it = frame.openUpvalues.find(uv.index);
			if (it != frame.openUpvalues.end()) {
				upvalue = it->second;
			} else {
				upvalue = m_heap.allocate<Upvalue>(ObjType::Upvalue);
				upvalue->open = true;
				upvalue->index = uv.index;
				upvalue->frame = &frame;
				frame.openUpvalues.emplace(uv.index, upvalue);
			}
			closure->upvalues[i] = upvalue;
		} else {
			closure->upvalues[i] = frame.closure->upvalues[uv.index];
		}
	}
	return closure;
}

void VMCPU::closeUpvalues(CallFrame& frame) {
	for (auto& entry : frame.openUpvalues) {
		Upvalue* upvalue = entry.second;
		upvalue->value = frame.registers[upvalue->index];
		upvalue->open = false;
		upvalue->frame = nullptr;
	}
	frame.openUpvalues.clear();
}

const Value& VMCPU::readUpvalue(Upvalue* upvalue) {
	if (upvalue->open) {
		return upvalue->frame->registers[upvalue->index];
	}
	return upvalue->value;
}

void VMCPU::writeUpvalue(Upvalue* upvalue, const Value& value) {
	if (upvalue->open) {
		upvalue->frame->registers[upvalue->index] = value;
		return;
	}
	upvalue->value = value;
}

void VMCPU::pushFrame(Closure* closure, const Value* args, size_t argCount,
	int returnBase, int returnCount, bool captureReturns, int callSitePc) {
	const Proto& proto = m_program->protos[closure->protoIndex];
	auto frame = acquireFrame();
	frame->protoIndex = closure->protoIndex;
	frame->pc = proto.entryPC;
	frame->closure = closure;
	frame->returnBase = returnBase;
	frame->returnCount = returnCount;
	frame->captureReturns = captureReturns;
	frame->callSitePc = callSitePc;
	frame->registers = acquireRegisters(static_cast<size_t>(proto.maxStack));
	frame->top = proto.numParams;

	for (int i = 0; i < proto.numParams; ++i) {
		if (i < static_cast<int>(argCount)) {
			frame->registers[static_cast<size_t>(i)] = args[i];
		} else {
			frame->registers[static_cast<size_t>(i)] = valueNil();
		}
	}
	if (proto.isVararg) {
		frame->varargs.clear();
		for (size_t i = static_cast<size_t>(proto.numParams); i < argCount; ++i) {
			frame->varargs.push_back(args[i]);
		}
	}
	m_frames.push_back(std::move(frame));
}

void VMCPU::pushFrame(Closure* closure, const std::vector<Value>& args,
	int returnBase, int returnCount, bool captureReturns, int callSitePc) {
	pushFrame(closure, args.data(), args.size(), returnBase, returnCount, captureReturns, callSitePc);
}

void VMCPU::writeReturnValues(CallFrame& frame, int base, int count, const std::vector<Value>& values) {
	if (count == 0) {
		int writeCount = static_cast<int>(values.size());
		for (int i = 0; i < writeCount; ++i) {
			setRegister(frame, base + i, values[static_cast<size_t>(i)]);
		}
		frame.top = base + writeCount;
		return;
	}
	for (int i = 0; i < count; ++i) {
		Value value = i < static_cast<int>(values.size()) ? values[static_cast<size_t>(i)] : valueNil();
		setRegister(frame, base + i, value);
	}
	frame.top = base + count;
}

void VMCPU::setRegister(CallFrame& frame, int index, const Value& value) {
	frame.registers[static_cast<size_t>(index)] = value;
	if (index >= frame.top) {
		frame.top = index + 1;
	}
}

const Value& VMCPU::readRK(CallFrame& frame, int operand) {
	bool isConst = (operand & 0x80) != 0;
	int index = operand & 0x7F;
	return isConst ? m_program->constPool[static_cast<size_t>(index)] : frame.registers[static_cast<size_t>(index)];
}

Value VMCPU::resolveTableIndex(Table* table, const Value& key) {
	Table* current = table;
	for (int depth = 0; depth < 32; depth += 1) {
		Value value = current->get(key);
		if (!isNil(value)) {
			return value;
		}
		Table* metatable = current->getMetatable();
		if (!metatable) {
			return valueNil();
		}
		Value indexerValue = metatable->get(m_indexKey);
		if (!valueIsTable(indexerValue)) {
			return valueNil();
		}
		current = asTable(indexerValue);
	}
	throw std::runtime_error("Metatable __index loop detected.");
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
	frame->varargs.clear();
	frame->openUpvalues.clear();
	if (m_framePool.size() < static_cast<size_t>(MAX_POOLED_FRAMES)) {
		m_framePool.push_back(std::move(frame));
	}
}

std::vector<Value> VMCPU::acquireRegisters(size_t size) {
	size_t bucket = 8;
	while (bucket < size) {
		bucket <<= 1;
	}
	auto& pool = m_registerPool[bucket];
	if (!pool.empty()) {
		std::vector<Value> regs = std::move(pool.back());
		pool.pop_back();
		for (size_t i = 0; i < size; ++i) {
			regs[i] = valueNil();
		}
		return regs;
	}
	std::vector<Value> regs(bucket, valueNil());
	return regs;
}

void VMCPU::releaseRegisters(std::vector<Value>&& regs) {
	size_t bucket = regs.size();
	if (bucket > MAX_REGISTER_ARRAY_SIZE) {
		return;
	}
	auto& pool = m_registerPool[bucket];
	if (pool.size() < MAX_POOLED_REGISTER_ARRAYS) {
		pool.push_back(std::move(regs));
	}
}

std::vector<Value> VMCPU::acquireNativeReturnScratch() {
	if (!m_nativeReturnPool.empty()) {
		std::vector<Value> out = std::move(m_nativeReturnPool.back());
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

std::vector<Value> VMCPU::acquireArgScratch() {
	if (!m_nativeArgPool.empty()) {
		std::vector<Value> args = std::move(m_nativeArgPool.back());
		m_nativeArgPool.pop_back();
		args.clear();
		return args;
	}
	return {};
}

void VMCPU::releaseArgScratch(std::vector<Value>&& args) {
	if (m_nativeArgPool.size() < MAX_POOLED_NATIVE_ARG_ARRAYS) {
		m_nativeArgPool.push_back(std::move(args));
	}
}

void VMCPU::markRoots(VMHeap& heap) {
	if (globals) {
		heap.markObject(globals);
	}
	for (const auto& value : m_memory) {
		heap.markValue(value);
	}
	for (const auto& value : lastReturnValues) {
		heap.markValue(value);
	}
	for (const auto& value : m_returnScratch) {
		heap.markValue(value);
	}
	if (m_program) {
		for (const auto& value : m_program->constPool) {
			heap.markValue(value);
		}
	}
	for (const auto& framePtr : m_frames) {
		CallFrame* frame = framePtr.get();
		heap.markObject(frame->closure);
		for (const auto& value : frame->registers) {
			heap.markValue(value);
		}
		for (const auto& value : frame->varargs) {
			heap.markValue(value);
		}
		for (const auto& entry : frame->openUpvalues) {
			heap.markObject(entry.second);
		}
	}
	m_externalRootMarker(heap);
}

} // namespace bmsx
