#include "cpu.h"
#include "memory.h"
#include "number_format.h"
#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdio>
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

struct NativeFunctionBridge {
	std::string name;
	uint16_t cycleBase = 20;
	uint8_t cyclePerArg = 2;
	uint8_t cyclePerRet = 1;
	NativeFunctionInvoke invoke;
	NativeBridgeMark mark;
};

struct NativeObjectBridge {
	void* raw = nullptr;
	std::function<Value(const Value&)> get;
	std::function<void(const Value&, const Value&)> set;
	std::function<int()> len;
	std::function<std::optional<std::pair<Value, Value>>(const Value&)> nextEntry;
	std::function<void(GcHeap&)> mark;
};

static std::unordered_map<const ObjectHandleTable*, std::unordered_map<uint32_t, GCObject*>>& objectRefRegistries() {
	static std::unordered_map<const ObjectHandleTable*, std::unordered_map<uint32_t, GCObject*>> registries;
	return registries;
}

static std::unordered_map<uint32_t, GCObject*>& objectRefRegistry(const ObjectHandleTable& handleTable) {
	return objectRefRegistries()[&handleTable];
}

struct NativeFunctionBridgeRegistryState {
	uint32_t nextBridgeId = 1;
	std::unordered_map<uint32_t, NativeFunctionBridge> entries;
};

struct NativeObjectBridgeRegistryState {
	uint32_t nextBridgeId = 1;
	std::unordered_map<uint32_t, NativeObjectBridge> entries;
};

static std::unordered_map<const ObjectHandleTable*, NativeFunctionBridgeRegistryState>& nativeFunctionBridgeRegistries() {
	static std::unordered_map<const ObjectHandleTable*, NativeFunctionBridgeRegistryState> registries;
	return registries;
}

static NativeFunctionBridgeRegistryState& nativeFunctionBridgeRegistryState(const ObjectHandleTable& handleTable) {
	return nativeFunctionBridgeRegistries()[&handleTable];
}

static std::unordered_map<uint32_t, NativeFunctionBridge>& nativeFunctionBridgeRegistry(const ObjectHandleTable& handleTable) {
	return nativeFunctionBridgeRegistryState(handleTable).entries;
}

static uint32_t allocateNativeFunctionBridgeId(const ObjectHandleTable& handleTable) {
	NativeFunctionBridgeRegistryState& state = nativeFunctionBridgeRegistryState(handleTable);
	const uint32_t bridgeId = state.nextBridgeId;
	state.nextBridgeId += 1;
	return bridgeId;
}

static std::unordered_map<const ObjectHandleTable*, NativeObjectBridgeRegistryState>& nativeObjectBridgeRegistries() {
	static std::unordered_map<const ObjectHandleTable*, NativeObjectBridgeRegistryState> registries;
	return registries;
}

static NativeObjectBridgeRegistryState& nativeObjectBridgeRegistryState(const ObjectHandleTable& handleTable) {
	return nativeObjectBridgeRegistries()[&handleTable];
}

static std::unordered_map<uint32_t, NativeObjectBridge>& nativeObjectBridgeRegistry(const ObjectHandleTable& handleTable) {
	return nativeObjectBridgeRegistryState(handleTable).entries;
}

static uint32_t allocateNativeObjectBridgeId(const ObjectHandleTable& handleTable) {
	NativeObjectBridgeRegistryState& state = nativeObjectBridgeRegistryState(handleTable);
	const uint32_t bridgeId = state.nextBridgeId;
	state.nextBridgeId += 1;
	return bridgeId;
}

static NativeFunctionBridge& resolveNativeFunctionBridge(const ObjectHandleTable& handleTable, uint32_t bridgeId) {
	auto& registry = nativeFunctionBridgeRegistry(handleTable);
	auto it = registry.find(bridgeId);
	if (it == registry.end()) {
		throw std::runtime_error("[CPU] Unknown native function bridge id.");
	}
	return it->second;
}

static NativeObjectBridge& resolveNativeObjectBridge(const ObjectHandleTable& handleTable, uint32_t bridgeId) {
	auto& registry = nativeObjectBridgeRegistry(handleTable);
	auto it = registry.find(bridgeId);
	if (it == registry.end()) {
		throw std::runtime_error("[CPU] Unknown native object bridge id.");
	}
	return it->second;
}

} // namespace

static uint32_t readNativeFunctionBridgeId(const NativeFunction* native);
static uint32_t readNativeObjectBridgeId(const NativeObject* native);
static uint32_t readNativeObjectMetatableRefId(const NativeObject* native);
static void writeNativeObjectMetatableRefId(ObjectHandleTable& handleTable, const NativeObject* native, uint32_t metatableRefId);

void registerRuntimeObjectRef(ObjectHandleTable& handleTable, uint32_t objectRefId, GCObject* object) {
	objectRefRegistry(handleTable)[objectRefId] = object;
}

void unregisterRuntimeObjectRef(ObjectHandleTable& handleTable, uint32_t objectRefId) {
	auto& registry = objectRefRegistry(handleTable);
	registry.erase(objectRefId);
	if (registry.empty()) {
		objectRefRegistries().erase(&handleTable);
	}
}

GCObject* resolveRuntimeObjectRef(const ObjectHandleTable& handleTable, uint32_t objectRefId) {
	const auto ownerIt = objectRefRegistries().find(&handleTable);
	if (ownerIt == objectRefRegistries().end()) {
		throw std::runtime_error("[CPU] Unknown object ref id.");
	}
	auto it = ownerIt->second.find(objectRefId);
	if (it == ownerIt->second.end()) {
		throw std::runtime_error("[CPU] Unknown object ref id.");
	}
	return it->second;
}

const std::unordered_map<uint32_t, GCObject*>& getRuntimeObjectRegistry(const ObjectHandleTable& handleTable) {
	const auto ownerIt = objectRefRegistries().find(&handleTable);
	if (ownerIt == objectRefRegistries().end()) {
		static const std::unordered_map<uint32_t, GCObject*> emptyRegistry;
		return emptyRegistry;
	}
	return ownerIt->second;
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

Table* asTable(Value v, const GcHeap& heap) {
	return static_cast<Table*>(heap.resolveRuntimeRef(static_cast<uint32_t>(valuePayload(v))));
}

Closure* asClosure(Value v, const GcHeap& heap) {
	return static_cast<Closure*>(heap.resolveRuntimeRef(static_cast<uint32_t>(valuePayload(v))));
}

NativeFunction* asNativeFunction(Value v, const GcHeap& heap) {
	return static_cast<NativeFunction*>(heap.resolveRuntimeRef(static_cast<uint32_t>(valuePayload(v))));
}

NativeObject* asNativeObject(Value v, const GcHeap& heap) {
	return static_cast<NativeObject*>(heap.resolveRuntimeRef(static_cast<uint32_t>(valuePayload(v))));
}

Upvalue* asUpvalue(Value v, const GcHeap& heap) {
	return static_cast<Upvalue*>(heap.resolveRuntimeRef(static_cast<uint32_t>(valuePayload(v))));
}

void NativeFunction::invoke(const std::vector<Value>& args, std::vector<Value>& out) const {
	resolveNativeFunctionBridge(handleTable, readNativeFunctionBridgeId(this)).invoke(args, out);
}

Value NativeObject::get(const Value& key) const {
	const auto& bridge = resolveNativeObjectBridge(handleTable, readNativeObjectBridgeId(this));
	if (!bridge.get) {
		return valueNil();
	}
	return bridge.get(key);
}

void NativeObject::set(const Value& key, const Value& value) const {
	resolveNativeObjectBridge(handleTable, readNativeObjectBridgeId(this)).set(key, value);
}

bool NativeObject::hasLen() const {
	return static_cast<bool>(resolveNativeObjectBridge(handleTable, readNativeObjectBridgeId(this)).len);
}

int NativeObject::len() const {
	return resolveNativeObjectBridge(handleTable, readNativeObjectBridgeId(this)).len();
}

bool NativeObject::hasNextEntry() const {
	return static_cast<bool>(resolveNativeObjectBridge(handleTable, readNativeObjectBridgeId(this)).nextEntry);
}

std::optional<std::pair<Value, Value>> NativeObject::nextEntry(const Value& after) const {
	const auto& bridge = resolveNativeObjectBridge(handleTable, readNativeObjectBridgeId(this));
	if (!bridge.nextEntry) {
		return std::nullopt;
	}
	return bridge.nextEntry(after);
}

void NativeObject::mark(GcHeap& heap) const {
	const auto& bridge = resolveNativeObjectBridge(handleTable, readNativeObjectBridgeId(this));
	if (bridge.mark) {
		bridge.mark(heap);
	}
}

void* NativeObject::raw() const {
	return resolveNativeObjectBridge(handleTable, readNativeObjectBridgeId(this)).raw;
}

Table* NativeObject::getMetatable() const {
	const uint32_t metatableRefId = readNativeObjectMetatableRefId(this);
	return metatableRefId == 0 ? nullptr : static_cast<Table*>(resolveRuntimeObjectRef(handleTable, metatableRefId));
}

void NativeObject::setMetatable(Table* metatable) {
	writeNativeObjectMetatableRefId(handleTable, this, metatable ? metatable->runtimeRefId : 0);
}

static TaggedValueSlotState encodeTaggedValueSlot(const Value& value);
static Value decodeTaggedValueSlot(const TaggedValueSlotState& slot, const GcHeap& gcHeap);

static void writeTaggedValueToHandle(ObjectHandleTable& handleTable, uint32_t addr, const Value& value) {
	const TaggedValueSlotState slot = encodeTaggedValueSlot(value);
	handleTable.writeU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET, slot.tag);
	handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET, slot.payloadLo);
	handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET, slot.payloadHi);
}

static TaggedValueSlotState encodeTaggedValueSlot(const Value& value) {
	if (isNil(value)) {
		return { static_cast<uint32_t>(TaggedValueTag::Nil), 0, 0 };
	}
	if (valueIsTagged(value)) {
		switch (valueTag(value)) {
			case ValueTag::False:
				return { static_cast<uint32_t>(TaggedValueTag::False), 0, 0 };
			case ValueTag::True:
				return { static_cast<uint32_t>(TaggedValueTag::True), 0, 0 };
			case ValueTag::String:
				return { static_cast<uint32_t>(TaggedValueTag::String), asStringId(value), 0 };
			case ValueTag::Table:
				return { static_cast<uint32_t>(TaggedValueTag::Table), static_cast<uint32_t>(valuePayload(value)), 0 };
			case ValueTag::Closure:
				return { static_cast<uint32_t>(TaggedValueTag::Closure), static_cast<uint32_t>(valuePayload(value)), 0 };
			case ValueTag::NativeFunction:
				return { static_cast<uint32_t>(TaggedValueTag::NativeFunction), static_cast<uint32_t>(valuePayload(value)), 0 };
			case ValueTag::NativeObject:
				return { static_cast<uint32_t>(TaggedValueTag::NativeObject), static_cast<uint32_t>(valuePayload(value)), 0 };
			case ValueTag::Upvalue:
				return { static_cast<uint32_t>(TaggedValueTag::Upvalue), static_cast<uint32_t>(valuePayload(value)), 0 };
			case ValueTag::Nil:
				return { static_cast<uint32_t>(TaggedValueTag::Nil), 0, 0 };
		}
	}
	uint64_t bits = 0;
	const double number = valueToNumber(value);
	std::memcpy(&bits, &number, sizeof(double));
	return {
		static_cast<uint32_t>(TaggedValueTag::Number),
		static_cast<uint32_t>(bits & 0xffffffffULL),
		static_cast<uint32_t>(bits >> 32),
	};
}

