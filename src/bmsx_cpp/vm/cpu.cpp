#include "cpu.h"
#include "vm_memory.h"
#include "number_format.h"
#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <limits>
#include <stdexcept>

namespace bmsx {

namespace {

static inline uint32_t readInstructionWord(const std::vector<uint8_t>& code, int pc) {
	size_t offset = static_cast<size_t>(pc) * INSTRUCTION_BYTES;
	return (static_cast<uint32_t>(code[offset]) << 24)
		| (static_cast<uint32_t>(code[offset + 1]) << 16)
		| (static_cast<uint32_t>(code[offset + 2]) << 8)
		| static_cast<uint32_t>(code[offset + 3]);
}

static inline int signExtend(uint32_t value, int bits) {
	int shift = 32 - bits;
	return static_cast<int>(value << shift) >> shift;
}

static inline size_t nextPowerOfTwo(size_t value) {
	if (value == 0) {
		return 0;
	}
	size_t power = 1;
	while (power < value) {
		power <<= 1;
	}
	return power;
}

static inline size_t ceilLog2(size_t value) {
	size_t log = 0;
	size_t power = 1;
	while (power < value) {
		power <<= 1;
		++log;
	}
	return log;
}

static inline int ceilDiv4(int value) {
	return (value + 3) >> 2;
}

static inline int ceilDiv8(int value) {
	return (value + 7) >> 3;
}

static inline int ceilDiv16(int value) {
	return (value + 15) >> 4;
}

static constexpr void setCycle(std::array<uint8_t, 64>& table, OpCode op, uint8_t cost) {
	table[static_cast<size_t>(op)] = cost;
}

static constexpr std::array<uint8_t, 64> makeBaseCycles() {
	std::array<uint8_t, 64> table{};
	for (size_t i = 0; i < table.size(); ++i) {
		table[i] = 2;
	}
	setCycle(table, OpCode::WIDE, 0);

	setCycle(table, OpCode::MOV, 1);
	setCycle(table, OpCode::LOADK, 1);
	setCycle(table, OpCode::LOADBOOL, 1);
	setCycle(table, OpCode::LOADNIL, 1);

	setCycle(table, OpCode::GETG, 6);
	setCycle(table, OpCode::SETG, 7);
	setCycle(table, OpCode::GETT, 8);
	setCycle(table, OpCode::SETT, 10);
	setCycle(table, OpCode::NEWT, 10);

	setCycle(table, OpCode::ADD, 2);
	setCycle(table, OpCode::SUB, 2);
	setCycle(table, OpCode::MUL, 3);
	setCycle(table, OpCode::DIV, 4);
	setCycle(table, OpCode::MOD, 6);
	setCycle(table, OpCode::FLOORDIV, 6);
	setCycle(table, OpCode::POW, 12);

	setCycle(table, OpCode::BAND, 2);
	setCycle(table, OpCode::BOR, 2);
	setCycle(table, OpCode::BXOR, 2);
	setCycle(table, OpCode::SHL, 2);
	setCycle(table, OpCode::SHR, 2);
	setCycle(table, OpCode::BNOT, 2);

	setCycle(table, OpCode::CONCAT, 12);
	setCycle(table, OpCode::CONCATN, 14);

	setCycle(table, OpCode::UNM, 1);
	setCycle(table, OpCode::NOT, 1);
	setCycle(table, OpCode::LEN, 4);

	setCycle(table, OpCode::EQ, 3);
	setCycle(table, OpCode::LT, 6);
	setCycle(table, OpCode::LE, 6);
	setCycle(table, OpCode::TEST, 2);
	setCycle(table, OpCode::TESTSET, 3);

	setCycle(table, OpCode::JMP, 1);
	setCycle(table, OpCode::JMPIF, 2);
	setCycle(table, OpCode::JMPIFNOT, 2);

	setCycle(table, OpCode::CLOSURE, 20);
	setCycle(table, OpCode::GETUP, 3);
	setCycle(table, OpCode::SETUP, 3);
	setCycle(table, OpCode::VARARG, 2);

	setCycle(table, OpCode::CALL, 18);
	setCycle(table, OpCode::RET, 18);

	setCycle(table, OpCode::LOAD_MEM, 5);
	setCycle(table, OpCode::STORE_MEM, 6);

	return table;
}

static constexpr std::array<uint8_t, 64> kBaseCycles = makeBaseCycles();

} // namespace

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
	return formatNumber(num);
}

const char* valueTypeName(Value v) {
	return valueTypeNameInline(v);
}

Table::Table(int arraySize, int hashSize) {
	if (arraySize > 0) {
		m_array.resize(static_cast<size_t>(arraySize), valueNil());
	}
	if (hashSize > 0) {
		size_t size = nextPowerOfTwo(static_cast<size_t>(hashSize));
		m_hash.assign(size, HashNode{});
		m_hashFree = static_cast<int>(size) - 1;
	}
}

