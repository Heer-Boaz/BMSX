#pragma once

#include <cstdint>
#include <cstring>
#include <cmath>
#include <functional>
#include <iterator>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <vector>

#include "common/scratchbuffer.h"
#include "core/primitives.h"
#include "core/utf8.h"
#include "machine/memory/string_memory.h"

namespace bmsx {

class CPU;
class GcHeap;
class Memory;

struct Table;
struct Closure;
struct NativeFunction;
struct NativeObject;
struct Upvalue;
struct CallFrame;

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

struct NativeFnCost {
	uint16_t base = 1;
	uint8_t perArg = 0;
	uint8_t perRet = 0;
};

struct InternedString {
	StringId id = 0;
	std::string value;
	int codepointCount = 0;
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

class StringPool {
public:
	explicit StringPool(StringHandleTable* handleTable = nullptr)
		: m_handleTable(handleTable) {
	}

	StringId intern(std::string_view value) {
		auto it = m_stringMap.find(value);
		if (it != m_stringMap.end()) {
			return it->second;
		}
		auto entry = std::make_unique<InternedString>();
		StringId id = m_nextId;
		if (m_handleTable) {
			id = static_cast<StringId>(m_handleTable->allocateHandle(value));
		}
		entry->id = id;
		entry->value.assign(value.data(), value.size());
		entry->codepointCount = countCodepoints(entry->value);
		if (id >= m_entries.size()) {
			m_entries.resize(static_cast<size_t>(id) + 1);
		}
		m_entries[id] = std::move(entry);
		m_stringMap.emplace(std::string_view(m_entries[id]->value), id);
		if (id >= m_nextId) {
			m_nextId = id + 1;
		}
		return id;
	}

	const std::string& toString(StringId id) const {
		return entry(id).value;
	}

	int codepointCount(StringId id) const {
		return entry(id).codepointCount;
	}

	void reserveHandles(StringId minHandle) {
		if (m_handleTable) {
			m_handleTable->reserveHandles(minHandle);
		}
		if (minHandle > m_nextId) {
			if (m_entries.size() < static_cast<size_t>(minHandle)) {
				m_entries.resize(static_cast<size_t>(minHandle));
			}
			m_nextId = minHandle;
		}
	}

	void rehydrateFromHandleTable(const StringHandleTableState& state) {
		m_stringMap.clear();
		m_entries.clear();
		m_nextId = 0;
		if (!m_handleTable) {
			throw std::runtime_error("StringPool: missing string handle table.");
		}
		for (StringId id = 0; id < state.nextHandle; ++id) {
			const StringHandleEntry entry = m_handleTable->readEntry(id);
			auto restored = std::make_unique<InternedString>();
			restored->id = id;
			restored->value = m_handleTable->readText(entry);
			restored->codepointCount = countCodepoints(restored->value);
			if (id >= m_entries.size()) {
				m_entries.resize(static_cast<size_t>(id) + 1);
			}
			m_entries[id] = std::move(restored);
			m_stringMap.emplace(std::string_view(m_entries[id]->value), id);
		}
		reserveHandles(state.nextHandle);
		m_nextId = state.nextHandle;
	}

private:
	const InternedString& entry(StringId id) const {
		const auto* entry = m_entries.at(static_cast<size_t>(id)).get();
		if (!entry) {
			throw std::runtime_error("StringPool: missing string entry.");
		}
		return *entry;
	}

	static int countCodepoints(std::string_view text) {
		int count = 0;
		size_t index = 0;
		while (index < text.size()) {
			index = nextUtf8Index(text, index);
			count += 1;
		}
		return count;
	}

