#pragma once

#include <exception>
#include <optional>
#include <type_traits>

#include "machine/cpu/jit/runtime/block.h"
#include "machine/cpu/jit/runtime/code_lookup.h"
#include "spec/blua32/builtin.h"

namespace bmsx {

// A returning leaf must not write through the table/collector ports, which
// can retire the source region before the native return address is used.
inline constexpr u32 NATIVE_BUILTIN_LEAF_LIMIT = static_cast<u32>(BuiltinFunctionId::Next);

constexpr bool nativeBuiltinLeafId(u32 id) {
	return id < NATIVE_BUILTIN_LEAF_LIMIT || id == static_cast<u32>(BuiltinFunctionId::RawGet);
}

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
	NativeCpuRunState(CPU& cpu, int targetDepth);
	void enterFrame(CallFrame& frame, int budget);
	struct Replay {
		u32 pc;
		std::optional<NativeArithmeticFeedback> arithmetic;
	};
	NativeBlockRunState state;
	CPU* cpu;
	int targetDepth;
	bool privateFirmware = false;
	NativeCodeLookup::Group* const* codeRoot = nullptr;
	u32 cartridgeSlot = 0;
	u32 frameBank = 0;
	size_t nativeStackCapacity = 0;
	u32 nativeFrameLimit = 0;
	i32 haltedCallDepth = -1;
	u32 closureDomain = 0;
	CallFrame* firstPendingFrame = nullptr;
	// Materialize in the admitted RAM extent. Even a frame that returns
	// entirely within the native grant leaves the ordinary retired words.
	void writePendingFrame(CallFrame& frame, u32 pc, i32 top) const noexcept;
	void publishActivation(u32 pc) noexcept;
	std::exception_ptr error;
	std::optional<Replay> replay{};
	std::optional<u32> hotSidePc{};
};

static_assert(std::is_standard_layout_v<NativeCpuRunState>);
static_assert(offsetof(NativeCpuRunState, state) == 0);

} // namespace bmsx
