#pragma once

#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <utility>
#include <variant>
#include <vector>

namespace bmsx {

// Forward declarations
class Table;
struct Closure;
struct NativeFunction;
struct NativeObject;

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

/**
 * Value type - the core type for all VM values.
 * Uses std::variant to represent Lua's dynamic typing.
 *
 * Order matters for std::monostate (nil), bool, double, string, then pointer types.
 */
using Value = std::variant<
	std::monostate,              // nil
	bool,                         // boolean
	double,                       // number
	std::string,                  // string
	std::shared_ptr<Table>,       // table
	std::shared_ptr<Closure>,     // closure/function
	std::shared_ptr<NativeFunction>, // native function
	std::shared_ptr<NativeObject>    // native object wrapper
>;

// Type indices for Value variant
constexpr size_t VALUE_NIL = 0;
constexpr size_t VALUE_BOOL = 1;
constexpr size_t VALUE_NUMBER = 2;
constexpr size_t VALUE_STRING = 3;
constexpr size_t VALUE_TABLE = 4;
constexpr size_t VALUE_CLOSURE = 5;
constexpr size_t VALUE_NATIVE_FUNCTION = 6;
constexpr size_t VALUE_NATIVE_OBJECT = 7;

/**
 * Check if a Value is nil.
 */
inline bool isNil(const Value& v) {
	return std::holds_alternative<std::monostate>(v);
}

/**
 * Check if a Value is truthy (not nil and not false).
 */
inline bool isTruthy(const Value& v) {
	if (isNil(v)) return false;
	if (auto* b = std::get_if<bool>(&v)) return *b;
	return true;
}

/**
 * Get a Value as a number, or 0 if not a number.
 */
inline double asNumber(const Value& v) {
	if (auto* n = std::get_if<double>(&v)) return *n;
	return 0.0;
}

/**
 * Get a Value as a string.
 */
inline const std::string& asString(const Value& v) {
	static const std::string empty;
	if (auto* s = std::get_if<std::string>(&v)) return *s;
	return empty;
}

/**
 * Native function signature - takes args, returns results.
 */
using NativeFunctionInvoke = std::function<std::vector<Value>(const std::vector<Value>&)>;

/**
 * Native function wrapper for C++ functions callable from Lua.
 */
struct NativeFunction {
	std::string name;
	NativeFunctionInvoke invoke;
};

/**
 * Create a native function.
 */
inline std::shared_ptr<NativeFunction> createNativeFunction(
	const std::string& name,
	NativeFunctionInvoke invoke
) {
	return std::make_shared<NativeFunction>(NativeFunction{name, std::move(invoke)});
}

/**
 * Check if a Value is a native function.
 */
inline bool isNativeFunction(const Value& v) {
	return std::holds_alternative<std::shared_ptr<NativeFunction>>(v);
}

/**
 * Native object wrapper for exposing C++ objects to Lua.
 */
struct NativeObject {
	void* raw = nullptr;
	std::function<Value(const Value&)> get;
	std::function<void(const Value&, const Value&)> set;
	std::function<int()> len; // optional
	std::function<std::optional<std::pair<Value, Value>>(const Value&)> next; // optional
};

/**
 * Create a native object wrapper.
 */
inline std::shared_ptr<NativeObject> createNativeObject(
	void* raw,
	std::function<Value(const Value&)> get,
	std::function<void(const Value&, const Value&)> set,
	std::function<int()> len = nullptr,
	std::function<std::optional<std::pair<Value, Value>>(const Value&)> next = nullptr
) {
	return std::make_shared<NativeObject>(NativeObject{raw, std::move(get), std::move(set), std::move(len), std::move(next)});
}

/**
 * Check if a Value is a native object.
 */
inline bool isNativeObject(const Value& v) {
	return std::holds_alternative<std::shared_ptr<NativeObject>>(v);
}

/**
 * Upvalue descriptor - describes how to find an upvalue when creating a closure.
 */
struct UpvalueDesc {
	bool isLocal = false;  // true = local in enclosing function, false = upvalue of enclosing function
	int index = 0;         // register index (if isLocal) or upvalue index (if !isLocal)
};

/**
 * Function prototype - compiled function metadata.
 */
struct Proto {
	int entryPC = 0;         // entry point in global code array
	int maxStack = 0;        // maximum stack size needed
	int numParams = 0;       // number of fixed parameters
	bool isVararg = false;   // accepts varargs
	std::vector<UpvalueDesc> upvalues; // upvalue descriptors
};

/**
 * Compiled program - bytecode, constants, and prototypes.
 */
struct Program {
	std::vector<uint32_t> code;            // bytecode instructions
	std::vector<Value> constPool;          // constant pool
	std::vector<Proto> protos;             // function prototypes
	std::vector<std::optional<SourceRange>> debugRanges; // debug info per instruction
	std::vector<std::string> protoIds;     // prototype identifiers for debugging
};

/**
 * Upvalue - runtime representation of a captured variable.
 */
struct Upvalue;
struct CallFrame;

struct Upvalue {
	bool open = false;       // still on stack?
	int index = 0;           // register index when open
	CallFrame* frame = nullptr; // owning frame when open
	Value value;             // closed value
};

/**
 * Closure - a function value with captured upvalues.
 */
struct Closure {
	int protoIndex = 0;
	std::vector<std::shared_ptr<Upvalue>> upvalues;
};

/**
 * VM opcodes - instruction set for the bytecode interpreter.
 */
enum class OpCode : uint8_t {
	MOV,        // A B     R[A] = R[B]
	LOADK,      // A Bx    R[A] = K[Bx]
	LOADNIL,    // A B     R[A..A+B-1] = nil
	LOADBOOL,   // A B C   R[A] = (B != 0); if C skip next
	GETG,       // A Bx    R[A] = globals[K[Bx]]
	SETG,       // A Bx    globals[K[Bx]] = R[A]
	GETT,       // A B C   R[A] = R[B][RK(C)]
	SETT,       // A B C   R[A][RK(B)] = RK(C)
	NEWT,       // A B C   R[A] = new Table(arraySize=B, hashSize=C)
	ADD,        // A B C   R[A] = RK(B) + RK(C)
	SUB,        // A B C   R[A] = RK(B) - RK(C)
	MUL,        // A B C   R[A] = RK(B) * RK(C)
	DIV,        // A B C   R[A] = RK(B) / RK(C)
	MOD,        // A B C   R[A] = RK(B) % RK(C)
	FLOORDIV,   // A B C   R[A] = floor(RK(B) / RK(C))
	POW,        // A B C   R[A] = RK(B) ^ RK(C)
	BAND,       // A B C   R[A] = RK(B) & RK(C)
	BOR,        // A B C   R[A] = RK(B) | RK(C)
	BXOR,       // A B C   R[A] = RK(B) ^ RK(C) (bitwise)
	SHL,        // A B C   R[A] = RK(B) << RK(C)
	SHR,        // A B C   R[A] = RK(B) >> RK(C)
	CONCAT,     // A B C   R[A] = tostring(RK(B)) .. tostring(RK(C))
	UNM,        // A B     R[A] = -R[B]
	NOT,        // A B     R[A] = not R[B]
	LEN,        // A B     R[A] = #R[B]
	BNOT,       // A B     R[A] = ~R[B]
	EQ,         // A B C   if (RK(B) == RK(C)) != A then skip next
	LT,         // A B C   if (RK(B) < RK(C)) != A then skip next
	LE,         // A B C   if (RK(B) <= RK(C)) != A then skip next
	TEST,       // A B C   if (R[A] is truthy) != C then skip next
	TESTSET,    // A B C   if R[B] is truthy == C then R[A] = R[B], else skip next
	JMP,        // sBx     pc += sBx
	CLOSURE,    // A Bx    R[A] = closure(protos[Bx])
	GETUP,      // A B     R[A] = upvalues[B]
	SETUP,      // A B     upvalues[B] = R[A]
	VARARG,     // A B     R[A..A+B-1] = varargs (B=0 means all)
	CALL,       // A B C   R[A..A+C-1] = R[A](R[A+1..A+B]) (B=0: varargs, C=0: multi-return)
	RET,        // A B     return R[A..A+B-1] (B=0: return all from A to top)
	LOAD_MEM,   // A B     R[A] = memory[R[B]]
	STORE_MEM,  // A B     memory[R[B]] = R[A]
};

/**
 * Run result - whether execution halted or yielded.
 */
enum class RunResult {
	Halted,   // no more frames to execute
	Yielded,  // yielded due to instruction budget
};

/**
 * Call frame - represents a function activation on the call stack.
 */
struct CallFrame {
	int protoIndex = 0;
	int pc = 0;
	std::vector<Value> registers;
	std::vector<Value> varargs;
	std::shared_ptr<Closure> closure;
	std::unordered_map<int, std::shared_ptr<Upvalue>> openUpvalues;
	int returnBase = 0;
	int returnCount = 0;
	int top = 0;
	bool captureReturns = false;
	int callSitePc = 0;
};

/**
 * Lua table implementation.
 *
 * Supports both array-style (1-based integer keys) and hash-style access.
 * Metatables are supported for operator overloading.
 */
class Table {
public:
	Table(int arraySize = 0, int hashSize = 0);
	// Canonicalized identifiers rely on case-insensitive string keys to mirror TS VM semantics.
	static void setCaseInsensitiveKeys(bool enabled);