	StringHandleTable* m_handleTable = nullptr;
	StringId m_nextId = 0;
	std::unordered_map<std::string_view, StringId, StringKeyHash, StringKeyEq> m_stringMap;
	std::vector<std::unique_ptr<InternedString>> m_entries;
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

inline Value valueTable(Table* table) {
	return valueFromTag(ValueTag::Table, reinterpret_cast<uint64_t>(table));
}

inline Value valueClosure(Closure* closure) {
	return valueFromTag(ValueTag::Closure, reinterpret_cast<uint64_t>(closure));
}

inline Value valueNativeFunction(NativeFunction* fn) {
	return valueFromTag(ValueTag::NativeFunction, reinterpret_cast<uint64_t>(fn));
}

inline Value valueNativeObject(NativeObject* obj) {
	return valueFromTag(ValueTag::NativeObject, reinterpret_cast<uint64_t>(obj));
}

inline Value valueUpvalue(Upvalue* upvalue) {
	return valueFromTag(ValueTag::Upvalue, reinterpret_cast<uint64_t>(upvalue));
}

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

inline uint32_t toU32(double value) {
	const double truncated = std::trunc(value);
	const double mod = std::fmod(truncated, 4294967296.0);
	const double normalized = mod < 0.0 ? (mod + 4294967296.0) : mod;
	return static_cast<uint32_t>(normalized);
}

inline int32_t toI32(double value) {
	return static_cast<int32_t>(toU32(value));
}

inline StringId asStringId(Value v) {
	return static_cast<StringId>(valuePayload(v));
}

inline Table* asTable(Value v) {
	return reinterpret_cast<Table*>(valuePayload(v));
}

inline Closure* asClosure(Value v) {
	return reinterpret_cast<Closure*>(valuePayload(v));
}

inline NativeFunction* asNativeFunction(Value v) {
	return reinterpret_cast<NativeFunction*>(valuePayload(v));
}

inline NativeObject* asNativeObject(Value v) {
	return reinterpret_cast<NativeObject*>(valuePayload(v));
}

inline Upvalue* asUpvalue(Value v) {
	return reinterpret_cast<Upvalue*>(valuePayload(v));
}

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
			return static_cast<size_t>(static_cast<uint64_t>(asStringId(v)) * 2654435761ULL);
		}
		if (valueIsBool(v)) {
			return valueToBool(v) ? static_cast<size_t>(0x9e3779b9u) : static_cast<size_t>(0x85ebca6bu);
		}
		if (isNil(v)) {
			return static_cast<size_t>(0x27d4eb2du);
		}
		const uint64_t payload = valuePayload(v);
		return static_cast<size_t>(payload * 2654435761ULL);
	}
};

struct ValueEq {
	bool operator()(Value lhs, Value rhs) const noexcept {
		if (valueIsNumber(lhs) && valueIsNumber(rhs)) {
			double leftNum = valueToNumber(lhs);
			double rightNum = valueToNumber(rhs);
			if (leftNum != leftNum && rightNum != rightNum) {
				return true;
			}
			return leftNum == rightNum;
		}
		return lhs == rhs;
	}
};

/**
 * Borrowed view over call arguments. Native functions read directly from the
 * caller register window, so the hot path does not need to materialize a
 * temporary vector per CALL.
 */
class NativeArgsView {
public:
	NativeArgsView() = default;
	NativeArgsView(const Value* data, size_t size)
		: m_data(data)
		, m_size(size) {
	}
	NativeArgsView(const std::vector<Value>& values)
		: m_data(values.data())
		, m_size(values.size()) {
	}

	size_t size() const noexcept { return m_size; }
	bool empty() const noexcept { return m_size == 0; }
	const Value* data() const noexcept { return m_data; }
	const Value* begin() const noexcept { return m_data; }
	const Value* end() const noexcept { return m_size == 0 ? m_data : m_data + m_size; }
	const Value& operator[](size_t index) const noexcept { return m_data[index]; }
	const Value& at(size_t index) const {
		if (index >= m_size) {
			throw std::out_of_range("NativeArgsView index out of range");
		}
		return m_data[index];
	}

private:
	const Value* m_data = nullptr;
	size_t m_size = 0;
};

/**
 * Pooled result buffer for native call returns. This keeps the native API
 * append-oriented without routing through std::vector.
 */
class NativeResults {
public:
	class iterator {
	public:
		enum class Position : uint8_t {
			Begin,
			End,
		};

		explicit iterator(Position position)
			: m_position(position) {
		}

		Position position() const noexcept { return m_position; }

	private:
		Position m_position;
	};

	NativeResults() = default;
	NativeResults(NativeResults&&) noexcept = default;
	NativeResults& operator=(NativeResults&&) noexcept = default;
	NativeResults(const NativeResults&) = delete;
	NativeResults& operator=(const NativeResults&) = delete;

