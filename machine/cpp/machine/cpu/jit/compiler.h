#pragma once

#include "machine/cpu/jit/runtime/block.h"
#include "machine/cpu/jit/compilation_input.h"

namespace bmsx {

class Memory;
class StringPool;

struct NativeCodeSourcePage;

// Captured on the CPU owner thread. Code emission consumes these bindings,
// not mutable Memory/controller state. The pointed-to owners are used only by
// the generated code after it has been published on the CPU thread.
struct NativeCodeBindings {
	NativeCodeBindings() = default;
	NativeCodeBindings(Memory& memory, StringPool& strings, CPU* cpu = nullptr,
		std::span<const NativeCodeSourcePage> sourcePages = {}, bool historyWriteWatches = true);
	DecodedInstruction* decodedPageFor(u32 pc) const;
	u32 ramBytes = 0;
	u8* ram = nullptr;
	const u32* ramBusEnd = nullptr;
	const u32* ramWriteGroups = nullptr;
	const u32* ramCodeWatchWords = nullptr;
	const u32* const* const* ramByteMaskPages = nullptr;
	const Span<const u8>* systemRom = nullptr;
	const Span<const u8>* cartridgeRom = nullptr;
	StringPool* strings = nullptr;
	// Only CPU-owned emission may call completion owners. Standalone blocks
	// retain the base run-state ABI and ordinary CALL exits.
	CPU* cpu = nullptr;
	// The worker may embed addresses of source-owned sites but never reads
	// their live data. Compilation decisions use the copied source rows.
	std::span<const NativeCodeSourcePage> sourcePages;
	// Standalone blocks have no owner to retire them when history is armed.
	bool historyWriteWatches = true;
	bool privateFirmware = false;
	u32 privateStoreEnd = 0u, privateProjection = 0u;
};

class NativeCompiler {
public:
	NativeCompiler();
	~NativeCompiler();
	NativeCompiler(const NativeCompiler&) = delete;
	NativeCompiler& operator=(const NativeCompiler&) = delete;

	// Each source run is bounded by a decoded page; region edges may cross them.
	std::vector<std::unique_ptr<NativeBlock>> compile(
		std::span<const NativeBlockSource> sources,
		const NativeCodeBindings& bindings, NativeCompilationOptions options = {}, NativeCompileSpecializations specializations = {});

private:
	struct Workspace;
	std::unique_ptr<Workspace> m_workspace;
};

} // namespace bmsx
