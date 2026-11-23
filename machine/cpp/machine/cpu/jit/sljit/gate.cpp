#include "machine/cpu/jit/sljit/gate.h"
#include "machine/cpu/jit/sljit/abi.h"
#include "machine/cpu/jit/sljit/table_access.h"

#include <new>
#include "common/scope_exit.h"
#include "machine/cpu/cpu.h"
#if defined(BMSX_NATIVE_PERF_MAP)
#include "machine/cpu/jit/runtime/perf_map.h"
#endif

namespace bmsx {
namespace {
// Valid only when NativeBlockAbi::pinnedRam; on ARMv7 S4 is a cached word register.
constexpr sljit_s32 PINNED_RAM = SLJIT_S4;
} // namespace

void NativeBlockAbi::emitRamAddress(sljit_compiler* compiler, sljit_s32 destination, sljit_s32 offset) {
	if constexpr (pinnedRam) {
		sljit_emit_op2(compiler, SLJIT_ADD, destination, 0, offset, 0, PINNED_RAM, 0);
	} else {
		sljit_emit_op2(compiler, SLJIT_ADD, destination, 0, offset, 0,
			SLJIT_MEM1(state), offsetof(NativeBlockRunState, ram));
	}
}

NativeBlockGate::NativeBlockGate() {
	auto* compiler = sljit_create_compiler(nullptr);
	if (!compiler)
		throw std::bad_alloc();
	ScopeExit release([&] { sljit_free_compiler(compiler); });
	sljit_emit_enter(compiler, 0, NativeBlockAbi::signature, NativeBlockAbi::scratches, NativeBlockAbi::saveds,
		NativeBlockAbi::stackBytes);
	// Arguments arrive in S0/S1/S2. Only the raw entry window is passed by
	// the caller; C++ continuations bind the active frame's own window.
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_S2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_S1, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, NativeBlockAbi::state, 0, SLJIT_S0, 0);
	if constexpr (NativeBlockAbi::pinnedRam)
		sljit_emit_op1(compiler, SLJIT_MOV_P, PINNED_RAM, 0, SLJIT_MEM1(NativeBlockAbi::state),
			offsetof(NativeBlockRunState, ram));
	auto* bindWindow = sljit_emit_label(compiler);
	sljit_emit_op1(compiler, SLJIT_MOV_P, NativeBlockAbi::words, 0, SLJIT_MEM1(SLJIT_R1), ValueSpan::wordsOffset());
	sljit_emit_op1(compiler, SLJIT_MOV_P, NativeBlockAbi::tags, 0, SLJIT_MEM1(SLJIT_R1), ValueSpan::tagsOffset());
	sljit_emit_op1(compiler, SLJIT_MOV, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, registerCapacity),
		SLJIT_MEM1(SLJIT_R1), ValueSpan::sizeOffset());
	sljit_emit_op1(compiler, SLJIT_MOV32, NativeBlockAbi::budget, 0, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, remainingCycles));
	sljit_emit_ijump(compiler, SLJIT_JUMP, SLJIT_R0, 0);
	auto* returned = sljit_emit_label(compiler);
	sljit_emit_return(compiler, SLJIT_MOV_P, SLJIT_R0, 0);
	auto* dispatched = sljit_emit_label(compiler);
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), offsetof(NativeBlockExitSite, exit));
	auto* call = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R1, 0, SLJIT_IMM, static_cast<int>(NativeBlockExit::Call));
	auto* ret = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R1, 0, SLJIT_IMM, static_cast<int>(NativeBlockExit::Return));
	auto* cold = sljit_emit_label(compiler);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, NativeBlockAbi::state, 0);
	sljit_emit_icall(compiler, SLJIT_CALL, SLJIT_ARGS2(P, P, P), SLJIT_IMM, SLJIT_FUNC_ADDR(&CPU::dispatchNativeExit));
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_IMM, 0), returned);
	auto* resume = sljit_emit_label(compiler);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, frame));
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, offsetof(CallFrame, registers));
	sljit_set_label(sljit_emit_jump(compiler, SLJIT_JUMP), bindWindow);
	// Restore the original CALL/RET descriptor before semantic dispatch.
	// Declined transitions still own the original, unplaced grant.
	auto* declined = sljit_emit_label(compiler);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, NativeBlockAbi::transitionExit, 0);
	sljit_set_label(sljit_emit_jump(compiler, SLJIT_JUMP), cold);
	// Both helpers run outside the region that just published its cache.
	// Success selects either a live continuation (which binds the receiving
	// frame) or the gate's return label. A null result still owns the
	// original semantic exit.
	const auto emitTransfer = [&](auto helper) {
		auto* label = sljit_emit_label(compiler);
		sljit_emit_op1(compiler, SLJIT_MOV_P, NativeBlockAbi::transitionExit, 0, SLJIT_R0, 0);
		sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_R0, 0);
		sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, NativeBlockAbi::state, 0);
		sljit_emit_icall(compiler, SLJIT_CALL, SLJIT_ARGS2(P, P, P), SLJIT_IMM, SLJIT_FUNC_ADDR(helper));
		sljit_set_label(sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_IMM, 0), declined);
		sljit_set_label(sljit_emit_jump(compiler, SLJIT_JUMP), resume);
		return label;
	};
	auto* callEntry = emitTransfer(&CPU::tryCallNativeFrame);
	sljit_set_label(call, callEntry);
	auto* retEntry = emitTransfer(&CPU::tryReturnNativeFrame);
	sljit_set_label(ret, retEntry);
	// Ordinary exits carry the exact outstanding charge and top floor in
	// their descriptor. Linked edges and scalar boundaries already applied them.
	auto* publish = sljit_emit_label(compiler);
	sljit_emit_op2(compiler, SLJIT_SUB32, NativeBlockAbi::budget, 0, NativeBlockAbi::budget, 0,
		SLJIT_MEM1(SLJIT_R0), offsetof(NativeBlockExitSite, cycles));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), offsetof(NativeBlockExitSite, registerTop));
	auto* noTop = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0);
	auto* retained = sljit_emit_cmp(compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32, SLJIT_R1, 0,
		SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, registerTop));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, registerTop), SLJIT_R1, 0);
	auto* leave = sljit_emit_label(compiler);
	sljit_set_label(noTop, leave);
	sljit_set_label(retained, leave);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, remainingCycles), NativeBlockAbi::budget, 0);
	sljit_emit_ijump(compiler, SLJIT_JUMP, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, exitCode));
	auto* stringProbe = emitStringReadProbe(compiler);
	entry = sljit_generate_code(compiler, 0, nullptr);
	if (!entry)
		throw std::bad_alloc();