	void clear() noexcept { m_size = 0; }
	size_t size() const noexcept { return m_size; }
	bool empty() const noexcept { return m_size == 0; }
	const Value* data() const noexcept { return m_data.get(); }
	Value* data() noexcept { return m_data.get(); }
	const Value& operator[](size_t index) const noexcept { return m_data[index]; }
	Value& operator[](size_t index) noexcept { return m_data[index]; }
	iterator begin() const noexcept { return iterator(iterator::Position::Begin); }
	iterator end() const noexcept { return iterator(iterator::Position::End); }

	void push_back(Value value) {
		ensureCapacity(m_size + 1);
		m_data[m_size++] = value;
	}

	void prepend(Value value) {
		ensureCapacity(m_size + 1);
		if (m_size > 0) {
			std::memmove(m_data.get() + 1, m_data.get(), m_size * sizeof(Value));
		}
		m_data[0] = value;
		++m_size;
	}

	void append(const Value* values, size_t count) {
		if (count == 0) {
			return;
		}
		ensureCapacity(m_size + count);
		std::memcpy(m_data.get() + m_size, values, count * sizeof(Value));
		m_size += count;
	}

	template <typename T>
	void emplace_back(T&& value) {
		push_back(static_cast<Value>(std::forward<T>(value)));
	}

	void insert(iterator position, Value value) {
		if (position.position() == iterator::Position::Begin) {
			prepend(value);
			return;
		}
		push_back(value);
	}

	template <typename InputIt>
	void insert(iterator position, InputIt first, InputIt last) {
		const size_t count = static_cast<size_t>(std::distance(first, last));
		if (count == 0) {
			return;
		}
		ensureCapacity(m_size + count);
		if (position.position() == iterator::Position::Begin) {
			std::memmove(m_data.get() + count, m_data.get(), m_size * sizeof(Value));
			size_t index = 0;
			for (; first != last; ++first, ++index) {
				m_data[index] = static_cast<Value>(*first);
			}
			m_size += count;
			return;
		}
		for (; first != last; ++first) {
			m_data[m_size++] = static_cast<Value>(*first);
		}
	}

	void ensureCapacity(size_t needed) {
		if (needed <= m_capacity) {
			return;
		}
		size_t nextCapacity = m_capacity == 0 ? 8 : m_capacity;
		while (nextCapacity < needed) {
			nextCapacity <<= 1;
		}
		std::unique_ptr<Value[]> next = std::make_unique<Value[]>(nextCapacity);
		if (m_size > 0) {
			std::memcpy(next.get(), m_data.get(), m_size * sizeof(Value));
		}
		m_data = std::move(next);
		m_capacity = nextCapacity;
	}

	std::unique_ptr<Value[]> m_data;
	size_t m_size = 0;
	size_t m_capacity = 0;
};

/**
 * Native function signature - takes args, writes results into out buffer.
 */
using NativeFunctionInvoke = std::function<void(NativeArgsView, NativeResults&)>;

class NativeResultsScratchScope {
public:
	NativeResultsScratchScope(CPU& cpu, NativeResults& out) noexcept;
	NativeResultsScratchScope(const NativeResultsScratchScope&) = delete;
	NativeResultsScratchScope& operator=(const NativeResultsScratchScope&) = delete;
	NativeResultsScratchScope(NativeResultsScratchScope&& other) noexcept;
	NativeResultsScratchScope& operator=(NativeResultsScratchScope&& other) = delete;
	~NativeResultsScratchScope();

	NativeResults& get() noexcept { return *m_out; }

private:
	CPU* m_cpu = nullptr;
	NativeResults* m_out = nullptr;
};

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
};

/**
 * Native function wrapper for C++ functions callable from Lua.
 */
struct NativeFunction : GCObject {
	std::string name;
	NativeFunctionInvoke invoke;
	uint16_t cycleBase = 1;
	uint8_t cyclePerArg = 0;
	uint8_t cyclePerRet = 0;
};

/**
 * Native object wrapper for exposing C++ objects to Lua.
 */
