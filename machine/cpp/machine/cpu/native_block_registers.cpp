#include "machine/cpu/native_block_compiler.h"

#include <bit>

namespace bmsx {

sljit_s32 NativeBlockCompiler::cachedFloatRegister(int slot) const {
	return m_useSavedFloats ? SLJIT_FS(slot) : SLJIT_FR(3 + slot);
}

NativeBlockCompiler::RegisterValueFact NativeBlockCompiler::operandFact(int selector) const {
	if (selector < 0) return {RegisterValueKind::Constant, m_constants[-selector - 1]};
	const int definition = m_slotBindings[bindingIndex(selector)].definition;
	return definition < 0 ? RegisterValueFact{} : m_definitions[definition].fact;
}

sljit_s32 NativeBlockCompiler::destinationRegister(int guest, RegisterValueFact fact) {
	const int definition = static_cast<int>(m_definitions.size());
	m_definitions.push_back({fact, -1});
	bindRegister(guest, definition, true);
	return cachedFloatRegister(allocateValue(definition));
}

void NativeBlockCompiler::writeRegister(int guest, sljit_s32 source, RegisterValueFact fact) {
	const int definition = static_cast<int>(m_definitions.size());
	m_definitions.push_back({fact, -1});
	bindRegister(guest, definition, true, source == SLJIT_FR2 ? SLJIT_FR1 : SLJIT_FR2);
	const auto target = cachedFloatRegister(allocateValue(definition));
	if (target != source) {
		if (m_lowering) ++m_lowering->phases[static_cast<size_t>(m_loweringPhase)].rawFprCopies;
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, target, 0, source, 0);
	}
}

sljit_s32 NativeBlockCompiler::readOperand(int selector, sljit_s32 temporary, sljit_s32 pinned) {
	if (selector < 0) {
		if (m_lowering) ++m_lowering->phases[static_cast<size_t>(m_loweringPhase)].constantValueLoads;
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, temporary, 0, SLJIT_MEM1(SLJIT_S1), static_cast<sljit_sw>(-selector - 1) * sizeof(Value));
		return temporary;
	}
	const int definition = definitionFor(selector);
	int slot = findValue(definition);
	if (slot >= 0) {
		m_registers[slot].lastUse = ++m_registerClock;
		return cachedFloatRegister(slot);
	}
	const auto source = valueLocation(definition);
	slot = allocateValue(definition, pinned);
	const auto target = slot < 0 ? temporary : cachedFloatRegister(slot);
	if (source.kind == ValueLocationKind::Constant) {
		if (m_lowering) ++m_lowering->phases[static_cast<size_t>(m_loweringPhase)].rawRematerializations;
		sljit_emit_fset64(m_compiler, target, asNumber(source.constant));
	} else {
		if (m_lowering) ++m_lowering->phases[static_cast<size_t>(m_loweringPhase)].registerValueLoads;
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, target, 0, SLJIT_MEM1(SLJIT_S0), static_cast<sljit_sw>(source.index) * sizeof(Value));
	}
	return target;
}

std::array<sljit_s32, 2> NativeBlockCompiler::readOperands(int left, int right) {
	const int rightSlot = right < 0 ? -1 : findRegister(right);
	const auto first = readOperand(left, SLJIT_FR0, rightSlot < 0 ? 0 : cachedFloatRegister(rightSlot));
	return {first, readOperand(right, SLJIT_FR1, first)};
}

void NativeBlockCompiler::loadOperand(int selector, sljit_s32 floatingRegister) {
	const auto source = readOperand(selector, floatingRegister);
	if (source != floatingRegister) {
		if (m_lowering) ++m_lowering->phases[static_cast<size_t>(m_loweringPhase)].rawFprCopies;
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, floatingRegister, 0, source, 0);
	}
}

NativeBlockCompiler::RegisterSnapshot NativeBlockCompiler::registerSnapshot() {
	RegisterSnapshot snapshot;
	snapshot.extraFirst = static_cast<u32>(m_snapshotWrites.size());
	for (size_t index = 0; index < m_slotBindings.size(); ++index) {
		const auto& binding = m_slotBindings[index];
		if (!binding.dirty) continue;
		const auto source = valueLocation(binding.definition);
		if (source.kind == ValueLocationKind::Register && snapshot.primary[source.index] < 0)
			snapshot.primary[source.index] = m_guestSlots[index];
		else m_snapshotWrites.push_back({m_guestSlots[index], source});
	}
	snapshot.extraCount = static_cast<u32>(m_snapshotWrites.size()) - snapshot.extraFirst;
	return snapshot;
}

void NativeBlockCompiler::emitValueStore(int guest, const ValueLocation& source, NativeLoweringPhase phase) {
	sljit_s32 value;
	if (source.kind == ValueLocationKind::Register) value = cachedFloatRegister(source.index);
	else {
		value = SLJIT_FR0;
		if (source.kind == ValueLocationKind::Constant) {
			if (m_lowering) ++m_lowering->phases[static_cast<size_t>(phase)].rawRematerializations;
			sljit_emit_fset64(m_compiler, value, asNumber(source.constant));
		} else {
			if (m_lowering) ++m_lowering->phases[static_cast<size_t>(phase)].registerValueLoads;
			sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, value, 0, SLJIT_MEM1(SLJIT_S0), static_cast<sljit_sw>(source.index) * sizeof(Value));
		}
	}
	if (m_lowering) ++m_lowering->phases[static_cast<size_t>(phase)].publicationStores;
	sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_S0), static_cast<sljit_sw>(guest) * sizeof(Value), value, 0);
}