	Value get(const Value& key) const;
	void set(const Value& key, const Value& value);
	int length() const;
	void clear();
	std::vector<std::pair<Value, Value>> entries() const;
	std::optional<std::pair<Value, Value>> nextEntry(const Value& after) const;

	std::shared_ptr<Table> getMetatable() const { return m_metatable; }
	void setMetatable(std::shared_ptr<Table> mt) { m_metatable = std::move(mt); }

private:
	bool isArrayIndex(const Value& key) const;
	int toArrayIndex(const Value& key) const;
	std::optional<size_t> findMapIndex(const Value& key) const;
	void ensureUppercaseIndex() const;
	static std::string toUpperAscii(const std::string& value);

	static bool s_caseInsensitiveKeys;

	std::vector<Value> m_array;
	std::vector<std::pair<Value, Value>> m_map;
	std::shared_ptr<Table> m_metatable;
	mutable std::unordered_map<std::string, size_t> m_uppercaseIndex;
	mutable bool m_uppercaseIndexValid = false;
};

/**
 * VM CPU - the bytecode interpreter.
 *
 * Executes compiled Lua programs with:
 * - Register-based instruction set
 * - Upvalue support for closures
 * - Memory-mapped I/O region
 * - Frame and register pooling for performance
 */
class VMCPU {
public:
	explicit VMCPU(std::vector<Value>& memory);

