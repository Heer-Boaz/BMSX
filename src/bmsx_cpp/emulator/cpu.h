#pragma once

#include <cstdint>
#include <cstring>
#include <functional>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

#include "../core/types.h"
#include "object_memory.h"

namespace bmsx {

class GcHeap;
class Memory;

struct Table;
struct Closure;
struct NativeFunction;
struct NativeObject;
struct Upvalue;
struct CallFrame;
struct GCObject;

void registerRuntimeObjectRef(uint32_t objectRefId, GCObject* object);
void unregisterRuntimeObjectRef(uint32_t objectRefId);
GCObject* resolveRuntimeObjectRef(uint32_t objectRefId);

/**
 * Source range in Lua code for debugging/error reporting.
 */
struct SourceRange {
	std::string path;
	int startLine = 0;
	int startColumn = 0;
	int endLine = 0;
	int endColumn = 0;
};

using StringId = uint32_t;

struct InternedString {
	StringId id = 0;
	std::string value;
	uint32_t byteLength = 0;
	int codepointCount = 0;
	uint32_t hashLo = 0;
	uint32_t hashHi = 0;
};

struct StringKeyHash {
	using is_transparent = void;
	size_t operator()(std::string_view key) const noexcept {
		return std::hash<std::string_view>{}(key);
	}
	size_t operator()(const std::string& key) const noexcept {
		return std::hash<std::string_view>{}(key);
	}
};

struct StringKeyEq {
	using is_transparent = void;
	bool operator()(std::string_view lhs, std::string_view rhs) const noexcept { return lhs == rhs; }
	bool operator()(const std::string& lhs, const std::string& rhs) const noexcept { return lhs == rhs; }
	bool operator()(const std::string& lhs, std::string_view rhs) const noexcept { return lhs == rhs; }
	bool operator()(std::string_view lhs, const std::string& rhs) const noexcept { return lhs == rhs; }
};

struct StringMetadata {
	uint32_t byteLength = 0;
	int codepointCount = 0;
	uint32_t hashLo = 0;
	uint32_t hashHi = 0;
};

inline StringMetadata analyzeStringMetadata(std::string_view text) {
	StringMetadata metadata;
	metadata.byteLength = static_cast<uint32_t>(text.size());
	metadata.hashLo = 0x84222325u;
	metadata.hashHi = 0xcbf29ce4u;
	for (unsigned char byte : text) {
		metadata.hashLo ^= static_cast<uint32_t>(byte);
		const uint32_t previousLo = metadata.hashLo;
		const uint64_t loMul = static_cast<uint64_t>(previousLo) * 0x1b3ULL;
		const uint32_t carry = static_cast<uint32_t>(loMul >> 32);
		metadata.hashLo = static_cast<uint32_t>(loMul);
		metadata.hashHi = static_cast<uint32_t>(
			(static_cast<uint64_t>(metadata.hashHi) * 0x1b3ULL)
			+ carry
			+ ((static_cast<uint64_t>(previousLo) << 8) & 0xffffffffULL));
		if ((byte & 0xc0u) != 0x80u) {
			metadata.codepointCount += 1;
		}
	}
	return metadata;
}

class StringPool {
public:
	StringId intern(std::string_view value) {
		auto it = m_stringMap.find(value);
		if (it != m_stringMap.end()) {
			return it->second;
		}
		auto entry = std::make_unique<InternedString>();
		StringId id = m_nextId;
		const StringMetadata metadata = analyzeStringMetadata(value);
		entry->id = id;
		entry->value.assign(value.data(), value.size());
		entry->byteLength = metadata.byteLength;
		entry->codepointCount = metadata.codepointCount;
		entry->hashLo = metadata.hashLo;
		entry->hashHi = metadata.hashHi;
		if (id >= m_entries.size()) {
			m_entries.resize(static_cast<size_t>(id) + 1);
		}
		m_entries[id] = std::move(entry);
		m_stringMap.emplace(std::string_view(m_entries[id]->value), id);
		m_nextId = id + 1;
		return id;
	}

	const std::string& toString(StringId id) const {
		return get(id).value;
	}

	int codepointCount(StringId id) const {
		return get(id).codepointCount;
	}

	uint32_t hash32(StringId id) const {
		const auto& entry = get(id);
		return (entry.hashLo ^ entry.hashHi) & 0xffffffffu;
	}

