#include "machine/cpu/native_block_compiler.h"
#include "machine/cpu/native_value_emit.h"

#include <algorithm>
#include <bit>

#include "machine/cpu/execution_image.h"

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

int NativeBlockCompiler::allocateRegister(int guest, sljit_s32 pinned) {
	int selected = -1;
	for (int slot = 0; slot < m_registerCount; ++slot) {
		if (cachedFloatRegister(slot) == pinned) continue;
		selected = slot;
		if (m_registers[slot].guest < 0) break;
	}
	if (selected < 0) return -1;
	if (m_registers[selected].guest >= 0) {
		std::array<size_t, REGISTER_CACHE_CAPACITY> nextAccess;
		nextAccess.fill(NATIVE_BLOCK_MAX_INSTRUCTIONS);
		const size_t horizon = std::min(m_remainingInstructions.size(), size_t{NATIVE_BLOCK_MAX_INSTRUCTIONS});
		int unresolved = m_registerCount;
		for (int slot = 0; slot < m_registerCount; ++slot) if (cachedFloatRegister(slot) == pinned) --unresolved;
		for (size_t distance = 0; distance < horizon && unresolved != 0; ++distance) {
			const auto& instruction = *m_remainingInstructions[distance].decoded;
			const auto access = registerAccess(instruction);
			for (int slot = 0; slot < m_registerCount; ++slot) {
				if (nextAccess[slot] != NATIVE_BLOCK_MAX_INSTRUCTIONS || cachedFloatRegister(slot) == pinned) continue;
				const int cached = m_registers[slot].guest;
				if (((access.scalarReads & REGISTER_OPERAND_A) && cached == instruction.a)
					|| ((access.scalarReads & REGISTER_OPERAND_B) && cached == instruction.b)
					|| ((access.scalarReads & REGISTER_OPERAND_C) && cached == instruction.c)
					|| (cached >= access.readFirst && cached < access.readEnd)
					|| (cached >= access.writeFirst && cached < access.writeEnd)) {
					nextAccess[slot] = distance;
					--unresolved;
				}
			}
		}
		// This caches observable guest slots, not SSA temporaries. An upcoming
		// overwrite also benefits from keeping its binding: eviction would first
		// have to publish the old dirty Value. Absence of a future access never
		// permits discarding it.
		for (int slot = 0; slot < m_registerCount; ++slot) {
			if (cachedFloatRegister(slot) == pinned) continue;
			const auto& candidate = m_registers[slot];
			const auto& victim = m_registers[selected];
			if (nextAccess[slot] > nextAccess[selected]
				|| (nextAccess[slot] == nextAccess[selected]
					&& (candidate.dirty < victim.dirty
						|| (candidate.dirty == victim.dirty && candidate.lastUse < victim.lastUse)))) selected = slot;
		}
	}
	auto& entry = m_registers[selected];
	if (entry.dirty) sljit_emit_fop1(m_compiler, SLJIT_MOV_F64,
		SLJIT_MEM1(SLJIT_S0), static_cast<sljit_sw>(entry.guest) * sizeof(Value), cachedFloatRegister(selected), 0);
	entry = CachedRegister{guest, false, ++m_registerClock};
	return selected;
}

NativeBlockCompiler::RegisterValueFact NativeBlockCompiler::operandFact(int selector) const {
	if (selector < 0) return {RegisterValueKind::Constant, m_constants[-selector - 1]};
	const int slot = findRegister(selector);
	return slot < 0 ? RegisterValueFact{} : m_registers[slot].value;
}

sljit_s32 NativeBlockCompiler::destinationRegister(int guest, RegisterValueFact fact) {
	int slot = findRegister(guest);
	if (slot < 0) slot = allocateRegister(guest);
	m_registers[slot].dirty = true;
	m_registers[slot].lastUse = ++m_registerClock;
	m_registers[slot].value = fact;
	return cachedFloatRegister(slot);
}

void NativeBlockCompiler::writeRegister(int guest, sljit_s32 source, RegisterValueFact fact) {
	const auto target = destinationRegister(guest, fact);
	if (target != source) sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, target, 0, source, 0);
}

