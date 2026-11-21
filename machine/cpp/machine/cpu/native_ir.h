#pragma once

#include "machine/cpu/native_compilation_input.h"
#include "machine/cpu/native_ir_ops.h"

#include <limits>
#include <utility>
#include <vector>

namespace bmsx {

class NativeRegisterUses;

// A miss that must execute the opcode in the interpreter. The charge and
// top describe only the instructions that already completed.
struct NativeResumePoint {
	struct CompletedInstruction {
		u32 pc, lastWord;
		bool operator==(const CompletedInstruction&) const = default;
	};
	u32 pc;
	int cycles, top;
	std::optional<CompletedInstruction> completed{};
	std::optional<NativeArithmeticFeedback> arithmeticAssumption{};
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

// Each guest instruction contributes at most one check. The remaining
// side exits belong to the block's terminator.
using NativeIrSideExit = std::optional<u8>;
static_assert(NATIVE_BLOCK_MAX_INSTRUCTIONS + 3u < std::numeric_limits<u8>::max());

struct NativeInstruction {
	NativeOperation operation;
	NativeSlotAccess slots;
	NativeResumePoint before;
	NativeIrSideExit slow{};
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	NativeAttempt attempt = NativeAttempt::None;
#endif

	NativeInstruction(NativeOperation operation, NativeResumePoint before = {})
		: operation(std::move(operation)), slots(std::visit([](const auto& op) { return op.slots(); }, this->operation)), before(before) {}
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
	std::span<const NativeSlotType> entryTypes{};
	size_t typePredecessor = std::numeric_limits<size_t>::max();
	NativeIrExit terminal{};
	u32 firstPc = 0;
	int admissionCycles = 0;
	u16 sourceWords = 0;
	u16 firstSideExit = 0;
	u8 sideExitCount = 0;
	bool hasFusedJump = false;
	std::span<const NativeOwnFieldAddress> ownFieldAddresses{};
};

// Temporary source-row links retained only until the region is partitioned.
struct NativeFieldAddressUse {
	u8 definition;
	std::optional<u8> temporary{};
};

class NativeIrRegion {
public:
	explicit NativeIrRegion(std::span<const NativeBlockSource> source, bool cpuOwned = false, NativeCompilationOptions options = {});
	void optimize(NativeRegisterUses& uses);
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
	void bindOwnFieldAddresses(NativeIrBlock& block, std::span<const NativeFieldAddressUse> uses, size_t firstRow);
	void planRecordConstructors(std::span<const u16> byAddress, u32 immutablePagePc);
};

NativeOperation translateNativeOperation(const DecodedInstruction& source);
enum class NativeOperationFlow : u8 { Linear, Checkpoint, Terminal, LeavesNative };
NativeOperationFlow nativeOperationFlow(const NativeOperation& operation);
size_t planNativeFieldReads(std::span<NativeInstruction> instructions, NativeCompilationTier tier,
	std::span<NativeFieldAddressUse> addressUses);

} // namespace bmsx
