#include "machine/cpu/native_block_abi.h"

#include <new>

#include "common/scope_exit.h"

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
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_S0, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, registers));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_S1, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, constants));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_S4, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, remainingCycles));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_S5, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, registerTop));
	sljit_emit_ijump(compiler, SLJIT_JUMP, SLJIT_R0, 0);
	auto* returnLabel = sljit_emit_label(compiler);
	sljit_emit_return(compiler, SLJIT_MOV_P, SLJIT_R0, 0);
	entry = sljit_generate_code(compiler, 0, nullptr);
	if (!entry) throw std::bad_alloc();
	exit = reinterpret_cast<void*>(sljit_get_label_addr(returnLabel));
}

NativeBlockGate::~NativeBlockGate() { sljit_free_code(entry, nullptr); }

const NativeBlockGate& nativeBlockGate() {
	static const NativeBlockGate gate;
	return gate;
}

} // namespace bmsx