bool Table::tryGetArrayIndex(const Value& key, int& outIndex) const {
	if (!valueIsNumber(key)) {
		return false;
	}
	double n = valueToNumber(key);
	if (!std::isfinite(n)) {
		return false;
	}
	if (n < 1.0) {
		return false;
	}
	if (n > static_cast<double>(std::numeric_limits<int>::max())) {
		return false;
	}
	int index = static_cast<int>(n);
	if (static_cast<double>(index) != n) {
		return false;
	}
	outIndex = index - 1;
	return true;
}

bool Table::hasArrayIndex(size_t index) const {
	if (index < m_array.size()) {
		return !isNil(m_array[index]);
	}
	if (m_hash.empty()) {
		return false;
	}
	Value key = valueNumber(static_cast<double>(index + 1));
	return findNodeIndex(key) >= 0;
}

void Table::updateArrayLengthFrom(size_t startIndex) {
	size_t newLength = startIndex;
	while (hasArrayIndex(newLength)) {
		++newLength;
	}
	m_arrayLength = newLength;
}

size_t Table::hashValue(const Value& key) const {
	return ValueHash{}(key);
}

bool Table::keyEquals(const Value& a, const Value& b) const {
	return ValueEq{}(a, b);
}

int Table::findNodeIndex(const Value& key) const {
	if (m_hash.empty()) {
		return -1;
	}
	size_t mask = m_hash.size() - 1;
	int index = static_cast<int>(hashValue(key) & mask);
	while (index >= 0) {
		const HashNode& node = m_hash[static_cast<size_t>(index)];
		if (!isNil(node.key) && keyEquals(node.key, key)) {
			return index;
		}
		index = node.next;
	}
	return -1;
}

Table::HashNode* Table::getNode(const Value& key) {
	int index = findNodeIndex(key);
	if (index < 0) {
		return nullptr;
	}
	return &m_hash[static_cast<size_t>(index)];
}

Table::HashNode* Table::getMainNode(const Value& key) {
	if (m_hash.empty()) {
		return nullptr;
	}
	size_t mask = m_hash.size() - 1;
	size_t index = hashValue(key) & mask;
	return &m_hash[index];
}

int Table::getFreeIndex() {
	int start = m_hashFree >= 0 ? m_hashFree : static_cast<int>(m_hash.size()) - 1;
	for (int i = start; i >= 0; --i) {
		if (isNil(m_hash[static_cast<size_t>(i)].key)) {
			m_hashFree = i - 1;
			return i;
		}
	}
	m_hashFree = -1;
	return -1;
}

void Table::rehash(const Value& key) {
	size_t totalKeys = 0;
	std::vector<size_t> counts;

	auto countIntegerKey = [&counts](size_t index) {
		size_t log = ceilLog2(index);
		if (log >= counts.size()) {
			counts.resize(log + 1, 0);
		}
		counts[log] += 1;
	};

	for (size_t i = 0; i < m_array.size(); ++i) {
		if (!isNil(m_array[i])) {
			totalKeys += 1;
			countIntegerKey(i + 1);
		}
	}
	for (const auto& node : m_hash) {
		if (!isNil(node.key)) {
			totalKeys += 1;
			int index = 0;
			if (tryGetArrayIndex(node.key, index)) {
				countIntegerKey(static_cast<size_t>(index) + 1);
			}
		}
	}
	if (!isNil(key)) {
		totalKeys += 1;
		int index = 0;
		if (tryGetArrayIndex(key, index)) {
			countIntegerKey(static_cast<size_t>(index) + 1);
		}
	}

	size_t arraySize = 0;
	size_t arrayKeys = 0;
	size_t total = 0;
	size_t power = 1;
	for (size_t i = 0; i < counts.size(); ++i) {
		total += counts[i];
		if (total > power / 2) {
			arraySize = power;
			arrayKeys = total;
		}
		power <<= 1;
	}

	size_t hashKeys = totalKeys - arrayKeys;
	size_t hashSize = hashKeys > 0 ? nextPowerOfTwo(hashKeys) : 0;
	resize(arraySize, hashSize);
}

void Table::resize(size_t newArraySize, size_t newHashSize) {
	std::vector<Value> oldArray = std::move(m_array);
	std::vector<HashNode> oldHash = std::move(m_hash);

	m_array.assign(newArraySize, valueNil());
	m_arrayLength = 0;
	m_hash.assign(newHashSize, HashNode{});
	m_hashFree = newHashSize > 0 ? static_cast<int>(newHashSize) - 1 : -1;

	for (size_t i = 0; i < oldArray.size(); ++i) {
		if (!isNil(oldArray[i])) {
			rawSet(valueNumber(static_cast<double>(i + 1)), oldArray[i]);
		}
	}
	for (const auto& node : oldHash) {
		if (!isNil(node.key)) {
			rawSet(node.key, node.value);
		}
	}
}

