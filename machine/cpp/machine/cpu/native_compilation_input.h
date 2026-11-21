#pragma once

#include <optional>
#include <span>

#include "machine/cpu/native_limits.h"

namespace bmsx {

struct DecodedInstruction;

struct NativeBlockInstruction {
	const DecodedInstruction* decoded;
	u32 pc;
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
