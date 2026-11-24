#include "machine/cpu/jit/sljit/lowering.h"

#include "machine/cpu/cpu.h"
#include "machine/cpu/jit/sljit/value_transport.h"
#include "machine/cpu/jit/sljit/gate.h"

namespace bmsx {

void NativeLowering::lowerOperation(const NativeLength& length, const NativeInstruction& instruction) {
	auto& semantic = *sideExit(instruction.slow);
	constexpr auto value = NativeBlockAbi::helperResultOffset;
	emitRawLoad(length.source, SLJIT_R0, SLJIT_R1);
	auto* c = m_compiler;
	sljit_jump* measured = nullptr;
	if constexpr (std::endian::native == std::endian::little) {
		if (m_bindings.cpu) {
			auto* other = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, static_cast<u8>(ValueTag::Table));
			sljit_emit_ijump(c, SLJIT_FAST_CALL, SLJIT_IMM, reinterpret_cast<sljit_sw>(nativeBlockGate().tableLengthProbe));
			measured = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, -1);
			emitRawLoad(length.source, SLJIT_R0, SLJIT_R1);
			sljit_set_label(other, sljit_emit_label(c));
		}
	}
	emitValueTransportStore(m_compiler, SLJIT_SP, value, SLJIT_R0, SLJIT_R1);
	const auto state = m_cache.state();
	m_cache.spillCall(false, 0, NativeRegisterCache::FrameSlots::Unchanged);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, heap));
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(m_bindings.strings));
	sljit_get_local_base(m_compiler, SLJIT_R2, 0, value);
	sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS3(32, P, P, P), SLJIT_IMM, SLJIT_FUNC_ADDR(&CPU::readNativeLength));
	m_cache.spillCall(true, 0, NativeRegisterCache::FrameSlots::Unchanged);
	fault(sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0), semantic, state);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), value + VALUE_LOW_WORD_BYTE_OFFSET);
	if (measured) sljit_set_label(measured, sljit_emit_label(c));
	const auto target = m_cache.write(length.result, ValueTag::Integer);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, SLJIT_R0, 0);
}

} // namespace bmsx
