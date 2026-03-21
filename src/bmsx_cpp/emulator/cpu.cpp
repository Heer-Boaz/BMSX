#include "cpu.h"
#include "memory.h"
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

static inline uint32_t toU32(double value) {
	const double truncated = std::trunc(value);
	const double mod = std::fmod(truncated, 4294967296.0);
	const double normalized = mod < 0.0 ? (mod + 4294967296.0) : mod;
	return static_cast<uint32_t>(normalized);
}

static inline int32_t toI32(double value) {
	return static_cast<int32_t>(toU32(value));
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

template <typename TStringPool>
static std::string valueToStringWithPool(const Value& v, const TStringPool& stringPool) {
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

static std::string formatNonFunctionCallError(Value callee, const RuntimeStringPool& stringPool,
												 const std::optional<SourceRange>& range) {
	std::string message = "Attempted to call a non-function value.";
	message += " callee=" + std::string(valueTypeName(callee)) + "(" + valueToStringWithPool(callee, stringPool) + ")";
	if (range.has_value()) {
		message += " at " + range->path + ":" + std::to_string(range->startLine) + ":" + std::to_string(range->startColumn);
	}
	return message;
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

static std::unordered_map<uint32_t, GCObject*>& objectRefRegistry() {
	static std::unordered_map<uint32_t, GCObject*> registry;
	return registry;
}

struct NativeFunctionBridge {
	NativeFunctionInvoke invoke;
};

struct NativeObjectBridge {
	void* raw = nullptr;
	std::function<Value(const Value&)> get;
	std::function<void(const Value&, const Value&)> set;
	std::function<int()> len;
	std::function<std::optional<std::pair<Value, Value>>(const Value&)> nextEntry;
	std::function<void(GcHeap&)> mark;
};

static std::unordered_map<uint32_t, NativeFunctionBridge>& nativeFunctionBridgeRegistry() {
	static std::unordered_map<uint32_t, NativeFunctionBridge> registry;
	return registry;
}

static std::unordered_map<uint32_t, NativeObjectBridge>& nativeObjectBridgeRegistry() {
	static std::unordered_map<uint32_t, NativeObjectBridge> registry;
	return registry;
}

static NativeFunctionBridge& resolveNativeFunctionBridge(uint32_t bridgeId) {
	auto it = nativeFunctionBridgeRegistry().find(bridgeId);
	if (it == nativeFunctionBridgeRegistry().end()) {
		throw std::runtime_error("[CPU] Unknown native function bridge id.");
	}
	return it->second;
}

static NativeObjectBridge& resolveNativeObjectBridge(uint32_t bridgeId) {
	auto it = nativeObjectBridgeRegistry().find(bridgeId);
	if (it == nativeObjectBridgeRegistry().end()) {
		throw std::runtime_error("[CPU] Unknown native object bridge id.");
	}
	return it->second;
}

} // namespace

void registerRuntimeObjectRef(uint32_t objectRefId, GCObject* object) {
	objectRefRegistry()[objectRefId] = object;
}

void unregisterRuntimeObjectRef(uint32_t objectRefId) {
	objectRefRegistry().erase(objectRefId);
}

GCObject* resolveRuntimeObjectRef(uint32_t objectRefId) {
	auto it = objectRefRegistry().find(objectRefId);
	if (it == objectRefRegistry().end()) {
		throw std::runtime_error("[CPU] Unknown object ref id.");
	}
	return it->second;
}

std::string valueToString(const Value& v, const StringPool& stringPool) {
	return valueToStringWithPool(v, stringPool);
}

std::string valueToString(const Value& v, const RuntimeStringPool& stringPool) {
	return valueToStringWithPool(v, stringPool);
}

const char* valueTypeName(Value v) {
	return valueTypeNameInline(v);
}

Value valueTable(Table* table) {
	return valueFromTag(ValueTag::Table, table->runtimeRefId);
}

Value valueClosure(Closure* closure) {
	return valueFromTag(ValueTag::Closure, closure->runtimeRefId);
}

Value valueNativeFunction(NativeFunction* fn) {
	return valueFromTag(ValueTag::NativeFunction, fn->runtimeRefId);
}

Value valueNativeObject(NativeObject* obj) {
	return valueFromTag(ValueTag::NativeObject, obj->runtimeRefId);
}

Value valueUpvalue(Upvalue* upvalue) {
	return valueFromTag(ValueTag::Upvalue, upvalue->runtimeRefId);
}

Table* asTable(Value v) {
	return static_cast<Table*>(resolveRuntimeObjectRef(static_cast<uint32_t>(valuePayload(v))));
}

Closure* asClosure(Value v) {
	return static_cast<Closure*>(resolveRuntimeObjectRef(static_cast<uint32_t>(valuePayload(v))));
}

NativeFunction* asNativeFunction(Value v) {
	return static_cast<NativeFunction*>(resolveRuntimeObjectRef(static_cast<uint32_t>(valuePayload(v))));
}

NativeObject* asNativeObject(Value v) {
	return static_cast<NativeObject*>(resolveRuntimeObjectRef(static_cast<uint32_t>(valuePayload(v))));
}

Upvalue* asUpvalue(Value v) {
	return static_cast<Upvalue*>(resolveRuntimeObjectRef(static_cast<uint32_t>(valuePayload(v))));
}

void NativeFunction::invoke(const std::vector<Value>& args, std::vector<Value>& out) const {
	resolveNativeFunctionBridge(runtimeRefId).invoke(args, out);
}

Value NativeObject::get(const Value& key) const {
	const auto& bridge = resolveNativeObjectBridge(runtimeRefId);
	if (!bridge.get) {
		return valueNil();
	}
	return bridge.get(key);
}

void NativeObject::set(const Value& key, const Value& value) const {
	resolveNativeObjectBridge(runtimeRefId).set(key, value);
}

bool NativeObject::hasLen() const {
	return static_cast<bool>(resolveNativeObjectBridge(runtimeRefId).len);
}

int NativeObject::len() const {
	return resolveNativeObjectBridge(runtimeRefId).len();
}

bool NativeObject::hasNextEntry() const {
	return static_cast<bool>(resolveNativeObjectBridge(runtimeRefId).nextEntry);
}

std::optional<std::pair<Value, Value>> NativeObject::nextEntry(const Value& after) const {
	const auto& bridge = resolveNativeObjectBridge(runtimeRefId);
	if (!bridge.nextEntry) {
		return std::nullopt;
	}
	return bridge.nextEntry(after);
}

void NativeObject::mark(GcHeap& heap) const {
	const auto& bridge = resolveNativeObjectBridge(runtimeRefId);
	if (bridge.mark) {
		bridge.mark(heap);
	}
}

void* NativeObject::raw() const {
	return resolveNativeObjectBridge(runtimeRefId).raw;
}

Table* NativeObject::getMetatable() const {
	return metatableRefId == 0 ? nullptr : static_cast<Table*>(resolveRuntimeObjectRef(metatableRefId));
}

void NativeObject::setMetatable(Table* metatable) {
	metatableRefId = metatable ? metatable->runtimeRefId : 0;
}

static void writeTaggedValueToHandle(ObjectHandleTable& handleTable, uint32_t addr, const Value& value) {
	if (isNil(value)) {
		handleTable.writeU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET, static_cast<uint32_t>(TaggedValueTag::Nil));
		handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET, 0);
		handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET, 0);
		return;
	}
	if (valueIsTagged(value)) {
		switch (valueTag(value)) {
			case ValueTag::False:
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET, static_cast<uint32_t>(TaggedValueTag::False));
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET, 0);
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET, 0);
				return;
			case ValueTag::True:
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET, static_cast<uint32_t>(TaggedValueTag::True));
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET, 0);
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET, 0);
				return;
			case ValueTag::String:
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET, static_cast<uint32_t>(TaggedValueTag::String));
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET, asStringId(value));
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET, 0);
				return;
			case ValueTag::Table:
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET, static_cast<uint32_t>(TaggedValueTag::Table));
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET, asTable(value)->runtimeRefId);
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET, 0);
				return;
			case ValueTag::Closure:
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET, static_cast<uint32_t>(TaggedValueTag::Closure));
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET, asClosure(value)->runtimeRefId);
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET, 0);
				return;
			case ValueTag::NativeFunction:
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET, static_cast<uint32_t>(TaggedValueTag::NativeFunction));
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET, asNativeFunction(value)->runtimeRefId);
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET, 0);
				return;
			case ValueTag::NativeObject:
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET, static_cast<uint32_t>(TaggedValueTag::NativeObject));
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET, asNativeObject(value)->runtimeRefId);
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET, 0);
				return;
			case ValueTag::Upvalue:
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET, static_cast<uint32_t>(TaggedValueTag::Upvalue));
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET, asUpvalue(value)->runtimeRefId);
				handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET, 0);
				return;
			case ValueTag::Nil:
				break;
		}
	}
	uint64_t bits = 0;
	const double number = valueToNumber(value);
	std::memcpy(&bits, &number, sizeof(double));
	handleTable.writeU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET, static_cast<uint32_t>(TaggedValueTag::Number));
	handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET, static_cast<uint32_t>(bits & 0xffffffffULL));
	handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET, static_cast<uint32_t>(bits >> 32));
}