	bool equals(StringId lhs, StringId rhs) const {
		if (lhs == rhs) {
			return true;
		}
		const auto& left = get(lhs);
		const auto& right = get(rhs);
		if (left.hashLo != right.hashLo || left.hashHi != right.hashHi) {
			return false;
		}
		if (left.byteLength != right.byteLength) {
			return false;
		}
		return left.value == right.value;
	}

private:
	const InternedString& get(StringId id) const {
		const auto* entry = id < m_entries.size() ? m_entries[static_cast<size_t>(id)].get() : nullptr;
		if (!entry) {
			throw std::runtime_error("StringPool: missing string entry.");
		}
		return *entry;
	}

	StringId m_nextId = 0;
	std::unordered_map<std::string_view, StringId, StringKeyHash, StringKeyEq> m_stringMap;
	mutable std::vector<std::unique_ptr<InternedString>> m_entries;
};

class RuntimeStringPool {
public:
	explicit RuntimeStringPool(ObjectHandleTable& handleTable)
		: m_handleTable(handleTable) {
	}

	StringId intern(std::string_view value) {
		auto entry = std::make_unique<InternedString>();
		const StringMetadata metadata = analyzeStringMetadata(value);
		const ObjectAllocation allocation = m_handleTable.allocateObject(
			static_cast<uint32_t>(HeapObjectType::String),
			STRING_OBJECT_HEADER_SIZE + metadata.byteLength);
		const auto* bytes = reinterpret_cast<const u8*>(value.data());
		m_handleTable.writeU32(allocation.addr + STRING_OBJECT_HASH_LO_OFFSET, metadata.hashLo);
		m_handleTable.writeU32(allocation.addr + STRING_OBJECT_HASH_HI_OFFSET, metadata.hashHi);
		m_handleTable.writeU32(allocation.addr + STRING_OBJECT_BYTE_LENGTH_OFFSET, metadata.byteLength);
		m_handleTable.writeU32(allocation.addr + STRING_OBJECT_CODEPOINT_COUNT_OFFSET, static_cast<uint32_t>(metadata.codepointCount));
		m_handleTable.writeBytes(allocation.addr + STRING_OBJECT_DATA_OFFSET, bytes, value.size());
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

	const std::string& toString(StringId id) const {
		return get(id).value;
	}

	int codepointCount(StringId id) const {
		return get(id).codepointCount;
	}

	uint32_t hash32(StringId id) const {
		const auto& entry = get(id);
		return (entry.hashLo ^ entry.hashHi) & 0xffffffffu;
	}

	bool equals(StringId lhs, StringId rhs) const {
		if (lhs == rhs) {
			return true;
		}
		const auto& left = get(lhs);
		const auto& right = get(rhs);
		if (left.hashLo != right.hashLo || left.hashHi != right.hashHi) {
			return false;
		}
		if (left.byteLength != right.byteLength) {
			return false;
		}
		return left.value == right.value;
	}

	void reserveHandles(StringId minHandle) {
		m_handleTable.reserveHandles(minHandle);
		if (minHandle > m_nextId) {
			if (m_entries.size() < static_cast<size_t>(minHandle)) {
				m_entries.resize(static_cast<size_t>(minHandle));
			}
			m_nextId = minHandle;
		}
	}

	void clearRuntimeCache() {
		for (auto& entry : m_entries) {
			entry.reset();
		}
	}

private:
	const InternedString& get(StringId id) const {
		const auto* entry = id < m_entries.size() ? m_entries[static_cast<size_t>(id)].get() : nullptr;
		if (!entry) {
			entry = restoreFromHandle(id);
		}
		return *entry;
	}

	const InternedString* restoreFromHandle(StringId id) const {
		const ObjectHandleEntry handle = m_handleTable.readEntry(id);
		if (handle.type != static_cast<uint32_t>(HeapObjectType::String)) {
			throw std::runtime_error("RuntimeStringPool: handle is not a string object.");
		}
		if (id >= m_entries.size()) {
			m_entries.resize(static_cast<size_t>(id) + 1);
		}
		auto entry = std::make_unique<InternedString>();
		entry->id = id;
		entry->hashLo = m_handleTable.readU32(handle.addr + STRING_OBJECT_HASH_LO_OFFSET);
		entry->hashHi = m_handleTable.readU32(handle.addr + STRING_OBJECT_HASH_HI_OFFSET);
		entry->byteLength = m_handleTable.readU32(handle.addr + STRING_OBJECT_BYTE_LENGTH_OFFSET);
		entry->codepointCount = static_cast<int>(m_handleTable.readU32(handle.addr + STRING_OBJECT_CODEPOINT_COUNT_OFFSET));
		entry->value.resize(entry->byteLength);
		m_handleTable.readBytes(handle.addr + STRING_OBJECT_DATA_OFFSET, reinterpret_cast<uint8_t*>(entry->value.data()), entry->byteLength);
		m_entries[id] = std::move(entry);
		return m_entries[id].get();
	}

	ObjectHandleTable& m_handleTable;
	StringId m_nextId = 1;
	mutable std::vector<std::unique_ptr<InternedString>> m_entries;
};

using Value = uint64_t;

enum class ValueTag : uint8_t {
	Nil = 0,
	False = 1,
	True = 2,
	String = 3,
	Table = 4,
	Closure = 5,
	NativeFunction = 6,
	NativeObject = 7,
	Upvalue = 8,
};

constexpr uint64_t VALUE_QNAN_MASK = 0x7ff8000000000000ULL;
constexpr uint64_t VALUE_SIGN_BIT = 0x8000000000000000ULL;
constexpr uint64_t VALUE_PAYLOAD_MASK = 0x0000ffffffffffffULL;

inline bool valueIsNumber(Value v) {
	if ((v & VALUE_QNAN_MASK) != VALUE_QNAN_MASK) {
		return true;
	}
	uint64_t tag = ((v >> 48) & 0x7ULL) | ((v & VALUE_SIGN_BIT) ? 0x8ULL : 0ULL);
	return tag == 0;
}

inline bool valueIsTagged(Value v) {
	if ((v & VALUE_QNAN_MASK) != VALUE_QNAN_MASK) {
		return false;
	}
	uint64_t tag = ((v >> 48) & 0x7ULL) | ((v & VALUE_SIGN_BIT) ? 0x8ULL : 0ULL);
	return tag != 0;
}

inline uint64_t valuePayload(Value v) {
	return v & VALUE_PAYLOAD_MASK;
}

inline ValueTag valueTag(Value v) {
	uint64_t tag = ((v >> 48) & 0x7ULL) | ((v & VALUE_SIGN_BIT) ? 0x8ULL : 0ULL);
	return static_cast<ValueTag>(tag - 1);
}

inline Value valueFromTag(ValueTag tag, uint64_t payload = 0) {
	uint64_t tagBits = static_cast<uint64_t>(tag) + 1;
	uint64_t hi = (tagBits & 0x7ULL) << 48;
	uint64_t sign = (tagBits & 0x8ULL) ? VALUE_SIGN_BIT : 0ULL;
	return VALUE_QNAN_MASK | hi | sign | (payload & VALUE_PAYLOAD_MASK);
}

inline Value valueFromNumber(double value) {
	if (value != value) {
		return VALUE_QNAN_MASK;
	}
	Value out = 0;
	std::memcpy(&out, &value, sizeof(double));
	return out;
}

inline double valueToNumber(Value v) {
	double out = 0.0;
	std::memcpy(&out, &v, sizeof(double));
	return out;
}

inline Value valueNil() {
	return valueFromTag(ValueTag::Nil);
}

inline Value valueBool(bool value) {
	return valueFromTag(value ? ValueTag::True : ValueTag::False);
}

inline Value valueNumber(double value) {
	return valueFromNumber(value);
}

inline Value valueString(StringId id) {
	return valueFromTag(ValueTag::String, id);
}

Value valueTable(Table* table);
Value valueClosure(Closure* closure);
Value valueNativeFunction(NativeFunction* fn);
Value valueNativeObject(NativeObject* obj);
Value valueUpvalue(Upvalue* upvalue);

inline bool isNil(Value v) {
	return valueIsTagged(v) && valueTag(v) == ValueTag::Nil;
}

inline bool isTruthy(Value v) {
	if (isNil(v)) return false;
	if (valueIsTagged(v)) return valueTag(v) != ValueTag::False;
	return true;
}

inline double asNumber(Value v) {
	return valueToNumber(v);
}

inline StringId asStringId(Value v) {
	return static_cast<StringId>(valuePayload(v));
}

Table* asTable(Value v);
Closure* asClosure(Value v);
NativeFunction* asNativeFunction(Value v);
NativeObject* asNativeObject(Value v);
Upvalue* asUpvalue(Value v);

inline bool valueIsString(Value v) {
	return valueIsTagged(v) && valueTag(v) == ValueTag::String;
}

inline bool valueIsBool(Value v) {
	if (!valueIsTagged(v)) {
		return false;
	}
	ValueTag tag = valueTag(v);
	return tag == ValueTag::True || tag == ValueTag::False;
}

inline bool valueToBool(Value v) {
	return valueTag(v) == ValueTag::True;
}

inline bool valueIsTable(Value v) {
	return valueIsTagged(v) && valueTag(v) == ValueTag::Table;
}

inline bool valueIsClosure(Value v) {
	return valueIsTagged(v) && valueTag(v) == ValueTag::Closure;
}

inline bool valueIsNativeFunction(Value v) {
	return valueIsTagged(v) && valueTag(v) == ValueTag::NativeFunction;
}

inline bool valueIsNativeObject(Value v) {
	return valueIsTagged(v) && valueTag(v) == ValueTag::NativeObject;
}

inline bool valueIsUpvalue(Value v) {
	return valueIsTagged(v) && valueTag(v) == ValueTag::Upvalue;
}

inline const char* valueTypeNameInline(Value v) {
	if (valueIsNumber(v)) return "number";
	if (!valueIsTagged(v)) return "unknown";
	switch (valueTag(v)) {
		case ValueTag::Nil: return "nil";
		case ValueTag::False: return "boolean";
		case ValueTag::True: return "boolean";
		case ValueTag::String: return "string";
		case ValueTag::Table: return "table";
		case ValueTag::Closure: return "closure";
		case ValueTag::NativeFunction: return "native_function";
		case ValueTag::NativeObject: return "native_object";
		case ValueTag::Upvalue: return "upvalue";
		default: return "unknown";
	}
}

struct ValueHash {
	const RuntimeStringPool& stringPool;

