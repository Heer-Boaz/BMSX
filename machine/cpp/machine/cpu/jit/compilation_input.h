#pragma once

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

// Frozen profile inputs, separate from bytecode and compilation topology.
struct NativeCompileSpecializations {
	std::span<const NativeRejectedFieldProof> rejectedFieldProofs{}; // sorted by PC
};

enum class NativeCompilationTier : u8 { OnDemand, ColdImage };

struct NativeCompilationOptions {
	NativeCompilationTier tier = NativeCompilationTier::OnDemand;
	// Set only for a complete, directly backed read-only instruction page.
	std::optional<u32> immutablePagePc = std::nullopt;
};

// A contiguous source run between guest entries or control-flow boundaries.
// The compiler can create more entries inside it for precise timing and exits.
struct NativeBlockSource {
	std::span<const NativeBlockInstruction> instructions;
	const DecodedInstruction* skippedInstruction = nullptr;
};

} // namespace bmsx