struct NativeObject : GCObject {
	void* raw = nullptr;
	std::function<Value(const Value&)> get;
	std::function<void(const Value&, const Value&)> set;
	std::function<int()> len;
	std::function<std::optional<std::pair<Value, Value>>(const Value&)> nextEntry;
	std::function<void(GcHeap&)> mark;
	Table* metatable = nullptr;
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
	StringPool* constPoolStringPool = nullptr;
	std::vector<Proto> protos;
	bool constPoolCanonicalized = false;
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
	std::vector<std::vector<std::string>> upvalueNamesByProto;
	std::vector<std::string> globalNames;
	std::vector<std::string> systemGlobalNames;
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
	uint32_t bx = 0;
	int32_t sbx = 0;
	int32_t rkB = 0;
	int32_t rkC = 0;
	uint16_t a = 0;
	uint16_t b = 0;
	uint16_t c = 0;
	uint8_t op = 0;
	uint8_t width = 1;
};

struct Upvalue : GCObject {
	bool open = false;
	int index = 0;
	CallFrame* frame = nullptr;
	Value value = valueNil();
};

struct Closure : GCObject {
	int protoIndex = 0;
	std::vector<Upvalue*> upvalues;
};

struct OpenUpvalueSlot {
	CallFrame* frame = nullptr;
	int index = 0;
	Upvalue* upvalue = nullptr;
};

struct TableLoadInlineCache {
	Table* table = nullptr;
	uint32_t version = 0;
	Value value = valueNil();
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
	KNIL,
	KFALSE,
	KTRUE,
	K0,
	K1,
	KM1,
	KSMI,
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
	STORE_MEM_WORDS,
	BR_TRUE,
	BR_FALSE,
	GETSYS,
	SETSYS,
	GETGL,
	SETGL,
	GETI,
	SETI,
	GETFIELD,
	SETFIELD,
	SELF,
	HALT,
};

enum class MemoryAccessKind : uint8_t {
	Word = 0,
	U8 = 1,
	U16LE = 2,
	U32LE = 3,
	F32LE = 4,
	F64LE = 5,
};

enum class RunResult {
	Halted,
	Yielded,
};

struct CallFrame {
	int protoIndex = 0;
	int pc = 0;
	int varargBase = 0;
	int varargCount = 0;
	Value* registers = nullptr;
	int stackBase = 0;
	int stackCapacity = 0;
	Closure* closure = nullptr;
	int returnBase = 0;
	int returnCount = 0;
	int top = 0;
	bool captureReturns = false;
	int callSitePc = 0;
};

struct TableHashNodeState {
	Value key = valueNil();
	Value value = valueNil();
	int next = -1;
};

struct TableRuntimeState {
	std::vector<Value> array;
	size_t arrayLength = 0;
	std::vector<TableHashNodeState> hash;
	int hashFree = -1;
	Table* metatable = nullptr;
};

struct CpuRuntimeRefSegment {
	bool isIndex = false;
	std::string key;
	int index = 0;
};

enum class CpuValueStateTag : uint8_t {
	Nil,
	False,
	True,
	Number,
	String,
	Ref,
	StableRef,
};

struct CpuValueState {
	CpuValueStateTag tag = CpuValueStateTag::Nil;
	double numberValue = 0;
	StringId stringId = 0;
	int refId = -1;
	std::vector<CpuRuntimeRefSegment> path;
};

struct CpuTableHashNodeSnapshot {
	CpuValueState key;
	CpuValueState value;
	int next = -1;
};

struct CpuObjectState {
	enum class Kind : uint8_t {
		Table,
		Closure,
		Upvalue,
	};

	Kind kind = Kind::Table;
	std::vector<CpuValueState> array;
	size_t arrayLength = 0;
	std::vector<CpuTableHashNodeSnapshot> hash;
	int hashFree = -1;
	CpuValueState metatable;
	int protoIndex = 0;
	std::vector<int> upvalues;
	bool upvalueOpen = false;
	int upvalueIndex = 0;
	int frameIndex = -1;
	CpuValueState upvalueValue;
};

struct CpuFrameState {
	int protoIndex = 0;
	int pc = 0;
	int closureRef = -1;
	std::vector<CpuValueState> registers;
	std::vector<CpuValueState> varargs;
	int returnBase = 0;
	int returnCount = 0;
	int top = 0;
	bool captureReturns = false;
	int callSitePc = 0;
};

struct CpuRootValueState {
	std::string name;
	CpuValueState value;
};

