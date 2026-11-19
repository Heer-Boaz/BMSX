#pragma once

#include <array>
#include <exception>
#include <type_traits>

#include "machine/cpu/native_block.h"
#include "machine/cpu/native_code_lookup.h"

namespace bmsx {

// A leaf builtin either leaves CALL untouched for its ordinary semantic path,
// or completes it once before deciding whether its receiving body may run.
enum class NativeBuiltinCallOutcome : u32 {
	Declined,
	CompletedStop,
	CompletedResume,
};

// A CPU grant owns this transient native frame. The register/cycle prefix is
// shared with the standalone block ABI; only the CPU dispatcher uses the tail.
struct NativeCpuRunState {
	NativeBlockRunState state;
	CPU* cpu;
	int targetDepth;
	NativeCodeLookup::Group* const* codeRoot = nullptr;
	const Span<const u8>* systemRom = nullptr;
	const Span<const u8>* cartridgeRom = nullptr;
	std::array<const Span<const u8>*, CARTRIDGE_SLOT_COUNT> cartridgeRoms{};
	u32 cartridgeSlot = 0;
	u32 frameBank = 0;
	std::exception_ptr error;
	bool forceScalar = false;
};

static_assert(std::is_standard_layout_v<NativeCpuRunState>);
static_assert(offsetof(NativeCpuRunState, state) == 0);

} // namespace bmsx
