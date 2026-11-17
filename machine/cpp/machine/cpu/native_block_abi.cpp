#include "machine/cpu/native_block_abi.h"

#include <new>
#include "common/scope_exit.h"
#include "machine/cpu/cpu.h"
#if defined(BMSX_NATIVE_PERF_MAP)
#include "machine/cpu/native_perf_map.h"
#endif

namespace bmsx {

NativeBlockGate::NativeBlockGate() {
	auto* compiler = sljit_create_compiler(nullptr);
	if (!compiler)
		throw std::bad_alloc();
	ScopeExit release([&] { sljit_free_compiler(compiler); });
	sljit_emit_enter(compiler, 0, NativeBlockAbi::signature, NativeBlockAbi::scratches, NativeBlockAbi::saveds,
		NativeBlockAbi::stackBytes);
	// Arguments arrive in S0/S1; preserve both before binding the two planes.
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_S1, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, NativeBlockAbi::state, 0, SLJIT_S0, 0);
	auto* resume = sljit_emit_label(compiler);
	sljit_emit_op1(compiler, SLJIT_MOV_P, NativeBlockAbi::words, 0, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, registers) + ValueSpan::wordsOffset());
	sljit_emit_op1(compiler, SLJIT_MOV_P, NativeBlockAbi::tags, 0, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, registers) + ValueSpan::tagsOffset());
	sljit_emit_op1(compiler, SLJIT_MOV32, NativeBlockAbi::budget, 0, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, remainingCycles));
	sljit_emit_ijump(compiler, SLJIT_JUMP, SLJIT_R0, 0);
	auto* returned = sljit_emit_label(compiler);
	sljit_emit_return(compiler, SLJIT_MOV_P, SLJIT_R0, 0);
	auto* dispatched = sljit_emit_label(compiler);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, NativeBlockAbi::state, 0);
	sljit_emit_icall(compiler, SLJIT_CALL, SLJIT_ARGS2(P, P, P), SLJIT_IMM, SLJIT_FUNC_ADDR(&CPU::dispatchNativeExit));
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_IMM, 0), returned);
	sljit_set_label(sljit_emit_jump(compiler, SLJIT_JUMP), resume);
	auto* leave = sljit_emit_label(compiler);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, remainingCycles), NativeBlockAbi::budget, 0);
	sljit_emit_ijump(compiler, SLJIT_JUMP, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, exitCode));
	entry = sljit_generate_code(compiler, 0, nullptr);
	if (!entry)
		throw std::bad_alloc();
#if defined(BMSX_NATIVE_PERF_MAP)
	const auto freeCode = [](void* code) { sljit_free_code(code, nullptr); };
	std::unique_ptr<void, decltype(freeCode)> codeOwner(entry, freeCode);
#endif
	exit = reinterpret_cast<void*>(sljit_get_label_addr(returned));
	dispatch = reinterpret_cast<void*>(sljit_get_label_addr(dispatched));
	leaveSegment = reinterpret_cast<void*>(sljit_get_label_addr(leave));
#if defined(BMSX_NATIVE_PERF_MAP)
	auto start = static_cast<std::uintptr_t>(SLJIT_FUNC_ADDR(entry));
#if defined(SLJIT_CONFIG_ARM_THUMB2) && SLJIT_CONFIG_ARM_THUMB2
	start &= ~std::uintptr_t{1};
#endif
	const NativePerfMapRange range{start, sljit_get_generated_code_size(compiler), "bmsx_native_gate_compact"};
	recordNativePerfMap(std::span(&range, 1));
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