static Value decodeTaggedValueSlot(const TaggedValueSlotState& slot, const GcHeap& gcHeap) {
	switch (static_cast<TaggedValueTag>(slot.tag)) {
		case TaggedValueTag::Nil:
			return valueNil();
		case TaggedValueTag::False:
			return valueBool(false);
		case TaggedValueTag::True:
			return valueBool(true);
		case TaggedValueTag::Number: {
			uint64_t bits = static_cast<uint64_t>(slot.payloadLo) | (static_cast<uint64_t>(slot.payloadHi) << 32);
			double number = 0.0;
			std::memcpy(&number, &bits, sizeof(double));
			return valueNumber(number);
		}
		case TaggedValueTag::String:
			return valueString(slot.payloadLo);
		case TaggedValueTag::Table:
			return valueTable(static_cast<Table*>(gcHeap.resolveRuntimeRef(slot.payloadLo)));
		case TaggedValueTag::Closure:
			return valueClosure(static_cast<Closure*>(gcHeap.resolveRuntimeRef(slot.payloadLo)));
		case TaggedValueTag::NativeFunction:
			return valueNativeFunction(static_cast<NativeFunction*>(gcHeap.resolveRuntimeRef(slot.payloadLo)));
		case TaggedValueTag::NativeObject:
			return valueNativeObject(static_cast<NativeObject*>(gcHeap.resolveRuntimeRef(slot.payloadLo)));
		case TaggedValueTag::Upvalue:
			return valueUpvalue(static_cast<Upvalue*>(gcHeap.resolveRuntimeRef(slot.payloadLo)));
	}
	throw std::runtime_error(
		"[Table] Unsupported tagged value tag="
		+ std::to_string(slot.tag)
		+ " payloadLo=" + std::to_string(slot.payloadLo)
		+ " payloadHi=" + std::to_string(slot.payloadHi)
		+ "."
	);
}

static void encodeTaggedValueVector(const std::vector<Value>& values, std::vector<TaggedValueSlotState>& out) {
	out.resize(values.size());
	for (size_t index = 0; index < values.size(); ++index) {
		out[index] = encodeTaggedValueSlot(values[index]);
	}
}

static void decodeTaggedValueVector(const std::vector<TaggedValueSlotState>& slots, const GcHeap& gcHeap, std::vector<Value>& out) {
	out.resize(slots.size());
	for (size_t index = 0; index < slots.size(); ++index) {
		out[index] = decodeTaggedValueSlot(slots[index], gcHeap);
	}
}

static Value readTaggedValueFromHandle(const ObjectHandleTable& handleTable, const GcHeap& gcHeap, uint32_t addr) {
	const TaggedValueSlotState slot{
		handleTable.readU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET),
		handleTable.readU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET),
		handleTable.readU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET),
	};
	return decodeTaggedValueSlot(slot, gcHeap);
}

static uint32_t runtimeObjectAddr(const ObjectHandleTable& handleTable, const GCObject* object) {
	return handleTable.readEntry(object->runtimeRefId).addr;
}

static uint32_t readNativeFunctionBridgeId(const NativeFunction* native) {
	return native->handleTable.readU32(runtimeObjectAddr(native->handleTable, native) + NATIVE_FUNCTION_OBJECT_BRIDGE_ID_OFFSET);
}

static void writeNativeFunctionBridgeId(ObjectHandleTable& handleTable, const NativeFunction* native, uint32_t bridgeId) {
	handleTable.writeU32(runtimeObjectAddr(handleTable, native) + NATIVE_FUNCTION_OBJECT_BRIDGE_ID_OFFSET, bridgeId);
}

static uint32_t readNativeObjectBridgeId(const NativeObject* native) {
	return native->handleTable.readU32(runtimeObjectAddr(native->handleTable, native) + NATIVE_OBJECT_BRIDGE_ID_OFFSET);
}

static void writeNativeObjectBridgeId(ObjectHandleTable& handleTable, const NativeObject* native, uint32_t bridgeId) {
	handleTable.writeU32(runtimeObjectAddr(handleTable, native) + NATIVE_OBJECT_BRIDGE_ID_OFFSET, bridgeId);
}

static uint32_t readNativeObjectMetatableRefId(const NativeObject* native) {
	return native->handleTable.readU32(runtimeObjectAddr(native->handleTable, native) + NATIVE_OBJECT_METATABLE_ID_OFFSET);
}

static void writeNativeObjectMetatableRefId(ObjectHandleTable& handleTable, const NativeObject* native, uint32_t metatableRefId) {
	handleTable.writeU32(runtimeObjectAddr(handleTable, native) + NATIVE_OBJECT_METATABLE_ID_OFFSET, metatableRefId);
}

static int readClosureProtoIndex(const ObjectHandleTable& handleTable, const Closure* closure) {
	return static_cast<int>(handleTable.readU32(runtimeObjectAddr(handleTable, closure) + CLOSURE_OBJECT_PROTO_INDEX_OFFSET));
}

static void writeClosureProtoIndex(ObjectHandleTable& handleTable, const Closure* closure, int protoIndex) {
	handleTable.writeU32(runtimeObjectAddr(handleTable, closure) + CLOSURE_OBJECT_PROTO_INDEX_OFFSET, static_cast<uint32_t>(protoIndex));
}

static uint32_t readClosureUpvalueCount(const ObjectHandleTable& handleTable, const Closure* closure) {
	return handleTable.readU32(runtimeObjectAddr(handleTable, closure) + CLOSURE_OBJECT_UPVALUE_COUNT_OFFSET);
}

static void writeClosureUpvalueCount(ObjectHandleTable& handleTable, const Closure* closure, uint32_t count) {
	handleTable.writeU32(runtimeObjectAddr(handleTable, closure) + CLOSURE_OBJECT_UPVALUE_COUNT_OFFSET, count);
}

static uint32_t readClosureUpvalueRefId(const ObjectHandleTable& handleTable, const Closure* closure, size_t index) {
	return handleTable.readU32(
		runtimeObjectAddr(handleTable, closure) + CLOSURE_OBJECT_UPVALUE_IDS_OFFSET + (static_cast<uint32_t>(index) * 4)
	);
}

static void writeClosureUpvalueRefId(ObjectHandleTable& handleTable, const Closure* closure, size_t index, uint32_t upvalueRefId) {
	handleTable.writeU32(
		runtimeObjectAddr(handleTable, closure) + CLOSURE_OBJECT_UPVALUE_IDS_OFFSET + (static_cast<uint32_t>(index) * 4),
		upvalueRefId
	);
}

static bool readUpvalueIsOpen(const ObjectHandleTable& handleTable, const Upvalue* upvalue) {
	return handleTable.readU32(runtimeObjectAddr(handleTable, upvalue) + UPVALUE_OBJECT_STATE_OFFSET) == UPVALUE_OBJECT_STATE_OPEN;
}

static void writeUpvalueIsOpen(ObjectHandleTable& handleTable, const Upvalue* upvalue, bool open) {
	handleTable.writeU32(
		runtimeObjectAddr(handleTable, upvalue) + UPVALUE_OBJECT_STATE_OFFSET,
		open ? UPVALUE_OBJECT_STATE_OPEN : UPVALUE_OBJECT_STATE_CLOSED
	);
}

static int readUpvalueFrameDepth(const ObjectHandleTable& handleTable, const Upvalue* upvalue) {
	return static_cast<int32_t>(handleTable.readU32(runtimeObjectAddr(handleTable, upvalue) + UPVALUE_OBJECT_FRAME_DEPTH_OFFSET));
}

static void writeUpvalueFrameDepth(ObjectHandleTable& handleTable, const Upvalue* upvalue, int frameDepth) {
	handleTable.writeU32(runtimeObjectAddr(handleTable, upvalue) + UPVALUE_OBJECT_FRAME_DEPTH_OFFSET, static_cast<uint32_t>(frameDepth));
}

static int readUpvalueIndex(const ObjectHandleTable& handleTable, const Upvalue* upvalue) {
	return static_cast<int>(handleTable.readU32(runtimeObjectAddr(handleTable, upvalue) + UPVALUE_OBJECT_REGISTER_INDEX_OFFSET));
}

static void writeUpvalueIndex(ObjectHandleTable& handleTable, const Upvalue* upvalue, int index) {
	handleTable.writeU32(runtimeObjectAddr(handleTable, upvalue) + UPVALUE_OBJECT_REGISTER_INDEX_OFFSET, static_cast<uint32_t>(index));
}

static Value readUpvalueClosedValue(const ObjectHandleTable& handleTable, const GcHeap& gcHeap, const Upvalue* upvalue) {
	return readTaggedValueFromHandle(handleTable, gcHeap, runtimeObjectAddr(handleTable, upvalue) + UPVALUE_OBJECT_CLOSED_VALUE_OFFSET);
}

static void writeUpvalueClosedValue(ObjectHandleTable& handleTable, const Upvalue* upvalue, const Value& value) {
	writeTaggedValueToHandle(handleTable, runtimeObjectAddr(handleTable, upvalue) + UPVALUE_OBJECT_CLOSED_VALUE_OFFSET, value);
}

RuntimeStringPool::RuntimeStringPool(ObjectHandleTable& handleTable, GcHeap& gcHeap)
	: m_handleTable(&handleTable)
	, m_gcHeap(&gcHeap) {
}

