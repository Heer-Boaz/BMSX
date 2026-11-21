#pragma once

#include "machine/cpu/native_block.h"
#include "machine/cpu/native_ir_ops.h"

#include <limits>
#include <utility>

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
	bool operator==(const NativeResumePoint&) const = default;
};

#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
enum class NativeAttempt : u8 { None, NewTable, Call, AssignField, Concat, ConcatRange };
#endif

struct NativeInstruction {
	NativeOperation operation;
	NativeSlotAccess slots;
	NativeResumePoint before;
	NativeBlockExitSite* slow;
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	NativeAttempt attempt = NativeAttempt::None;
#endif

	NativeInstruction(NativeOperation operation, NativeResumePoint before = {}, NativeBlockExitSite* slow = nullptr)
		: operation(std::move(operation)), slots(std::visit([](const auto& op) { return op.slots(); }, this->operation)), before(before), slow(slow) {}
};

struct NativeIrBlock {
	std::span<NativeInstruction> instructions;
	NativeBlockExitSite* taken;
	// Primary and alternate successors within this region; size() is external.
	std::array<size_t, 2> successors;
	NativeBlockExitSite* beforeFusedJump = nullptr;
	NativeBlockExitSite* completedCall = nullptr;
	size_t optimizationPrefix = 0;
	bool nativeSuccessor = true;
	std::span<const NativeSlotType> entryTypes{};
	size_t typePredecessor = std::numeric_limits<size_t>::max();
};

class NativeIrRegion {
public:
	explicit NativeIrRegion(std::span<const NativeBlockSource> source, ConstValueSpan constants = {},
		bool cpuOwned = false, NativeCompilationTier tier = NativeCompilationTier::OnDemand);
	void optimize(ConstValueSpan constants, NativeRegisterUses& uses);
	std::span<const NativeIrBlock> blocks() const { return m_blocks; }
	size_t instructionCount() const { return m_instructions.size(); }
	std::vector<std::unique_ptr<NativeBlock>> entries;

private:
	std::vector<NativeInstruction> m_instructions;
	std::vector<NativeSlotType> m_entryTypes;
	std::vector<NativeIrBlock> m_blocks;
	void buildBlock(const NativeBlockSource& source, std::span<NativeInstruction> operations, bool cpuOwned);
};

NativeOperation translateNativeOperation(const DecodedInstruction& source, ConstValueSpan constants);
enum class NativeOperationFlow : u8 { Linear, Checkpoint, Terminal, LeavesNative };
NativeOperationFlow nativeOperationFlow(const NativeOperation& operation);
size_t selectNativeFieldPaths(std::span<NativeInstruction> instructions, NativeCompilationTier tier);

} // namespace bmsx
