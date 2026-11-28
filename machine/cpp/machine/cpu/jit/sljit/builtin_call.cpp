#include "machine/cpu/jit/sljit/lowering.h"

#include "machine/cpu/cpu.h"
#include "machine/cpu/jit/runtime/execution.h"
#include "machine/devices/irq/controller.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {

void NativeLowering::lowerOperation(const NativeCallSite& site, const NativeInstruction&) {
	auto& block = *m_blocks[m_current];
	auto& call = block.terminal;
	const auto& ir = m_ir[m_current];
	const int base = site.callee;
	if (!ir.completedCall) {
		emitLeave(call, Charge::Pending);
		return;
	}

	if (site.calleeCheck == NativeTagCheck::Dynamic)
		fault(m_cache.guard(base, ValueTag::BuiltinFunction, SLJIT_R0), call, m_cache.state());
	const auto id = readTyped(base, ValueTag::BuiltinFunction);
	auto* rawGet = sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, id.reg, 0, SLJIT_IMM, static_cast<u32>(BuiltinFunctionId::RawGet));
	fault(sljit_emit_cmp(m_compiler, SLJIT_GREATER_EQUAL | SLJIT_32, id.reg, 0,
		SLJIT_IMM, NATIVE_BUILTIN_LEAF_LIMIT), call, m_cache.state());
	sljit_set_label(rawGet, sljit_emit_label(m_compiler));
	auto& completed = *sideExit(ir.completedCall);
	auto* c = m_compiler;
	const auto entry = m_cache.state();
	auto* joined = static_cast<sljit_jump*>(nullptr);
	if (site.supplied == 2) {
		// The completed CALL already admits its fixed arguments. The
		// general helper still owns other forms and the observer boundary.
		std::array<sljit_jump*, 8> general{};
		general[0] = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, id.reg, 0,
			SLJIT_IMM, static_cast<u32>(BuiltinFunctionId::StringByte));
		general[1] = guardTag(base + 1, ValueTag::String, SLJIT_R0);
		general[2] = guardTag(base + 2, ValueTag::Integer, SLJIT_R0);
		auto& cpu = *m_bindings.cpu;
		general[3] = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32,
			SLJIT_MEM0(), reinterpret_cast<sljit_sw>(&cpu.m_runSignals), SLJIT_IMM, 0);
		general[4] = sljit_emit_cmp(c, SLJIT_SIG_GREATER_EQUAL | SLJIT_32,
			SLJIT_MEM0(), reinterpret_cast<sljit_sw>(&cpu.m_haltedUntilIrqFrameDepth), SLJIT_IMM, 0);
		sljit_emit_op2(c, SLJIT_AND32 | SLJIT_SET_Z, SLJIT_R0, 0,
			SLJIT_MEM0(), reinterpret_cast<sljit_sw>(&cpu.m_cop0Words[COP0_STATUS]),
			SLJIT_IMM, CPU_STATUS_INTERRUPT_ENABLE_CURRENT);
		auto* masked = sljit_emit_jump(c, SLJIT_ZERO);
		sljit_emit_op2(c, SLJIT_AND32 | SLJIT_SET_Z, SLJIT_R0, 0,
			SLJIT_MEM0(), reinterpret_cast<sljit_sw>(&cpu.m_irqController.m_pendingFlags),
			SLJIT_MEM0(), reinterpret_cast<sljit_sw>(&cpu.m_irqController.m_mask));
		general[5] = sljit_emit_jump(c, SLJIT_NOT_ZERO);
		sljit_set_label(masked, sljit_emit_label(c));

		const int receiving = site.requested != 0;
		if (receiving) {
			emitPayload(base + 1, SLJIT_R1);
			sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R2, 0, SLJIT_R1, 0, SLJIT_IMM, RAM_BASE);
			general[6] = sljit_emit_cmp(c, SLJIT_GREATER_EQUAL | SLJIT_32,
				SLJIT_R2, 0, SLJIT_IMM, CART_ROM_BASE - RAM_BASE);
			emitPayload(base + 2, SLJIT_R0);
			sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 1);
			sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R2, 0, SLJIT_R1, 0, SLJIT_IMM, BLUA32_STRING_LENGTH_OFFSET);
			sljit_emit_op2(c, SLJIT_AND, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
			NativeBlockAbi::emitRamAddress(c, SLJIT_R2, SLJIT_R2);
			sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
			if constexpr (std::endian::native == std::endian::big)
				sljit_emit_op1(c, SLJIT_REV32, SLJIT_R2, 0, SLJIT_R2, 0);
			sljit_emit_op2(c, SLJIT_AND32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, MAIN_RAM_SIZE - 1u);
			general[7] = sljit_emit_cmp(c, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_R2, 0);
			sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, BLUA32_STRING_RECORD_HEADER_SIZE);
			sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R1, 0, SLJIT_R0, 0);
			sljit_emit_op2(c, SLJIT_AND, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, MAIN_RAM_SIZE - 1u);
			NativeBlockAbi::emitRamAddress(c, SLJIT_R0, SLJIT_R0);
			sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), 0);
			sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, static_cast<u8>(ValueTag::Integer));
			emitRawStore(base, SLJIT_R0, SLJIT_R1);
		}
		sljit_emit_op2(c, SLJIT_ADD32, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, physicalTop),
			SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, registerBase), SLJIT_IMM, base + receiving);
		constexpr int primitiveCycles = BUILTIN_FUNCTION_COSTS[static_cast<size_t>(BuiltinFunctionId::StringByte)].base;
		sljit_emit_op2(c, SLJIT_SUB32 | SLJIT_SET_SIG_LESS_EQUAL, NativeBlockAbi::budget, 0,
			NativeBlockAbi::budget, 0, SLJIT_IMM, call.cycles + primitiveCycles + receiving);
		fault(sljit_emit_jump(c, SLJIT_SIG_LESS_EQUAL), completed, m_cache.state(), Charge::Paid);
		joined = sljit_emit_jump(c, SLJIT_JUMP);

		auto* generic = sljit_emit_label(c);
		for (auto* branch : general)
			if (branch) sljit_set_label(branch, generic);
		m_cache.setState(entry);
	}
	m_cache.publishRange(base, base + 1 + site.supplied);

	m_cache.spillCall(false, 0, NativeRegisterCache::FrameSlots::MayChange);
	sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, remainingCycles),
		NativeBlockAbi::budget, 0, SLJIT_IMM, call.cycles);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(m_bindings.cpu));
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R1, 0, NativeBlockAbi::state, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(&call));
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R3, 0, id.reg, 0);
	sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS4(32, P, P, P, 32), SLJIT_IMM, SLJIT_FUNC_ADDR(&CPU::runNativeBuiltinLeaf));
	m_cache.spillCall(true, 0, NativeRegisterCache::FrameSlots::MayChange);
	fault(sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM,
		static_cast<u32>(NativeBuiltinCallOutcome::Declined)), call, m_cache.state());

	if (site.requested != 0) m_cache.discardRange(base, base + 1);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, NativeBlockAbi::budget, 0, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, remainingCycles));
	fault(sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM,
		static_cast<u32>(NativeBuiltinCallOutcome::CompletedStop)), completed, m_cache.state(), Charge::Paid);
	if (joined) {
		// The direct arm preserves dirty argument payloads in the same
		// registers. The helper published them, so conservatively keep
		// the pre-helper writeback obligations on the converged edge.
		m_cache.setState(entry);
		if (site.requested != 0) m_cache.discardRange(base, base + 1);
		sljit_set_label(joined, sljit_emit_label(c));
	}
	emitExit(completed);
}

} // namespace bmsx