StringId RuntimeStringPool::intern(std::string_view value) {
	auto entry = std::make_unique<InternedString>();
	const StringMetadata metadata = analyzeStringMetadata(value);
	const ObjectAllocation allocation = m_gcHeap->allocateHandleObject(
		static_cast<uint32_t>(HeapObjectType::String),
		STRING_OBJECT_HEADER_SIZE + metadata.byteLength);
	const auto* bytes = reinterpret_cast<const u8*>(value.data());
	m_handleTable->writeU32(allocation.addr + STRING_OBJECT_HASH_LO_OFFSET, metadata.hashLo);
	m_handleTable->writeU32(allocation.addr + STRING_OBJECT_HASH_HI_OFFSET, metadata.hashHi);
	m_handleTable->writeU32(allocation.addr + STRING_OBJECT_BYTE_LENGTH_OFFSET, metadata.byteLength);
	m_handleTable->writeU32(allocation.addr + STRING_OBJECT_CODEPOINT_COUNT_OFFSET, static_cast<uint32_t>(metadata.codepointCount));
	m_handleTable->writeBytes(allocation.addr + STRING_OBJECT_DATA_OFFSET, bytes, value.size());
	entry->id = allocation.id;
	entry->value.assign(value.data(), value.size());
	entry->byteLength = metadata.byteLength;
	entry->codepointCount = metadata.codepointCount;
	entry->hashLo = metadata.hashLo;
	entry->hashHi = metadata.hashHi;
	if (allocation.id >= m_entries.size()) {
		m_entries.resize(static_cast<size_t>(allocation.id) + 1);
	}
	m_entries[allocation.id] = std::move(entry);
	if (allocation.id >= m_nextId) {
		m_nextId = allocation.id + 1;
	}
	return allocation.id;
}

Table::Table(GcHeap& gcHeap, ObjectHandleTable& handleTable, const RuntimeStringPool& stringPool, int arraySize, int hashSize)
	: m_gcHeap(gcHeap)
	, m_handleTable(handleTable)
	, m_stringPool(stringPool) {
	const size_t resolvedHashSize = hashSize > 0 ? nextPowerOfTwo(static_cast<size_t>(hashSize)) : 0;
	const ObjectAllocation allocation = m_gcHeap.allocateHandleObject(
		static_cast<uint32_t>(HeapObjectType::Table),
		TABLE_OBJECT_HEADER_SIZE);
	runtimeRefId = allocation.id;
	allocateStoreObjects(static_cast<size_t>(arraySize), resolvedHashSize);
	writeMetatableId(0);
	writeArrayLength(0);
}

Table::~Table() {}

Table* Table::getMetatable() const {
	const uint32_t metatableId = readMetatableId();
	return metatableId == 0 ? nullptr : static_cast<Table*>(m_gcHeap.resolveRuntimeRef(metatableId));
}

void Table::setMetatable(Table* metatable) {
	writeMetatableId(metatable ? metatable->runtimeRefId : 0);
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
	if (index < arrayStoreCapacity()) {
		return !isNil(readArraySlot(index));
	}
	return findNodeIndex(valueNumber(static_cast<double>(index + 1))) >= 0;
}

void Table::updateArrayLengthFrom(size_t startIndex) {
	size_t newLength = startIndex;
	while (hasArrayIndex(newLength)) {
		++newLength;
	}
	writeArrayLength(newLength);
}

void Table::writeTaggedValue(uint32_t addr, const Value& value) {
	writeTaggedValueToHandle(m_handleTable, addr, value);
}

Value Table::readTaggedValue(uint32_t addr) const {
	try {
		return readTaggedValueFromHandle(m_handleTable, m_gcHeap, addr);
	} catch (const std::runtime_error& error) {
		const ObjectHandleEntry arrayStoreEntry = m_handleTable.readEntry(readArrayStoreId());
		const ObjectHandleEntry hashStoreEntry = m_handleTable.readEntry(readHashStoreId());
		throw std::runtime_error(
			std::string(error.what())
			+ " tableId=" + std::to_string(runtimeRefId)
			+ " tableAddr=" + std::to_string(objectAddr())
			+ " arrayLength=" + std::to_string(readArrayLength())
			+ " slotAddr=" + std::to_string(addr)
			+ " arrayStoreId=" + std::to_string(readArrayStoreId())
			+ " arrayStoreAddr=" + std::to_string(arrayStoreEntry.addr)
			+ " arrayStoreType=" + std::to_string(arrayStoreEntry.type)
			+ " arrayStoreSize=" + std::to_string(arrayStoreEntry.sizeBytes)
			+ " arrayStoreCapacity=" + std::to_string(arrayStoreEntry.addr == 0 ? 0 : readArrayStoreCapacity(arrayStoreEntry.addr))
			+ " hashStoreId=" + std::to_string(readHashStoreId())
			+ " hashStoreAddr=" + std::to_string(hashStoreEntry.addr)
			+ " hashStoreType=" + std::to_string(hashStoreEntry.type)
			+ " hashStoreSize=" + std::to_string(hashStoreEntry.sizeBytes)
			+ " hashStoreCapacity=" + std::to_string(hashStoreEntry.addr == 0 ? 0 : readHashStoreCapacity(hashStoreEntry.addr))
			+ "."
		);
	}
}

uint32_t Table::objectAddr() const {
	return m_handleTable.readEntry(runtimeRefId).addr;
}

size_t Table::hashValue(const Value& key) const {
	return ValueHash{ m_stringPool }(key);
}

bool Table::keyEquals(const Value& a, const Value& b) const {
	return ValueEq{ m_stringPool }(a, b);
}

int Table::findNodeIndex(const Value& key) const {
	const uint32_t hashStore = hashStoreAddr();
	const size_t hashCapacity = readHashStoreCapacity(hashStore);
	if (hashCapacity == 0) {
		return -1;
	}
	const size_t mask = hashCapacity - 1;
	int index = static_cast<int>(hashValue(key) & mask);
	while (index >= 0) {
		const Value nodeKey = readHashNodeKeyAt(hashStore, static_cast<size_t>(index));
		if (!isNil(nodeKey) && keyEquals(nodeKey, key)) {
			return index;
		}
		index = readHashNodeNextAt(hashStore, static_cast<size_t>(index));
	}
	return -1;
}

int Table::getFreeIndex() {
	const uint32_t hashStore = hashStoreAddr();
	const size_t hashCapacity = readHashStoreCapacity(hashStore);
	const int freeIndex = readHashStoreFreeIndexAt(hashStore);
	int start = freeIndex >= 0 ? freeIndex : static_cast<int>(hashCapacity) - 1;
	for (int i = start; i >= 0; --i) {
		if (isNil(readHashNodeKeyAt(hashStore, static_cast<size_t>(i)))) {
			writeHashStoreFreeIndexAt(hashStore, i - 1);
			return i;
		}
	}
	writeHashStoreFreeIndexAt(hashStore, -1);
	return -1;
}

