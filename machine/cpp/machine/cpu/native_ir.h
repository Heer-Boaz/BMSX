#pragma once

#include <optional>
#include <variant>
#include "machine/cpu/native_block.h"
#include "machine/cpu/native_ir_numeric.h"

namespace bmsx {

// The JIT's logical operands are guest slots (or RK constant selectors), not
// host registers. The immediate is an index, an integer word or a byte
// displacement, as selected by the operation.
struct NativeOperands {
	OpCode op;
	u16 a;
	i16 b, c;
	u32 immediate;
};

struct NativeArithmeticHint {
	std::optional<NativeArithmeticFeedback> feedback;
	bool resultFeedsStore;
};

struct NativeFieldRead {
	ValueTag result;
};

struct NativeControlAccess {
	bool checkPrivilege;
};

// A miss that must execute the opcode in the interpreter. The charge and
// top describe only the instructions that already completed.
struct NativeResumePoint {
	u32 pc;
	int cycles, top;
	bool operator==(const NativeResumePoint&) const = default;
};

struct NativeInstruction {
	NativeOperands operands;
	NativeResumePoint before;
	NativeBlockExitSite* slow;
	std::variant<std::monostate, NativeArithmeticHint, NativeFieldRead, NativeControlAccess, NativeNumericPlan> specialization;
};

struct NativeIrBlock {
	std::span<NativeInstruction> instructions;
	NativeBlockExitSite* taken;
	// Primary and alternate successors within this region; size() is external.
	std::array<size_t, 2> successors;
	NativeBlockExitSite* beforeFusedJump = nullptr;
	NativeBlockExitSite* completedCall = nullptr;
	size_t numericPrefix = 0;
};

class NativeIrRegion {
public:
	NativeIrRegion(std::span<const NativeBlockSource> source, const NativeBlockExitHandlers& handlers, bool cpuOwned = false);
	std::span<const NativeIrBlock> blocks() const { return m_blocks; }
	std::vector<std::unique_ptr<NativeBlock>> entries;

private:
	std::vector<NativeInstruction> m_instructions;
	std::vector<NativeIrBlock> m_blocks;
	void translate(const NativeBlockSource& source, const NativeBlockExitHandlers& handlers, bool cpuOwned);
};

// Region discovery uses the same selection as translation, so it can keep a
// guarded read and its consumer in one admitted block.
const DecodedInstruction* nativeNumericFieldConsumer(std::span<const NativeBlockInstruction> instructions);
std::optional<ValueTag> nativeGuardedFieldResult(std::span<const NativeBlockInstruction> instructions);

} // namespace bmsx
