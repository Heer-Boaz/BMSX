#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <span>
#include <array>
#include <vector>

#include "common/primitives.h"
#include "machine/cpu/value_slots.h"
#include "machine/cpu/native_block_exit.h"
#include "machine/cpu/table_lookup.h"
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
class GcHeap;
class NativeBlock;
class NativeBlockGate;
class NativeLowering;
class NativeIrRegion;
struct NativeCpuRunState;
struct NativeBlockExitSite;
struct NativeTableConstructor;

struct NativeBlockLink {
	void disconnect();
	std::uintptr_t patchAddress = 0;
	std::uintptr_t coldEntry = 0;
	std::intptr_t executableOffset = 0;
	NativeBlock* target = nullptr;
	NativeBlockLink* previous = nullptr;
	NativeBlockLink* next = nullptr;
};

static_assert(sizeof(TableStringReadCache) <= sizeof(NativeBlockLink));

struct NativeBlockRunState {
	ConstValueSpan constants;
	CallFrame* frame = nullptr;
	GcHeap* heap = nullptr;
	ValueSpan globalValues;
	ValueSpan systemGlobalValues;
	u32* cop0Words = nullptr;
	u32 constantCount = 0;
	int remainingCycles = 0;
	int registerTop = 0;
	void* exitCode = nullptr;
	// Host base of guest main RAM; the gate pins it for the whole native frame.
	u8* ram = nullptr;
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	DiagnosticNativeOpcodeCounts diagnosticOpcodes;
#endif
};

inline constexpr u8 NATIVE_BLOCK_COMPILATION_THRESHOLD = 64u;
inline constexpr u32 NATIVE_BLOCK_MAX_INSTRUCTIONS = 64u;
inline constexpr size_t NATIVE_CODE_CACHE_MAX_BYTES = 32u * 1024u * 1024u;

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
	NativeExitOperands operands{};
	int cycles = 0;
	int registerTop = 0;
	u32 nextPc = 0;
	u32 currentPc = 0;
	u32 lastPc = 0;
	// Only Continue edges can link to another native entry. Table side
	// exits instead use the same storage for their callsite prediction.
	union {
		mutable NativeBlockLink link{};
		mutable TableStringReadCache tableReadCache;
		mutable i32 tableStoreSlot;
		NativeTableConstructor* recordConstructor;
	};
	// Bound on CPU-side publication for CALL returns and same-frame helpers.
	// Image-lifetime cells survive retirement of the source or target region.
	std::array<void* const*, 2> continuationCells{};
};

struct NativeBlockInstruction {
	const DecodedInstruction* decoded;
	u32 pc;
};

enum class NativeCompilationTier : u8 { OnDemand, ColdImage };

// A contiguous source run between guest entries or control-flow boundaries.
// The compiler can create more entries inside it for precise timing and exits.
struct NativeBlockSource {
	std::span<const NativeBlockInstruction> instructions;
	const DecodedInstruction* skippedInstruction = nullptr;
};

// Captured on the CPU owner thread. Code emission consumes these bindings,
// not mutable Memory/controller state. The pointed-to owners are used only by
// the generated code after it has been published on the CPU thread.
struct NativeCodeBindings {
	NativeCodeBindings() = default;
	NativeCodeBindings(Memory& memory, StringPool& strings, StringId indexKey, CPU* cpu = nullptr);
	u32 ramBytes = 0;
	u8* ram = nullptr;
	const u32* ramBusEnd = nullptr;
	const u32* ramWriteGroups = nullptr;
	const u32* ramCodeWatchWords = nullptr;
	const Memory* memory = nullptr;
	StringPool* strings = nullptr;
	StringId indexKey = 0;
	// Only CPU-owned emission may call completion owners. Standalone blocks
	// retain the base run-state ABI and ordinary CALL exits.
	CPU* cpu = nullptr;
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
	u32 sourceInstructions = 0;
	// The main RAM the generated code addresses through the pinned RAM base.
	u8* ram = nullptr;
private:
	friend class NativeBlock;
	void* m_code = nullptr;
	std::vector<NativeBlockExitSite> m_replaySites;
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

// Source discovery already ends the run at these instructions. Feed their
// successor if the ordinary CPU can return there.
inline constexpr bool nativeBlockHasTerminalContinuation(u8 op, int field) {
	switch (static_cast<OpCode>(op)) {
		case OpCode::STORE_MEM_WORDS: case OpCode::STORE_MEM_WORDS_D:
		case OpCode::NEWT: case OpCode::CONCAT: case OpCode::CONCATN:
		case OpCode::CLOSURE: case OpCode::CALL:
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

class NativeBlock {
public:
	// Source runs contain at most one decoded page's worth of instructions.
	static std::vector<std::unique_ptr<NativeBlock>> compileRegion(
		std::span<const NativeBlockSource> sources, ConstValueSpan constants,
		const NativeCodeBindings& bindings, NativeCompilationTier tier = NativeCompilationTier::OnDemand
	);
	~NativeBlock();
	NativeBlock(const NativeBlock&) = delete;
	NativeBlock& operator=(const NativeBlock&) = delete;

	const NativeBlockExitSite* run(const ValueSpan& registers, NativeBlockRunState& state) const;
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
	friend class NativeLowering;
	void execute(NativeCpuRunState& state) const;
	friend class NativeIrRegion;
	NativeBlock() = default;
	void* m_body = nullptr;
	void* m_linkEntry = nullptr;
	const NativeBlockGate* m_gate = nullptr;
	NativeBlockLink* m_incoming = nullptr;
};

} // namespace bmsx