void Table::rehash(const Value& key) {
	const uint32_t arrayStore = arrayStoreAddr();
	const uint32_t hashStore = hashStoreAddr();
	const size_t arrayCapacity = readArrayStoreCapacity(arrayStore);
	const size_t hashCapacity = readHashStoreCapacity(hashStore);
	size_t totalKeys = 0;
	std::vector<size_t> counts;

	auto countIntegerKey = [&counts](size_t index) {
		size_t log = ceilLog2(index);
		if (log >= counts.size()) {
			counts.resize(log + 1, 0);
		}
		counts[log] += 1;
	};

	for (size_t index = 0; index < arrayCapacity; ++index) {
		if (!isNil(readArraySlotAt(arrayStore, index))) {
			totalKeys += 1;
			countIntegerKey(index + 1);
		}
	}
	for (size_t index = 0; index < hashCapacity; ++index) {
		const Value nodeKey = readHashNodeKeyAt(hashStore, index);
		if (!isNil(nodeKey)) {
			totalKeys += 1;
			int arrayIndex = 0;
			if (tryGetArrayIndex(nodeKey, arrayIndex)) {
				countIntegerKey(static_cast<size_t>(arrayIndex) + 1);
			}
		}
	}
	if (!isNil(key)) {
		totalKeys += 1;
		int arrayIndex = 0;
		if (tryGetArrayIndex(key, arrayIndex)) {
			countIntegerKey(static_cast<size_t>(arrayIndex) + 1);
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
	struct PinnedHandleScope {
		GcHeap& heap;
		explicit PinnedHandleScope(GcHeap& value)
			: heap(value) {
			heap.beginPinnedHandleScope();
		}
		~PinnedHandleScope() {
			heap.endPinnedHandleScope();
		}
	};
	PinnedHandleScope pinnedHandleScope(m_gcHeap);
	const uint32_t oldArrayStoreId = readArrayStoreId();
	const uint32_t oldHashStoreId = readHashStoreId();
	m_gcHeap.pinHandleRoot(runtimeRefId);
	m_gcHeap.pinHandleRoot(oldArrayStoreId);
	m_gcHeap.pinHandleRoot(oldHashStoreId);
	const size_t oldArrayCapacity = readArrayStoreCapacity(m_handleTable.readEntry(oldArrayStoreId).addr);
	const size_t oldHashCapacity = readHashStoreCapacity(m_handleTable.readEntry(oldHashStoreId).addr);
	const uint32_t metatableId = readMetatableId();
	allocateStoreObjects(newArraySize, newHashSize);
	writeMetatableId(metatableId);
	writeArrayLength(0);
	for (size_t index = 0; index < oldArrayCapacity; ++index) {
		const uint32_t oldArrayStore = m_handleTable.readEntry(oldArrayStoreId).addr;
		const Value value = readArraySlotAt(oldArrayStore, index);
		if (!isNil(value)) {
			rawSet(valueNumber(static_cast<double>(index + 1)), value);
		}
	}
	for (size_t index = 0; index < oldHashCapacity; ++index) {
		const uint32_t oldHashStore = m_handleTable.readEntry(oldHashStoreId).addr;
		const Value key = readHashNodeKeyAt(oldHashStore, index);
		if (!isNil(key)) {
			rawSet(key, readHashNodeValueAt(oldHashStore, index));
		}
	}
}

void Table::allocateStoreObjects(size_t arraySize, size_t hashSize) {
	struct ConstructionScope {
		GcHeap& heap;
		explicit ConstructionScope(GcHeap& value)
			: heap(value) {
			heap.beginConstructionScope();
		}
		~ConstructionScope() {
			heap.endConstructionScope();
		}
	} constructionScope(m_gcHeap);
	const ObjectAllocation arrayStoreAllocation = m_gcHeap.allocateHandleObject(
		static_cast<uint32_t>(HeapObjectType::ArrayStore),
		ARRAY_STORE_OBJECT_DATA_OFFSET + (static_cast<uint32_t>(arraySize) * TAGGED_VALUE_SLOT_SIZE));
	const ObjectAllocation hashStoreAllocation = m_gcHeap.allocateHandleObject(
		static_cast<uint32_t>(HeapObjectType::HashStore),
		HASH_STORE_OBJECT_DATA_OFFSET + (static_cast<uint32_t>(hashSize) * HASH_NODE_SIZE));
	const uint32_t tableAddr = objectAddr();
	const uint32_t arrayStoreAddr = m_handleTable.readEntry(arrayStoreAllocation.id).addr;
	const uint32_t hashStoreAddr = m_handleTable.readEntry(hashStoreAllocation.id).addr;
	m_handleTable.writeU32(tableAddr + TABLE_OBJECT_ARRAY_STORE_ID_OFFSET, arrayStoreAllocation.id);
	m_handleTable.writeU32(tableAddr + TABLE_OBJECT_HASH_STORE_ID_OFFSET, hashStoreAllocation.id);
	m_handleTable.writeU32(arrayStoreAddr + ARRAY_STORE_OBJECT_CAPACITY_OFFSET, static_cast<uint32_t>(arraySize));
	m_handleTable.writeU32(hashStoreAddr + HASH_STORE_OBJECT_CAPACITY_OFFSET, static_cast<uint32_t>(hashSize));
	m_handleTable.writeU32(
		hashStoreAddr + HASH_STORE_OBJECT_FREE_OFFSET,
		static_cast<uint32_t>(hashSize > 0 ? static_cast<int>(hashSize) - 1 : -1)
	);
	for (size_t index = 0; index < arraySize; ++index) {
		clearTaggedValueAt(arraySlotAddrAt(arrayStoreAddr, index));
	}
	for (size_t index = 0; index < hashSize; ++index) {
		clearHashNodeAt(hashStoreAddr, index);
	}
	if (m_handleTable.readU32(arrayStoreAddr + ARRAY_STORE_OBJECT_CAPACITY_OFFSET) != arraySize) {
		throw std::runtime_error(
			"[Table] Array store capacity init mismatch."
			" handleId=" + std::to_string(arrayStoreAllocation.id)
			+ " addr=" + std::to_string(arrayStoreAddr)
			+ " expected=" + std::to_string(arraySize)
			+ " actual=" + std::to_string(m_handleTable.readU32(arrayStoreAddr + ARRAY_STORE_OBJECT_CAPACITY_OFFSET))
			+ "."
		);
	}
	if (m_handleTable.readU32(hashStoreAddr + HASH_STORE_OBJECT_CAPACITY_OFFSET) != hashSize) {
		throw std::runtime_error(
			"[Table] Hash store capacity init mismatch."
			" handleId=" + std::to_string(hashStoreAllocation.id)
			+ " addr=" + std::to_string(hashStoreAddr)
			+ " expected=" + std::to_string(hashSize)
			+ " actual=" + std::to_string(m_handleTable.readU32(hashStoreAddr + HASH_STORE_OBJECT_CAPACITY_OFFSET))
			+ "."
		);
	}
}

void Table::rawSet(const Value& key, const Value& value) {
	int index = 0;
	const bool isArrayKey = tryGetArrayIndex(key, index);
	if (isArrayKey) {
		const size_t idx = static_cast<size_t>(index);
		if (idx < arrayStoreCapacity()) {
			writeArraySlot(idx, value);
			if (isNil(value)) {
				if (idx < readArrayLength()) {
					writeArrayLength(idx);
				}
			} else if (idx == readArrayLength()) {
				updateArrayLengthFrom(readArrayLength());
			}
			return;
		}
	}
	insertHash(key, value);
	if (isArrayKey && static_cast<size_t>(index) == readArrayLength()) {
		updateArrayLengthFrom(readArrayLength());
	}
}

void Table::insertHash(const Value& key, const Value& value) {
	const uint32_t hashStore = hashStoreAddr();
	const size_t hashCapacity = readHashStoreCapacity(hashStore);
	if (hashCapacity == 0) {
		rehash(key);
		rawSet(key, value);
		return;
	}
	const size_t mask = hashCapacity - 1;
	const int mainIndex = static_cast<int>(hashValue(key) & mask);
	const Value mainNodeKey = readHashNodeKeyAt(hashStore, static_cast<size_t>(mainIndex));
	if (isNil(mainNodeKey)) {
		writeHashNodeAt(hashStore, static_cast<size_t>(mainIndex), key, value, -1);
		return;
	}
	const int freeIndex = getFreeIndex();
	if (freeIndex < 0) {
		rehash(key);
		rawSet(key, value);
		return;
	}
	const Value mainNodeValue = readHashNodeValueAt(hashStore, static_cast<size_t>(mainIndex));
	const int mainNodeNext = readHashNodeNextAt(hashStore, static_cast<size_t>(mainIndex));
	const int mainIndexOfOccupied = static_cast<int>(hashValue(mainNodeKey) & mask);
	if (mainIndexOfOccupied != mainIndex) {
		writeHashNodeAt(hashStore, static_cast<size_t>(freeIndex), mainNodeKey, mainNodeValue, mainNodeNext);
		int prev = mainIndexOfOccupied;
		while (readHashNodeNextAt(hashStore, static_cast<size_t>(prev)) != mainIndex) {
			prev = readHashNodeNextAt(hashStore, static_cast<size_t>(prev));
		}
		writeHashNodeNextAt(hashStore, static_cast<size_t>(prev), freeIndex);
		writeHashNodeAt(hashStore, static_cast<size_t>(mainIndex), key, value, -1);
		return;
	}
	writeHashNodeAt(hashStore, static_cast<size_t>(freeIndex), key, value, mainNodeNext);
	writeHashNodeNextAt(hashStore, static_cast<size_t>(mainIndex), freeIndex);
}

void Table::removeFromHash(const Value& key) {
	const uint32_t hashStore = hashStoreAddr();
	const size_t hashCapacity = readHashStoreCapacity(hashStore);
	if (hashCapacity == 0) {
		return;
	}
	const size_t mask = hashCapacity - 1;
	const int mainIndex = static_cast<int>(hashValue(key) & mask);
	int prev = -1;
	int index = mainIndex;
	while (index >= 0) {
		const Value nodeKey = readHashNodeKeyAt(hashStore, static_cast<size_t>(index));
		if (!isNil(nodeKey) && keyEquals(nodeKey, key)) {
			const int next = readHashNodeNextAt(hashStore, static_cast<size_t>(index));
			if (prev >= 0) {
				writeHashNodeNextAt(hashStore, static_cast<size_t>(prev), next);
				clearHashNodeAt(hashStore, static_cast<size_t>(index));
				if (index > readHashStoreFreeIndexAt(hashStore)) {
					writeHashStoreFreeIndexAt(hashStore, index);
				}
				return;
			}
			if (next >= 0) {
				writeHashNodeAt(
					hashStore,
					static_cast<size_t>(index),
					readHashNodeKeyAt(hashStore, static_cast<size_t>(next)),
					readHashNodeValueAt(hashStore, static_cast<size_t>(next)),
					readHashNodeNextAt(hashStore, static_cast<size_t>(next))
				);
				clearHashNodeAt(hashStore, static_cast<size_t>(next));
				if (next > readHashStoreFreeIndexAt(hashStore)) {
					writeHashStoreFreeIndexAt(hashStore, next);
				}
				return;
			}
			clearHashNodeAt(hashStore, static_cast<size_t>(index));
			if (index > readHashStoreFreeIndexAt(hashStore)) {
				writeHashStoreFreeIndexAt(hashStore, index);
			}
			return;
		}
		prev = index;
		index = readHashNodeNextAt(hashStore, static_cast<size_t>(index));
	}
}

Value Table::get(const Value& key) const {
	if (isNil(key)) {
		throw BMSX_RUNTIME_ERROR("Table index is nil.");
	}
	int index = 0;
	if (tryGetArrayIndex(key, index)) {
		if (index < static_cast<int>(arrayStoreCapacity())) {
			return readArraySlot(static_cast<size_t>(index));
		}
	}

	int nodeIndex = findNodeIndex(key);
	if (nodeIndex >= 0) {
		return readHashNodeValue(static_cast<size_t>(nodeIndex));
	}
	return valueNil();
}

void Table::set(const Value& key, const Value& value) {
	if (isNil(key)) {
		throw BMSX_RUNTIME_ERROR("Table index is nil.");
	}
	struct PinnedValueScope {
		GcHeap& heap;
		explicit PinnedValueScope(GcHeap& value)
			: heap(value) {
			heap.beginPinnedValueScope();
		}
		~PinnedValueScope() {
			heap.endPinnedValueScope();
		}
	} pinnedValueScope(m_gcHeap);
	m_gcHeap.pinValueRoot(key);
	m_gcHeap.pinValueRoot(value);
	int index = 0;
	const bool isArrayKey = tryGetArrayIndex(key, index);
	if (isArrayKey) {
		const size_t idx = static_cast<size_t>(index);
		if (idx < arrayStoreCapacity()) {
			writeArraySlot(idx, value);
			if (isNil(value)) {
				if (idx < readArrayLength()) {
					writeArrayLength(idx);
				}
				return;
			}
			if (idx == readArrayLength()) {
				updateArrayLengthFrom(readArrayLength());
			}
			return;
		}
		if (isNil(value)) {
			removeFromHash(key);
			if (idx < readArrayLength()) {
				writeArrayLength(idx);
			}
			return;
		}
	}
	if (isNil(value)) {
		removeFromHash(key);
		return;
	}
	const int nodeIndex = findNodeIndex(key);
	if (nodeIndex >= 0) {
		writeHashNode(static_cast<size_t>(nodeIndex), key, value, readHashNodeNext(static_cast<size_t>(nodeIndex)));
		return;
	}
	if (hashStoreCapacity() == 0 || hashStoreFreeIndex() < 0) {
		rehash(key);
	}
	rawSet(key, value);
}

int Table::length() const {
	return static_cast<int>(readArrayLength());
}

void Table::clear() {
	const uint32_t metatableId = readMetatableId();
	allocateStoreObjects(0, 0);
	writeMetatableId(metatableId);
	writeArrayLength(0);
}

std::vector<std::pair<Value, Value>> Table::entries() const {
	std::vector<std::pair<Value, Value>> result;
	forEachEntry([&result](Value key, Value value) {
		result.emplace_back(key, value);
	});
	return result;
}

std::optional<std::pair<Value, Value>> Table::nextEntry(const Value& after) const {
	const size_t arrayCapacity = arrayStoreCapacity();
	const size_t hashCapacity = hashStoreCapacity();
	if (isNil(after)) {
		for (size_t index = 0; index < arrayCapacity; ++index) {
			const Value value = readArraySlot(index);
			if (!isNil(value)) {
				return std::make_pair(valueNumber(static_cast<double>(index + 1)), value);
			}
		}
		for (size_t index = 0; index < hashCapacity; ++index) {
			const Value key = readHashNodeKey(index);
			if (!isNil(key)) {
				return std::make_pair(key, readHashNodeValue(index));
			}
		}
		return std::nullopt;
	}
	int index = 0;
	if (tryGetArrayIndex(after, index)) {
		if (index < static_cast<int>(arrayCapacity)) {
			if (isNil(readArraySlot(static_cast<size_t>(index)))) {
				return std::nullopt;
			}
			for (size_t cursor = static_cast<size_t>(index + 1); cursor < arrayCapacity; ++cursor) {
				const Value value = readArraySlot(cursor);
				if (!isNil(value)) {
					return std::make_pair(valueNumber(static_cast<double>(cursor + 1)), value);
				}
			}
			for (size_t cursor = 0; cursor < hashCapacity; ++cursor) {
				const Value key = readHashNodeKey(cursor);
				if (!isNil(key)) {
					return std::make_pair(key, readHashNodeValue(cursor));
				}
			}
			return std::nullopt;
		}
	}
	int nodeIndex = findNodeIndex(after);
	if (nodeIndex < 0) {
		return std::nullopt;
	}
	for (size_t indexAfter = static_cast<size_t>(nodeIndex + 1); indexAfter < hashCapacity; ++indexAfter) {
		const Value key = readHashNodeKey(indexAfter);
		if (!isNil(key)) {
			return std::make_pair(key, readHashNodeValue(indexAfter));
		}
	}
	return std::nullopt;
}

uint32_t Table::readMetatableId() const {
	return m_handleTable.readU32(objectAddr() + TABLE_OBJECT_METATABLE_ID_OFFSET);
}

void Table::writeMetatableId(uint32_t metatableId) {
	m_handleTable.writeU32(objectAddr() + TABLE_OBJECT_METATABLE_ID_OFFSET, metatableId);
}

uint32_t Table::readArrayStoreId() const {
	return m_handleTable.readU32(objectAddr() + TABLE_OBJECT_ARRAY_STORE_ID_OFFSET);
}

uint32_t Table::readHashStoreId() const {
	return m_handleTable.readU32(objectAddr() + TABLE_OBJECT_HASH_STORE_ID_OFFSET);
}

size_t Table::readArrayLength() const {
	return static_cast<size_t>(m_handleTable.readU32(objectAddr() + TABLE_OBJECT_ARRAY_LENGTH_OFFSET));
}

void Table::writeArrayLength(size_t length) {
	m_handleTable.writeU32(objectAddr() + TABLE_OBJECT_ARRAY_LENGTH_OFFSET, static_cast<uint32_t>(length));
}

uint32_t Table::arrayStoreAddr() const {
	return m_handleTable.readEntry(readArrayStoreId()).addr;
}

uint32_t Table::hashStoreAddr() const {
	return m_handleTable.readEntry(readHashStoreId()).addr;
}

size_t Table::arrayStoreCapacity() const {
	return readArrayStoreCapacity(arrayStoreAddr());
}

size_t Table::readArrayStoreCapacity(uint32_t arrayStoreAddrValue) const {
	return static_cast<size_t>(m_handleTable.readU32(arrayStoreAddrValue + ARRAY_STORE_OBJECT_CAPACITY_OFFSET));
}

size_t Table::hashStoreCapacity() const {
	return readHashStoreCapacity(hashStoreAddr());
}

size_t Table::readHashStoreCapacity(uint32_t hashStoreAddrValue) const {
	return static_cast<size_t>(m_handleTable.readU32(hashStoreAddrValue + HASH_STORE_OBJECT_CAPACITY_OFFSET));
}

int Table::hashStoreFreeIndex() const {
	return readHashStoreFreeIndexAt(hashStoreAddr());
}

int Table::readHashStoreFreeIndexAt(uint32_t hashStoreAddrValue) const {
	return static_cast<int32_t>(m_handleTable.readU32(hashStoreAddrValue + HASH_STORE_OBJECT_FREE_OFFSET));
}

void Table::writeHashStoreFreeIndexAt(uint32_t hashStoreAddrValue, int freeIndex) {
	m_handleTable.writeU32(hashStoreAddrValue + HASH_STORE_OBJECT_FREE_OFFSET, static_cast<uint32_t>(freeIndex));
}

uint32_t Table::arraySlotAddr(size_t index) const {
	return arraySlotAddrAt(arrayStoreAddr(), index);
}

uint32_t Table::arraySlotAddrAt(uint32_t arrayStoreAddrValue, size_t index) const {
	return arrayStoreAddrValue + ARRAY_STORE_OBJECT_DATA_OFFSET + (static_cast<uint32_t>(index) * TAGGED_VALUE_SLOT_SIZE);
}

Value Table::readArraySlot(size_t index) const {
	return readArraySlotAt(arrayStoreAddr(), index);
}

Value Table::readArraySlotAt(uint32_t arrayStoreAddrValue, size_t index) const {
	return readTaggedValue(arraySlotAddrAt(arrayStoreAddrValue, index));
}

void Table::writeArraySlot(size_t index, const Value& value) {
	writeTaggedValue(arraySlotAddr(index), value);
}

uint32_t Table::hashNodeAddrAt(uint32_t hashStoreAddrValue, size_t index) const {
	return hashStoreAddrValue + HASH_STORE_OBJECT_DATA_OFFSET + (static_cast<uint32_t>(index) * HASH_NODE_SIZE);
}

Value Table::readHashNodeKey(size_t index) const {
	return readHashNodeKeyAt(hashStoreAddr(), index);
}

Value Table::readHashNodeKeyAt(uint32_t hashStoreAddrValue, size_t index) const {
	return readTaggedValue(hashNodeAddrAt(hashStoreAddrValue, index) + HASH_NODE_KEY_OFFSET);
}

Value Table::readHashNodeValue(size_t index) const {
	return readHashNodeValueAt(hashStoreAddr(), index);
}

Value Table::readHashNodeValueAt(uint32_t hashStoreAddrValue, size_t index) const {
	return readTaggedValue(hashNodeAddrAt(hashStoreAddrValue, index) + HASH_NODE_VALUE_OFFSET);
}

int Table::readHashNodeNext(size_t index) const {
	return readHashNodeNextAt(hashStoreAddr(), index);
}

int Table::readHashNodeNextAt(uint32_t hashStoreAddrValue, size_t index) const {
	return static_cast<int32_t>(m_handleTable.readU32(hashNodeAddrAt(hashStoreAddrValue, index) + HASH_NODE_NEXT_OFFSET));
}

void Table::writeHashNode(size_t index, const Value& key, const Value& value, int next) {
	writeHashNodeAt(hashStoreAddr(), index, key, value, next);
}

void Table::writeHashNodeAt(uint32_t hashStoreAddrValue, size_t index, const Value& key, const Value& value, int next) {
	const uint32_t nodeAddr = hashNodeAddrAt(hashStoreAddrValue, index);
	writeTaggedValue(nodeAddr + HASH_NODE_KEY_OFFSET, key);
	writeTaggedValue(nodeAddr + HASH_NODE_VALUE_OFFSET, value);
	m_handleTable.writeU32(nodeAddr + HASH_NODE_NEXT_OFFSET, static_cast<uint32_t>(next));
}

void Table::writeHashNodeNextAt(uint32_t hashStoreAddrValue, size_t index, int next) {
	m_handleTable.writeU32(hashNodeAddrAt(hashStoreAddrValue, index) + HASH_NODE_NEXT_OFFSET, static_cast<uint32_t>(next));
}

void Table::clearTaggedValueAt(uint32_t addr) {
	m_handleTable.writeU32(addr + TAGGED_VALUE_SLOT_TAG_OFFSET, static_cast<uint32_t>(TaggedValueTag::Nil));
	m_handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET, 0);
	m_handleTable.writeU32(addr + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET, 0);
}

void Table::clearHashNodeAt(uint32_t hashStoreAddrValue, size_t index) {
	const uint32_t nodeAddr = hashNodeAddrAt(hashStoreAddrValue, index);
	clearTaggedValueAt(nodeAddr + HASH_NODE_KEY_OFFSET);
	clearTaggedValueAt(nodeAddr + HASH_NODE_VALUE_OFFSET);
	m_handleTable.writeU32(nodeAddr + HASH_NODE_NEXT_OFFSET, static_cast<uint32_t>(-1));
}

ObjectAllocation GcHeap::allocateHandleObject(uint32_t type, uint32_t ramSizeBytes, uint32_t flags) {
	try {
		const ObjectAllocation allocation = m_handleTable.allocateObject(type, ramSizeBytes, flags);
		pinConstructionHandle(allocation.id);
		if (m_handleTable.usedHeapBytes() > m_nextGCHeapBytes) {
			m_collectRequested = true;
		}
		return allocation;
	} catch (const std::runtime_error&) {
		m_collectRequested = true;
		collect();
		try {
			const ObjectAllocation allocation = m_handleTable.allocateObject(type, ramSizeBytes, flags);
			pinConstructionHandle(allocation.id);
			if (m_handleTable.usedHeapBytes() > m_nextGCHeapBytes) {
				m_collectRequested = true;
			}
			return allocation;
		} catch (const std::runtime_error&) {
			throw BMSX_RUNTIME_ERROR("out of RAM");
		}
	}
}

void GcHeap::beginConstructionScope() {
	m_constructionScopeOffsets.push_back(m_constructionHandleIds.size());
}

void GcHeap::endConstructionScope() {
	const size_t offset = m_constructionScopeOffsets.back();
	m_constructionScopeOffsets.pop_back();
	m_constructionHandleIds.resize(offset);
}

void GcHeap::pinConstructionHandle(uint32_t handleId) {
	if (m_constructionScopeOffsets.empty() || handleId == 0) {
		return;
	}
	m_constructionHandleIds.push_back(handleId);
}

void GcHeap::beginPinnedHandleScope() {
	m_pinnedHandleScopeOffsets.push_back(m_pinnedHandleIds.size());
}

void GcHeap::endPinnedHandleScope() {
	const size_t offset = m_pinnedHandleScopeOffsets.back();
	m_pinnedHandleScopeOffsets.pop_back();
	m_pinnedHandleIds.resize(offset);
}

void GcHeap::pinHandleRoot(uint32_t handleId) {
	if (m_pinnedHandleScopeOffsets.empty() || handleId == 0) {
		return;
	}
	m_pinnedHandleIds.push_back(handleId);
}

void GcHeap::beginPinnedValueScope() {
	m_pinnedValueScopeOffsets.push_back(m_pinnedValues.size());
}

void GcHeap::endPinnedValueScope() {
	const size_t offset = m_pinnedValueScopeOffsets.back();
	m_pinnedValueScopeOffsets.pop_back();
	m_pinnedValues.resize(offset);
}

void GcHeap::pinValueRoot(Value value) {
	if (m_pinnedValueScopeOffsets.empty()) {
		return;
	}
	m_pinnedValues.push_back(value);
}

void GcHeap::markValue(Value v) {
	if (!valueIsTagged(v)) {
		return;
	}
	switch (valueTag(v)) {
		case ValueTag::String:
			markHandle(asStringId(v));
			break;
		case ValueTag::Table:
			markObject(static_cast<Table*>(resolveRuntimeRef(static_cast<uint32_t>(valuePayload(v)))));
			break;
		case ValueTag::Closure:
			markObject(static_cast<Closure*>(resolveRuntimeRef(static_cast<uint32_t>(valuePayload(v)))));
			break;
		case ValueTag::NativeFunction:
			markObject(static_cast<NativeFunction*>(resolveRuntimeRef(static_cast<uint32_t>(valuePayload(v)))));
			break;
		case ValueTag::NativeObject:
			markObject(static_cast<NativeObject*>(resolveRuntimeRef(static_cast<uint32_t>(valuePayload(v)))));
			break;
		case ValueTag::Upvalue:
			markObject(static_cast<Upvalue*>(resolveRuntimeRef(static_cast<uint32_t>(valuePayload(v)))));
			break;
		default:
			break;
	}
}

void GcHeap::markHandle(uint32_t handleId) {
	if (handleId == 0) {
		return;
	}
	if (m_liveHandleSet.insert(handleId).second) {
		m_liveHandleIds.push_back(handleId);
	}
}

void GcHeap::markObject(GCObject* obj) {
	if (!obj) {
		return;
	}
	if (m_liveHandleSet.insert(obj->runtimeRefId).second) {
		m_liveHandleIds.push_back(obj->runtimeRefId);
	}
	if (m_tracedObjectSet.insert(obj->runtimeRefId).second) {
		m_grayStack.push_back(obj);
	}
}

GCObject* GcHeap::resolveRuntimeRef(uint32_t runtimeRefId) const {
	return resolveRuntimeObjectRef(m_handleTable, runtimeRefId);
}

void GcHeap::trace() {
	while (!m_grayStack.empty()) {
		GCObject* obj = m_grayStack.back();
		m_grayStack.pop_back();
		switch (obj->type) {
			case ObjType::Table: {
				auto* table = static_cast<Table*>(obj);
				const uint32_t tableAddr = runtimeObjectAddr(m_handleTable, table);
				markHandle(m_handleTable.readU32(tableAddr + TABLE_OBJECT_ARRAY_STORE_ID_OFFSET));
				markHandle(m_handleTable.readU32(tableAddr + TABLE_OBJECT_HASH_STORE_ID_OFFSET));
				if (table->getMetatable()) {
					markObject(table->getMetatable());
				}
				try {
					table->forEachEntry([this](Value key, Value value) {
						markValue(key);
						markValue(value);
					});
				} catch (const std::runtime_error& error) {
					throw std::runtime_error(
						std::string(error.what())
						+ " tableId=" + std::to_string(table->runtimeRefId)
						+ " tableAddr=" + std::to_string(tableAddr)
						+ " arrayStoreId=" + std::to_string(m_handleTable.readU32(tableAddr + TABLE_OBJECT_ARRAY_STORE_ID_OFFSET))
						+ " hashStoreId=" + std::to_string(m_handleTable.readU32(tableAddr + TABLE_OBJECT_HASH_STORE_ID_OFFSET))
						+ "."
					);
				}
				break;
			}
			case ObjType::Closure: {
				auto* closure = static_cast<Closure*>(obj);
				const uint32_t upvalueCount = readClosureUpvalueCount(m_handleTable, closure);
				for (uint32_t index = 0; index < upvalueCount; ++index) {
					markObject(static_cast<Upvalue*>(resolveRuntimeRef(readClosureUpvalueRefId(m_handleTable, closure, index))));
				}
				break;
			}
			case ObjType::NativeFunction: {
				const auto& bridge = resolveNativeFunctionBridge(m_handleTable, readNativeFunctionBridgeId(static_cast<NativeFunction*>(obj)));
				if (bridge.mark) {
					bridge.mark(*this);
				}
				break;
			}
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
				if (!readUpvalueIsOpen(m_handleTable, upvalue)) {
					markValue(readUpvalueClosedValue(m_handleTable, *this, upvalue));
				}
				break;
			}
		}
	}
}

