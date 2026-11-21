#pragma once

#include "machine/cpu/jit/runtime/block.h"
#include "machine/cpu/jit/compilation_input.h"

namespace bmsx {

class Memory;
class StringPool;

// Captured on the CPU owner thread. Code emission consumes these bindings,
// not mutable Memory/controller state. The pointed-to owners are used only by
// the generated code after it has been published on the CPU thread.
struct NativeCodeBindings {
	NativeCodeBindings() = default;
	NativeCodeBindings(Memory& memory, StringPool& strings, CPU* cpu = nullptr, DecodedInstruction* decodedPage = nullptr);
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
	// The worker may embed addresses of source-owned sites but never reads
	// their live data. Compilation decisions use the copied source rows.
	DecodedInstruction* decodedPage = nullptr;
};

class NativeCompiler {
public:
	// Source runs contain at most one decoded page's worth of instructions.
	static std::vector<std::unique_ptr<NativeBlock>> compile(
		std::span<const NativeBlockSource> sources,
		const NativeCodeBindings& bindings, NativeCompilationOptions options = {}, NativeCompileSpecializations specializations = {});
};

} // namespace bmsx
