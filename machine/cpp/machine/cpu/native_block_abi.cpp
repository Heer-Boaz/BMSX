#include "machine/cpu/native_block_abi.h"

#include <new>

#include "common/scope_exit.h"
#include "machine/cpu/cpu.h"

namespace bmsx {

NativeBlockGate::NativeBlockGate() {
	auto* compiler = sljit_create_compiler(nullptr);
	if (!compiler) throw std::bad_alloc();
	ScopeExit releaseCompiler([&] { sljit_free_compiler(compiler); });
	sljit_emit_enter(compiler, 0, NativeBlockAbi::signature,
		NativeBlockAbi::scratches, NativeBlockAbi::saveds, NativeBlockAbi::stackBytes);
	// Entry arguments are S0=state, S1=body. Preserve the body before loading
	// the guest banks; linked branches enter bodies with these banks live.
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_S1, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_S3, 0, SLJIT_S0, 0);
	auto* resumeLabel = sljit_emit_label(compiler);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_S0, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, registers));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_S1, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, constants));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_S4, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, remainingCycles));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_S5, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, registerTop));
	sljit_emit_ijump(compiler, SLJIT_JUMP, SLJIT_R0, 0);
	auto* returnLabel = sljit_emit_label(compiler);
	sljit_emit_return(compiler, SLJIT_MOV_P, SLJIT_R0, 0);
	auto* dispatchLabel = sljit_emit_label(compiler);
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_R1, 0,
		SLJIT_MEM1(SLJIT_R0), offsetof(NativeBlockExitSite, exit));
	auto* ordinaryReturn = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R1, 0,
		SLJIT_IMM, static_cast<int>(NativeBlockExit::Return));
	auto* ordinaryCall = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R1, 0,
		SLJIT_IMM, static_cast<int>(NativeBlockExit::Call));
	auto* coldDispatchLabel = sljit_emit_label(compiler);
	// The retiring body has no return address on the host stack. Helpers may
	// invalidate it; their continuation belongs to this stable dispatcher.
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_S3, 0);
	sljit_emit_icall(compiler, SLJIT_CALL, SLJIT_ARGS2(P, P, P),
		SLJIT_IMM, SLJIT_FUNC_ADDR(&CPU::dispatchNativeExit));
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_IMM, 0), returnLabel);
	sljit_set_label(sljit_emit_jump(compiler, SLJIT_JUMP), resumeLabel);
	sljit_set_label(ordinaryReturn, emitReturnGate(compiler, coldDispatchLabel));
	sljit_set_label(ordinaryCall, emitCallGate(compiler, coldDispatchLabel));

	// Region bodies name an exit and its register map. Materialization and
	// dispatch live here once, not in every generated instruction's side exit.
	std::array<sljit_label*, 2> finishLabels, publishLabels;
	std::array<sljit_jump*, 2> published;
	for (int saved = 0; saved != 2; ++saved) {
		finishLabels[saved] = sljit_emit_label(compiler);
		sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_S4, 0, SLJIT_S4, 0,
			SLJIT_MEM1(SLJIT_R0), offsetof(NativeBlockExitSite, cycles));
		sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R1, 0,
			SLJIT_MEM1(SLJIT_R0), offsetof(NativeBlockExitSite, registerTop));
		auto* noExtent = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0);
		auto* retained = sljit_emit_cmp(compiler, SLJIT_SIG_GREATER_EQUAL | SLJIT_32, SLJIT_S5, 0, SLJIT_R1, 0);
		sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_S5, 0, SLJIT_R1, 0);
		publishLabels[saved] = sljit_emit_label(compiler);
		sljit_set_label(noExtent, publishLabels[saved]);
		sljit_set_label(retained, publishLabels[saved]);
		const int count = saved ? NativeBlockAbi::savedFloats : NativeBlockAbi::scratchFloats - 3;
		for (int slot = 0; slot < count; ++slot) {
			sljit_emit_op1(compiler, SLJIT_MOV_S32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0),
				offsetof(NativeBlockExitSite, registerOffsets) + slot * sizeof(i32));
			auto* absent = sljit_emit_cmp(compiler, SLJIT_SIG_LESS, SLJIT_R1, 0, SLJIT_IMM, 0);
			sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R1, 0, SLJIT_S0, 0, SLJIT_R1, 0);
			sljit_emit_fop1(compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_R1), 0,
				saved ? SLJIT_FS(slot) : SLJIT_FR(3 + slot), 0);
			sljit_set_label(absent, sljit_emit_label(compiler));
		}
		published[saved] = sljit_emit_jump(compiler, SLJIT_JUMP);
	}
	auto* leaveLabel = sljit_emit_label(compiler);
	for (auto* jump : published) sljit_set_label(jump, leaveLabel);
	// The cold path publishes complete state before entering C++, where the
	// descriptor may be retired. Warm edges jump directly between bodies.
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, remainingCycles), SLJIT_S4, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, registerTop), SLJIT_S5, 0);
	sljit_emit_ijump(compiler, SLJIT_JUMP, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, exitCode));
	entry = sljit_generate_code(compiler, 0, nullptr);
	if (!entry) throw std::bad_alloc();
	exit = reinterpret_cast<void*>(sljit_get_label_addr(returnLabel));
	dispatch = reinterpret_cast<void*>(sljit_get_label_addr(dispatchLabel));
	leaveSegment = reinterpret_cast<void*>(sljit_get_label_addr(leaveLabel));
	for (size_t bank = 0; bank < finishLabels.size(); ++bank) {
		finishSegment[bank] = reinterpret_cast<void*>(sljit_get_label_addr(finishLabels[bank]));
		publishSegment[bank] = reinterpret_cast<void*>(sljit_get_label_addr(publishLabels[bank]));
	}
}

NativeBlockGate::~NativeBlockGate() { sljit_free_code(entry, nullptr); }

const NativeBlockGate& nativeBlockGate() {
	static const NativeBlockGate gate;
	return gate;
}

} // namespace bmsx