void GcHeap::compactObjectMemory() {
	m_handleTable.compact(m_liveHandleIds);
	for (uint32_t handleId : m_liveHandleIds) {
		const ObjectHandleEntry entry = m_handleTable.readEntry(handleId);
		if (entry.type == static_cast<uint32_t>(HeapObjectType::ArrayStore)) {
			const uint32_t heapType = m_handleTable.readU32(entry.addr);
			const uint32_t heapSize = m_handleTable.readU32(entry.addr + 8);
			if (heapType != entry.type || heapSize != entry.sizeBytes) {
				throw std::runtime_error(
					"[GC] Array store entry/header mismatch after compaction."
					" handleId=" + std::to_string(handleId)
					+ " addr=" + std::to_string(entry.addr)
					+ " entryType=" + std::to_string(entry.type)
					+ " heapType=" + std::to_string(heapType)
					+ " entrySize=" + std::to_string(entry.sizeBytes)
					+ " heapSize=" + std::to_string(heapSize)
					+ "."
				);
			}
			const uint32_t capacity = m_handleTable.readU32(entry.addr + ARRAY_STORE_OBJECT_CAPACITY_OFFSET);
			const uint32_t maxCapacity = entry.sizeBytes <= ARRAY_STORE_OBJECT_HEADER_SIZE
				? 0
				: (entry.sizeBytes - ARRAY_STORE_OBJECT_HEADER_SIZE) / TAGGED_VALUE_SLOT_SIZE;
			if (capacity > maxCapacity) {
				throw std::runtime_error(
					"[GC] Invalid array store after compaction."
					" handleId=" + std::to_string(handleId)
					+ " addr=" + std::to_string(entry.addr)
					+ " sizeBytes=" + std::to_string(entry.sizeBytes)
					+ " capacity=" + std::to_string(capacity)
					+ " maxCapacity=" + std::to_string(maxCapacity)
					+ "."
				);
			}
			continue;
		}
		if (entry.type == static_cast<uint32_t>(HeapObjectType::HashStore)) {
			const uint32_t heapType = m_handleTable.readU32(entry.addr);
			const uint32_t heapSize = m_handleTable.readU32(entry.addr + 8);
			if (heapType != entry.type || heapSize != entry.sizeBytes) {
				throw std::runtime_error(
					"[GC] Hash store entry/header mismatch after compaction."
					" handleId=" + std::to_string(handleId)
					+ " addr=" + std::to_string(entry.addr)
					+ " entryType=" + std::to_string(entry.type)
					+ " heapType=" + std::to_string(heapType)
					+ " entrySize=" + std::to_string(entry.sizeBytes)
					+ " heapSize=" + std::to_string(heapSize)
					+ "."
				);
			}
			const uint32_t capacity = m_handleTable.readU32(entry.addr + HASH_STORE_OBJECT_CAPACITY_OFFSET);
			const uint32_t maxCapacity = entry.sizeBytes <= HASH_STORE_OBJECT_HEADER_SIZE
				? 0
				: (entry.sizeBytes - HASH_STORE_OBJECT_HEADER_SIZE) / HASH_NODE_SIZE;
			if (capacity > maxCapacity) {
				throw std::runtime_error(
					"[GC] Invalid hash store after compaction."
					" handleId=" + std::to_string(handleId)
					+ " addr=" + std::to_string(entry.addr)
					+ " sizeBytes=" + std::to_string(entry.sizeBytes)
					+ " capacity=" + std::to_string(capacity)
					+ " maxCapacity=" + std::to_string(maxCapacity)
					+ "."
				);
			}
		}
	}
	m_liveHandleIds.clear();
	m_liveHandleSet.clear();
	m_tracedObjectSet.clear();
}