	size_t operator()(Value v) const noexcept {
		if (valueIsNumber(v)) {
			double num = valueToNumber(v);
			if (num == 0.0) {
				num = 0.0;
			}
			if (num != num) {
				return static_cast<size_t>(VALUE_QNAN_MASK ^ (VALUE_QNAN_MASK >> 32));
			}
			uint64_t bits = 0;
			std::memcpy(&bits, &num, sizeof(double));
			return static_cast<size_t>(bits ^ (bits >> 32));
		}
		if (valueIsString(v)) {
			return static_cast<size_t>(stringPool.hash32(asStringId(v)));
		}
		return static_cast<size_t>(v ^ (v >> 32));
	}
};

struct ValueEq {
	const RuntimeStringPool& stringPool;

	bool operator()(Value lhs, Value rhs) const noexcept {
		if (valueIsNumber(lhs) && valueIsNumber(rhs)) {
			double leftNum = valueToNumber(lhs);
			double rightNum = valueToNumber(rhs);
			if (leftNum != leftNum && rightNum != rightNum) {
				return true;
			}
			return leftNum == rightNum;
		}
		if (valueIsString(lhs) && valueIsString(rhs)) {
			return stringPool.equals(asStringId(lhs), asStringId(rhs));
		}
		return lhs == rhs;
	}
};

/**
 * Native function signature - takes args, writes results into out buffer.
 */
using NativeFunctionInvoke = std::function<void(const std::vector<Value>&, std::vector<Value>&)>;

enum class ObjType : uint8_t {
	Table,
	Closure,
	NativeFunction,
	NativeObject,
	Upvalue,
};

struct GCObject {
	ObjType type;
	bool marked = false;
	GCObject* next = nullptr;
	uint32_t runtimeRefId = 0;
};

/**
 * Native function wrapper for C++ functions callable from Lua.
 */
struct NativeFunction : GCObject {
	std::string name;
	uint16_t cycleBase = 20;
	uint8_t cyclePerArg = 2;
	uint8_t cyclePerRet = 1;