static Value readTaggedValueFromHandle(const ObjectHandleTable& handleTable, const GcHeap& gcHeap, uint32_t addr) {
	const uint32_t tag = handleTable.readU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET);
	const uint32_t payloadLo = handleTable.readU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET);
	const uint32_t payloadHi = handleTable.readU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET);
	switch (static_cast<TaggedValueTag>(tag)) {
		case TaggedValueTag::Nil:
			return valueNil();
		case TaggedValueTag::False:
			return valueBool(false);
		case TaggedValueTag::True:
			return valueBool(true);
		case TaggedValueTag::Number: {
			uint64_t bits = static_cast<uint64_t>(payloadLo) | (static_cast<uint64_t>(payloadHi) << 32);
			double number = 0.0;
			std::memcpy(&number, &bits, sizeof(double));
			return valueNumber(number);
		}
		case TaggedValueTag::String:
			return valueString(payloadLo);
		case TaggedValueTag::Table:
			return valueTable(static_cast<Table*>(resolveRuntimeObjectRef(payloadLo)));
		case TaggedValueTag::Closure:
			return valueClosure(static_cast<Closure*>(gcHeap.resolveRuntimeRef(payloadLo)));
		case TaggedValueTag::NativeFunction:
			return valueNativeFunction(static_cast<NativeFunction*>(gcHeap.resolveRuntimeRef(payloadLo)));
		case TaggedValueTag::NativeObject:
			return valueNativeObject(static_cast<NativeObject*>(gcHeap.resolveRuntimeRef(payloadLo)));
		case TaggedValueTag::Upvalue:
			return valueUpvalue(static_cast<Upvalue*>(gcHeap.resolveRuntimeRef(payloadLo)));
	}
	throw std::runtime_error("[Table] Unsupported tagged value tag.");
}

Table::Table(GcHeap& gcHeap, ObjectHandleTable& handleTable, const RuntimeStringPool& stringPool, int arraySize, int hashSize)
	: m_gcHeap(gcHeap)
	, m_handleTable(handleTable)
	, m_stringPool(stringPool) {
	if (arraySize > 0) {
		m_arrayStore.resize(static_cast<size_t>(arraySize));
	}
	if (hashSize > 0) {
		size_t size = nextPowerOfTwo(static_cast<size_t>(hashSize));
		m_hashStore.resize(size);
	}
	const ObjectAllocation allocation = m_handleTable.allocateObject(
		static_cast<uint32_t>(HeapObjectType::Table),
		TABLE_OBJECT_HEADER_SIZE);
	m_objectId = allocation.id;
	m_objectAddr = allocation.addr;
	allocateStoreObjects(static_cast<size_t>(arraySize), m_hashStore.capacity());
	syncObjectState();
}