void GcHeap::sweep() {
	std::vector<GCObject*> deadObjects;
	for (const auto& entry : getRuntimeObjectRegistry(m_handleTable)) {
		if (m_liveHandleSet.count(entry.first) == 0) {
			deadObjects.push_back(entry.second);
		}
	}
	for (GCObject* obj : deadObjects) {
		destroyObject(obj);
	}
}

GcHeap::~GcHeap() {
	std::vector<GCObject*> objects;
	objects.reserve(getRuntimeObjectRegistry(m_handleTable).size());
	for (const auto& entry : getRuntimeObjectRegistry(m_handleTable)) {
		objects.push_back(entry.second);
	}
	for (GCObject* obj : objects) {
		destroyObject(obj);
	}
	m_grayStack.clear();
}

void GcHeap::destroyObject(GCObject* obj) {
	unregisterRuntimeObjectRef(m_handleTable, obj->runtimeRefId);
	switch (obj->type) {
		case ObjType::Table:
			delete static_cast<Table*>(obj);
			break;
		case ObjType::Closure:
			delete static_cast<Closure*>(obj);
			break;
		case ObjType::NativeFunction:
			nativeFunctionBridgeRegistry(m_handleTable).erase(readNativeFunctionBridgeId(static_cast<NativeFunction*>(obj)));
			if (nativeFunctionBridgeRegistry(m_handleTable).empty()) {
				nativeFunctionBridgeRegistries().erase(&m_handleTable);
			}
			delete static_cast<NativeFunction*>(obj);
			break;
		case ObjType::NativeObject:
			nativeObjectBridgeRegistry(m_handleTable).erase(readNativeObjectBridgeId(static_cast<NativeObject*>(obj)));
			if (nativeObjectBridgeRegistry(m_handleTable).empty()) {
				nativeObjectBridgeRegistries().erase(&m_handleTable);
			}
			delete static_cast<NativeObject*>(obj);
			break;
		case ObjType::Upvalue:
			delete static_cast<Upvalue*>(obj);
			break;
	}
}

void GcHeap::collect() {
	if (!m_collectRequested) {
		return;
	}
	m_collectRequested = false;
	m_liveHandleIds.clear();
	m_liveHandleSet.clear();
	m_tracedObjectSet.clear();
	m_grayStack.clear();
	if (m_rootMarker) {
		m_rootMarker(*this);
	}
	for (uint32_t handleId : m_constructionHandleIds) {
		markHandle(handleId);
	}
	for (uint32_t handleId : m_pinnedHandleIds) {
		markHandle(handleId);
	}
	for (Value value : m_pinnedValues) {
		markValue(value);
	}
	for (const auto& entry : getRuntimeObjectRegistry(m_handleTable)) {
		if (m_liveHandleSet.count(entry.first) == 0) {
			continue;
		}
		if (m_tracedObjectSet.insert(entry.first).second) {
			m_grayStack.push_back(entry.second);
		}
	}
	trace();
	sweep();
	compactObjectMemory();
	m_nextGCHeapBytes = std::max<size_t>(1024 * 1024, static_cast<size_t>(m_handleTable.usedHeapBytes()) * 2);
}

CPU::CPU(Memory& memory, ObjectHandleTable& handleTable)
	: m_memory(memory)
	, m_handleTable(handleTable)
	, m_heap(handleTable)
	, m_stringPool(handleTable, m_heap) {
	m_heap.setRootMarker([this](GcHeap& heap) { markRoots(heap); });
	m_externalRootMarker = [](GcHeap&) {};
	globals = m_heap.allocate<Table>(ObjType::Table, m_heap, m_handleTable, m_stringPool, 0, 0);
	m_indexKey = valueString(m_stringPool.intern("__index"));
}