	void invoke(const std::vector<Value>& args, std::vector<Value>& out) const;
};

/**
 * Native object wrapper for exposing C++ objects to Lua.
 */
struct NativeObject : GCObject {
	uint32_t metatableRefId = 0;

	Value get(const Value& key) const;
	void set(const Value& key, const Value& value) const;
	bool hasLen() const;
	int len() const;
	bool hasNextEntry() const;
	std::optional<std::pair<Value, Value>> nextEntry(const Value& after) const;
	void mark(GcHeap& heap) const;
	void* raw() const;
	Table* getMetatable() const;
	void setMetatable(Table* metatable);
};

/**
 * Upvalue descriptor - describes how to find an upvalue when creating a closure.
 */
struct UpvalueDesc {
	bool isLocal = false;
	int index = 0;
};

/**
 * Function prototype - compiled function metadata.
 */
struct Proto {
	int entryPC = 0;
	int maxStack = 0;
	int numParams = 0;
	bool isVararg = false;
	std::vector<UpvalueDesc> upvalues;
};

/**
 * Compiled program - bytecode, constants, and prototypes.
 */
struct Program {
	std::vector<uint8_t> code;
	std::vector<Value> constPool;
	StringPool stringPool;
	StringPool* constPoolStringPool = &stringPool;
	std::vector<Proto> protos;
};

struct LocalSlotDebug {
	std::string name;
	int reg = 0;
	SourceRange definition;
	SourceRange scope;
};

struct ProgramMetadata {
	std::vector<std::optional<SourceRange>> debugRanges;
	std::vector<std::string> protoIds;
	std::vector<std::vector<LocalSlotDebug>> localSlotsByProto;
};

constexpr int INSTRUCTION_BYTES = 4;
constexpr int MAX_OPERAND_BITS = 6;
constexpr int MAX_BX_BITS = 12;
constexpr int EXT_A_BITS = 2;
constexpr int EXT_B_BITS = 3;
constexpr int EXT_C_BITS = 3;
constexpr int EXT_BX_BITS = 8;

struct DecodedInstruction {
	uint32_t word = 0;
	uint8_t op = 0;
	uint8_t a = 0;
	uint8_t b = 0;
	uint8_t c = 0;
	uint8_t ext = 0;
};

struct Upvalue : GCObject {
	bool open = false;
	int index = 0;
	int frameDepth = -1;
	Value value = valueNil();
};

struct Closure : GCObject {
	int protoIndex = 0;
	std::vector<uint32_t> upvalueRefIds;
};

/**
 * Runtime opcodes - instruction set for the bytecode interpreter.
 */
enum class OpCode : uint8_t {
	WIDE,
	MOV,
	LOADK,
	LOADNIL,
	LOADBOOL,
	GETG,
	SETG,
	GETT,
	SETT,
	NEWT,
	ADD,
	SUB,
	MUL,
	DIV,
	MOD,
	FLOORDIV,
	POW,
	BAND,
	BOR,
	BXOR,
	SHL,
	SHR,
	CONCAT,
	CONCATN,
	UNM,
	NOT,
	LEN,
	BNOT,
	EQ,
	LT,
	LE,
	TEST,
	TESTSET,
	JMP,
	JMPIF,
	JMPIFNOT,
	CLOSURE,
	GETUP,
	SETUP,
	VARARG,
	CALL,
	RET,
	LOAD_MEM,
	STORE_MEM,
};

enum class RunResult {
	Halted,
	Yielded,
};

struct CallFrame {
	int protoIndex = 0;
	int pc = 0;
	int depth = 0;
	std::vector<Value> registers;
	std::vector<Value> varargs;
	Closure* closure = nullptr;
	std::unordered_map<int, Upvalue*> openUpvalues;
	int returnBase = 0;
	int returnCount = 0;
	int top = 0;
	bool captureReturns = false;
	int callSitePc = 0;
};

class Table : public GCObject {
public:
	Table(GcHeap& gcHeap, ObjectHandleTable& handleTable, const RuntimeStringPool& stringPool, int arraySize = 0, int hashSize = 0);
	~Table();

