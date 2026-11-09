#include "machine/cpu/native_block_compiler.h"

#include <bit>

namespace bmsx {

sljit_s32 NativeBlockCompiler::cachedFloatRegister(int slot) const {
	return m_useSavedFloats ? SLJIT_FS(slot) : SLJIT_FR(3 + slot);
}

int NativeBlockCompiler::findRegister(int guest) const {
	for (int slot = 0; slot < m_registerCount; ++slot) {
		if (m_registers[slot].guest == guest) return slot;
	}
	return -1;
}

int NativeBlockCompiler::allocateRegister(int guest) {
	int selected = 0;
	for (int slot = 0; slot < m_registerCount; ++slot) {
		if (m_registers[slot].guest < 0) {
			selected = slot;
			break;
		}
		if (m_registers[slot].lastUse < m_registers[selected].lastUse) selected = slot;
	}
	auto& entry = m_registers[selected];
	if (entry.dirty) sljit_emit_fop1(m_compiler, SLJIT_MOV_F64,
		SLJIT_MEM1(SLJIT_S0), static_cast<sljit_sw>(entry.guest) * sizeof(Value), cachedFloatRegister(selected), 0);
	entry = CachedRegister{guest, false, ++m_registerClock};
	return selected;
}

void NativeBlockCompiler::writeRegister(int guest) {
	int slot = findRegister(guest);
	if (slot < 0) slot = allocateRegister(guest);
	m_registers[slot].dirty = true;
	m_registers[slot].lastUse = ++m_registerClock;
	sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, cachedFloatRegister(slot), 0, SLJIT_FR0, 0);
}

void NativeBlockCompiler::loadOperand(int selector, sljit_s32 floatingRegister) {
	if (selector < 0) {
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, floatingRegister, 0,
			SLJIT_MEM1(SLJIT_S1), static_cast<sljit_sw>(-selector - 1) * sizeof(Value));
		return;
	}
	int slot = findRegister(selector);
	if (slot >= 0) {
		m_registers[slot].lastUse = ++m_registerClock;
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, floatingRegister, 0, cachedFloatRegister(slot), 0);
		return;
	}
	sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, floatingRegister, 0,
		SLJIT_MEM1(SLJIT_S0), static_cast<sljit_sw>(selector) * sizeof(Value));
	slot = allocateRegister(selector);
	sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, cachedFloatRegister(slot), 0, floatingRegister, 0);
}

NativeBlockCompiler::RegisterSnapshot NativeBlockCompiler::registerSnapshot() const {
	RegisterSnapshot snapshot;
	snapshot.fill(-1);
	for (int slot = 0; slot < m_registerCount; ++slot) {
		if (m_registers[slot].dirty) snapshot[slot] = m_registers[slot].guest;
	}
	return snapshot;
}

void NativeBlockCompiler::emitRegisterSnapshot(const RegisterSnapshot& snapshot) {
	for (int slot = 0; slot < m_registerCount; ++slot) {
		if (snapshot[slot] >= 0) sljit_emit_fop1(m_compiler, SLJIT_MOV_F64,
			SLJIT_MEM1(SLJIT_S0), static_cast<sljit_sw>(snapshot[slot]) * sizeof(Value), cachedFloatRegister(slot), 0);
	}
}

void NativeBlockCompiler::flushRegisters() {
	emitRegisterSnapshot(registerSnapshot());
	for (int slot = 0; slot < m_registerCount; ++slot) m_registers[slot].dirty = false;
}

void NativeBlockCompiler::emitCallSpills(bool reload) {
	if (m_useSavedFloats) return;
	for (int slot = 0; slot < m_registerCount; ++slot) {
		if (m_registers[slot].guest < 0) continue;
		const auto offset = static_cast<sljit_sw>(slot) * sizeof(Value);
		if (reload) sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, cachedFloatRegister(slot), 0, SLJIT_MEM1(SLJIT_SP), offset);
		else sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_SP), offset, cachedFloatRegister(slot), 0);
	}
}

void NativeBlockCompiler::loadHeader(int selector, sljit_s32 target) {
	if (selector < 0) {
		sljit_emit_op1(m_compiler, SLJIT_MOV, target, 0, SLJIT_IMM, m_constants[-selector - 1] >> 48u);
		return;
	}
	const int slot = findRegister(selector);
	if (slot >= 0) {
		m_registers[slot].lastUse = ++m_registerClock;
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, cachedFloatRegister(slot), target);
		sljit_emit_op2(m_compiler, SLJIT_LSHR, target, 0, target, 0, SLJIT_IMM, sizeof(sljit_sw) * 8u - 16u);
		return;
	}
	constexpr sljit_sw offset = std::endian::native == std::endian::little ? 6 : 0;
	sljit_emit_op1(m_compiler, SLJIT_MOV_U16, target, 0,
		SLJIT_MEM1(SLJIT_S0), static_cast<sljit_sw>(selector) * sizeof(Value) + offset);
}

void NativeBlockCompiler::loadPayload(int selector, sljit_s32 target, [[maybe_unused]] sljit_s32 scratch) {
	const int slot = findRegister(selector);
	if (slot >= 0) {
		m_registers[slot].lastUse = ++m_registerClock;
#if defined(SLJIT_64BIT_ARCHITECTURE)
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, cachedFloatRegister(slot), target);
#else
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, cachedFloatRegister(slot), SLJIT_REG_PAIR(scratch, target));
#endif
	} else {
		sljit_sw offset = static_cast<sljit_sw>(selector) * sizeof(Value);
#if defined(SLJIT_32BIT_ARCHITECTURE)
		if constexpr (std::endian::native == std::endian::big) offset += 4;
#endif
		sljit_emit_op1(m_compiler, SLJIT_MOV, target, 0, SLJIT_MEM1(SLJIT_S0),
			offset);
	}
#if defined(SLJIT_64BIT_ARCHITECTURE)
	sljit_emit_op2(m_compiler, SLJIT_AND, target, 0, target, 0, SLJIT_IMM, VALUE_PAYLOAD_MASK);
#endif
}

} // namespace bmsx