void Table::rawSet(const Value& key, const Value& value) {
	int index = 0;
	bool isArrayKey = tryGetArrayIndex(key, index);
	if (isArrayKey) {
		size_t idx = static_cast<size_t>(index);
		if (idx < m_array.size()) {
			m_array[idx] = value;
			if (isNil(value)) {
				if (idx < m_arrayLength) {
					m_arrayLength = idx;
				}
			} else if (idx == m_arrayLength) {
				size_t newLength = m_arrayLength;
				while (newLength < m_array.size() && !isNil(m_array[newLength])) {
					++newLength;
				}
				m_arrayLength = newLength;
			}
			return;
		}
	}
	insertHash(key, value);
	if (isArrayKey && static_cast<size_t>(index) == m_arrayLength) {
		updateArrayLengthFrom(m_arrayLength);
	}
}

void Table::insertHash(const Value& key, const Value& value) {
	if (m_hash.empty()) {
		rehash(key);
		rawSet(key, value);
		return;
	}
	size_t mask = m_hash.size() - 1;
	int mainIndex = static_cast<int>(hashValue(key) & mask);
	HashNode& mainNode = m_hash[static_cast<size_t>(mainIndex)];
	if (isNil(mainNode.key)) {
		mainNode.key = key;
		mainNode.value = value;
		mainNode.next = -1;
		return;
	}
	int freeIndex = getFreeIndex();
	if (freeIndex < 0) {
		rehash(key);
		rawSet(key, value);
		return;
	}
	HashNode& freeNode = m_hash[static_cast<size_t>(freeIndex)];
	int mainIndexOfOccupied = static_cast<int>(hashValue(mainNode.key) & mask);
	if (mainIndexOfOccupied != mainIndex) {
		freeNode = mainNode;
		int prev = mainIndexOfOccupied;
		while (m_hash[static_cast<size_t>(prev)].next != mainIndex) {
			prev = m_hash[static_cast<size_t>(prev)].next;
		}
		m_hash[static_cast<size_t>(prev)].next = freeIndex;
		mainNode.key = key;
		mainNode.value = value;
		mainNode.next = -1;
		return;
	}
	freeNode.key = key;
	freeNode.value = value;
	freeNode.next = mainNode.next;
	mainNode.next = freeIndex;
}

void Table::removeFromHash(const Value& key) {
	if (m_hash.empty()) {
		return;
	}
	size_t mask = m_hash.size() - 1;
	int mainIndex = static_cast<int>(hashValue(key) & mask);
	int prev = -1;
	int index = mainIndex;
	while (index >= 0) {
		HashNode& node = m_hash[static_cast<size_t>(index)];
		if (!isNil(node.key) && keyEquals(node.key, key)) {
			int next = node.next;
			if (prev >= 0) {
				m_hash[static_cast<size_t>(prev)].next = next;
				node.key = valueNil();
				node.value = valueNil();
				node.next = -1;
				if (index > m_hashFree) {
					m_hashFree = index;
				}
				return;
			}
			if (next >= 0) {
				HashNode& nextNode = m_hash[static_cast<size_t>(next)];
				node = nextNode;
				nextNode.key = valueNil();
				nextNode.value = valueNil();
				nextNode.next = -1;
				if (next > m_hashFree) {
					m_hashFree = next;
				}
				return;
			}
			node.key = valueNil();
			node.value = valueNil();
			node.next = -1;
			if (index > m_hashFree) {
				m_hashFree = index;
			}
			return;
		}
		prev = index;
		index = node.next;
	}
}

Value Table::get(const Value& key) const {
	if (isNil(key)) {
		throw BMSX_RUNTIME_ERROR("Table index is nil.");
	}
	int index = 0;
	if (tryGetArrayIndex(key, index)) {
		if (index < static_cast<int>(m_array.size())) {
			return m_array[static_cast<size_t>(index)];
		}
	}

	int nodeIndex = findNodeIndex(key);
	if (nodeIndex >= 0) {
		return m_hash[static_cast<size_t>(nodeIndex)].value;
	}
	return valueNil();
}

void Table::set(const Value& key, const Value& value) {
	if (isNil(key)) {
		throw BMSX_RUNTIME_ERROR("Table index is nil.");
	}
	int index = 0;
	bool isArrayKey = tryGetArrayIndex(key, index);
	if (isArrayKey) {
		const size_t idx = static_cast<size_t>(index);
		if (isNil(value)) {
			if (idx < m_array.size()) {
				m_array[idx] = value;
				if (idx < m_arrayLength) {
					m_arrayLength = idx;
				}
				return;
			}
		} else if (idx < m_array.size()) {
			m_array[idx] = value;
			if (idx == m_arrayLength) {
				size_t newLength = m_arrayLength;
				while (newLength < m_array.size() && !isNil(m_array[newLength])) {
					++newLength;
				}
				m_arrayLength = newLength;
			}
			return;
		}
	}

	if (isNil(value)) {
		removeFromHash(key);
		if (isArrayKey && static_cast<size_t>(index) < m_arrayLength) {
			m_arrayLength = static_cast<size_t>(index);
		}
		return;
	}
	int nodeIndex = findNodeIndex(key);
	if (nodeIndex >= 0) {
		m_hash[static_cast<size_t>(nodeIndex)].value = value;
		return;
	}
	if (m_hash.empty() || m_hashFree < 0) {
		rehash(key);
	}
	rawSet(key, value);
}