	Value get(const Value& key) const;
	void set(const Value& key, const Value& value);
	int length() const;
	void clear();
	void rehydrateStoreViews();
	template <typename Fn>
	void forEachEntry(Fn&& fn) const {
		m_arrayStore.forEachPresent([&fn](size_t index, Value value) {
			fn(valueNumber(static_cast<double>(index + 1)), value);
		});
		m_hashStore.forEachPresent([&fn](size_t, const HashNode& node) {
			fn(node.key, node.value);
		});
	}
	std::vector<std::pair<Value, Value>> entries() const;
	std::optional<std::pair<Value, Value>> nextEntry(const Value& after) const;

	Table* getMetatable() const { return m_metatable; }
	void setMetatable(Table* mt) {
		m_metatable = mt;
		syncTableMetadata();
	}
	uint32_t objectId() const { return m_objectId; }

private:
	struct HashNode {
		Value key = valueNil();
		Value value = valueNil();
		int next = -1;
	};

	struct ArrayStoreView {
		std::vector<Value> values;

		void resize(size_t size) {
			values.assign(size, valueNil());
		}

		size_t capacity() const {
			return values.size();
		}

		bool has(size_t index) const {
			return !isNil(values[index]);
		}

		const Value& read(size_t index) const {
			return values[index];
		}

