#pragma once

#include "machine/cpu/jit/compilation_input.h"
#include "machine/cpu/jit/ir/operations.h"

#include <limits>
#include <utility>
#include <vector>

namespace bmsx {

class NativeRegisterUses;
class NativeSlotValues;

// The observable prefix before a guest instruction. The charge and top
// describe only the instructions that already completed.
struct NativeResumePoint {
	struct CompletedInstruction {
		u32 pc, lastWord;
		bool operator==(const CompletedInstruction&) const = default;
	};
	u32 pc;
	int cycles, top;
	std::optional<CompletedInstruction> completed{};
	bool operator==(const NativeResumePoint&) const = default;
};

#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
enum class NativeAttempt : u8 { None, NewTable, Call, AssignField, Concat, ConcatRange };
#endif

// Compile-time description only. Publication materializes runtime sites and
// prediction storage after the IR has been optimized.
struct NativeIrExit {
	NativeBlockExit exit = NativeBlockExit::Continue;
	NativeExitOperands operands{};
	int cycles = 0;
	int registerTop = 0;
	u32 nextPc = 0;
	u32 currentPc = 0;
	u32 lastPc = 0;
	i32 tableSlotSeed = -1;
};

// Rows can have distinct semantic and scalar exits. The remaining
// side exits belong to the block terminator.
using NativeIrSideExit = std::optional<u8>;
static_assert(3u * NATIVE_BLOCK_MAX_INSTRUCTIONS + 3u < std::numeric_limits<u8>::max());

struct NativeInstruction {
	NativeOperation operation;
	NativeSlotAccess slots;
	u32 pc = 0;
	NativeIrSideExit slow{}, replay{}, feedback{};
	u8 width = 0, baseCycles = 0;
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	NativeAttempt attempt = NativeAttempt::None;
#endif

	explicit NativeInstruction(NativeOperation operation)
		: operation(std::move(operation)), slots(std::visit([](const auto& op) { return op.slots(); }, this->operation)) {}
};

struct NativeOwnFieldAddress {
	u8 definingRow;
	NativeValueRef receiver;
	u16 key;
	std::optional<u8> temporary{};
};

struct NativeIrBlock {
	std::span<NativeInstruction> instructions;
	NativeIrSideExit taken{};
	// Primary and alternate successors within this region; size() is external.
	std::array<size_t, 2> successors{};
	NativeIrSideExit beforeFusedJump{};
	NativeIrSideExit completedCall{};
	bool nativeSuccessor = true;
	bool inlineBuiltin = false;
	std::span<const NativeSlotType> entryTypes{};
	std::array<bool, 2> provesSuccessorTypes{};
	NativeIrExit terminal{};
	u32 firstPc = 0, sourcePc = 0;
	int admissionCycles = 0;
	u16 sourceWords = 0;
	u16 firstSideExit = 0;
	u8 sideExitCount = 0;
	bool hasFusedJump = false;
	u8 skippedWidth = 0, fusedJumpCycles = 0;
	std::span<const NativeOwnFieldAddress> ownFieldAddresses{};

	bool provesEntryTo(size_t target) const {
		return (provesSuccessorTypes[0] && successors[0] == target)
			|| (provesSuccessorTypes[1] && successors[1] == target);
	}
};

// Temporary source-row links retained only until the region is partitioned.
struct NativeFieldAddressUse {
	u8 definition;
	std::optional<u8> temporary{};
};

class NativeIrRegion {
public:
	NativeIrRegion(std::span<const NativeBlockSource> source, NativeRegisterUses& uses, bool cpuOwned = false,
		NativeCompilationOptions options = {}, NativeCompileSpecializations specializations = {});
	std::span<const NativeIrBlock> blocks() const { return m_blocks; }
	std::span<const NativeIrExit> sideExits(const NativeIrBlock& block) const {
		return std::span(m_sideExits).subspan(block.firstSideExit, block.sideExitCount);
	}
	std::span<const NativeRecordPlan> recordPlans() const { return m_records; }
	size_t instructionCount() const { return m_instructions.size(); }

private:
	std::vector<NativeInstruction> m_instructions;
	std::vector<NativeSlotType> m_entryTypes;
	std::vector<NativeIrBlock> m_blocks;
	std::vector<NativeIrExit> m_sideExits;
	std::vector<NativeRecordPlan> m_records;
	std::vector<NativeOwnFieldAddress> m_ownFieldAddresses;
	void buildBlock(const NativeBlockSource& source, std::span<NativeInstruction> operations, bool cpuOwned);
	void finalizeBlockExits(NativeIrBlock& block, bool observesArithmetic);
	void bindOwnFieldAddresses(NativeIrBlock& block, std::span<const NativeFieldAddressUse> uses, size_t firstRow);
	void planRecordConstructors(std::span<const u16> byAddress, u32 immutablePagePc);
};

NativeOperation translateNativeOperation(const DecodedInstruction& source);
enum class NativeOperationFlow : u8 { Linear, Checkpoint, Terminal, LeavesNative };
NativeOperationFlow nativeOperationFlow(const NativeOperation& operation);
void planNativeFieldReads(std::span<NativeInstruction> instructions, std::span<const NativeBlockInstruction> source,
	NativeSlotValues& values, std::span<NativeFieldAddressUse> addressUses, NativeCompileSpecializations specializations);

} // namespace bmsx