int Table::length() const {
	return static_cast<int>(m_arrayLength);
}

void Table::clear() {
	m_array.clear();
	m_arrayLength = 0;
	m_hash.clear();
	m_hashFree = -1;
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
		for (const auto& node : m_hash) {
			if (!isNil(node.key)) {
				return std::make_pair(node.key, node.value);
			}
		}
		return std::nullopt;
	}
	int index = 0;
	if (tryGetArrayIndex(after, index)) {
		if (index < static_cast<int>(m_array.size())) {
			if (isNil(m_array[static_cast<size_t>(index)])) {
				return std::nullopt;
			}
			int startIndex = index + 1;
			for (int i = startIndex; i < static_cast<int>(m_array.size()); ++i) {
				if (!isNil(m_array[static_cast<size_t>(i)])) {
					return std::make_pair(valueNumber(static_cast<double>(i + 1)), m_array[static_cast<size_t>(i)]);
				}
			}
			for (const auto& node : m_hash) {
				if (!isNil(node.key)) {
					return std::make_pair(node.key, node.value);
				}
			}
			return std::nullopt;
		}
	}
	int nodeIndex = findNodeIndex(after);
	if (nodeIndex < 0) {
		return std::nullopt;
	}
	for (size_t i = static_cast<size_t>(nodeIndex + 1); i < m_hash.size(); ++i) {
		const auto& node = m_hash[i];
		if (!isNil(node.key)) {
			return std::make_pair(node.key, node.value);
		}
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
		GCObject* next = obj->next;
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
		*current = next;
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

VMCPU::VMCPU(VmMemory& memory, StringHandleTable* handleTable)
	: m_memory(memory)
	, m_stringPool(handleTable) {
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
	std::function<std::optional<std::pair<Value, Value>>(const Value&)> nextEntry,
	std::function<void(VMHeap&)> mark
) {
	auto* native = m_heap.allocate<NativeObject>(ObjType::NativeObject);
	native->raw = raw;
	native->get = std::move(get);
	native->set = std::move(set);
	native->len = std::move(len);
	native->nextEntry = std::move(nextEntry);
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

void VMCPU::setProgram(Program* program, ProgramMetadata* metadata) {
	m_program = program;
	m_metadata = metadata;
	if (!m_program) {
		m_decoded.clear();
		return;
	}
	if (!m_program->constPoolCanonicalized) {
		const StringPool& programPool = *m_program->constPoolStringPool;
		auto& constPool = m_program->constPool;
		for (size_t index = 0; index < constPool.size(); ++index) {
			Value value = constPool[index];
			if (valueIsString(value)) {
				StringId oldId = asStringId(value);
				StringId newId = m_stringPool.intern(programPool.toString(oldId));
				constPool[index] = valueString(newId);
			}
		}
		m_program->constPoolCanonicalized = true;
		m_program->constPoolStringPool = &m_stringPool;
	} else if (m_program->constPoolStringPool != &m_stringPool) {
		throw BMSX_RUNTIME_ERROR("[VMCPU] Program const pool is canonicalized for a different string pool.");
	}
	m_indexKey = valueString(m_stringPool.intern("__index"));
	decodeProgram();
}

void VMCPU::reserveStringHandles(StringId minHandle) {
	m_stringPool.reserveHandles(minHandle);
}

void VMCPU::decodeProgram() {
	m_decoded.clear();
	if (!m_program) {
		return;
	}
	size_t instructionCount = m_program->code.size() / INSTRUCTION_BYTES;
	m_decoded.resize(instructionCount);
	for (size_t pc = 0; pc < instructionCount; ++pc) {
		uint32_t instr = readInstructionWord(m_program->code, static_cast<int>(pc));
		DecodedInstruction decoded;
		decoded.word = instr;
		decoded.ext = static_cast<uint8_t>(instr >> 24);
		decoded.op = static_cast<uint8_t>((instr >> 18) & 0x3f);
		decoded.a = static_cast<uint8_t>((instr >> 12) & 0x3f);
		decoded.b = static_cast<uint8_t>((instr >> 6) & 0x3f);
		decoded.c = static_cast<uint8_t>(instr & 0x3f);
		m_decoded[pc] = decoded;
	}
}

void VMCPU::start(int entryProtoIndex, const std::vector<Value>& args) {
	m_frames.clear();
	auto* closure = createRootClosure(entryProtoIndex);
	pushFrame(closure, args, 0, 0, false, m_program->protos[entryProtoIndex].entryPC);
}

void VMCPU::call(Closure* closure, const std::vector<Value>& args, int returnCount) {
	if (!closure) {
		throw BMSX_RUNTIME_ERROR("Attempted to call a nil value.");
	}
	pushFrame(closure, args, 0, returnCount, false, m_program->protos[closure->protoIndex].entryPC);
}

void VMCPU::callExternal(Closure* closure, const std::vector<Value>& args) {
	if (!closure) {
		throw BMSX_RUNTIME_ERROR("Attempted to call a nil value.");
	}
	pushFrame(closure, args, 0, 0, true, m_program->protos[closure->protoIndex].entryPC);
}

RunResult VMCPU::run(std::optional<int> instructionBudget) {
	const auto previousBudget = instructionBudgetRemaining;
	const int previousCycleBudget = m_cycleBudget;
	const bool previousLimited = m_cycleLimited;
	const bool ownsBudget = instructionBudget.has_value();
	if (ownsBudget) {
		instructionBudgetRemaining = instructionBudget;
	}
	if (instructionBudgetRemaining.has_value()) {
		m_cycleLimited = true;
		m_cycleBudget = *instructionBudgetRemaining;
	} else {
		m_cycleLimited = false;
	}
	RunResult result = RunResult::Halted;
	while (!m_frames.empty()) {
		if (m_cycleLimited && m_cycleBudget <= 0) {
			result = RunResult::Yielded;
			break;
		}
		step();
	}
	if (m_cycleLimited) {
		instructionBudgetRemaining = m_cycleBudget;
	} else {
		instructionBudgetRemaining = std::nullopt;
	}
	if (ownsBudget) {
		instructionBudgetRemaining = previousBudget;
		m_cycleBudget = previousCycleBudget;
		m_cycleLimited = previousLimited;
	}
	return result;
}

RunResult VMCPU::runUntilDepth(int targetDepth, std::optional<int> instructionBudget) {
	const auto previousBudget = instructionBudgetRemaining;
	const int previousCycleBudget = m_cycleBudget;
	const bool previousLimited = m_cycleLimited;
	const bool ownsBudget = instructionBudget.has_value();
	if (ownsBudget) {
		instructionBudgetRemaining = instructionBudget;
	}
	if (instructionBudgetRemaining.has_value()) {
		m_cycleLimited = true;
		m_cycleBudget = *instructionBudgetRemaining;
	} else {
		m_cycleLimited = false;
	}
	RunResult result = RunResult::Halted;
	while (static_cast<int>(m_frames.size()) > targetDepth) {
		if (m_cycleLimited && m_cycleBudget <= 0) {
			result = RunResult::Yielded;
			break;
		}
		step();
	}
	if (m_cycleLimited) {
		instructionBudgetRemaining = m_cycleBudget;
	} else {
		instructionBudgetRemaining = std::nullopt;
	}
	if (ownsBudget) {
		instructionBudgetRemaining = previousBudget;
		m_cycleBudget = previousCycleBudget;
		m_cycleLimited = previousLimited;
	}
	return result;
}

void VMCPU::step() {
	if (m_frames.empty()) return;
	if (m_heap.needsCollection()) {
		if (m_cycleLimited) {
			m_cycleBudget -= 200;
		}
		m_heap.collect();
	}
	CallFrame& frame = *m_frames.back();
	int pc = frame.pc;
	int wordIndex = pc / INSTRUCTION_BYTES;
	const DecodedInstruction* decoded = &m_decoded[static_cast<size_t>(wordIndex)];
	uint8_t op = decoded->op;
	uint8_t ext = decoded->ext;
	uint8_t wideA = 0;
	uint8_t wideB = 0;
	uint8_t wideC = 0;
	bool hasWide = false;
	if (static_cast<OpCode>(op) == OpCode::WIDE) {
		hasWide = true;
		wideA = decoded->a;
		wideB = decoded->b;
		wideC = decoded->c;
		pc += INSTRUCTION_BYTES;
		wordIndex += 1;
		decoded = &m_decoded[static_cast<size_t>(wordIndex)];
		op = decoded->op;
		ext = decoded->ext;
	}
	frame.pc = pc + INSTRUCTION_BYTES;
	lastPc = pc;
	lastInstruction = decoded->word;
	if (m_cycleLimited) {
		m_cycleBudget -= static_cast<int>(kBaseCycles[op]) + (hasWide ? 1 : 0);
	}
	executeInstruction(frame, static_cast<OpCode>(op), decoded->a, decoded->b, decoded->c, ext, wideA, wideB, wideC, hasWide);
}

std::optional<SourceRange> VMCPU::getDebugRange(int pc) const {
	int wordIndex = pc / INSTRUCTION_BYTES;
	if (!m_metadata || wordIndex < 0 || wordIndex >= static_cast<int>(m_metadata->debugRanges.size())) {
		return std::nullopt;
	}
	return m_metadata->debugRanges[static_cast<size_t>(wordIndex)];
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

void VMCPU::skipNextInstruction(CallFrame& frame) {
	int pc = frame.pc;
	int wordIndex = pc / INSTRUCTION_BYTES;
	if (wordIndex < 0 || wordIndex >= static_cast<int>(m_decoded.size())) {
		throw BMSX_RUNTIME_ERROR("Attempted to skip beyond end of program.");
	}
	if (static_cast<OpCode>(m_decoded[static_cast<size_t>(wordIndex)].op) == OpCode::WIDE) {
		if (wordIndex + 1 >= static_cast<int>(m_decoded.size())) {
			throw BMSX_RUNTIME_ERROR("Malformed program: WIDE instruction at end of program.");
		}
		frame.pc += INSTRUCTION_BYTES * 2;
		return;
	}
	frame.pc += INSTRUCTION_BYTES;
}

void VMCPU::executeInstruction(
	CallFrame& frame,
	OpCode op,
	uint8_t aLow,
	uint8_t bLow,
	uint8_t cLow,
	uint8_t ext,
	uint8_t wideA,
	uint8_t wideB,
	uint8_t wideC,
	bool hasWide
) {
	bool usesBx = op == OpCode::LOADK
		|| op == OpCode::GETG
		|| op == OpCode::SETG
		|| op == OpCode::CLOSURE
		|| op == OpCode::JMP
		|| op == OpCode::JMPIF
		|| op == OpCode::JMPIFNOT;
	uint8_t extA = usesBx ? 0 : static_cast<uint8_t>((ext >> 6) & 0x3);
	uint8_t extB = usesBx ? 0 : static_cast<uint8_t>((ext >> 3) & 0x7);
	uint8_t extC = usesBx ? 0 : static_cast<uint8_t>(ext & 0x7);
	int aShift = MAX_OPERAND_BITS + (usesBx ? 0 : EXT_A_BITS);
	int a = (static_cast<int>(wideA) << aShift) | (static_cast<int>(extA) << MAX_OPERAND_BITS) | aLow;
	int b = (static_cast<int>(wideB) << (MAX_OPERAND_BITS + EXT_B_BITS)) | (static_cast<int>(extB) << MAX_OPERAND_BITS) | bLow;
	int c = (static_cast<int>(wideC) << (MAX_OPERAND_BITS + EXT_C_BITS)) | (static_cast<int>(extC) << MAX_OPERAND_BITS) | cLow;
	uint32_t bxLow = (static_cast<uint32_t>(bLow) << MAX_OPERAND_BITS) | static_cast<uint32_t>(cLow);
	uint32_t bx = (static_cast<uint32_t>(wideB) << (MAX_BX_BITS + EXT_BX_BITS))
		| (static_cast<uint32_t>(usesBx ? ext : 0) << MAX_BX_BITS)
		| bxLow;
	int sbxBits = MAX_BX_BITS + EXT_BX_BITS + (hasWide ? MAX_OPERAND_BITS : 0);
	int sbx = signExtend(bx, sbxBits);
	int rkBitsB = MAX_OPERAND_BITS + EXT_B_BITS + (hasWide ? MAX_OPERAND_BITS : 0);
	int rkBitsC = MAX_OPERAND_BITS + EXT_C_BITS + (hasWide ? MAX_OPERAND_BITS : 0);
	uint32_t rkRawB = (static_cast<uint32_t>(wideB) << (MAX_OPERAND_BITS + EXT_B_BITS))
		| (static_cast<uint32_t>(extB) << MAX_OPERAND_BITS)
		| bLow;
	uint32_t rkRawC = (static_cast<uint32_t>(wideC) << (MAX_OPERAND_BITS + EXT_C_BITS))
		| (static_cast<uint32_t>(extC) << MAX_OPERAND_BITS)
		| cLow;

#define CYCLES_ADD(n) do { if (m_cycleLimited) m_cycleBudget -= (n); } while (0)

	switch (op) {
		case OpCode::WIDE:
			throw BMSX_RUNTIME_ERROR("Unexpected WIDE opcode.");

		case OpCode::MOV:
			setRegister(frame, a, frame.registers[b]);
			return;

		case OpCode::LOADK:
			setRegister(frame, a, m_program->constPool[bx]);
			return;

		case OpCode::LOADNIL:
			CYCLES_ADD(ceilDiv4(b));
			for (int i = 0; i < b; ++i) {
				setRegister(frame, a + i, valueNil());
			}
			return;

		case OpCode::LOADBOOL:
			setRegister(frame, a, valueBool(b != 0));
			if (c != 0) {
				CYCLES_ADD(1);
				skipNextInstruction(frame);
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
			const Value& key = readRK(frame, rkRawC, rkBitsC);
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
			auto range = getDebugRange(frame.pc - INSTRUCTION_BYTES);
			if (range.has_value()) {
				message += " at " + range->path + ":" + std::to_string(range->startLine);
			}
			throw BMSX_RUNTIME_ERROR(message);
		}

		case OpCode::SETT: {
			const Value& tableValue = frame.registers[a];
			const Value& key = readRK(frame, rkRawB, rkBitsB);
			const Value& value = readRK(frame, rkRawC, rkBitsC);
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
			auto range = getDebugRange(frame.pc - INSTRUCTION_BYTES);
			if (range.has_value()) {
				message += " at " + range->path + ":" + std::to_string(range->startLine);
			}
			throw BMSX_RUNTIME_ERROR(message);
		}

		case OpCode::NEWT: {
			CYCLES_ADD(ceilDiv4(b) + ceilDiv4(c));
			auto* table = m_heap.allocate<Table>(ObjType::Table, b, c);
			setRegister(frame, a, valueTable(table));
			return;
		}

		case OpCode::ADD: {
			double left = asNumber(readRK(frame, rkRawB, rkBitsB));
			double right = asNumber(readRK(frame, rkRawC, rkBitsC));
			setRegister(frame, a, valueNumber(left + right));
			return;
		}

		case OpCode::SUB: {
			double left = asNumber(readRK(frame, rkRawB, rkBitsB));
			double right = asNumber(readRK(frame, rkRawC, rkBitsC));
			setRegister(frame, a, valueNumber(left - right));
			return;
		}

		case OpCode::MUL: {
			double left = asNumber(readRK(frame, rkRawB, rkBitsB));
			double right = asNumber(readRK(frame, rkRawC, rkBitsC));
			setRegister(frame, a, valueNumber(left * right));
			return;
		}

		case OpCode::DIV: {
			double left = asNumber(readRK(frame, rkRawB, rkBitsB));
			double right = asNumber(readRK(frame, rkRawC, rkBitsC));
			setRegister(frame, a, valueNumber(left / right));
			return;
		}

		case OpCode::MOD: {
			double left = asNumber(readRK(frame, rkRawB, rkBitsB));
			double right = asNumber(readRK(frame, rkRawC, rkBitsC));
			setRegister(frame, a, valueNumber(std::fmod(left, right)));
			return;
		}

		case OpCode::FLOORDIV: {
			double left = asNumber(readRK(frame, rkRawB, rkBitsB));
			double right = asNumber(readRK(frame, rkRawC, rkBitsC));
			setRegister(frame, a, valueNumber(std::floor(left / right)));
			return;
		}

		case OpCode::POW: {
			double left = asNumber(readRK(frame, rkRawB, rkBitsB));
			double right = asNumber(readRK(frame, rkRawC, rkBitsC));
			setRegister(frame, a, valueNumber(std::pow(left, right)));
			return;
		}

		case OpCode::BAND: {
			int left = static_cast<int>(asNumber(readRK(frame, rkRawB, rkBitsB)));
			int right = static_cast<int>(asNumber(readRK(frame, rkRawC, rkBitsC)));
			setRegister(frame, a, valueNumber(static_cast<double>(left & right)));
			return;
		}

		case OpCode::BOR: {
			int left = static_cast<int>(asNumber(readRK(frame, rkRawB, rkBitsB)));
			int right = static_cast<int>(asNumber(readRK(frame, rkRawC, rkBitsC)));
			setRegister(frame, a, valueNumber(static_cast<double>(left | right)));
			return;
		}

		case OpCode::BXOR: {
			int left = static_cast<int>(asNumber(readRK(frame, rkRawB, rkBitsB)));
			int right = static_cast<int>(asNumber(readRK(frame, rkRawC, rkBitsC)));
			setRegister(frame, a, valueNumber(static_cast<double>(left ^ right)));
			return;
		}

		case OpCode::SHL: {
			int left = static_cast<int>(asNumber(readRK(frame, rkRawB, rkBitsB)));
			int right = static_cast<int>(asNumber(readRK(frame, rkRawC, rkBitsC))) & 31;
			setRegister(frame, a, valueNumber(static_cast<double>(left << right)));
			return;
		}

		case OpCode::SHR: {
			int left = static_cast<int>(asNumber(readRK(frame, rkRawB, rkBitsB)));
			int right = static_cast<int>(asNumber(readRK(frame, rkRawC, rkBitsC))) & 31;
			setRegister(frame, a, valueNumber(static_cast<double>(left >> right)));
			return;
		}

		case OpCode::CONCAT: {
			std::string text = valueToString(readRK(frame, rkRawB, rkBitsB), m_stringPool);
			text += valueToString(readRK(frame, rkRawC, rkBitsC), m_stringPool);
			CYCLES_ADD(ceilDiv8(static_cast<int>(text.size())));
			setRegister(frame, a, valueString(m_stringPool.intern(text)));
			return;
		}

		case OpCode::CONCATN: {
			std::string text;
			CYCLES_ADD(c << 1);
			for (int index = 0; index < c; ++index) {
				text += valueToString(frame.registers[static_cast<size_t>(b + index)], m_stringPool);
			}
			CYCLES_ADD(ceilDiv8(static_cast<int>(text.size())));
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
				int cp = static_cast<int>(m_stringPool.codepointCount(asStringId(val)));
				CYCLES_ADD(ceilDiv16(cp));
				setRegister(frame, a, valueNumber(static_cast<double>(cp)));
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
					throw BMSX_RUNTIME_ERROR("Length operator expects a native object with a length. stack=" + stack);
				}
				CYCLES_ADD(12);
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
			throw BMSX_RUNTIME_ERROR("Length operator expects a string or table. stack=" + stack);
		}

		case OpCode::BNOT: {
			int val = static_cast<int>(asNumber(frame.registers[b]));
			setRegister(frame, a, valueNumber(static_cast<double>(~val)));
			return;
		}

		case OpCode::EQ: {
			const Value& left = readRK(frame, rkRawB, rkBitsB);
			const Value& right = readRK(frame, rkRawC, rkBitsC);
			bool eq = false;
			if (valueIsNumber(left) && valueIsNumber(right)) {
				eq = valueToNumber(left) == valueToNumber(right);
			} else if (valueIsTagged(left) && valueIsTagged(right)) {
				eq = left == right;
			}
			if (eq != (a != 0)) {
				CYCLES_ADD(1);
				skipNextInstruction(frame);
			}
			return;
		}

		case OpCode::LT: {
			const Value& leftValue = readRK(frame, rkRawB, rkBitsB);
			const Value& rightValue = readRK(frame, rkRawC, rkBitsC);
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
				CYCLES_ADD(1);
				skipNextInstruction(frame);
			}
			return;
		}

		case OpCode::LE: {
			const Value& leftValue = readRK(frame, rkRawB, rkBitsB);
			const Value& rightValue = readRK(frame, rkRawC, rkBitsC);
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
				CYCLES_ADD(1);
				skipNextInstruction(frame);
			}
			return;
		}

		case OpCode::TEST: {
			const Value& val = frame.registers[a];
			if (isTruthy(val) != (c != 0)) {
				CYCLES_ADD(1);
				skipNextInstruction(frame);
			}
			return;
		}

		case OpCode::TESTSET: {
			const Value& val = frame.registers[b];
			if (isTruthy(val) == (c != 0)) {
				setRegister(frame, a, val);
			} else {
				CYCLES_ADD(1);
				skipNextInstruction(frame);
			}
			return;
		}

		case OpCode::JMP:
			frame.pc += sbx * INSTRUCTION_BYTES;
			return;

		case OpCode::JMPIF:
			if (isTruthy(frame.registers[static_cast<size_t>(a)])) {
				frame.pc += sbx * INSTRUCTION_BYTES;
			}
			return;

		case OpCode::JMPIFNOT:
			if (!isTruthy(frame.registers[static_cast<size_t>(a)])) {
				frame.pc += sbx * INSTRUCTION_BYTES;
			}
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
			CYCLES_ADD(ceilDiv4(count));
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
				const Proto& proto = m_program->protos[closure->protoIndex];
				CYCLES_ADD(argCount);
				CYCLES_ADD(ceilDiv4(proto.maxStack));
				if (proto.isVararg && argCount > proto.numParams) {
					CYCLES_ADD(ceilDiv4(argCount - proto.numParams));
				}
				pushFrame(closure, &frame.registers[a + 1], static_cast<size_t>(argCount), a, retCount, false, frame.pc - INSTRUCTION_BYTES);
				return;
			}
			if (valueIsNativeFunction(callee)) {
				NativeFunction* fn = asNativeFunction(callee);
				const int rc = retCount == 0 ? 2 : retCount;
				CYCLES_ADD(static_cast<int>(fn->cycleBase)
					+ static_cast<int>(fn->cyclePerArg) * argCount
					+ static_cast<int>(fn->cyclePerRet) * rc);
				std::vector<Value> args = acquireArgScratch();
				args.resize(static_cast<size_t>(argCount));
				for (int i = 0; i < argCount; ++i) {
					args[static_cast<size_t>(i)] = frame.registers[a + 1 + i];
				}
				std::vector<Value> out = acquireNativeReturnScratch();
				fn->invoke(args, out);
				writeReturnValues(frame, a, retCount, out);
				releaseNativeReturnScratch(std::move(out));
				releaseArgScratch(std::move(args));
				return;
			}
			throw BMSX_RUNTIME_ERROR("Attempted to call a non-function value.");
		}

		case OpCode::RET: {
			auto& results = m_returnScratch;
			results.clear();
			int count = b == 0 ? std::max(frame.top - a, 0) : b;
			CYCLES_ADD(count);
			CYCLES_ADD(static_cast<int>(frame.openUpvalues.size()) * 3);
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
			uint32_t addr = static_cast<uint32_t>(asNumber(frame.registers[b]));
			setRegister(frame, a, m_memory.readValue(addr));
			return;
		}

		case OpCode::STORE_MEM: {
			uint32_t addr = static_cast<uint32_t>(asNumber(frame.registers[b]));
			m_memory.writeValue(addr, frame.registers[a]);
			return;
		}
	}

#undef CYCLES_ADD
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

const Value& VMCPU::readRK(CallFrame& frame, uint32_t raw, int bits) {
	int rk = signExtend(raw, bits);
	if (rk < 0) {
		int index = -1 - rk;
		return m_program->constPool[static_cast<size_t>(index)];
	}
	return frame.registers[static_cast<size_t>(rk)];
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
	throw BMSX_RUNTIME_ERROR("Metatable __index loop detected.");
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
	for (const auto& value : m_memory.ioSlots()) {
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
		for (int i = 0; i < frame->top; ++i) {
			heap.markValue(frame->registers[static_cast<size_t>(i)]);
		}
		for (const auto& value : frame->varargs) {
			heap.markValue(value);
		}
		for (const auto& entry : frame->openUpvalues) {
			heap.markObject(entry.second);
			heap.markValue(frame->registers[static_cast<size_t>(entry.first)]);
		}
	}
	m_externalRootMarker(heap);
}

} // namespace bmsx