		Value& slot(size_t index) {
			return values[index];
		}

		void clear() {
			values.clear();
		}

		template <typename Fn>
		void forEachPresent(Fn&& fn) const {
			for (size_t index = 0; index < values.size(); ++index) {
				if (isNil(values[index])) {
					continue;
				}
				fn(index, values[index]);
			}
		}
	};

	struct HashStoreView {
		std::vector<HashNode> nodes;
		int free = -1;

		void resize(size_t size) {
			nodes.assign(size, HashNode{});
			free = size > 0 ? static_cast<int>(size) - 1 : -1;
		}

		size_t capacity() const {
			return nodes.size();
		}

		HashNode& node(size_t index) {
			return nodes[index];
		}

		const HashNode& node(size_t index) const {
			return nodes[index];
		}

		void clear() {
			nodes.clear();
			free = -1;
		}

		template <typename Fn>
		void forEachPresent(Fn&& fn) const {
			for (size_t index = 0; index < nodes.size(); ++index) {
				if (isNil(nodes[index].key)) {
					continue;
				}
				fn(index, nodes[index]);
			}
		}
	};

	bool tryGetArrayIndex(const Value& key, int& outIndex) const;
	bool hasArrayIndex(size_t index) const;
	void updateArrayLengthFrom(size_t startIndex);
	size_t hashValue(const Value& key) const;
	bool keyEquals(const Value& a, const Value& b) const;
	int findNodeIndex(const Value& key) const;
	HashNode* getNode(const Value& key);
	HashNode* getMainNode(const Value& key);
	int getFreeIndex();
	void rehash(const Value& key);
	void resize(size_t newArraySize, size_t newHashSize);
	void allocateStoreObjects(size_t arraySize, size_t hashSize);
	void rawSet(const Value& key, const Value& value);
	void insertHash(const Value& key, const Value& value);
	void removeFromHash(const Value& key);
	void syncObjectState();
	void syncTableMetadata();
	void syncStoreMetadata();
	void writeArraySlot(size_t index);
	void writeHashNode(size_t index);
	void writeTaggedValue(uint32_t addr, const Value& value);
	Value readTaggedValue(uint32_t addr) const;

	ArrayStoreView m_arrayStore;
	size_t m_arrayLength = 0;
	HashStoreView m_hashStore;
	Table* m_metatable = nullptr;
	GcHeap& m_gcHeap;
	ObjectHandleTable& m_handleTable;
	uint32_t m_objectId = 0;
	uint32_t m_objectAddr = 0;
	uint32_t m_arrayStoreId = 0;
	uint32_t m_arrayStoreAddr = 0;
	uint32_t m_hashStoreId = 0;
	uint32_t m_hashStoreAddr = 0;
	const RuntimeStringPool& m_stringPool;
};

class GcHeap {
public:
	explicit GcHeap(ObjectHandleTable& handleTable)
		: m_handleTable(handleTable) {
	}
	~GcHeap();

	template <typename T, typename... Args>
	T* allocate(ObjType type, Args&&... args) {
		return allocateWithRamSize<T>(type, HEAP_OBJECT_HEADER_SIZE, std::forward<Args>(args)...);
	}

