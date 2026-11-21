#pragma once

#include <exception>
#include <optional>
#include <type_traits>

#include "machine/cpu/jit/runtime/block.h"
#include "machine/cpu/jit/runtime/code_lookup.h"
#include "spec/blua32/builtin.h"

namespace bmsx {

static_assert(BUILTIN_FUNCTION_COUNT <= 32);
// A returning leaf must not write through the table/collector ports, which
// can retire the source region before the native return address is used.
inline constexpr u32 NATIVE_BUILTIN_LEAF_IDS = (1u << static_cast<u32>(BuiltinFunctionId::GetMetatable))
	| (1u << static_cast<u32>(BuiltinFunctionId::StringByte))
	| (1u << static_cast<u32>(BuiltinFunctionId::ToInteger));

constexpr bool nativeBuiltinLeafId(u32 id) {
	return id < 32 && (NATIVE_BUILTIN_LEAF_IDS & (1u << id)) != 0;
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
	struct Replay {
		u32 pc;
		std::optional<NativeArithmeticFeedback> arithmetic;
	};
	NativeBlockRunState state;
	CPU* cpu;
	int targetDepth;
	NativeCodeLookup::Group* const* codeRoot = nullptr;
	u32 cartridgeSlot = 0;
	u32 frameBank = 0;
	CallFrame* firstPendingFrame = nullptr;
	// MMIO, semantic calls, resumable faults and the end of the grant all
	// observe real RAM records. Pure compiled transfers do not.
	void publishActivation(u32 pc) noexcept;
	std::exception_ptr error;
	std::optional<Replay> replay{};
	bool fixedCallMismatch = false;
};

static_assert(std::is_standard_layout_v<NativeCpuRunState>);
static_assert(offsetof(NativeCpuRunState, state) == 0);

} // namespace bmsx
