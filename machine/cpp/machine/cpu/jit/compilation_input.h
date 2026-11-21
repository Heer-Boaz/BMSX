#pragma once

#include <algorithm>
#include <optional>
#include <span>

#include "machine/cpu/jit/limits.h"
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

// Frozen image and profile inputs, separate from compilation topology.
struct NativeCompileSpecializations {
	std::span<const NativeRejectedFieldProof> rejectedFieldProofs{}; // sorted by PC
	std::span<const NativeImageConstant> imageConstants{}; // sorted by index
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
