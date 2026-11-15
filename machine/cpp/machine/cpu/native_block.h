#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <span>
#include <array>
#include <vector>

#include "common/primitives.h"
#include "machine/cpu/value.h"
#include "machine/cpu/native_block_exit.h"
#include "machine/cpu/native_compilation_profile.h"
#include "spec/blua32/opcode.h"
#include "spec/blua32/cop0.h"
#if defined(BMSX_NATIVE_PERF_MAP)
#include "spec/blua32/execution_domain.h"
#endif
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
#include "machine/cpu/diagnostic_execution_profile.h"
#endif

namespace bmsx {

struct DecodedInstruction;
struct DecodedInstructionPage;
struct CallFrame;
class CPU;
class Memory;
class StringPool;
class NativeBlock;
class NativeBlockGate;
class NativeBlockCompiler;
struct NativeCpuRunState;
struct NativeBlockExitSite;

struct NativeBlockLink {
	void disconnect();
	std::uintptr_t patchAddress = 0;
	std::intptr_t executableOffset = 0;
	NativeBlock* target = nullptr;
	NativeBlockLink* previous = nullptr;
	NativeBlockLink* next = nullptr;
};

struct NativeBlockRunState {
	Value* registers = nullptr;
	const Value* constants = nullptr;
	CallFrame* frame = nullptr;
	Value* globalValues = nullptr;
	Value* systemGlobalValues = nullptr;
	u32* cop0Words = nullptr;
	u32 constantCount = 0;
	int remainingCycles = 0;
	int registerTop = 0;
	u32 scalarPc = 0;
	u32 memoryAddress = 0;
	void* exitCode = nullptr;
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	DiagnosticNativeOpcodeCounts diagnosticOpcodes;
#endif
};

// Live inputs/results for a nonallocating builtin. The two consumed arguments
// are independent of the deferred guest-bank publication; success reuses the
// first word for its result and returns the exact completed grant/top.
struct NativeBuiltinCallState {
	Value arguments[2];
	int remainingCycles;
	int registerTop;
};

enum class NativeBlockTransition : u32 {
	Redispatch,
	RebindFrame,
	// The same frame/image remains active; its register storage may have grown.
	NextInstruction,
};

using NativeBlockExitHandler = NativeBlockTransition (*)(CPU*, CallFrame*, const NativeBlockExitSite*);

inline constexpr u8 NATIVE_BLOCK_COMPILATION_THRESHOLD = 64u;
inline constexpr u32 NATIVE_BLOCK_MAX_INSTRUCTIONS = 64u;
inline constexpr size_t NATIVE_CODE_CACHE_MAX_BYTES = 32u * 1024u * 1024u;
inline constexpr int NATIVE_BLOCK_REGISTER_CACHE_CAPACITY = 4;

// Semantic helpers with a fixed successor and no frame, image or device change.
// Ordinary Continue edges use the region's direct branches instead.
inline constexpr bool nativeBlockExitResumesFrame(NativeBlockExit exit) {
	switch (exit) {
	case NativeBlockExit::ReadField: case NativeBlockExit::WriteField:
	case NativeBlockExit::ReadIndex: case NativeBlockExit::WriteIndex:
	case NativeBlockExit::ReadInteger: case NativeBlockExit::WriteInteger:
	case NativeBlockExit::WriteUpvalue: case NativeBlockExit::Vararg:
	case NativeBlockExit::AllocateTable: case NativeBlockExit::Concat: case NativeBlockExit::ConcatRange:
		return true;
	default:
		return false;
	}
}

struct NativeBlockExitSite {
	NativeBlockExit exit = NativeBlockExit::Continue;
	NativeBlockExitHandler handler = nullptr;
	u16 exitA = 0;
	i16 exitB = 0;
	i16 exitC = 0;
	u32 exitBx = 0;
	mutable int tableCacheSlot = -1;
	int cycles = 0;
	int registerTop = 0;
	u32 nextPc = 0;
	u32 currentPc = 0;
	u32 lastPc = 0;
	// Generated exit state: byte offsets into the Value bank, or -1 for
	// host registers whose contents need no publication at this exit.
	std::array<i32, NATIVE_BLOCK_REGISTER_CACHE_CAPACITY> registerOffsets{};
	mutable NativeBlockLink link;
	// Bound on CPU-side publication for CALL returns and same-frame helpers.
	// Image-lifetime cells survive retirement of the source or target region.
	std::array<void* const*, 2> continuationCells{};
};

using NativeBlockExitHandlers = std::array<NativeBlockExitHandler, static_cast<size_t>(NativeBlockExit::Count)>;

struct NativeBlockInstruction {
	const DecodedInstruction* decoded;
	u32 pc;
};

struct NativeBlockSource {
	std::span<const NativeBlockInstruction> instructions;
	const DecodedInstruction* skippedInstruction = nullptr;
	bool fallthrough = false;
};

// Captured on the CPU owner thread. Code emission consumes these bindings,
// not mutable Memory/controller state. The pointed-to owners are used only by
// the generated code after it has been published on the CPU thread.
struct NativeCodeBindings {
	NativeCodeBindings() = default;
	NativeCodeBindings(Memory& memory, StringPool& strings, StringId indexKey, CPU* cpu = nullptr);
	u32 ramBytes = 0;
	u8* ram = nullptr;
	const u8* ramWriteGroups = nullptr;
	const u32* cartridgeSelection = nullptr;
	std::array<const Span<const u8>*, 2> cartridgeRom{};
	const Span<const u8>* systemRom = nullptr;
	StringPool* strings = nullptr;
	StringId indexKey = 0;
	// Only CPU-owned emission may call completion owners. Standalone blocks
	// retain the base run-state ABI and ordinary CALL exits.
	CPU* cpu = nullptr;
	bool profileLowering = false;
};

// Entry descriptors share one executable allocation. Source invalidation retires
// every entry which can reach its internal labels before this storage is freed.
class NativeCodeRegion {
public:
	NativeCodeRegion() = default;
	void publish(size_t& cacheBytes);
#if defined(BMSX_NATIVE_PERF_MAP)
	void recordPerfMap(ExecutionDomainId domain, u32 slot, u32 firstPc) const;
#endif
	~NativeCodeRegion();
	NativeCodeRegion(const NativeCodeRegion&) = delete;
	NativeCodeRegion& operator=(const NativeCodeRegion&) = delete;
	size_t codeBytes = 0;
	std::unique_ptr<const NativeLoweringStats> loweringStats;
private:
	friend class NativeBlock;
	void* m_code = nullptr;
	size_t* m_cacheBytes = nullptr;
};

// Cached fields and plain RAM stay in generated code. Slow exits return their precise
// state map before a semantic helper can allocate, raise or invalidate code.
inline constexpr bool nativeBlockSupports(u8 op) {
	switch (static_cast<OpCode>(op)) {
		case OpCode::MOV:
		case OpCode::GETT:
		case OpCode::SETT:
		case OpCode::GETI:
		case OpCode::SETI:
		case OpCode::SELF:
		case OpCode::LEN:
		case OpCode::NEWT:
		case OpCode::CONCAT:
		case OpCode::CONCATN:
		case OpCode::CLOSURE:
		case OpCode::MFC0:
		case OpCode::MTC0:
		case OpCode::RFE:
		case OpCode::LOADK:
		case OpCode::LOADKR:
		case OpCode::LOADNIL:
		case OpCode::GETGL:
		case OpCode::SETGL:
		case OpCode::GETSYS:
		case OpCode::SETSYS:
		case OpCode::GETUP:
		case OpCode::SETUP:
		case OpCode::VARARG:
		case OpCode::KNIL:
		case OpCode::KFALSE:
		case OpCode::KTRUE:
		case OpCode::K0:
		case OpCode::K1:
		case OpCode::KM1:
		case OpCode::KSMI:
		case OpCode::ADD:
		case OpCode::SUB:
		case OpCode::MUL:
		case OpCode::DIV:
		case OpCode::MOD:
		case OpCode::FLOORDIV:
		case OpCode::POW:
		case OpCode::UNM:
		case OpCode::NOT:
		case OpCode::BAND:
		case OpCode::BOR:
		case OpCode::BXOR:
		case OpCode::SHL:
		case OpCode::SHR:
		case OpCode::BNOT:
		case OpCode::JMP:
		case OpCode::JMPIF:
		case OpCode::JMPIFNOT:
		case OpCode::EQ:
		case OpCode::LT:
		case OpCode::LE:
		case OpCode::HALT:
		case OpCode::CALL:
		case OpCode::RET:
		case OpCode::GETFIELD:
		case OpCode::SETFIELD:
		case OpCode::LOAD_MEM:
		case OpCode::LOAD_MEM_D:
		case OpCode::STORE_MEM:
		case OpCode::STORE_MEM_D:
		case OpCode::STORE_MEM_WORDS:
		case OpCode::STORE_MEM_WORDS_D:
			return true;
		default:
			return false;
	}
}

// These instructions can complete through a semantic helper at their next PC.
// Publish that entry before code generation rather than discovering it by
// repeatedly translating an already compiled interior.
inline constexpr bool nativeBlockHasContinuation(u8 op, int field) {
	switch (static_cast<OpCode>(op)) {
		case OpCode::GETFIELD: case OpCode::SETFIELD: case OpCode::SELF:
		case OpCode::GETT: case OpCode::SETT: case OpCode::GETI: case OpCode::SETI:
		case OpCode::SETUP: case OpCode::VARARG:
		case OpCode::LOAD_MEM: case OpCode::LOAD_MEM_D:
		case OpCode::STORE_MEM: case OpCode::STORE_MEM_D:
		case OpCode::STORE_MEM_WORDS: case OpCode::STORE_MEM_WORDS_D:
		case OpCode::NEWT: case OpCode::CONCAT: case OpCode::CONCATN:
		case OpCode::CLOSURE: case OpCode::CALL: case OpCode::LEN:
			return true;
		case OpCode::MTC0: return field == COP0_STATUS;
		default: return false;
	}
}

inline constexpr bool nativeBlockComparison(u8 op) {
	return op == static_cast<u8>(OpCode::EQ) || op == static_cast<u8>(OpCode::LT) || op == static_cast<u8>(OpCode::LE);
}

inline constexpr auto NATIVE_BLOCK_BOUNDARY_OPS = [] {
	// Decoded dispatch opcodes are bytes, including the internal pseudo-ops.
	std::array<bool, 256> boundaries{};
	for (const auto op : {OpCode::JMP, OpCode::JMPIF, OpCode::JMPIFNOT, OpCode::HALT,
		OpCode::CALL, OpCode::RET, OpCode::NEWT, OpCode::CLOSURE, OpCode::CONCAT, OpCode::CONCATN,
		OpCode::STORE_MEM_WORDS, OpCode::STORE_MEM_WORDS_D, OpCode::RFE, OpCode::EQ, OpCode::LT, OpCode::LE}) {
		boundaries[static_cast<u8>(op)] = true;
	}
	return boundaries;
}();

inline constexpr bool nativeBlockEndsBlock(u8 op, int field) {
	return NATIVE_BLOCK_BOUNDARY_OPS[op]
		|| (op == static_cast<u8>(OpCode::MTC0) && (field == COP0_STATUS || field == COP0_EXEC || !cop0FieldImplemented(field)));
}

inline constexpr NativeBlockExit nativeBlockSlowExit(u8 op, int field, bool controlGuarded) {
	switch (static_cast<OpCode>(op)) {
		case OpCode::MFC0:
		case OpCode::MTC0: return controlGuarded && cop0FieldImplemented(field) ? NativeBlockExit::Continue : NativeBlockExit::ControlFault;
		case OpCode::GETFIELD: return NativeBlockExit::ReadField;
		case OpCode::SELF: return NativeBlockExit::ReadField;
		case OpCode::SETFIELD: return NativeBlockExit::WriteField;
		case OpCode::GETT: return NativeBlockExit::ReadIndex;
		case OpCode::SETT: return NativeBlockExit::WriteIndex;
		case OpCode::GETI: return NativeBlockExit::ReadInteger;
		case OpCode::SETI: return NativeBlockExit::WriteInteger;
		case OpCode::LEN: return NativeBlockExit::InvalidLength;
		case OpCode::SETUP: return NativeBlockExit::WriteUpvalue;
		case OpCode::VARARG: return NativeBlockExit::Vararg;
		case OpCode::LOADKR: return NativeBlockExit::InvalidConstant;
		case OpCode::LOAD_MEM:
		case OpCode::LOAD_MEM_D: return NativeBlockExit::ReadMemory;
		case OpCode::STORE_MEM:
		case OpCode::STORE_MEM_D: return NativeBlockExit::WriteMemory;
		case OpCode::STORE_MEM_WORDS:
		case OpCode::STORE_MEM_WORDS_D: return NativeBlockExit::WriteWords;
		default: return NativeBlockExit::Continue;
	}
}

class NativeBlock {
public:
	static std::unique_ptr<NativeBlock> compile(
		std::span<const NativeBlockInstruction> instructions,
		const Value* constants,
		size_t& cacheBytes,
		Memory& memory,
		StringPool& strings,
		StringId indexKey,
		const NativeBlockExitHandlers& exitHandlers = {},
		const DecodedInstruction* skippedInstruction = nullptr
	);
	static std::vector<std::unique_ptr<NativeBlock>> compileRegion(
		std::span<const NativeBlockSource> sources, const Value* constants,
		const NativeCodeBindings& bindings,
		const NativeBlockExitHandlers& exitHandlers = {}
	);
	~NativeBlock();
	NativeBlock(const NativeBlock&) = delete;
	NativeBlock& operator=(const NativeBlock&) = delete;

	const NativeBlockExitSite* run(NativeBlockRunState& state) const;
	void linkFrom(const NativeBlockExitSite& source);

	std::shared_ptr<NativeCodeRegion> region;
	u32 firstPc = 0;
	bool hasFusedJump = false;
	NativeBlockExitSite terminal;
	std::vector<NativeBlockExitSite> sideExits;
	int admissionCycles = 0;
	// Dependency extent includes the linear successors admitted by this entry.
	u16 sourceWords = 0;

private:
	friend struct NativeBlockLink;
	friend class CPU;
	friend class NativeBlockCompiler;
	void execute(NativeCpuRunState& state) const;
	static std::unique_ptr<NativeBlock> prepare(const NativeBlockSource& source, const NativeBlockExitHandlers& exitHandlers,
		bool builtinCall);
	NativeBlock() = default;
	void* m_body = nullptr;
	void* m_linkEntry = nullptr;
	const NativeBlockGate* m_gate = nullptr;
	NativeBlockLink* m_incoming = nullptr;
};

} // namespace bmsx