struct CpuRuntimeState {
	std::vector<CpuRootValueState> globals;
	std::vector<CpuValueState> ioMemory;
	std::vector<CpuRootValueState> moduleCache;
	std::vector<CpuFrameState> frames;
	std::vector<CpuValueState> lastReturnValues;
	std::vector<CpuObjectState> objects;
	std::vector<int> openUpvalues;
	int lastPc = 0;
	uint32_t lastInstruction = 0;
	int instructionBudgetRemaining = 0;
	bool haltedUntilIrq = false;
	bool yieldRequested = false;
};

class Table : public GCObject {
public:
	Table(int arraySize = 0, int hashSize = 0);

	Value get(const Value& key) const;
	void set(const Value& key, const Value& value);
	Value getInteger(int index) const;
	void setInteger(int index, const Value& value);
	Value getStringKey(StringId key) const;
	void setStringKey(StringId key, const Value& value);
	int length() const;
	void clear();
	template <typename Fn>
	void forEachEntry(Fn&& fn) const {
		for (size_t i = 0; i < m_array.size(); ++i) {
			if (!isNil(m_array[i])) {
				fn(valueNumber(static_cast<double>(i + 1)), m_array[i]);
			}
		}
		for (const auto& node : m_hash) {
			if (!isNil(node.key)) {
				fn(node.key, node.value);
			}
		}
	}
	std::optional<std::pair<Value, Value>> nextEntry(const Value& after) const;
	std::optional<std::tuple<size_t, size_t, Value, Value>> nextEntryFromCursor(size_t arrayCursor, size_t hashCursor, const Value& previousHashKey = valueNil()) const;
	TableRuntimeState captureRuntimeState() const;
	void restoreRuntimeState(const TableRuntimeState& state);
	size_t trackedHeapBytes() const;

	Table* getMetatable() const { return m_metatable; }
	void setMetatable(Table* mt) {
		m_metatable = mt;
		bumpVersion();
	}
	uint32_t version() const { return m_version; }

private:
	struct HashNode {
		Value key = valueNil();
		Value value = valueNil();
		int next = -1;
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
	void rawSet(const Value& key, const Value& value);
	void insertHash(const Value& key, const Value& value);
	void removeFromHash(const Value& key);
	void bumpVersion() {
		++m_version;
		if (m_version == 0) {
			m_version = 1;
		}
	}

	std::vector<Value> m_array;
	size_t m_arrayLength = 0;
	std::vector<HashNode> m_hash;
	int m_hashFree = -1;
	Table* m_metatable = nullptr;
	uint32_t m_version = 1;
};

class GcHeap {
public:
	GcHeap() = default;

	template <typename T, typename... Args>
	T* allocate(ObjType type, Args&&... args) {
		auto* obj = new T(std::forward<Args>(args)...);
		obj->type = type;
		obj->marked = false;
		obj->next = m_objects;
		m_objects = obj;
		m_bytesAllocated += sizeof(T);
		if (m_bytesAllocated > m_nextGC) {
			m_collectRequested = true;
		}
		return obj;
	}

	void requestCollection() { m_collectRequested = true; }
	bool needsCollection() const { return m_collectRequested; }
	void collect();
	void suspendCollection() { m_collectionSuspendDepth += 1; }
	void resumeCollection() {
		if (m_collectionSuspendDepth <= 0) {
			throw std::runtime_error("[GcHeap] Collection resume underflow.");
		}
		m_collectionSuspendDepth -= 1;
		if (m_collectionSuspendDepth == 0 && m_collectRequested) {
			collect();
		}
	}

	void markValue(Value v);
	void markObject(GCObject* obj);

	void setRootMarker(std::function<void(GcHeap&)> marker) { m_rootMarker = std::move(marker); }

private:
	void trace();
	void sweep();

	GCObject* m_objects = nullptr;
	std::vector<GCObject*> m_grayStack;
	size_t m_bytesAllocated = 0;
	size_t m_nextGC = 1024 * 1024;
	bool m_collectRequested = false;
	int m_collectionSuspendDepth = 0;
	std::function<void(GcHeap&)> m_rootMarker;
};

class CPU {
public:
	explicit CPU(Memory& memory, StringHandleTable* handleTable = nullptr);

