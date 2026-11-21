#pragma once

#include <optional>

#include "machine/cpu/native_block.h"

namespace bmsx {

struct DecodedInstruction;
class Memory;
class StringPool;

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

// Captured on the CPU owner thread. Code emission consumes these bindings,
// not mutable Memory/controller state. The pointed-to owners are used only by
// the generated code after it has been published on the CPU thread.
struct NativeCodeBindings {
	NativeCodeBindings() = default;
	NativeCodeBindings(Memory& memory, StringPool& strings, CPU* cpu = nullptr);
	u32 ramBytes = 0;
	u8* ram = nullptr;
	const u32* ramBusEnd = nullptr;
	const u32* ramWriteGroups = nullptr;
	const u32* ramCodeWatchWords = nullptr;
	const Memory* memory = nullptr;
	StringPool* strings = nullptr;
	// Only CPU-owned emission may call completion owners. Standalone blocks
	// retain the base run-state ABI and ordinary CALL exits.
	CPU* cpu = nullptr;
};

class NativeCompiler {
public:
	// Source runs contain at most one decoded page's worth of instructions.
	static std::vector<std::unique_ptr<NativeBlock>> compile(
		std::span<const NativeBlockSource> sources, ConstValueSpan constants,
		const NativeCodeBindings& bindings, NativeCompilationOptions options = {});
};

} // namespace bmsx