	// Program management
	void setProgram(Program* program);
	Program* getProgram() const { return m_program; }

	// Execution control
	void start(int entryProtoIndex, const std::vector<Value>& args = {});
	void call(std::shared_ptr<Closure> closure, const std::vector<Value>& args = {}, int returnCount = 0);
	void callExternal(std::shared_ptr<Closure> closure, const std::vector<Value>& args = {});
	RunResult run(std::optional<int> instructionBudget = std::nullopt);
	RunResult runUntilDepth(int targetDepth, std::optional<int> instructionBudget = std::nullopt);
	void step();

	// State inspection
	int getFrameDepth() const { return static_cast<int>(m_frames.size()); }
	bool hasFrames() const { return !m_frames.empty(); }
	std::optional<SourceRange> getDebugRange(int pc) const;
	std::vector<std::pair<int, int>> getCallStack() const; // [(protoIndex, pc), ...]

	// Public state
	std::optional<int> instructionBudgetRemaining;
	std::vector<Value> lastReturnValues;
	int lastPc = 0;
	uint32_t lastInstruction = 0;
	Table globals;

private:
	void executeInstruction(CallFrame& frame, uint32_t instr);
	void pushFrame(std::shared_ptr<Closure> closure, const std::vector<Value>& args,
	               int returnBase, int returnCount, bool captureReturns, int callSitePc);
	std::shared_ptr<Closure> createClosure(CallFrame& frame, int protoIndex);
	void closeUpvalues(CallFrame& frame);
	Value readUpvalue(const std::shared_ptr<Upvalue>& upvalue);
	void writeUpvalue(const std::shared_ptr<Upvalue>& upvalue, const Value& value);
	void writeReturnValues(CallFrame& frame, int base, int count, const std::vector<Value>& values);
	void setRegister(CallFrame& frame, int index, const Value& value);
	Value readRK(CallFrame& frame, int operand);
	Value resolveTableIndex(const std::shared_ptr<Table>& table, const Value& key);

	// Frame pooling
	std::unique_ptr<CallFrame> acquireFrame();
	void releaseFrame(std::unique_ptr<CallFrame> frame);

	Program* m_program = nullptr;
	std::vector<std::unique_ptr<CallFrame>> m_frames;
	std::vector<Value>& m_memory;

	// Scratch buffers for avoiding allocations
	std::vector<Value> m_valueScratch;
	std::vector<Value> m_returnScratch;

	// Frame pool
	std::vector<std::unique_ptr<CallFrame>> m_framePool;
	static constexpr int MAX_POOLED_FRAMES = 32;
};

/**
 * Convert a Value to its string representation.
 */
std::string valueToString(const Value& v);

} // namespace bmsx