Value CPU::createNativeFunction(std::string_view name, NativeFunctionInvoke fn, NativeBridgeMark mark) {
	auto* native = m_heap.allocateWithRamSize<NativeFunction>(
		ObjType::NativeFunction,
		NATIVE_FUNCTION_OBJECT_HEADER_SIZE,
		m_handleTable
	);
	const uint32_t bridgeId = allocateNativeFunctionBridgeId(m_handleTable);
	nativeFunctionBridgeRegistry(m_handleTable)[bridgeId] = NativeFunctionBridge{
		std::string(name),
		20,
		2,
		1,
		[invoke = std::move(fn)](const std::vector<Value>& args, std::vector<Value>& out) {
		out.clear();
		invoke(args, out);
		},
		std::move(mark),
	};
	writeNativeFunctionBridgeId(m_handleTable, native, bridgeId);
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
	auto* native = m_heap.allocateWithRamSize<NativeObject>(
		ObjType::NativeObject,
		NATIVE_OBJECT_HEADER_SIZE,
		m_handleTable
	);
	const uint32_t bridgeId = allocateNativeObjectBridgeId(m_handleTable);
	nativeObjectBridgeRegistry(m_handleTable)[bridgeId] = NativeObjectBridge{
		raw,
		std::move(get),
		std::move(set),
		std::move(len),
		std::move(nextEntry),
		std::move(mark),
	};
	writeNativeObjectBridgeId(m_handleTable, native, bridgeId);
	writeNativeObjectMetatableRefId(m_handleTable, native, 0);
	return valueNativeObject(native);
}

void CPU::setNativeObjectMetatable(NativeObject* native, Table* metatable) {
	native->setMetatable(metatable);
}

Table* CPU::createTable(int arraySize, int hashSize) {
	return m_heap.allocate<Table>(ObjType::Table, m_heap, m_handleTable, m_stringPool, arraySize, hashSize);
}

