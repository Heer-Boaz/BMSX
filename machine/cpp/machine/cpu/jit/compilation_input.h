#pragma once

#include <algorithm>
#include <optional>
#include <span>
#include <vector>

#include "machine/cpu/jit/limits.h"
#include "machine/cpu/jit/exit_contract.h"
#include "machine/cpu/value.h"

namespace bmsx {

struct DecodedInstruction;

struct NativeBlockInstruction {
	const DecodedInstruction* decoded;
	u32 pc;
};

struct NativeRejectedFieldProof {
	u32 pc;
	ValueTag tag;
};

struct NativeImageConstant {
	u32 index;
	Value value;
};

struct NativeCallProfile {
	u32 pc;
	std::optional<NativeFixedCallPlan> fixed;
};

struct NativeFieldGrowth {
	u32 pc;
	u8 extraHashSlots;
};

// Frozen image and profile inputs, separate from compilation topology.
struct NativeCompileSpecializations {
	std::span<const NativeRejectedFieldProof> rejectedFieldProofs{}; // sorted by PC
	std::span<const NativeImageConstant> imageConstants{}; // sorted by index
	std::span<const NativeCallProfile> calls{}; // sorted by PC; no fixed plan means observe
	std::span<const NativeFieldGrowth> fieldGrowth{}; // sorted by PC; nonzero prefix operands only
};

// Mutable capture storage stays with the active compiler lane. In the worker
// lane the CPU fills it while Idle and the worker reads it while Compiling.
struct NativeCompileSpecializationBuffer {
	std::vector<NativeRejectedFieldProof> rejectedFieldProofs;
	std::vector<NativeImageConstant> imageConstants;
	std::vector<NativeCallProfile> calls;
	std::vector<NativeFieldGrowth> fieldGrowth;

	void clear() {
		rejectedFieldProofs.clear();
		imageConstants.clear();
		calls.clear();
		fieldGrowth.clear();
	}
	NativeCompileSpecializations view() const {
		return {rejectedFieldProofs, imageConstants, calls, fieldGrowth};
	}
};

inline std::optional<Value> nativeImageConstant(std::span<const NativeImageConstant> constants, u32 index) {
	const auto found = std::ranges::lower_bound(constants, index, {}, &NativeImageConstant::index);
	if (found == constants.end() || found->index != index) return std::nullopt;
	return found->value;
}

struct NativeCompilationOptions {
	bool observesArithmetic = false;
	// All admitted source pages have directly backed read-only instructions.
	bool immutableSource = false;
};

// A contiguous source run between guest entries or control-flow boundaries.
// The compiler can create more entries inside it for precise timing and exits.
struct NativeBlockSource {
	std::span<const NativeBlockInstruction> instructions;
	const DecodedInstruction* skippedInstruction = nullptr;
};

} // namespace bmsx