	template <typename T, typename... Args>
	T* allocateWithRamSize(ObjType type, uint32_t ramSizeBytes, Args&&... args) {
		auto* obj = new T(std::forward<Args>(args)...);
		obj->type = type;
		obj->marked = false;
		obj->next = m_objects;
		if (type == ObjType::Table) {
			auto* table = reinterpret_cast<Table*>(obj);
			obj->runtimeRefId = table->objectId() != 0 ? table->objectId() : m_nextRuntimeRefId++;
		} else {
			uint32_t heapType = 0;
			switch (type) {
				case ObjType::Closure:
					heapType = static_cast<uint32_t>(HeapObjectType::Closure);
					break;
				case ObjType::NativeFunction:
					heapType = static_cast<uint32_t>(HeapObjectType::NativeFunction);
					break;
				case ObjType::NativeObject:
					heapType = static_cast<uint32_t>(HeapObjectType::NativeObject);
					break;
				case ObjType::Upvalue:
					heapType = static_cast<uint32_t>(HeapObjectType::Upvalue);
					break;
				case ObjType::Table:
					break;
			}
			obj->runtimeRefId = m_handleTable.allocateObject(heapType, ramSizeBytes).id;
		}
		if (obj->runtimeRefId >= m_nextRuntimeRefId) {
			m_nextRuntimeRefId = obj->runtimeRefId + 1;
		}
		m_objects = obj;
		m_runtimeRefs[obj->runtimeRefId] = obj;
		registerRuntimeObjectRef(obj->runtimeRefId, obj);
		m_bytesAllocated += sizeof(T);
		if (m_bytesAllocated > m_nextGC) {
			m_collectRequested = true;
		}
		return obj;
	}

	void requestCollection() { m_collectRequested = true; }
	bool needsCollection() const { return m_collectRequested; }
	void collect();

	void markValue(Value v);
	void markObject(GCObject* obj);
	GCObject* resolveRuntimeRef(uint32_t runtimeRefId) const;
	template <typename Fn>
	void forEachRuntimeRef(Fn&& fn) const {
		for (const auto& entry : m_runtimeRefs) {
			fn(entry.first, entry.second);
		}
	}

	void setRootMarker(std::function<void(GcHeap&)> marker) { m_rootMarker = std::move(marker); }

private:
	void trace();
	void sweep();
	void destroyObject(GCObject* obj);

	ObjectHandleTable& m_handleTable;
	GCObject* m_objects = nullptr;
	std::vector<GCObject*> m_grayStack;
	size_t m_bytesAllocated = 0;
	size_t m_nextGC = 1024 * 1024;
	uint32_t m_nextRuntimeRefId = 1;
	std::unordered_map<uint32_t, GCObject*> m_runtimeRefs;
	bool m_collectRequested = false;
	std::function<void(GcHeap&)> m_rootMarker;
};

class CPU {
public:
	explicit CPU(Memory& memory, ObjectHandleTable& handleTable);

	void setProgram(Program* program, ProgramMetadata* metadata);
	Program* getProgram() const { return m_program; }
	StringId internString(std::string_view value) { return m_stringPool.intern(value); }
	RuntimeStringPool& stringPool() { return m_stringPool; }
	const RuntimeStringPool& stringPool() const { return m_stringPool; }
	void reserveStringHandles(StringId minHandle);
	ObjectHandleTableState captureObjectMemoryState() const { return m_handleTable.captureState(); }
	void restoreObjectMemoryState(const ObjectHandleTableState& state);
	void setExternalRootMarker(std::function<void(GcHeap&)> marker) { m_externalRootMarker = std::move(marker); }
	void setStringIndexTable(Table* table) { m_stringIndexTable = table; }

	Value createNativeFunction(std::string_view name, NativeFunctionInvoke fn);
	Value createNativeObject(
		void* raw,
		std::function<Value(const Value&)> get,
		std::function<void(const Value&, const Value&)> set,
		std::function<int()> len = nullptr,
		std::function<std::optional<std::pair<Value, Value>>(const Value&)> nextEntry = nullptr,
		std::function<void(GcHeap&)> mark = nullptr
	);
	void setNativeObjectMetatable(NativeObject* native, Table* metatable);
	Table* createTable(int arraySize = 0, int hashSize = 0);
	Closure* createRootClosure(int protoIndex);