	void setProgram(Program* program, ProgramMetadata* metadata);
	Program* getProgram() const { return m_program; }
	StringId internString(std::string_view value) { return m_stringPool.intern(value); }
	StringPool& stringPool() { return m_stringPool; }
	const StringPool& stringPool() const { return m_stringPool; }
	void reserveStringHandles(StringId minHandle);
	void setExternalRootMarker(std::function<void(GcHeap&)> marker) { m_externalRootMarker = std::move(marker); }
	void setStringIndexTable(Table* table) { m_stringIndexTable = table; }
	void setGlobalByKey(const Value& key, const Value& value);
	Value getGlobalByKey(const Value& key) const;
	void clearGlobalSlots();
	void syncGlobalSlotsToTable();

	Value createNativeFunction(std::string_view name, NativeFunctionInvoke fn, std::optional<NativeFnCost> cost = std::nullopt);
	Value createNativeObject(
		void* raw,
		std::function<Value(const Value&)> get,
		std::function<void(const Value&, const Value&)> set,
		std::function<int()> len = nullptr,
		std::function<std::optional<std::pair<Value, Value>>(const Value&)> nextEntry = nullptr,
		std::function<void(GcHeap&)> mark = nullptr
	);
	Table* createTable(int arraySize = 0, int hashSize = 0);
	Closure* createRootClosure(int protoIndex);

	void start(int entryProtoIndex, const std::vector<Value>& args = {});
	void start(int entryProtoIndex, NativeArgsView args);
	void call(Closure* closure, const std::vector<Value>& args = {}, int returnCount = 0);
	void call(Closure* closure, NativeArgsView args, int returnCount = 0);
	void callExternal(Closure* closure, const std::vector<Value>& args = {});
	void callExternal(Closure* closure, NativeArgsView args);
	NativeResults* swapExternalReturnSink(NativeResults* sink);
	CpuRuntimeState captureRuntimeState(const std::unordered_map<std::string, Value>& moduleCache) const;
	void restoreRuntimeState(const CpuRuntimeState& state, std::unordered_map<std::string, Value>& moduleCache);
	void requestYield();
	void clearYieldRequest();
	void haltUntilIrq();
	void clearHaltUntilIrq();
	bool isHaltedUntilIrq() const { return m_haltedUntilIrq; }
	RunResult run(int instructionBudget);
	RunResult runUntilDepth(int targetDepth, int instructionBudget);
	void unwindToDepth(int targetDepth);
	void step();
	void collectHeap();
	void suspendGc() { m_heap.suspendCollection(); }
	void resumeGc() { m_heap.resumeCollection(); }

	int getFrameDepth() const { return static_cast<int>(m_frames.size()); }
	bool hasFrames() const { return !m_frames.empty(); }
	std::optional<SourceRange> getDebugRange(int pc) const;
	std::vector<std::pair<int, int>> getCallStack() const;
	int getFrameRegisterCount(int frameIndex) const;
	Value readFrameRegister(int frameIndex, int registerIndex) const;
	bool hasFrameUpvalue(int frameIndex, int upvalueIndex) const;
	Value readFrameUpvalue(int frameIndex, int upvalueIndex) const;

	int instructionBudgetRemaining = 0;
	std::vector<Value> lastReturnValues;
	int lastPc = 0;
	uint32_t lastInstruction = 0;
	Table* globals = nullptr;

private:
	friend class NativeResultsScratchScope;