Closure* CPU::createRootClosure(int protoIndex) {
	auto* closure = m_heap.allocateWithRamSize<Closure>(ObjType::Closure, CLOSURE_OBJECT_HEADER_SIZE);
	writeClosureProtoIndex(m_handleTable, closure, protoIndex);
	writeClosureUpvalueCount(m_handleTable, closure, 0);
	return closure;
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

TaggedValueSlotState CPU::encodeTaggedValueState(const Value& value) const {
	return encodeTaggedValueSlot(value);
}

Value CPU::decodeTaggedValueState(const TaggedValueSlotState& slot) const {
	return decodeTaggedValueSlot(slot, m_heap);
}

CpuRuntimeState CPU::captureRuntimeState() const {
	CpuRuntimeState state;
	state.frames.resize(m_frames.size());
	for (size_t frameIndex = 0; frameIndex < m_frames.size(); ++frameIndex) {
		const CallFrame& frame = *m_frames[frameIndex];
		CpuRuntimeFrameState& frameState = state.frames[frameIndex];
		frameState.protoIndex = frame.protoIndex;
		frameState.pc = frame.pc;
		frameState.depth = frame.depth;
		frameState.registers.assign(frame.registers.begin(), frame.registers.begin() + frame.top);
		frameState.varargs = frame.varargs;
		frameState.closureObjectRefId = frame.closure->runtimeRefId;
		frameState.openUpvalues.reserve(frame.openUpvalues.size());
		for (const auto& [registerIndex, upvalue] : frame.openUpvalues) {
			frameState.openUpvalues.push_back({ registerIndex, upvalue->runtimeRefId });
		}
		frameState.returnBase = frame.returnBase;
		frameState.returnCount = frame.returnCount;
		frameState.top = frame.top;
		frameState.captureReturns = frame.captureReturns;
		frameState.callSitePc = frame.callSitePc;
	}
	state.lastReturnValues = lastReturnValues;
	state.lastPc = lastPc;
	state.lastInstruction = lastInstruction;
	state.stringIndexTableObjectRefId = m_stringIndexTable ? m_stringIndexTable->runtimeRefId : 0;
	return state;
}

void CPU::restoreObjectMemoryState(const ObjectHandleTableState& state) {
	m_handleTable.restoreState(state);
	m_stringPool.clearRuntimeCache();
}

void CPU::restoreRuntimeState(const CpuRuntimeState& state) {
	unwindToDepth(0);
	m_frames.clear();
	lastReturnValues = state.lastReturnValues;
	lastPc = state.lastPc;
	lastInstruction = state.lastInstruction;
	m_stringIndexTable = state.stringIndexTableObjectRefId == 0
		? nullptr
		: static_cast<Table*>(m_heap.resolveRuntimeRef(state.stringIndexTableObjectRefId));
	for (const CpuRuntimeFrameState& frameState : state.frames) {
		const Proto& proto = m_program->protos[static_cast<size_t>(frameState.protoIndex)];
		auto frame = acquireFrame();
		frame->protoIndex = frameState.protoIndex;
		frame->pc = frameState.pc;
		frame->depth = frameState.depth;
		frame->closure = static_cast<Closure*>(m_heap.resolveRuntimeRef(frameState.closureObjectRefId));
		const size_t registerCount = std::max(
			{ static_cast<size_t>(proto.maxStack), static_cast<size_t>(frameState.top), frameState.registers.size() });
		frame->registers = acquireRegisters(registerCount);
		std::copy(frameState.registers.begin(), frameState.registers.end(), frame->registers.begin());
		frame->varargs = frameState.varargs;
		frame->openUpvalues.clear();
		for (const RuntimeOpenUpvalueState& upvalueState : frameState.openUpvalues) {
			frame->openUpvalues[upvalueState.index] = static_cast<Upvalue*>(m_heap.resolveRuntimeRef(upvalueState.objectRefId));
		}
		frame->returnBase = frameState.returnBase;
		frame->returnCount = frameState.returnCount;
		frame->top = frameState.top;
		frame->captureReturns = frameState.captureReturns;
		frame->callSitePc = frameState.callSitePc;
		m_frames.push_back(std::move(frame));
	}
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
	pushFrame(closure, args, 0, returnCount, false, m_program->protos[readClosureProtoIndex(m_handleTable, closure)].entryPC);
}

void CPU::callExternal(Closure* closure, const std::vector<Value>& args) {
	if (!closure) {
		throw BMSX_RUNTIME_ERROR("Attempted to call a nil value.");
	}
	pushFrame(closure, args, 0, 0, true, m_program->protos[readClosureProtoIndex(m_handleTable, closure)].entryPC);
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
		m_stringPool.clearRuntimeCache();
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
	return decodeTaggedValueSlot(frame.registers[static_cast<size_t>(registerIndex)], m_heap);
}

std::vector<Value> CPU::copyLastReturnValues() const {
	std::vector<Value> out;
	decodeTaggedValueVector(lastReturnValues, m_heap, out);
	return out;
}

Value CPU::readRegister(const CallFrame& frame, int index) const {
	return decodeTaggedValueSlot(frame.registers[static_cast<size_t>(index)], m_heap);
}

Value CPU::readVararg(const CallFrame& frame, int index) const {
	return decodeTaggedValueSlot(frame.varargs[static_cast<size_t>(index)], m_heap);
}

void CPU::setLastReturnValues(const std::vector<Value>& values) {
	encodeTaggedValueVector(values, lastReturnValues);
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
			setRegister(frame, a, readRegister(frame, b));
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
			globals->set(key, readRegister(frame, a));
			return;
		}

		case OpCode::GETT: {
			const Value tableValue = readRegister(frame, b);
			const Value& key = readRK(frame, rkRawC, rkBitsC);
			if (valueIsTable(tableValue)) {
				setRegister(frame, a, resolveTableIndex(asTable(tableValue, m_heap), key));
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
				auto* native = asNativeObject(tableValue, m_heap);
				Value nativeResult = native->get(key);
				if (!isNil(nativeResult)) {
					setRegister(frame, a, nativeResult);
					return;
				}
				Table* metatable = native->getMetatable();
				if (metatable) {
					Value indexerValue = metatable->get(m_indexKey);
					if (valueIsTable(indexerValue)) {
						setRegister(frame, a, resolveTableIndex(asTable(indexerValue, m_heap), key));
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
			const Value tableValue = readRegister(frame, a);
			const Value& key = readRK(frame, rkRawB, rkBitsB);
			const Value& value = readRK(frame, rkRawC, rkBitsC);
			if (valueIsTable(tableValue)) {
				asTable(tableValue, m_heap)->set(key, value);
				return;
			}
			if (valueIsNativeObject(tableValue)) {
				asNativeObject(tableValue, m_heap)->set(key, value);
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
				text += valueToString(readRegister(frame, b + index), m_stringPool);
			}
			const StringId textId = m_stringPool.intern(text);
			const int cp = m_stringPool.codepointCount(textId);
			CYCLES_ADD(ceilDiv8(cp));
			setRegister(frame, a, valueString(textId));
			return;
		}

		case OpCode::UNM: {
			double val = asNumber(readRegister(frame, b));
			setRegister(frame, a, valueNumber(-val));
			return;
		}

		case OpCode::NOT:
			setRegister(frame, a, valueBool(!isTruthy(readRegister(frame, b))));
			return;

		case OpCode::LEN: {
			const Value val = readRegister(frame, b);
			if (valueIsString(val)) {
				int cp = static_cast<int>(m_stringPool.codepointCount(asStringId(val)));
				CYCLES_ADD(ceilDiv16(cp));
				setRegister(frame, a, valueNumber(static_cast<double>(cp)));
				return;
			}
			if (valueIsTable(val)) {
				setRegister(frame, a, valueNumber(static_cast<double>(asTable(val, m_heap)->length())));
				return;
			}
			if (valueIsNativeObject(val)) {
				auto* obj = asNativeObject(val, m_heap);
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
			const uint32_t val = toU32(asNumber(readRegister(frame, b)));
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
			const Value val = readRegister(frame, a);
			if (isTruthy(val) != (c != 0)) {
				CYCLES_ADD(1);
				skipNextInstruction(frame);
			}
			return;
		}

		case OpCode::TESTSET: {
			const Value val = readRegister(frame, b);
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
			if (isTruthy(readRegister(frame, a))) {
				frame.pc += sbx * INSTRUCTION_BYTES;
			}
			return;

		case OpCode::JMPIFNOT:
			if (!isTruthy(readRegister(frame, a))) {
				frame.pc += sbx * INSTRUCTION_BYTES;
			}
			return;

		case OpCode::CLOSURE:
			setRegister(frame, a, valueClosure(createClosure(frame, bx)));
			return;

		case OpCode::GETUP: {
			Upvalue* upvalue = static_cast<Upvalue*>(m_heap.resolveRuntimeRef(readClosureUpvalueRefId(m_handleTable, frame.closure, b)));
			setRegister(frame, a, readUpvalue(upvalue));
			return;
		}

		case OpCode::SETUP: {
			Upvalue* upvalue = static_cast<Upvalue*>(m_heap.resolveRuntimeRef(readClosureUpvalueRefId(m_handleTable, frame.closure, b)));
			writeUpvalue(upvalue, readRegister(frame, a));
			return;
		}

		case OpCode::VARARG: {
			int count = b == 0 ? static_cast<int>(frame.varargs.size()) : b;
			CYCLES_ADD(ceilDiv4(count));
			for (int i = 0; i < count; ++i) {
				Value value = i < static_cast<int>(frame.varargs.size()) ? readVararg(frame, i) : valueNil();
				setRegister(frame, a + i, value);
			}
			return;
		}

		case OpCode::CALL: {
			int argCount = b == 0 ? std::max(frame.top - a - 1, 0) : b;
			int retCount = c;
			const Value callee = readRegister(frame, a);
			std::vector<Value> args = acquireArgScratch();
			args.resize(static_cast<size_t>(argCount));
			for (int i = 0; i < argCount; ++i) {
				args[static_cast<size_t>(i)] = readRegister(frame, a + 1 + i);
			}
			pinActiveValueScratch(&args);
			try {
				if (valueIsClosure(callee)) {
					Closure* closure = asClosure(callee, m_heap);
					const Proto& proto = m_program->protos[readClosureProtoIndex(m_handleTable, closure)];
					CYCLES_ADD(argCount);
					CYCLES_ADD(ceilDiv4(proto.maxStack));
					if (proto.isVararg && argCount > proto.numParams) {
						CYCLES_ADD(ceilDiv4(argCount - proto.numParams));
					}
					pushFrame(closure, args, a, retCount, false, frame.pc - INSTRUCTION_BYTES);
					unpinActiveValueScratch(&args);
					releaseArgScratch(std::move(args));
					return;
				}
			if (valueIsNativeFunction(callee)) {
				NativeFunction* fn = asNativeFunction(callee, m_heap);
				const NativeFunctionBridge& bridge = resolveNativeFunctionBridge(m_handleTable, readNativeFunctionBridgeId(fn));
				CYCLES_ADD(static_cast<int>(bridge.cycleBase)
					+ static_cast<int>(bridge.cyclePerArg) * argCount);
				std::vector<Value> out = acquireNativeReturnScratch();
				pinActiveValueScratch(&out);
				try {
					fn->invoke(args, out);
					const int returnSlots = retCount == 0 ? static_cast<int>(out.size()) : retCount;
					CYCLES_ADD(static_cast<int>(bridge.cyclePerRet) * returnSlots);
						writeReturnValues(frame, a, retCount, out);
						unpinActiveValueScratch(&out);
						releaseNativeReturnScratch(std::move(out));
						unpinActiveValueScratch(&args);
						releaseArgScratch(std::move(args));
						return;
					} catch (...) {
						unpinActiveValueScratch(&out);
						releaseNativeReturnScratch(std::move(out));
						throw;
					}
				}
				throw BMSX_RUNTIME_ERROR(formatNonFunctionCallError(
					callee,
					m_stringPool,
					getDebugRange(frame.pc - INSTRUCTION_BYTES)
				));
			} catch (...) {
				unpinActiveValueScratch(&args);
				releaseArgScratch(std::move(args));
				throw;
			}
		}

		case OpCode::RET: {
			auto& results = m_returnScratch;
			results.clear();
			int count = b == 0 ? std::max(frame.top - a, 0) : b;
			CYCLES_ADD(count);
			CYCLES_ADD(static_cast<int>(frame.openUpvalues.size()) * 3);
			results.reserve(static_cast<size_t>(count));
			for (int i = 0; i < count; ++i) {
				results.push_back(readRegister(frame, a + i));
			}
			setLastReturnValues(results);
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
			uint32_t addr = static_cast<uint32_t>(asNumber(readRegister(frame, b)));
			setRegister(frame, a, m_memory.readValue(addr));
			return;
		}

		case OpCode::STORE_MEM: {
			uint32_t addr = static_cast<uint32_t>(asNumber(readRegister(frame, b)));
			m_memory.writeValue(addr, readRegister(frame, a));
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
	writeClosureProtoIndex(m_handleTable, closure, protoIndex);
	writeClosureUpvalueCount(m_handleTable, closure, static_cast<uint32_t>(proto.upvalues.size()));
	for (size_t i = 0; i < proto.upvalues.size(); ++i) {
		const UpvalueDesc& uv = proto.upvalues[i];
		if (uv.isLocal) {
			Upvalue* upvalue = nullptr;
			auto it = frame.openUpvalues.find(uv.index);
			if (it != frame.openUpvalues.end()) {
				upvalue = it->second;
			} else {
				upvalue = m_heap.allocateWithRamSize<Upvalue>(ObjType::Upvalue, UPVALUE_OBJECT_HEADER_SIZE);
				writeUpvalueIsOpen(m_handleTable, upvalue, true);
				writeUpvalueIndex(m_handleTable, upvalue, uv.index);
				writeUpvalueFrameDepth(m_handleTable, upvalue, frame.depth);
				writeUpvalueClosedValue(m_handleTable, upvalue, valueNil());
				frame.openUpvalues.emplace(uv.index, upvalue);
			}
			writeClosureUpvalueRefId(m_handleTable, closure, i, upvalue->runtimeRefId);
		} else {
			writeClosureUpvalueRefId(
				m_handleTable,
				closure,
				i,
				readClosureUpvalueRefId(m_handleTable, frame.closure, static_cast<size_t>(uv.index))
			);
		}
	}
	return closure;
}

void CPU::closeUpvalues(CallFrame& frame) {
	for (auto& entry : frame.openUpvalues) {
		Upvalue* upvalue = entry.second;
		writeUpvalueClosedValue(m_handleTable, upvalue, readRegister(frame, readUpvalueIndex(m_handleTable, upvalue)));
		writeUpvalueIsOpen(m_handleTable, upvalue, false);
		writeUpvalueFrameDepth(m_handleTable, upvalue, -1);
	}
	frame.openUpvalues.clear();
}

Value CPU::readUpvalue(Upvalue* upvalue) {
	if (readUpvalueIsOpen(m_handleTable, upvalue)) {
		return readRegister(
			*m_frames[static_cast<size_t>(readUpvalueFrameDepth(m_handleTable, upvalue))],
			readUpvalueIndex(m_handleTable, upvalue)
		);
	}
	return readUpvalueClosedValue(m_handleTable, m_heap, upvalue);
}

void CPU::writeUpvalue(Upvalue* upvalue, const Value& value) {
	if (readUpvalueIsOpen(m_handleTable, upvalue)) {
		setRegister(
			*m_frames[static_cast<size_t>(readUpvalueFrameDepth(m_handleTable, upvalue))],
			readUpvalueIndex(m_handleTable, upvalue),
			value
		);
		return;
	}
	writeUpvalueClosedValue(m_handleTable, upvalue, value);
}

void CPU::pushFrame(Closure* closure, const Value* args, size_t argCount,
	int returnBase, int returnCount, bool captureReturns, int callSitePc) {
	const int protoIndex = readClosureProtoIndex(m_handleTable, closure);
	const Proto& proto = m_program->protos[protoIndex];
	auto frame = acquireFrame();
	frame->protoIndex = protoIndex;
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
			frame->registers[static_cast<size_t>(i)] = encodeTaggedValueSlot(args[i]);
		} else {
			frame->registers[static_cast<size_t>(i)] = {};
		}
	}
	if (proto.isVararg) {
		frame->varargs.clear();
		for (size_t i = static_cast<size_t>(proto.numParams); i < argCount; ++i) {
			frame->varargs.push_back(encodeTaggedValueSlot(args[i]));
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
	frame.registers[static_cast<size_t>(index)] = encodeTaggedValueSlot(value);
	if (index >= frame.top) {
		frame.top = index + 1;
	}
}

Value CPU::readRK(CallFrame& frame, uint32_t raw, int bits) {
	int rk = signExtend(raw, bits);
	if (rk < 0) {
		int index = -1 - rk;
		return m_runtimeConstPool[static_cast<size_t>(index)];
	}
	return readRegister(frame, rk);
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
		current = asTable(indexerValue, m_heap);
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

std::vector<TaggedValueSlotState> CPU::acquireRegisters(size_t size) {
	size_t bucket = 8;
	while (bucket < size) {
		bucket <<= 1;
	}
	auto& pool = m_registerPool[bucket];
	if (!pool.empty()) {
		std::vector<TaggedValueSlotState> regs = std::move(pool.back());
		pool.pop_back();
		for (size_t i = 0; i < size; ++i) {
			regs[i] = {};
		}
		return regs;
	}
	std::vector<TaggedValueSlotState> regs(bucket);
	return regs;
}

void CPU::releaseRegisters(std::vector<TaggedValueSlotState>&& regs) {
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

void CPU::pinActiveValueScratch(const std::vector<Value>* values) {
	m_activeValueScratch.push_back(values);
}

void CPU::unpinActiveValueScratch(const std::vector<Value>* values) {
	for (auto it = m_activeValueScratch.end(); it != m_activeValueScratch.begin();) {
		--it;
		if (*it == values) {
			m_activeValueScratch.erase(it);
			return;
		}
	}
	throw std::runtime_error("[CPU] Active value scratch not pinned.");
}

void CPU::markRoots(GcHeap& heap) {
	if (globals) {
		heap.markObject(globals);
	}
	heap.markValue(m_indexKey);
	if (m_stringIndexTable) {
		heap.markObject(m_stringIndexTable);
	}
	for (const auto& value : m_memory.ioSlots()) {
		heap.markValue(value);
	}
	for (const auto& slot : lastReturnValues) {
		heap.markValue(decodeTaggedValueSlot(slot, m_heap));
	}
	for (const auto& value : m_returnScratch) {
		heap.markValue(value);
	}
	for (const auto& value : m_runtimeConstPool) {
		heap.markValue(value);
	}
	for (const std::vector<Value>* values : m_activeValueScratch) {
		for (const Value& value : *values) {
			heap.markValue(value);
		}
	}
	for (const auto& framePtr : m_frames) {
		CallFrame* frame = framePtr.get();
		heap.markObject(frame->closure);
		for (int i = 0; i < frame->top; ++i) {
			heap.markValue(readRegister(*frame, i));
		}
		for (int index = 0; index < static_cast<int>(frame->varargs.size()); ++index) {
			heap.markValue(readVararg(*frame, index));
		}
		for (const auto& entry : frame->openUpvalues) {
			heap.markObject(entry.second);
			heap.markValue(readRegister(*frame, entry.first));
		}
	}
	m_externalRootMarker(heap);
}

} // namespace bmsx