Table::~Table() {}

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
	if (index < m_arrayStore.capacity()) {
		return m_arrayStore.has(index);
	}
	if (m_hashStore.capacity() == 0) {
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

void Table::syncObjectState() {
	syncTableMetadata();
	syncStoreMetadata();
}

void Table::syncTableMetadata() {
	const uint32_t metatableId = m_metatable ? m_metatable->runtimeRefId : 0;
	m_handleTable.writeU32(m_objectAddr + TABLE_OBJECT_METATABLE_ID_OFFSET, metatableId);
	m_handleTable.writeU32(m_objectAddr + TABLE_OBJECT_ARRAY_STORE_ID_OFFSET, m_arrayStoreId);
	m_handleTable.writeU32(m_objectAddr + TABLE_OBJECT_HASH_STORE_ID_OFFSET, m_hashStoreId);
	m_handleTable.writeU32(m_objectAddr + TABLE_OBJECT_ARRAY_LENGTH_OFFSET, static_cast<uint32_t>(m_arrayLength));
}

void Table::syncStoreMetadata() {
	m_handleTable.writeU32(m_arrayStoreAddr + ARRAY_STORE_OBJECT_CAPACITY_OFFSET, static_cast<uint32_t>(m_arrayStore.capacity()));
	m_handleTable.writeU32(m_hashStoreAddr + HASH_STORE_OBJECT_CAPACITY_OFFSET, static_cast<uint32_t>(m_hashStore.capacity()));
	m_handleTable.writeU32(m_hashStoreAddr + HASH_STORE_OBJECT_FREE_OFFSET, static_cast<uint32_t>(m_hashStore.free));
	for (size_t index = 0; index < m_arrayStore.capacity(); ++index) {
		writeArraySlot(index);
	}
	for (size_t index = 0; index < m_hashStore.capacity(); ++index) {
		writeHashNode(index);
	}
}

void Table::writeArraySlot(size_t index) {
	const uint32_t addr = m_arrayStoreAddr + ARRAY_STORE_OBJECT_DATA_OFFSET + (static_cast<uint32_t>(index) * TAGGED_VALUE_SLOT_SIZE);
	writeTaggedValue(addr, m_arrayStore.read(index));
}

void Table::writeHashNode(size_t index) {
	const HashNode& node = m_hashStore.node(index);
	const uint32_t addr = m_hashStoreAddr + HASH_STORE_OBJECT_DATA_OFFSET + (static_cast<uint32_t>(index) * HASH_NODE_SIZE);
	writeTaggedValue(addr + HASH_NODE_KEY_OFFSET, node.key);
	writeTaggedValue(addr + HASH_NODE_VALUE_OFFSET, node.value);
	m_handleTable.writeU32(addr + HASH_NODE_NEXT_OFFSET, static_cast<uint32_t>(node.next));
}

void Table::writeTaggedValue(uint32_t addr, const Value& value) {
	writeTaggedValueToHandle(m_handleTable, addr, value);
}

Value Table::readTaggedValue(uint32_t addr) const {
	return readTaggedValueFromHandle(m_handleTable, m_gcHeap, addr);
}

void Table::rehydrateStoreViews() {
	const ObjectHandleEntry tableEntry = m_handleTable.readEntry(m_objectId);
	m_objectAddr = tableEntry.addr;
	m_arrayStoreId = m_handleTable.readU32(m_objectAddr + TABLE_OBJECT_ARRAY_STORE_ID_OFFSET);
	m_hashStoreId = m_handleTable.readU32(m_objectAddr + TABLE_OBJECT_HASH_STORE_ID_OFFSET);
	m_arrayLength = static_cast<size_t>(m_handleTable.readU32(m_objectAddr + TABLE_OBJECT_ARRAY_LENGTH_OFFSET));
	const uint32_t metatableId = m_handleTable.readU32(m_objectAddr + TABLE_OBJECT_METATABLE_ID_OFFSET);
	m_metatable = metatableId == 0 ? nullptr : static_cast<Table*>(resolveRuntimeObjectRef(metatableId));
	const ObjectHandleEntry arrayStoreEntry = m_handleTable.readEntry(m_arrayStoreId);
	const ObjectHandleEntry hashStoreEntry = m_handleTable.readEntry(m_hashStoreId);
	m_arrayStoreAddr = arrayStoreEntry.addr;
	m_hashStoreAddr = hashStoreEntry.addr;
	const size_t arrayCapacity = static_cast<size_t>(m_handleTable.readU32(m_arrayStoreAddr + ARRAY_STORE_OBJECT_CAPACITY_OFFSET));
	const size_t hashCapacity = static_cast<size_t>(m_handleTable.readU32(m_hashStoreAddr + HASH_STORE_OBJECT_CAPACITY_OFFSET));
	m_arrayStore.resize(arrayCapacity);
	m_hashStore.resize(hashCapacity);
	m_hashStore.free = static_cast<int>(m_handleTable.readU32(m_hashStoreAddr + HASH_STORE_OBJECT_FREE_OFFSET));
	for (size_t index = 0; index < arrayCapacity; ++index) {
		const uint32_t slotAddr = m_arrayStoreAddr + ARRAY_STORE_OBJECT_DATA_OFFSET + (static_cast<uint32_t>(index) * TAGGED_VALUE_SLOT_SIZE);
		m_arrayStore.slot(index) = readTaggedValue(slotAddr);
	}
	for (size_t index = 0; index < hashCapacity; ++index) {
		HashNode& node = m_hashStore.node(index);
		const uint32_t nodeAddr = m_hashStoreAddr + HASH_STORE_OBJECT_DATA_OFFSET + (static_cast<uint32_t>(index) * HASH_NODE_SIZE);
		node.key = readTaggedValue(nodeAddr + HASH_NODE_KEY_OFFSET);
		node.value = readTaggedValue(nodeAddr + HASH_NODE_VALUE_OFFSET);
		node.next = static_cast<int>(m_handleTable.readU32(nodeAddr + HASH_NODE_NEXT_OFFSET));
	}
}

size_t Table::hashValue(const Value& key) const {
	return ValueHash{ m_stringPool }(key);
}

bool Table::keyEquals(const Value& a, const Value& b) const {
	return ValueEq{ m_stringPool }(a, b);
}

int Table::findNodeIndex(const Value& key) const {
	if (m_hashStore.capacity() == 0) {
		return -1;
	}
	size_t mask = m_hashStore.capacity() - 1;
	int index = static_cast<int>(hashValue(key) & mask);
	while (index >= 0) {
		const HashNode& node = m_hashStore.node(static_cast<size_t>(index));
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
	return &m_hashStore.node(static_cast<size_t>(index));
}

Table::HashNode* Table::getMainNode(const Value& key) {
	if (m_hashStore.capacity() == 0) {
		return nullptr;
	}
	size_t mask = m_hashStore.capacity() - 1;
	size_t index = hashValue(key) & mask;
	return &m_hashStore.node(index);
}

int Table::getFreeIndex() {
	int start = m_hashStore.free >= 0 ? m_hashStore.free : static_cast<int>(m_hashStore.capacity()) - 1;
	for (int i = start; i >= 0; --i) {
		if (isNil(m_hashStore.node(static_cast<size_t>(i)).key)) {
			m_hashStore.free = i - 1;
			return i;
		}
	}
	m_hashStore.free = -1;
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

	m_arrayStore.forEachPresent([&](size_t index, Value value) {
		(void)value;
			totalKeys += 1;
			countIntegerKey(index + 1);
	});
	m_hashStore.forEachPresent([&](size_t _index, const HashNode& node) {
		(void)_index;
			totalKeys += 1;
			int index = 0;
			if (tryGetArrayIndex(node.key, index)) {
				countIntegerKey(static_cast<size_t>(index) + 1);
			}
	});
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
	ArrayStoreView oldArray = std::move(m_arrayStore);
	HashStoreView oldHash = std::move(m_hashStore);

	m_arrayStore.resize(newArraySize);
	m_arrayLength = 0;
	m_hashStore.resize(newHashSize);
	allocateStoreObjects(newArraySize, newHashSize);

	oldArray.forEachPresent([&](size_t index, Value value) {
		rawSet(valueNumber(static_cast<double>(index + 1)), value);
	});
	oldHash.forEachPresent([&](size_t _index, const HashNode& node) {
		(void)_index;
		rawSet(node.key, node.value);
	});
}

void Table::allocateStoreObjects(size_t arraySize, size_t hashSize) {
	const ObjectAllocation arrayStoreAllocation = m_handleTable.allocateObject(
		static_cast<uint32_t>(HeapObjectType::ArrayStore),
		ARRAY_STORE_OBJECT_DATA_OFFSET + (static_cast<uint32_t>(arraySize) * TAGGED_VALUE_SLOT_SIZE));
	const ObjectAllocation hashStoreAllocation = m_handleTable.allocateObject(
		static_cast<uint32_t>(HeapObjectType::HashStore),
		HASH_STORE_OBJECT_DATA_OFFSET + (static_cast<uint32_t>(hashSize) * HASH_NODE_SIZE));
	m_arrayStoreId = arrayStoreAllocation.id;
	m_arrayStoreAddr = arrayStoreAllocation.addr;
	m_hashStoreId = hashStoreAllocation.id;
	m_hashStoreAddr = hashStoreAllocation.addr;
}

void Table::rawSet(const Value& key, const Value& value) {
	int index = 0;
	bool isArrayKey = tryGetArrayIndex(key, index);
	if (isArrayKey) {
		size_t idx = static_cast<size_t>(index);
		if (idx < m_arrayStore.capacity()) {
			m_arrayStore.slot(idx) = value;
			if (isNil(value)) {
				if (idx < m_arrayLength) {
					m_arrayLength = idx;
				}
			} else if (idx == m_arrayLength) {
				size_t newLength = m_arrayLength;
				while (newLength < m_arrayStore.capacity() && !isNil(m_arrayStore.read(newLength))) {
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
	if (m_hashStore.capacity() == 0) {
		rehash(key);
		rawSet(key, value);
		return;
	}
	size_t mask = m_hashStore.capacity() - 1;
	int mainIndex = static_cast<int>(hashValue(key) & mask);
	HashNode& mainNode = m_hashStore.node(static_cast<size_t>(mainIndex));
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
	HashNode& freeNode = m_hashStore.node(static_cast<size_t>(freeIndex));
	int mainIndexOfOccupied = static_cast<int>(hashValue(mainNode.key) & mask);
	if (mainIndexOfOccupied != mainIndex) {
		freeNode = mainNode;
		int prev = mainIndexOfOccupied;
		while (m_hashStore.node(static_cast<size_t>(prev)).next != mainIndex) {
			prev = m_hashStore.node(static_cast<size_t>(prev)).next;
		}
		m_hashStore.node(static_cast<size_t>(prev)).next = freeIndex;
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
	if (m_hashStore.capacity() == 0) {
		return;
	}
	size_t mask = m_hashStore.capacity() - 1;
	int mainIndex = static_cast<int>(hashValue(key) & mask);
	int prev = -1;
	int index = mainIndex;
	while (index >= 0) {
		HashNode& node = m_hashStore.node(static_cast<size_t>(index));
		if (!isNil(node.key) && keyEquals(node.key, key)) {
			int next = node.next;
			if (prev >= 0) {
				m_hashStore.node(static_cast<size_t>(prev)).next = next;
				node.key = valueNil();
				node.value = valueNil();
				node.next = -1;
				if (index > m_hashStore.free) {
					m_hashStore.free = index;
				}
				return;
			}
			if (next >= 0) {
				HashNode& nextNode = m_hashStore.node(static_cast<size_t>(next));
				node = nextNode;
				nextNode.key = valueNil();
				nextNode.value = valueNil();
				nextNode.next = -1;
				if (next > m_hashStore.free) {
					m_hashStore.free = next;
				}
				return;
			}
			node.key = valueNil();
			node.value = valueNil();
			node.next = -1;
			if (index > m_hashStore.free) {
				m_hashStore.free = index;
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
		if (index < static_cast<int>(m_arrayStore.capacity())) {
			return m_arrayStore.read(static_cast<size_t>(index));
		}
	}

	int nodeIndex = findNodeIndex(key);
	if (nodeIndex >= 0) {
		return m_hashStore.node(static_cast<size_t>(nodeIndex)).value;
	}
	return valueNil();
}

void Table::set(const Value& key, const Value& value) {
	if (isNil(key)) {
		throw BMSX_RUNTIME_ERROR("Table index is nil.");
	}
	int index = 0;
	try {
		bool isArrayKey = tryGetArrayIndex(key, index);
		if (isArrayKey) {
			const size_t idx = static_cast<size_t>(index);
			if (isNil(value)) {
				if (idx < m_arrayStore.capacity()) {
					m_arrayStore.slot(idx) = value;
					if (idx < m_arrayLength) {
						m_arrayLength = idx;
					}
					return;
				}
			} else if (idx < m_arrayStore.capacity()) {
				m_arrayStore.slot(idx) = value;
				if (idx == m_arrayLength) {
					size_t newLength = m_arrayLength;
					while (newLength < m_arrayStore.capacity() && !isNil(m_arrayStore.read(newLength))) {
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
			m_hashStore.node(static_cast<size_t>(nodeIndex)).value = value;
			return;
		}
		if (m_hashStore.capacity() == 0 || m_hashStore.free < 0) {
			rehash(key);
		}
		rawSet(key, value);
	} catch (...) {
		syncObjectState();
		throw;
	}
	syncObjectState();
}

int Table::length() const {
	return static_cast<int>(m_arrayLength);
}

void Table::clear() {
	m_arrayStore.clear();
	m_arrayLength = 0;
	m_hashStore.clear();
	syncObjectState();
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
		for (size_t i = 0; i < m_arrayStore.capacity(); ++i) {
			if (!isNil(m_arrayStore.read(i))) {
				return std::make_pair(valueNumber(static_cast<double>(i + 1)), m_arrayStore.read(i));
			}
		}
		for (size_t i = 0; i < m_hashStore.capacity(); ++i) {
			const auto& node = m_hashStore.node(i);
			if (!isNil(node.key)) {
				return std::make_pair(node.key, node.value);
			}
		}
		return std::nullopt;
	}
	int index = 0;
	if (tryGetArrayIndex(after, index)) {
		if (index < static_cast<int>(m_arrayStore.capacity())) {
			if (isNil(m_arrayStore.read(static_cast<size_t>(index)))) {
				return std::nullopt;
			}
			int startIndex = index + 1;
			for (int i = startIndex; i < static_cast<int>(m_arrayStore.capacity()); ++i) {
				if (!isNil(m_arrayStore.read(static_cast<size_t>(i)))) {
					return std::make_pair(valueNumber(static_cast<double>(i + 1)), m_arrayStore.read(static_cast<size_t>(i)));
				}
			}
			for (size_t i = 0; i < m_hashStore.capacity(); ++i) {
				const auto& node = m_hashStore.node(i);
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
	for (size_t i = static_cast<size_t>(nodeIndex + 1); i < m_hashStore.capacity(); ++i) {
		const auto& node = m_hashStore.node(i);
		if (!isNil(node.key)) {
			return std::make_pair(node.key, node.value);
		}
	}
	return std::nullopt;
}

void GcHeap::markValue(Value v) {
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

void GcHeap::markObject(GCObject* obj) {
	if (!obj || obj->marked) {
		return;
	}
	obj->marked = true;
	m_grayStack.push_back(obj);
}

GCObject* GcHeap::resolveRuntimeRef(uint32_t runtimeRefId) const {
	auto it = m_runtimeRefs.find(runtimeRefId);
	if (it == m_runtimeRefs.end()) {
		throw std::runtime_error("[GcHeap] Unknown runtime ref id.");
	}
	return it->second;
}

void GcHeap::trace() {
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
				for (uint32_t upvalueRefId : closure->upvalueRefIds) {
					markObject(static_cast<Upvalue*>(resolveRuntimeObjectRef(upvalueRefId)));
				}
				break;
			}
			case ObjType::NativeFunction:
				break;
			case ObjType::NativeObject: {
				auto* native = static_cast<NativeObject*>(obj);
				if (native->getMetatable()) {
					markObject(native->getMetatable());
				}
				native->mark(*this);
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

void GcHeap::sweep() {
	GCObject** current = &m_objects;
	while (*current) {
		GCObject* obj = *current;
		if (obj->marked) {
			obj->marked = false;
			current = &obj->next;
			continue;
		}
		GCObject* next = obj->next;
		destroyObject(obj);
		*current = next;
	}
}

GcHeap::~GcHeap() {
	GCObject* current = m_objects;
	while (current) {
		GCObject* next = current->next;
		destroyObject(current);
		current = next;
	}
	m_objects = nullptr;
	m_grayStack.clear();
	m_runtimeRefs.clear();
}

void GcHeap::destroyObject(GCObject* obj) {
	m_runtimeRefs.erase(obj->runtimeRefId);
	unregisterRuntimeObjectRef(obj->runtimeRefId);
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
			nativeFunctionBridgeRegistry().erase(obj->runtimeRefId);
			m_bytesAllocated -= sizeof(NativeFunction);
			delete static_cast<NativeFunction*>(obj);
			break;
		case ObjType::NativeObject:
			nativeObjectBridgeRegistry().erase(obj->runtimeRefId);
			m_bytesAllocated -= sizeof(NativeObject);
			delete static_cast<NativeObject*>(obj);
			break;
		case ObjType::Upvalue:
			m_bytesAllocated -= sizeof(Upvalue);
			delete static_cast<Upvalue*>(obj);
			break;
	}
}

void GcHeap::collect() {
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

CPU::CPU(Memory& memory, ObjectHandleTable& handleTable)
	: m_memory(memory)
	, m_handleTable(handleTable)
	, m_stringPool(handleTable)
	, m_heap(handleTable) {
	m_heap.setRootMarker([this](GcHeap& heap) { markRoots(heap); });
	m_externalRootMarker = [](GcHeap&) {};
	globals = m_heap.allocate<Table>(ObjType::Table, m_heap, m_handleTable, m_stringPool, 0, 0);
	m_indexKey = valueString(m_stringPool.intern("__index"));
}

Value CPU::createNativeFunction(std::string_view name, NativeFunctionInvoke fn) {
	auto* native = m_heap.allocate<NativeFunction>(ObjType::NativeFunction);
	native->name = std::string(name);
	nativeFunctionBridgeRegistry()[native->runtimeRefId] = NativeFunctionBridge{
		[invoke = std::move(fn)](const std::vector<Value>& args, std::vector<Value>& out) {
		out.clear();
		invoke(args, out);
		},
	};
	return valueNativeFunction(native);
}

Value CPU::createNativeObject(
	void* raw,
	std::function<Value(const Value&)> get,
	std::function<void(const Value&, const Value&)> set,
	std::function<int()> len,
	std::function<std::optional<std::pair<Value, Value>>(const Value&)> nextEntry,
	std::function<void(GcHeap&)> mark
) {
	auto* native = m_heap.allocateWithRamSize<NativeObject>(ObjType::NativeObject, NATIVE_OBJECT_HEADER_SIZE);
	nativeObjectBridgeRegistry()[native->runtimeRefId] = NativeObjectBridge{
		raw,
		std::move(get),
		std::move(set),
		std::move(len),
		std::move(nextEntry),
		std::move(mark),
	};
	syncNativeObjectState(native);
	return valueNativeObject(native);
}

void CPU::setNativeObjectMetatable(NativeObject* native, Table* metatable) {
	native->setMetatable(metatable);
	syncNativeObjectState(native);
}

Table* CPU::createTable(int arraySize, int hashSize) {
	return m_heap.allocate<Table>(ObjType::Table, m_heap, m_handleTable, m_stringPool, arraySize, hashSize);
}

Closure* CPU::createRootClosure(int protoIndex) {
	auto* closure = m_heap.allocateWithRamSize<Closure>(ObjType::Closure, CLOSURE_OBJECT_HEADER_SIZE);
	closure->protoIndex = protoIndex;
	closure->upvalueRefIds.clear();
	syncClosureObjectState(closure);
	return closure;
}

void CPU::syncNativeObjectState(NativeObject* native) {
	const ObjectHandleEntry entry = m_handleTable.readEntry(native->runtimeRefId);
	m_handleTable.writeU32(entry.addr + NATIVE_OBJECT_METATABLE_ID_OFFSET, native->metatableRefId);
}

void CPU::syncClosureObjectState(Closure* closure) {
	const ObjectHandleEntry entry = m_handleTable.readEntry(closure->runtimeRefId);
	m_handleTable.writeU32(entry.addr + CLOSURE_OBJECT_PROTO_INDEX_OFFSET, static_cast<uint32_t>(closure->protoIndex));
	m_handleTable.writeU32(entry.addr + CLOSURE_OBJECT_UPVALUE_COUNT_OFFSET, static_cast<uint32_t>(closure->upvalueRefIds.size()));
	for (size_t index = 0; index < closure->upvalueRefIds.size(); ++index) {
		m_handleTable.writeU32(
			entry.addr + CLOSURE_OBJECT_UPVALUE_IDS_OFFSET + (static_cast<uint32_t>(index) * 4),
			closure->upvalueRefIds[index]
		);
	}
}

void CPU::syncUpvalueObjectState(Upvalue* upvalue) {
	const ObjectHandleEntry entry = m_handleTable.readEntry(upvalue->runtimeRefId);
	m_handleTable.writeU32(
		entry.addr + UPVALUE_OBJECT_STATE_OFFSET,
		upvalue->open ? UPVALUE_OBJECT_STATE_OPEN : UPVALUE_OBJECT_STATE_CLOSED
	);
	m_handleTable.writeU32(entry.addr + UPVALUE_OBJECT_FRAME_DEPTH_OFFSET, static_cast<uint32_t>(upvalue->frameDepth));
	m_handleTable.writeU32(entry.addr + UPVALUE_OBJECT_REGISTER_INDEX_OFFSET, static_cast<uint32_t>(upvalue->index));
	writeTaggedValueToHandle(m_handleTable, entry.addr + UPVALUE_OBJECT_CLOSED_VALUE_OFFSET, upvalue->value);
}

void CPU::setProgram(Program* program, ProgramMetadata* metadata) {
	m_program = program;
	m_metadata = metadata;
	if (!m_program) {
		m_runtimeConstPool.clear();
		m_decoded.clear();
		return;
	}
	const StringPool& programPool = *m_program->constPoolStringPool;
	m_runtimeConstPool.resize(m_program->constPool.size());
	for (size_t index = 0; index < m_program->constPool.size(); ++index) {
		Value value = m_program->constPool[index];
		if (valueIsString(value)) {
			value = valueString(m_stringPool.intern(programPool.toString(asStringId(value))));
		}
		m_runtimeConstPool[index] = value;
	}
	decodeProgram();
}

void CPU::reserveStringHandles(StringId minHandle) {
	m_stringPool.reserveHandles(minHandle);
}

void CPU::restoreObjectMemoryState(const ObjectHandleTableState& state) {
	m_handleTable.restoreState(state);
	m_stringPool.clearRuntimeCache();
	rehydrateRuntimeObjects();
	if (m_stringIndexTable && m_handleTable.readEntry(m_stringIndexTable->runtimeRefId).type == 0) {
		m_stringIndexTable = nullptr;
	}
}

void CPU::rehydrateRuntimeObjects() {
	m_heap.forEachRuntimeRef([this](uint32_t runtimeRefId, GCObject* object) {
		const ObjectHandleEntry entry = m_handleTable.readEntry(runtimeRefId);
		if (entry.type == 0) {
			return;
		}
		switch (object->type) {
			case ObjType::Table:
				static_cast<Table*>(object)->rehydrateStoreViews();
				break;
			case ObjType::NativeFunction:
				break;
			case ObjType::NativeObject:
				static_cast<NativeObject*>(object)->metatableRefId = m_handleTable.readU32(entry.addr + NATIVE_OBJECT_METATABLE_ID_OFFSET);
				break;
			case ObjType::Closure: {
				auto* closure = static_cast<Closure*>(object);
				const uint32_t upvalueCount = m_handleTable.readU32(entry.addr + CLOSURE_OBJECT_UPVALUE_COUNT_OFFSET);
				closure->protoIndex = static_cast<int>(m_handleTable.readU32(entry.addr + CLOSURE_OBJECT_PROTO_INDEX_OFFSET));
				closure->upvalueRefIds.resize(upvalueCount);
				for (uint32_t index = 0; index < upvalueCount; ++index) {
					closure->upvalueRefIds[index] = m_handleTable.readU32(
						entry.addr + CLOSURE_OBJECT_UPVALUE_IDS_OFFSET + (index * 4)
					);
				}
				break;
			}
			case ObjType::Upvalue: {
				auto* upvalue = static_cast<Upvalue*>(object);
				upvalue->open = m_handleTable.readU32(entry.addr + UPVALUE_OBJECT_STATE_OFFSET) == UPVALUE_OBJECT_STATE_OPEN;
				upvalue->frameDepth = upvalue->open
					? static_cast<int>(m_handleTable.readU32(entry.addr + UPVALUE_OBJECT_FRAME_DEPTH_OFFSET))
					: -1;
				upvalue->index = static_cast<int>(m_handleTable.readU32(entry.addr + UPVALUE_OBJECT_REGISTER_INDEX_OFFSET));
				upvalue->value = readTaggedValueFromHandle(m_handleTable, m_heap, entry.addr + UPVALUE_OBJECT_CLOSED_VALUE_OFFSET);
				break;
			}
		}
	});
}

void CPU::decodeProgram() {
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

void CPU::start(int entryProtoIndex, const std::vector<Value>& args) {
	m_frames.clear();
	auto* closure = createRootClosure(entryProtoIndex);
	pushFrame(closure, args, 0, 0, false, m_program->protos[entryProtoIndex].entryPC);
}

void CPU::call(Closure* closure, const std::vector<Value>& args, int returnCount) {
	if (!closure) {
		throw BMSX_RUNTIME_ERROR("Attempted to call a nil value.");
	}
	pushFrame(closure, args, 0, returnCount, false, m_program->protos[closure->protoIndex].entryPC);
}

void CPU::callExternal(Closure* closure, const std::vector<Value>& args) {
	if (!closure) {
		throw BMSX_RUNTIME_ERROR("Attempted to call a nil value.");
	}
	pushFrame(closure, args, 0, 0, true, m_program->protos[closure->protoIndex].entryPC);
}

RunResult CPU::run(int instructionBudget) {
	instructionBudgetRemaining = instructionBudget;
	RunResult result = RunResult::Halted;
	while (!m_frames.empty()) {
		if (instructionBudgetRemaining <= 0) {
			result = RunResult::Yielded;
			break;
		}
		step();
	}
	return result;
}

RunResult CPU::runUntilDepth(int targetDepth, int instructionBudget) {
	instructionBudgetRemaining = instructionBudget;
	RunResult result = RunResult::Halted;
	while (static_cast<int>(m_frames.size()) > targetDepth) {
		if (instructionBudgetRemaining <= 0) {
			result = RunResult::Yielded;
			break;
		}
		step();
	}
	return result;
}

void CPU::unwindToDepth(int targetDepth) {
	while (static_cast<int>(m_frames.size()) > targetDepth) {
		auto finished = std::move(m_frames.back());
		m_frames.pop_back();
		closeUpvalues(*finished);
		releaseFrame(std::move(finished));
	}
}

void CPU::step() {
	if (m_frames.empty()) return;
	if (m_heap.needsCollection()) {
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
	instructionBudgetRemaining -= static_cast<int>(kBaseCycles[op]) + (hasWide ? 1 : 0);
	executeInstruction(frame, static_cast<OpCode>(op), decoded->a, decoded->b, decoded->c, ext, wideA, wideB, wideC, hasWide);
}

std::optional<SourceRange> CPU::getDebugRange(int pc) const {
	int wordIndex = pc / INSTRUCTION_BYTES;
	if (!m_metadata || wordIndex < 0 || wordIndex >= static_cast<int>(m_metadata->debugRanges.size())) {
		return std::nullopt;
	}
	return m_metadata->debugRanges[static_cast<size_t>(wordIndex)];
}

std::vector<std::pair<int, int>> CPU::getCallStack() const {
	std::vector<std::pair<int, int>> stack;
	int topIndex = static_cast<int>(m_frames.size()) - 1;
	for (int i = 0; i < static_cast<int>(m_frames.size()); ++i) {
		const auto& frame = m_frames[i];
		int pc = (i == topIndex) ? lastPc : frame->callSitePc;
		stack.emplace_back(frame->protoIndex, pc);
	}
	return stack;
}

int CPU::getFrameRegisterCount(int frameIndex) const {
	if (frameIndex < 0 || frameIndex >= static_cast<int>(m_frames.size())) {
		throw BMSX_RUNTIME_ERROR("[CPU] Frame index out of range: " + std::to_string(frameIndex) + ".");
	}
	return m_frames[static_cast<size_t>(frameIndex)]->top;
}

Value CPU::readFrameRegister(int frameIndex, int registerIndex) const {
	if (frameIndex < 0 || frameIndex >= static_cast<int>(m_frames.size())) {
		throw BMSX_RUNTIME_ERROR("[CPU] Frame index out of range: " + std::to_string(frameIndex) + ".");
	}
	const CallFrame& frame = *m_frames[static_cast<size_t>(frameIndex)];
	if (registerIndex < 0 || registerIndex >= static_cast<int>(frame.registers.size())) {
		throw BMSX_RUNTIME_ERROR("[CPU] Register index out of range: " + std::to_string(registerIndex) + ".");
	}
	return frame.registers[static_cast<size_t>(registerIndex)];
}

void CPU::skipNextInstruction(CallFrame& frame) {
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

void CPU::executeInstruction(
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

#define CYCLES_ADD(n) do { instructionBudgetRemaining -= (n); } while (0)

	switch (op) {
		case OpCode::WIDE:
			throw BMSX_RUNTIME_ERROR("Unexpected WIDE opcode.");

		case OpCode::MOV:
			setRegister(frame, a, frame.registers[b]);
			return;

		case OpCode::LOADK:
			setRegister(frame, a, m_runtimeConstPool[bx]);
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
			const Value& key = m_runtimeConstPool[bx];
			setRegister(frame, a, globals->get(key));
			return;
		}

		case OpCode::SETG: {
			const Value& key = m_runtimeConstPool[bx];
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
			if (valueIsString(tableValue)) {
				if (m_stringIndexTable) {
					setRegister(frame, a, resolveTableIndex(m_stringIndexTable, key));
				} else {
					setRegister(frame, a, valueNil());
				}
				return;
			}
			if (valueIsNativeObject(tableValue)) {
				auto* native = asNativeObject(tableValue);
				Value nativeResult = native->get(key);
				if (!isNil(nativeResult)) {
					setRegister(frame, a, nativeResult);
					return;
				}
				Table* metatable = native->getMetatable();
				if (metatable) {
					Value indexerValue = metatable->get(m_indexKey);
					if (valueIsTable(indexerValue)) {
						setRegister(frame, a, resolveTableIndex(asTable(indexerValue), key));
						return;
					}
				}
				setRegister(frame, a, nativeResult);
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
			auto* table = m_heap.allocate<Table>(ObjType::Table, m_heap, m_handleTable, m_stringPool, b, c);
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
			const uint32_t left = toU32(asNumber(readRK(frame, rkRawB, rkBitsB)));
			const uint32_t right = toU32(asNumber(readRK(frame, rkRawC, rkBitsC)));
			const int32_t result = static_cast<int32_t>(left & right);
			setRegister(frame, a, valueNumber(static_cast<double>(result)));
			return;
		}

		case OpCode::BOR: {
			const uint32_t left = toU32(asNumber(readRK(frame, rkRawB, rkBitsB)));
			const uint32_t right = toU32(asNumber(readRK(frame, rkRawC, rkBitsC)));
			const int32_t result = static_cast<int32_t>(left | right);
			setRegister(frame, a, valueNumber(static_cast<double>(result)));
			return;
		}

		case OpCode::BXOR: {
			const uint32_t left = toU32(asNumber(readRK(frame, rkRawB, rkBitsB)));
			const uint32_t right = toU32(asNumber(readRK(frame, rkRawC, rkBitsC)));
			const int32_t result = static_cast<int32_t>(left ^ right);
			setRegister(frame, a, valueNumber(static_cast<double>(result)));
			return;
		}

		case OpCode::SHL: {
			const uint32_t left = toU32(asNumber(readRK(frame, rkRawB, rkBitsB)));
			const uint32_t right = toU32(asNumber(readRK(frame, rkRawC, rkBitsC))) & 31u;
			const uint32_t result = left << right;
			setRegister(frame, a, valueNumber(static_cast<double>(static_cast<int32_t>(result))));
			return;
		}

		case OpCode::SHR: {
			const int32_t left = toI32(asNumber(readRK(frame, rkRawB, rkBitsB)));
			const uint32_t right = toU32(asNumber(readRK(frame, rkRawC, rkBitsC))) & 31u;
			setRegister(frame, a, valueNumber(static_cast<double>(left >> right)));
			return;
		}

		case OpCode::CONCAT: {
			std::string text = valueToString(readRK(frame, rkRawB, rkBitsB), m_stringPool);
			text += valueToString(readRK(frame, rkRawC, rkBitsC), m_stringPool);
			const StringId textId = m_stringPool.intern(text);
			const int cp = m_stringPool.codepointCount(textId);
			CYCLES_ADD(ceilDiv8(cp));
			setRegister(frame, a, valueString(textId));
			return;
		}

		case OpCode::CONCATN: {
			std::string text;
			CYCLES_ADD(c << 1);
			for (int index = 0; index < c; ++index) {
				text += valueToString(frame.registers[static_cast<size_t>(b + index)], m_stringPool);
			}
			const StringId textId = m_stringPool.intern(text);
			const int cp = m_stringPool.codepointCount(textId);
			CYCLES_ADD(ceilDiv8(cp));
			setRegister(frame, a, valueString(textId));
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
				if (!obj->hasLen()) {
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
			const uint32_t val = toU32(asNumber(frame.registers[b]));
			const int32_t result = static_cast<int32_t>(~val);
			setRegister(frame, a, valueNumber(static_cast<double>(result)));
			return;
		}

		case OpCode::EQ: {
			const Value& left = readRK(frame, rkRawB, rkBitsB);
			const Value& right = readRK(frame, rkRawC, rkBitsC);
			const bool eq = ValueEq{ m_stringPool }(left, right);
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
			Upvalue* upvalue = static_cast<Upvalue*>(resolveRuntimeObjectRef(frame.closure->upvalueRefIds[b]));
			setRegister(frame, a, readUpvalue(upvalue));
			return;
		}

		case OpCode::SETUP: {
			Upvalue* upvalue = static_cast<Upvalue*>(resolveRuntimeObjectRef(frame.closure->upvalueRefIds[b]));
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
				CYCLES_ADD(static_cast<int>(fn->cycleBase)
					+ static_cast<int>(fn->cyclePerArg) * argCount);
				std::vector<Value> args = acquireArgScratch();
				args.resize(static_cast<size_t>(argCount));
				for (int i = 0; i < argCount; ++i) {
					args[static_cast<size_t>(i)] = frame.registers[a + 1 + i];
				}
				std::vector<Value> out = acquireNativeReturnScratch();
				fn->invoke(args, out);
				const int returnSlots = retCount == 0 ? static_cast<int>(out.size()) : retCount;
				CYCLES_ADD(static_cast<int>(fn->cyclePerRet) * returnSlots);
				writeReturnValues(frame, a, retCount, out);
				releaseNativeReturnScratch(std::move(out));
				releaseArgScratch(std::move(args));
				return;
			}
			throw BMSX_RUNTIME_ERROR(formatNonFunctionCallError(
				callee,
				m_stringPool,
				getDebugRange(frame.pc - INSTRUCTION_BYTES)
			));
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

Closure* CPU::createClosure(CallFrame& frame, int protoIndex) {
	const Proto& proto = m_program->protos[protoIndex];
	auto* closure = m_heap.allocateWithRamSize<Closure>(
		ObjType::Closure,
		CLOSURE_OBJECT_UPVALUE_IDS_OFFSET + (static_cast<uint32_t>(proto.upvalues.size()) * 4)
	);
	closure->protoIndex = protoIndex;
	closure->upvalueRefIds.resize(proto.upvalues.size());
	for (size_t i = 0; i < proto.upvalues.size(); ++i) {
		const UpvalueDesc& uv = proto.upvalues[i];
		if (uv.isLocal) {
			Upvalue* upvalue = nullptr;
			auto it = frame.openUpvalues.find(uv.index);
			if (it != frame.openUpvalues.end()) {
				upvalue = it->second;
			} else {
				upvalue = m_heap.allocateWithRamSize<Upvalue>(ObjType::Upvalue, UPVALUE_OBJECT_HEADER_SIZE);
				upvalue->open = true;
				upvalue->index = uv.index;
				upvalue->frameDepth = frame.depth;
				frame.openUpvalues.emplace(uv.index, upvalue);
				syncUpvalueObjectState(upvalue);
			}
			closure->upvalueRefIds[i] = upvalue->runtimeRefId;
		} else {
			closure->upvalueRefIds[i] = frame.closure->upvalueRefIds[uv.index];
		}
	}
	syncClosureObjectState(closure);
	return closure;
}

void CPU::closeUpvalues(CallFrame& frame) {
	for (auto& entry : frame.openUpvalues) {
		Upvalue* upvalue = entry.second;
		upvalue->value = frame.registers[upvalue->index];
		upvalue->open = false;
		upvalue->frameDepth = -1;
		syncUpvalueObjectState(upvalue);
	}
	frame.openUpvalues.clear();
}

const Value& CPU::readUpvalue(Upvalue* upvalue) {
	if (upvalue->open) {
		return m_frames[static_cast<size_t>(upvalue->frameDepth)]->registers[static_cast<size_t>(upvalue->index)];
	}
	return upvalue->value;
}

void CPU::writeUpvalue(Upvalue* upvalue, const Value& value) {
	if (upvalue->open) {
		m_frames[static_cast<size_t>(upvalue->frameDepth)]->registers[static_cast<size_t>(upvalue->index)] = value;
		return;
	}
	upvalue->value = value;
	syncUpvalueObjectState(upvalue);
}

void CPU::pushFrame(Closure* closure, const Value* args, size_t argCount,
	int returnBase, int returnCount, bool captureReturns, int callSitePc) {
	const Proto& proto = m_program->protos[closure->protoIndex];
	auto frame = acquireFrame();
	frame->protoIndex = closure->protoIndex;
	frame->pc = proto.entryPC;
	frame->depth = static_cast<int>(m_frames.size());
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

void CPU::pushFrame(Closure* closure, const std::vector<Value>& args,
	int returnBase, int returnCount, bool captureReturns, int callSitePc) {
	pushFrame(closure, args.data(), args.size(), returnBase, returnCount, captureReturns, callSitePc);
}

void CPU::writeReturnValues(CallFrame& frame, int base, int count, const std::vector<Value>& values) {
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

void CPU::setRegister(CallFrame& frame, int index, const Value& value) {
	frame.registers[static_cast<size_t>(index)] = value;
	if (index >= frame.top) {
		frame.top = index + 1;
	}
}

const Value& CPU::readRK(CallFrame& frame, uint32_t raw, int bits) {
	int rk = signExtend(raw, bits);
	if (rk < 0) {
		int index = -1 - rk;
		return m_runtimeConstPool[static_cast<size_t>(index)];
	}
	return frame.registers[static_cast<size_t>(rk)];
}

Value CPU::resolveTableIndex(Table* table, const Value& key) {
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

std::unique_ptr<CallFrame> CPU::acquireFrame() {
	if (!m_framePool.empty()) {
		auto frame = std::move(m_framePool.back());
		m_framePool.pop_back();
		return frame;
	}
	return std::make_unique<CallFrame>();
}

void CPU::releaseFrame(std::unique_ptr<CallFrame> frame) {
	releaseRegisters(std::move(frame->registers));
	frame->varargs.clear();
	frame->openUpvalues.clear();
	if (m_framePool.size() < static_cast<size_t>(MAX_POOLED_FRAMES)) {
		m_framePool.push_back(std::move(frame));
	}
}

std::vector<Value> CPU::acquireRegisters(size_t size) {
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

void CPU::releaseRegisters(std::vector<Value>&& regs) {
	size_t bucket = regs.size();
	if (bucket > MAX_REGISTER_ARRAY_SIZE) {
		return;
	}
	auto& pool = m_registerPool[bucket];
	if (pool.size() < MAX_POOLED_REGISTER_ARRAYS) {
		pool.push_back(std::move(regs));
	}
}

std::vector<Value> CPU::acquireNativeReturnScratch() {
	if (!m_nativeReturnPool.empty()) {
		std::vector<Value> out = std::move(m_nativeReturnPool.back());
		m_nativeReturnPool.pop_back();
		out.clear();
		return out;
	}
	return {};
}

void CPU::releaseNativeReturnScratch(std::vector<Value>&& out) {
	if (m_nativeReturnPool.size() < MAX_POOLED_NATIVE_RETURN_ARRAYS) {
		m_nativeReturnPool.push_back(std::move(out));
	}
}

std::vector<Value> CPU::acquireArgScratch() {
	if (!m_nativeArgPool.empty()) {
		std::vector<Value> args = std::move(m_nativeArgPool.back());
		m_nativeArgPool.pop_back();
		args.clear();
		return args;
	}
	return {};
}

void CPU::releaseArgScratch(std::vector<Value>&& args) {
	if (m_nativeArgPool.size() < MAX_POOLED_NATIVE_ARG_ARRAYS) {
		m_nativeArgPool.push_back(std::move(args));
	}
}

void CPU::markRoots(GcHeap& heap) {
	if (globals) {
		heap.markObject(globals);
	}
	if (m_stringIndexTable) {
		heap.markObject(m_stringIndexTable);
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
	for (const auto& value : m_runtimeConstPool) {
		heap.markValue(value);
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