sljit_s32 NativeBlockCompiler::readOperand(int selector, sljit_s32 temporary, sljit_s32 pinned) {
	if (selector < 0) {
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, temporary, 0,
			SLJIT_MEM1(SLJIT_S1), static_cast<sljit_sw>(-selector - 1) * sizeof(Value));
		return temporary;
	}
	int slot = findRegister(selector);
	if (slot >= 0) {
		m_registers[slot].lastUse = ++m_registerClock;
		return cachedFloatRegister(slot);
	}
	slot = allocateRegister(selector, pinned);
	// On a target with a single cache register, the other operand stays pinned
	// and this read uses its instruction scratch register without caching it.
	const auto target = slot < 0 ? temporary : cachedFloatRegister(slot);
	sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, target, 0,
		SLJIT_MEM1(SLJIT_S0), static_cast<sljit_sw>(selector) * sizeof(Value));
	return target;
}

std::array<sljit_s32, 2> NativeBlockCompiler::readOperands(int left, int right) {
	// Pin both existing inputs before admitting either cold input. Otherwise a
	// cache miss for the left operand can evict a still-live right operand.
	const int rightSlot = right < 0 ? -1 : findRegister(right);
	const auto first = readOperand(left, SLJIT_FR0, rightSlot < 0 ? 0 : cachedFloatRegister(rightSlot));
	return {first, readOperand(right, SLJIT_FR1, first)};
}

void NativeBlockCompiler::loadOperand(int selector, sljit_s32 floatingRegister) {
	const auto source = readOperand(selector, floatingRegister);
	if (source != floatingRegister) sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, floatingRegister, 0, source, 0);
}

NativeBlockCompiler::RegisterSnapshot NativeBlockCompiler::registerSnapshot(bool dirtyOnly) const {
	RegisterSnapshot snapshot;
	snapshot.fill(-1);
	for (int slot = 0; slot < m_registerCount; ++slot) {
		if (!dirtyOnly || m_registers[slot].dirty) snapshot[slot] = m_registers[slot].guest;
	}
	return snapshot;
}

void NativeBlockCompiler::emitRegisterSnapshot(const RegisterSnapshot& snapshot) {
	for (int slot = 0; slot < m_registerCount; ++slot) {
		if (snapshot[slot] >= 0) sljit_emit_fop1(m_compiler, SLJIT_MOV_F64,
			SLJIT_MEM1(SLJIT_S0), static_cast<sljit_sw>(snapshot[slot]) * sizeof(Value), cachedFloatRegister(slot), 0);
	}
}

void NativeBlockCompiler::discardRegisterRange(int first, int end) {
	for (int slot = 0; slot < m_registerCount; ++slot) {
		const int guest = m_registers[slot].guest;
		if (guest >= first && guest < end) {
			m_registers[slot] = CachedRegister{};
		}
	}
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
		sljit_emit_op1(m_compiler, SLJIT_MOV, target, 0, SLJIT_IMM, valueHeader(m_constants[-selector - 1]));
		return;
	}
	const int slot = findRegister(selector);
	if (slot >= 0) {
		m_registers[slot].lastUse = ++m_registerClock;
		emitValueHeaderFromFloat(m_compiler, target, cachedFloatRegister(slot));
		return;
	}
	emitValueHeaderLoad(m_compiler, target, SLJIT_S0, static_cast<sljit_sw>(selector) * sizeof(Value));
}

void NativeBlockCompiler::loadPayload(int selector, sljit_s32 target, sljit_s32 scratch) {
	if (selector < 0) {
		sljit_emit_op1(m_compiler, SLJIT_MOV, target, 0, SLJIT_IMM,
			static_cast<sljit_sw>(valuePayload(m_constants[-selector - 1])));
		return;
	}
	const int slot = findRegister(selector);
	if (slot >= 0) {
		m_registers[slot].lastUse = ++m_registerClock;
		emitValuePayloadFromFloat(m_compiler, target, cachedFloatRegister(slot), scratch);
		return;
	}
	emitValuePayloadLoad(m_compiler, target, SLJIT_S0, static_cast<sljit_sw>(selector) * sizeof(Value));
}

} // namespace bmsx
