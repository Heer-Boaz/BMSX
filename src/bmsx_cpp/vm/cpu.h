#pragma once

#include <cstdint>
#include <cstring>
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

#include "../core/types.h"

namespace bmsx {

class VMHeap;

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
	StringId intern(std::string_view value) {
		auto it = m_stringMap.find(value);
		if (it != m_stringMap.end()) {
			return it->second;
		}
		auto entry = std::make_unique<InternedString>();
		entry->id = static_cast<StringId>(m_entries.size());
		entry->value.assign(value.data(), value.size());
		entry->codepointCount = countCodepoints(entry->value);
		StringId id = entry->id;
		m_entries.push_back(std::move(entry));
		m_stringMap.emplace(std::string_view(m_entries.back()->value), id);
		return id;
	}

	const std::string& toString(StringId id) const {
		return m_entries.at(static_cast<size_t>(id))->value;
	}

	int codepointCount(StringId id) const {
		return m_entries.at(static_cast<size_t>(id))->codepointCount;
	}

private:
	static size_t utf8NextIndex(std::string_view text, size_t index) {
		unsigned char c0 = static_cast<unsigned char>(text[index]);
		if (c0 < 0x80) {
			return index + 1;
		}
		if ((c0 & 0xE0) == 0xC0) {
			return index + 2;
		}
		if ((c0 & 0xF0) == 0xE0) {
			return index + 3;
		}
		return index + 4;
	}

	static int countCodepoints(std::string_view text) {
		int count = 0;
		size_t index = 0;
		while (index < text.size()) {
			index = utf8NextIndex(text, index);
			count += 1;
		}
		return count;
	}

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
		return static_cast<size_t>(v ^ (v >> 32));
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
};

/**
 * Native function wrapper for C++ functions callable from Lua.
 */
struct NativeFunction : GCObject {
	std::string name;
	NativeFunctionInvoke invoke;
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
	std::function<void(VMHeap&)> mark;
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
	std::vector<Proto> protos;
	bool constPoolCanonicalized = false;
};

struct ProgramMetadata {
	std::vector<std::optional<SourceRange>> debugRanges;
	std::vector<std::string> protoIds;
};

constexpr int INSTRUCTION_BYTES = 4;

struct DecodedInstruction {
	uint32_t word = 0;
	uint8_t op = 0;
	uint8_t a = 0;
	uint8_t b = 0;
	uint8_t c = 0;
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

/**
 * VM opcodes - instruction set for the bytecode interpreter.
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
	Table(int arraySize = 0, int hashSize = 0);

	Value get(const Value& key) const;
	void set(const Value& key, const Value& value);
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
	std::vector<std::pair<Value, Value>> entries() const;
	std::optional<std::pair<Value, Value>> nextEntry(const Value& after) const;

	Table* getMetatable() const { return m_metatable; }
	void setMetatable(Table* mt) { m_metatable = mt; }

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

	std::vector<Value> m_array;
	size_t m_arrayLength = 0;
	std::vector<HashNode> m_hash;
	int m_hashFree = -1;
	Table* m_metatable = nullptr;
};

class VMHeap {
public:
	VMHeap() = default;

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

	void markValue(Value v);
	void markObject(GCObject* obj);

	void setRootMarker(std::function<void(VMHeap&)> marker) { m_rootMarker = std::move(marker); }

private:
	void trace();
	void sweep();

	GCObject* m_objects = nullptr;
	std::vector<GCObject*> m_grayStack;
	size_t m_bytesAllocated = 0;
	size_t m_nextGC = 1024 * 1024;
	bool m_collectRequested = false;
	std::function<void(VMHeap&)> m_rootMarker;
};

class VMCPU {
public:
	explicit VMCPU(std::vector<Value>& memory);

	void setProgram(Program* program, ProgramMetadata* metadata);
	Program* getProgram() const { return m_program; }
	StringId internString(std::string_view value) { return m_stringPool.intern(value); }
	const StringPool& stringPool() const { return m_stringPool; }
	void setExternalRootMarker(std::function<void(VMHeap&)> marker) { m_externalRootMarker = std::move(marker); }

	Value createNativeFunction(std::string_view name, NativeFunctionInvoke fn);
	Value createNativeObject(
		void* raw,
		std::function<Value(const Value&)> get,
		std::function<void(const Value&, const Value&)> set,
		std::function<int()> len = nullptr,
		std::function<std::optional<std::pair<Value, Value>>(const Value&)> nextEntry = nullptr,
		std::function<void(VMHeap&)> mark = nullptr
	);
	Table* createTable(int arraySize = 0, int hashSize = 0);
	Closure* createRootClosure(int protoIndex);

	void start(int entryProtoIndex, const std::vector<Value>& args = {});
	void call(Closure* closure, const std::vector<Value>& args = {}, int returnCount = 0);
	void callExternal(Closure* closure, const std::vector<Value>& args = {});
	RunResult run(std::optional<int> instructionBudget = std::nullopt);
	RunResult runUntilDepth(int targetDepth, std::optional<int> instructionBudget = std::nullopt);
	void step();

	int getFrameDepth() const { return static_cast<int>(m_frames.size()); }
	bool hasFrames() const { return !m_frames.empty(); }
	std::optional<SourceRange> getDebugRange(int pc) const;
	std::vector<std::pair<int, int>> getCallStack() const;

	std::optional<int> instructionBudgetRemaining;
	std::vector<Value> lastReturnValues;
	int lastPc = 0;
	uint32_t lastInstruction = 0;
	Table* globals = nullptr;

private:
	void executeInstruction(CallFrame& frame, OpCode op, uint8_t aLow, uint8_t bLow, uint8_t cLow, uint8_t wideA, uint8_t wideB, uint8_t wideC);
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
	const Value& readRK(CallFrame& frame, int low, int wide);
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
	void markRoots(VMHeap& heap);

	Program* m_program = nullptr;
	ProgramMetadata* m_metadata = nullptr;
	std::vector<std::unique_ptr<CallFrame>> m_frames;
	std::vector<Value>& m_memory;
	StringPool m_stringPool;
	VMHeap m_heap;
	std::function<void(VMHeap&)> m_externalRootMarker;

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
};

std::string valueToString(const Value& v, const StringPool& stringPool);
const char* valueTypeName(Value v);

} // namespace bmsx
