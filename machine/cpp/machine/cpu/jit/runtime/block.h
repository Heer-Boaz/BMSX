#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <span>
#include <array>
#include <vector>

#include "common/primitives.h"
#include "machine/cpu/value_slots.h"
#include "machine/cpu/jit/exit_contract.h"
#include "machine/cpu/jit/limits.h"
#include "machine/cpu/table_lookup.h"
#if defined(BMSX_NATIVE_PERF_MAP)
#include "spec/blua32/execution_domain.h"
#endif
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
#include "machine/cpu/diagnostic_execution_profile.h"
#endif

namespace bmsx {

struct CallFrame;
struct Thread;
class CPU;
class GcHeap;
class NativeBlock;
class NativeBlockGate;
class NativeLowering;
class NativeCompiler;
class NativeCodeCache;
struct DecodedInstructionPage;
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

struct NativeBlockRunState {
	void bindWindow(CallFrame&);
	void bindFrame(CallFrame&);
	ConstValueSpan constants;
	CallFrame* frame = nullptr;
	GcHeap* heap = nullptr;
	ValueSpan globalValues;
	ValueSpan systemGlobalValues;
	u32* cop0Words = nullptr;
	StringId tableIndexKey = 0;
	int remainingCycles = 0;
	int registerTop = 0;
	void* exitCode = nullptr;
	// Host base of guest main RAM; the gate pins it for the whole native frame.
	u8* ram = nullptr;
	// The admitted nonwrapping physical extent, including frame-control words.
	u32 stackBegin = 0;
	u32 stackEnd = 0;
	// Standalone execution has no guest frame control in its RAM window.
	u32 frameControl = 2u * MAIN_RAM_SIZE;
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	DiagnosticNativeOpcodeCounts diagnosticOpcodes;
#endif
};

// Semantic exits with a fixed physical successor. The CPU uses it only if
// the path taken retained the frame and image. Pure edges branch directly.
inline constexpr bool nativeBlockExitResumesFrame(NativeBlockExit exit) {
	switch (exit) {
	case NativeBlockExit::ReadField: case NativeBlockExit::WriteField:
	case NativeBlockExit::ReadIndex: case NativeBlockExit::WriteIndex:
	case NativeBlockExit::ReadInteger: case NativeBlockExit::WriteInteger:
	case NativeBlockExit::Length:
	case NativeBlockExit::ReadUpvalue: case NativeBlockExit::WriteUpvalue: case NativeBlockExit::Vararg:
	case NativeBlockExit::AllocateTable: case NativeBlockExit::Concat: case NativeBlockExit::ConcatRange:
		return true;
	default:
		return false;
	}
}

// Emission selects the binding from its compilation owner. Only installed
// code reaches the CPU gate, which always uses the decoded arm.
union NativeTableSlotBinding {
	i32* decoded;
	i32 standalone;
};

struct NativeTableReadPrediction {
	NativeTableSlotBinding own;
	TableStringPathCache path;
};

static_assert(sizeof(NativeTableReadPrediction) <= sizeof(NativeBlockLink));

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
		mutable NativeTableReadPrediction tableRead;
		mutable NativeTableSlotBinding tableStore;
		NativeTableConstructor* recordConstructor;
	};
	// Bound on CPU-side publication for CALL returns and same-frame helpers.
	// Image-lifetime cells survive retirement of the source or target region.
	std::array<void* const*, 2> continuationCells{};
};

// Entry descriptors share one executable allocation. Source invalidation retires
// every entry which can reach its internal labels before this storage is freed.
class NativeCodeRegion {
public:
	NativeCodeRegion() = default;
	// Synchronize on the receiving thread before entering worker-emitted code.
	void synchronizeInstructionStream() const;
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
	friend class NativeCompiler;
	friend class NativeCodeCache;
	friend struct DecodedInstructionPage;
	friend struct NativeBlockPage;
	void withdrawFromCache();
	void* m_code = nullptr;
	std::vector<NativeBlockExitSite> m_replaySites;
	NativeCodeCache* m_cache = nullptr;
	DecodedInstructionPage* m_page = nullptr;
	NativeCodeRegion* m_older = nullptr;
	NativeCodeRegion* m_newer = nullptr;
};

class NativeBlock {
public:
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
	friend class NativeCompiler;
	void execute(NativeCpuRunState& state) const;
	NativeBlock() = default;
	void* m_body = nullptr;
	const NativeBlockGate* m_gate = nullptr;
	NativeBlockLink* m_incoming = nullptr;
};

} // namespace bmsx