#if defined(BMSX_NATIVE_PERF_MAP)
	const auto freeCode = [](void* code) { sljit_free_code(code, nullptr); };
	std::unique_ptr<void, decltype(freeCode)> codeOwner(entry, freeCode);
#endif
	exit = reinterpret_cast<void*>(sljit_get_label_addr(returned));
	dispatch = reinterpret_cast<void*>(sljit_get_label_addr(dispatched));
	publishSegment = reinterpret_cast<void*>(sljit_get_label_addr(publish));
	leaveSegment = reinterpret_cast<void*>(sljit_get_label_addr(leave));
	stringReadProbe = reinterpret_cast<void*>(sljit_get_label_addr(stringProbe));
#if defined(BMSX_NATIVE_PERF_MAP)
	auto start = static_cast<sljit_uw>(SLJIT_FUNC_ADDR(entry));
#if defined(SLJIT_CONFIG_ARM_THUMB2) && SLJIT_CONFIG_ARM_THUMB2
	start &= ~sljit_uw{1};
#endif
	const std::array boundaries{
		start, sljit_get_label_abs_addr(returned), sljit_get_label_abs_addr(dispatched),
		sljit_get_label_abs_addr(cold), sljit_get_label_abs_addr(declined), sljit_get_label_abs_addr(callEntry),
		sljit_get_label_abs_addr(retEntry),
		sljit_get_label_abs_addr(publish), sljit_get_label_abs_addr(leave),
		sljit_get_label_abs_addr(stringProbe),
		start + sljit_get_generated_code_size(compiler)
	};
	constexpr std::array names{
		"bmsx_native_gate_entry", "bmsx_native_gate_return_to_cpp", "bmsx_native_gate_dispatch",
		"bmsx_native_gate_cold_dispatch", "bmsx_native_gate_declined", "bmsx_native_gate_call",
		"bmsx_native_gate_ret",
		"bmsx_native_gate_publish", "bmsx_native_gate_leave", "bmsx_native_string_read_probe"
	};
	static_assert(boundaries.size() == names.size() + 1);
	std::array<NativePerfMapRange, names.size()> ranges;
	for (size_t i = 0; i < ranges.size(); ++i)
		ranges[i] = {boundaries[i], boundaries[i + 1] - boundaries[i], names[i]};
	recordNativePerfMap(ranges);
	codeOwner.release();
#endif
}
NativeBlockGate::~NativeBlockGate() {
	sljit_free_code(entry, nullptr);
}
const NativeBlockGate& nativeBlockGate() {
	static const NativeBlockGate gate;
	return gate;
}

} // namespace bmsx