	void executeInstruction(CallFrame& frame, const DecodedInstruction& decoded);
	void runHousekeeping();
	void tickHotLoopHousekeeping();
	void initializeGlobalSlots(ProgramMetadata* metadata);
	void initializeGlobalSlotList(std::vector<StringId>& names, std::vector<Value>& values, std::unordered_map<StringId, size_t>& slotByKey, const std::vector<std::string>& source);
	void pushFrame(CallFrame& caller, Closure* closure, int argBase, int argCount,
		int returnBase, int returnCount, bool captureReturns, int callSitePc);
	void pushFrame(Closure* closure, const Value* args, size_t argCount,
		int returnBase, int returnCount, bool captureReturns, int callSitePc);
	void pushFrame(Closure* closure, const std::vector<Value>& args,
		int returnBase, int returnCount, bool captureReturns, int callSitePc);
	Closure* createClosure(CallFrame& frame, int protoIndex);
	void closeUpvalues(CallFrame& frame);
	Upvalue* findOpenUpvalue(const CallFrame& frame, int index) const;
	const Value& readUpvalue(Upvalue* upvalue);
	void writeUpvalue(Upvalue* upvalue, const Value& value);
	void captureLastReturnValues(const Value* values, int count);
	void writeReturnValues(CallFrame& frame, int base, int count, const Value* values, int valueCount);
	void setRegister(CallFrame& frame, int index, Value value);
	Value* ensureRegisterCapacity(CallFrame& frame, int index);
	Value readMappedMemoryValue(uint32_t addr, MemoryAccessKind accessKind) const;
	void writeMappedMemoryValue(uint32_t addr, MemoryAccessKind accessKind, const Value& value);
	void writeMappedWordSequence(CallFrame& frame, uint32_t addr, int valueBase, int valueCount);
	double requireRegisterNumber(CallFrame& frame, int index) const;
	double requireRKNumber(CallFrame& frame, int rk) const;
	const Value& readRK(CallFrame& frame, int rk);
	template <typename Getter>
	Value resolveTableIndexChain(Table* table, Getter get);
	Value resolveTableIndex(Table* table, const Value& key);
	Value resolveTableIntegerIndex(Table* table, int index);
	Value resolveTableFieldIndex(Table* table, StringId key);
	Value loadTableIndex(const Value& base, const Value& key);
	Value loadTableIntegerIndexCached(int cacheIndex, const Value& base, int index);
	Value loadTableIntegerIndex(const Value& base, int index);
	Value loadTableFieldIndexCached(int cacheIndex, const Value& base, StringId key);
	Value loadTableFieldIndex(const Value& base, StringId key);
	void storeTableIndex(const Value& base, const Value& key, const Value& value);
	void storeTableIntegerIndex(const Value& base, int index, const Value& value);
	void storeTableFieldIndex(const Value& base, StringId key, const Value& value);

	std::unique_ptr<CallFrame> acquireFrame();
	void releaseFrame(std::unique_ptr<CallFrame> frame);
	void ensureStackSize(size_t size);
	void refreshFrameRegisterPointers();
	NativeResultsScratchScope acquireNativeReturnScratch();
	void releaseNativeReturnScratch(NativeResults& out);

	void decodeProgram();
	void markRoots(GcHeap& heap);

	Program* m_program = nullptr;
	ProgramMetadata* m_metadata = nullptr;
	std::vector<std::unique_ptr<CallFrame>> m_frames;
	std::vector<OpenUpvalueSlot> m_openUpvalues;
	bool m_haltedUntilIrq = false;
	bool m_yieldRequested = false;
	Memory& m_memory;
	StringPool m_stringPool;
	GcHeap m_heap;
	std::function<void(GcHeap&)> m_externalRootMarker;
	NativeResults* m_externalReturnSink = nullptr;

	ScratchBuffer<NativeResults> m_nativeReturnScratch;
	size_t m_nativeReturnScratchIndex = 0;

	std::vector<std::unique_ptr<CallFrame>> m_framePool;
	static constexpr int MAX_POOLED_FRAMES = 32;
	std::vector<Value> m_stack;
	int m_stackTop = 0;
	static constexpr int HOT_LOOP_HOUSEKEEPING_STRIDE = 16;

	std::vector<DecodedInstruction> m_decoded;
	std::vector<TableLoadInlineCache> m_tableLoadCaches;
	Value m_indexKey = valueNil();
	std::vector<StringId> m_systemGlobalNames;
	std::vector<Value> m_systemGlobalValues;
	std::unordered_map<StringId, size_t> m_systemGlobalSlotByKey;
	std::vector<StringId> m_globalNames;
	std::vector<Value> m_globalValues;
	std::unordered_map<StringId, size_t> m_globalSlotByKey;
	Table* m_stringIndexTable = nullptr;
	int m_hotLoopHousekeepingCountdown = HOT_LOOP_HOUSEKEEPING_STRIDE;
};

std::string valueToString(const Value& v, const StringPool& stringPool);
const char* valueTypeName(Value v);

} // namespace bmsx