	void start(int entryProtoIndex, const std::vector<Value>& args = {});
	void call(Closure* closure, const std::vector<Value>& args = {}, int returnCount = 0);
	void callExternal(Closure* closure, const std::vector<Value>& args = {});
	RunResult run(int instructionBudget);
	RunResult runUntilDepth(int targetDepth, int instructionBudget);
	void unwindToDepth(int targetDepth);
	void step();

	int getFrameDepth() const { return static_cast<int>(m_frames.size()); }
	bool hasFrames() const { return !m_frames.empty(); }
	std::optional<SourceRange> getDebugRange(int pc) const;
	std::vector<std::pair<int, int>> getCallStack() const;
	int getFrameRegisterCount(int frameIndex) const;
	Value readFrameRegister(int frameIndex, int registerIndex) const;

	int instructionBudgetRemaining = 0;
	std::vector<Value> lastReturnValues;
	int lastPc = 0;
	uint32_t lastInstruction = 0;
	Table* globals = nullptr;

private:
	void executeInstruction(
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
	);
	void skipNextInstruction(CallFrame& frame);
	void pushFrame(Closure* closure, const Value* args, size_t argCount,
		int returnBase, int returnCount, bool captureReturns, int callSitePc);
	void pushFrame(Closure* closure, const std::vector<Value>& args,
		int returnBase, int returnCount, bool captureReturns, int callSitePc);
	Closure* createClosure(CallFrame& frame, int protoIndex);
	void closeUpvalues(CallFrame& frame);
	const Value& readUpvalue(Upvalue* upvalue);
	void writeUpvalue(Upvalue* upvalue, const Value& value);
	void writeReturnValues(CallFrame& frame, int base, int count, const std::vector<Value>& values);
	void setRegister(CallFrame& frame, int index, const Value& value);
	const Value& readRK(CallFrame& frame, uint32_t raw, int bits);
	Value resolveTableIndex(Table* table, const Value& key);

	std::unique_ptr<CallFrame> acquireFrame();
	void releaseFrame(std::unique_ptr<CallFrame> frame);
	std::vector<Value> acquireRegisters(size_t size);
	void releaseRegisters(std::vector<Value>&& regs);
	std::vector<Value> acquireNativeReturnScratch();
	void releaseNativeReturnScratch(std::vector<Value>&& out);
	std::vector<Value> acquireArgScratch();
	void releaseArgScratch(std::vector<Value>&& args);

	void decodeProgram();
	void markRoots(GcHeap& heap);
	void syncNativeObjectState(NativeObject* native);
	void syncClosureObjectState(Closure* closure);
	void syncUpvalueObjectState(Upvalue* upvalue);
	void rehydrateRuntimeObjects();

	Program* m_program = nullptr;
	ProgramMetadata* m_metadata = nullptr;
	std::vector<Value> m_runtimeConstPool;
	std::vector<std::unique_ptr<CallFrame>> m_frames;
	Memory& m_memory;
	ObjectHandleTable& m_handleTable;
	RuntimeStringPool m_stringPool;
	GcHeap m_heap;
	std::function<void(GcHeap&)> m_externalRootMarker;

	std::vector<Value> m_returnScratch;
	std::vector<std::vector<Value>> m_nativeReturnPool;
	static constexpr size_t MAX_POOLED_NATIVE_RETURN_ARRAYS = 32;
	std::vector<std::vector<Value>> m_nativeArgPool;
	static constexpr size_t MAX_POOLED_NATIVE_ARG_ARRAYS = 32;

	std::vector<std::unique_ptr<CallFrame>> m_framePool;
	static constexpr int MAX_POOLED_FRAMES = 32;

	std::unordered_map<size_t, std::vector<std::vector<Value>>> m_registerPool;
	static constexpr size_t MAX_POOLED_REGISTER_ARRAYS = 64;
	static constexpr size_t MAX_REGISTER_ARRAY_SIZE = 256;

	std::vector<DecodedInstruction> m_decoded;
	Value m_indexKey = valueNil();
	Table* m_stringIndexTable = nullptr;
};

std::string valueToString(const Value& v, const StringPool& stringPool);
std::string valueToString(const Value& v, const RuntimeStringPool& stringPool);
const char* valueTypeName(Value v);

} // namespace bmsx
