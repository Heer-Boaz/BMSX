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
#if defined(BMSX_NATIVE_PERF_MAP)
#include "spec/blua32/execution_domain.h"
#endif
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
#include "machine/cpu/diagnostic_execution_profile.h"
#endif

namespace bmsx {

struct CallFrame;
class CPU;
class GcHeap;
class NativeBlock;
class NativeBlockGate;
class NativeLowering;
class NativeIrRegion;
class NativeCompiler;
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

struct NativeTableStorePrediction {
	i32 slot;
	void* const* sourceEntry;
};

static_assert(sizeof(NativeTableStorePrediction) <= sizeof(NativeBlockLink));

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
		mutable NativeTableStorePrediction tableStore;
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
	friend class NativeCompiler;
	void* m_code = nullptr;
	std::vector<NativeBlockExitSite> m_replaySites;
	size_t* m_cacheBytes = nullptr;
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
	friend class NativeIrRegion;
	NativeBlock() = default;
	void* m_body = nullptr;
	void* m_linkEntry = nullptr;
	const NativeBlockGate* m_gate = nullptr;
	NativeBlockLink* m_incoming = nullptr;
};

} // namespace bmsx