void NativeBlockCompiler::emitSnapshotExtras(const RegisterSnapshot& snapshot, NativeLoweringPhase phase) {
	for (u32 index = 0; index < snapshot.extraCount; ++index) {
		const auto& write = m_snapshotWrites[snapshot.extraFirst + index];
		emitValueStore(write.guest, write.source, phase);
	}
}

void NativeBlockCompiler::emitRegisterSnapshot(const RegisterSnapshot& snapshot) {
	for (int slot = 0; slot < m_registerCount; ++slot)
		if (snapshot.primary[slot] >= 0) emitValueStore(snapshot.primary[slot], {ValueLocationKind::Register, slot}, m_loweringPhase);
	emitSnapshotExtras(snapshot, m_loweringPhase);
}

void NativeBlockCompiler::emitCallSpills(bool reload) {
	if (m_useSavedFloats) return;
	for (int slot = 0; slot < m_registerCount; ++slot) {
		if (m_registers[slot].definition < 0) continue;
		const auto offset = static_cast<sljit_sw>(slot) * sizeof(Value);
		if (reload) {
			if (m_lowering) ++m_lowering->phases[static_cast<size_t>(m_loweringPhase)].helperSpillReloads;
			sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, cachedFloatRegister(slot), 0, SLJIT_MEM1(SLJIT_SP), offset);
		} else {
			if (m_lowering) ++m_lowering->phases[static_cast<size_t>(m_loweringPhase)].helperSpillStores;
			sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_SP), offset, cachedFloatRegister(slot), 0);
		}
	}
}

void NativeBlockCompiler::loadHeader(int selector, sljit_s32 target) {
	const auto fact = operandFact(selector);
	if (fact.kind == RegisterValueKind::Constant) {
		sljit_emit_op1(m_compiler, SLJIT_MOV, target, 0, SLJIT_IMM, fact.constant >> 48u);
		return;
	}
	const auto source = valueLocation(definitionFor(selector));
	if (source.kind == ValueLocationKind::Register) {
		m_registers[source.index].lastUse = ++m_registerClock;
		if (m_lowering) ++m_lowering->phases[static_cast<size_t>(m_loweringPhase)].headerExtractions;
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, cachedFloatRegister(source.index), target);
		sljit_emit_op2(m_compiler, SLJIT_LSHR, target, 0, target, 0, SLJIT_IMM, sizeof(sljit_sw) * 8u - 16u);
		return;
	}
	constexpr sljit_sw offset = std::endian::native == std::endian::little ? 6 : 0;
	if (m_lowering) ++m_lowering->phases[static_cast<size_t>(m_loweringPhase)].registerHeaderLoads;
	sljit_emit_op1(m_compiler, SLJIT_MOV_U16, target, 0, SLJIT_MEM1(SLJIT_S0), static_cast<sljit_sw>(source.index) * sizeof(Value) + offset);
}

void NativeBlockCompiler::loadPayload(int selector, sljit_s32 target, [[maybe_unused]] sljit_s32 scratch) {
	const auto fact = operandFact(selector);
	if (fact.kind == RegisterValueKind::Constant) {
		sljit_emit_op1(m_compiler, SLJIT_MOV, target, 0, SLJIT_IMM, static_cast<sljit_sw>(valuePayload(fact.constant)));
		return;
	}
	const auto source = valueLocation(definitionFor(selector));
	if (source.kind == ValueLocationKind::Register) {
		m_registers[source.index].lastUse = ++m_registerClock;
		if (m_lowering) ++m_lowering->phases[static_cast<size_t>(m_loweringPhase)].payloadExtractions;
#if defined(SLJIT_64BIT_ARCHITECTURE)
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, cachedFloatRegister(source.index), target);
#else
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, cachedFloatRegister(source.index), SLJIT_REG_PAIR(scratch, target));
#endif
	} else {
		sljit_sw offset = static_cast<sljit_sw>(source.index) * sizeof(Value);
#if defined(SLJIT_32BIT_ARCHITECTURE)
		if constexpr (std::endian::native == std::endian::big) offset += 4;
#endif
		if (m_lowering) ++m_lowering->phases[static_cast<size_t>(m_loweringPhase)].registerPayloadLoads;
		sljit_emit_op1(m_compiler, SLJIT_MOV, target, 0, SLJIT_MEM1(SLJIT_S0), offset);
	}
#if defined(SLJIT_64BIT_ARCHITECTURE)
	sljit_emit_op2(m_compiler, SLJIT_AND, target, 0, target, 0, SLJIT_IMM, VALUE_PAYLOAD_MASK);
#endif
}

} // namespace bmsx
