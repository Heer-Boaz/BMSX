#include "machine/cpu/native_block_compiler.h"

#include <algorithm>
#include "machine/cpu/execution_image.h"

namespace bmsx {

size_t NativeBlockCompiler::bindingIndex(int guest) const {
	return std::lower_bound(m_guestSlots.begin(), m_guestSlots.end(), guest) - m_guestSlots.begin();
}

int NativeBlockCompiler::definitionFor(int guest) {
	auto& binding = m_slotBindings[bindingIndex(guest)];
	if (binding.definition < 0) {
		binding.definition = static_cast<int>(m_definitions.size());
		m_definitions.push_back({{}, guest});
	}
	return binding.definition;
}

int NativeBlockCompiler::findValue(int definition) const {
	for (int slot = 0; slot < m_registerCount; ++slot)
		if (m_registers[slot].definition == definition) return slot;
	return -1;
}

int NativeBlockCompiler::findRegister(int guest) const {
	const int definition = m_slotBindings[bindingIndex(guest)].definition;
	return definition < 0 ? -1 : findValue(definition);
}

bool NativeBlockCompiler::hasBindings(int definition) const {
	return std::any_of(m_slotBindings.begin(), m_slotBindings.end(),
		[definition](const auto& binding) { return binding.definition == definition; });
}

NativeBlockCompiler::ValueLocation NativeBlockCompiler::valueLocation(int definition) const {
	const int slot = findValue(definition);
	if (slot >= 0) return {ValueLocationKind::Register, slot};
	const auto& value = m_definitions[definition];
	if (value.fact.kind == RegisterValueKind::Constant) return {ValueLocationKind::Constant, 0, value.fact.constant};
	return {ValueLocationKind::Home, value.home};
}

void NativeBlockCompiler::preserveHome(int guest, sljit_s32 temporary) {
	const int definition = m_slotBindings[bindingIndex(guest)].definition;
	if (definition < 0 || m_definitions[definition].home != guest) return;
	for (size_t index = 0; index < m_slotBindings.size(); ++index) {
		const auto& binding = m_slotBindings[index];
		if (m_guestSlots[index] != guest && binding.definition == definition && !binding.dirty) {
			m_definitions[definition].home = m_guestSlots[index];
			return;
		}
	}
	if (findValue(definition) >= 0 || m_definitions[definition].fact.kind == RegisterValueKind::Constant) {
		m_definitions[definition].home = -1;
		return;
	}
	for (size_t index = 0; index < m_slotBindings.size(); ++index) {
		auto& binding = m_slotBindings[index];
		if (m_guestSlots[index] == guest || binding.definition != definition) continue;
		if (m_lowering) ++m_lowering->phases[static_cast<size_t>(m_loweringPhase)].registerValueLoads;
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, temporary, 0, SLJIT_MEM1(SLJIT_S0), guest * sizeof(Value));
		if (m_lowering) ++m_lowering->phases[static_cast<size_t>(m_loweringPhase)].publicationStores;
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_S0), m_guestSlots[index] * sizeof(Value), temporary, 0);
		binding.dirty = false;
		m_definitions[definition].home = m_guestSlots[index];
		return;
	}
	m_definitions[definition].home = -1;
}

void NativeBlockCompiler::preserveRangeHomes(int first, int end) {
	for (size_t definition = 0; definition < m_definitions.size(); ++definition) {
		const int home = m_definitions[definition].home;
		if (home < first || home >= end) continue;
		size_t outside = 0;
		while (outside < m_slotBindings.size() && (m_slotBindings[outside].definition != static_cast<int>(definition)
			|| (m_guestSlots[outside] >= first && m_guestSlots[outside] < end))) ++outside;
		if (outside == m_slotBindings.size()) continue;
		if (findValue(static_cast<int>(definition)) >= 0 || m_definitions[definition].fact.kind == RegisterValueKind::Constant) {
			m_definitions[definition].home = -1;
			continue;
		}
		emitValueStore(m_guestSlots[outside], {ValueLocationKind::Home, home}, m_loweringPhase);
		m_slotBindings[outside].dirty = false;
		m_definitions[definition].home = m_guestSlots[outside];
	}
}

void NativeBlockCompiler::bindRegister(int guest, int definition, bool dirty, sljit_s32 temporary) {
	auto& binding = m_slotBindings[bindingIndex(guest)];
	const int previous = binding.definition;
	if (previous == definition) return;
	preserveHome(guest, temporary);
	binding = {definition, dirty};
	if (previous >= 0 && !hasBindings(previous)) {
		const int slot = findValue(previous);
		if (slot >= 0) m_registers[slot] = {};
	}
}

int NativeBlockCompiler::allocateValue(int definition, sljit_s32 pinned) {
	int selected = -1;
	for (int slot = 0; slot < m_registerCount; ++slot) {
		if (cachedFloatRegister(slot) == pinned) continue;
		selected = slot;
		if (m_registers[slot].definition < 0) break;
	}
	if (selected < 0) return -1;
	if (m_registers[selected].definition >= 0) {
		std::array<size_t, REGISTER_CACHE_CAPACITY> nextAccess;
		nextAccess.fill(NATIVE_BLOCK_MAX_INSTRUCTIONS);
		const size_t horizon = std::min(m_remainingInstructions.size(), size_t{NATIVE_BLOCK_MAX_INSTRUCTIONS});
		int unresolved = m_registerCount;
		for (int slot = 0; slot < m_registerCount; ++slot) if (cachedFloatRegister(slot) == pinned) --unresolved;
		for (size_t distance = 0; distance < horizon && unresolved != 0; ++distance) {
			const auto& instruction = *m_remainingInstructions[distance].decoded;
			const auto access = registerAccess(instruction);
			const auto observe = [&](size_t index) {
				const int value = m_slotBindings[index].definition;
				if (value < 0) return;
				const int slot = findValue(value);
				if (slot >= 0 && cachedFloatRegister(slot) != pinned && nextAccess[slot] == NATIVE_BLOCK_MAX_INSTRUCTIONS) {
					nextAccess[slot] = distance;
					--unresolved;
				}
			};
			if (access.scalarReads & REGISTER_OPERAND_A) observe(bindingIndex(instruction.a));
			if ((access.scalarReads & REGISTER_OPERAND_B) && instruction.b >= 0) observe(bindingIndex(instruction.b));
			if ((access.scalarReads & REGISTER_OPERAND_C) && instruction.c >= 0) observe(bindingIndex(instruction.c));
			for (const auto [first, end] : {std::pair{access.readFirst, access.readEnd}, std::pair{access.writeFirst, access.writeEnd}})
				for (auto index = bindingIndex(first); index < m_guestSlots.size() && m_guestSlots[index] < end; ++index) observe(index);
		}
		for (int slot = 0; slot < m_registerCount; ++slot) {
			if (cachedFloatRegister(slot) == pinned) continue;
			const auto& candidate = m_registers[slot];
			const auto& victim = m_registers[selected];
			const auto& candidateValue = m_definitions[candidate.definition];
			const auto& victimValue = m_definitions[victim.definition];
			const bool candidateStore = candidateValue.home < 0 && candidateValue.fact.kind != RegisterValueKind::Constant;
			const bool victimStore = victimValue.home < 0 && victimValue.fact.kind != RegisterValueKind::Constant;
			if (nextAccess[slot] > nextAccess[selected] || (nextAccess[slot] == nextAccess[selected]
				&& (candidateStore < victimStore || (candidateStore == victimStore && candidate.lastUse < victim.lastUse)))) selected = slot;
		}
	}
	const int previous = m_registers[selected].definition;
	if (previous >= 0 && m_definitions[previous].home < 0 && m_definitions[previous].fact.kind != RegisterValueKind::Constant) {
		for (size_t index = 0; index < m_slotBindings.size(); ++index) {
			auto& binding = m_slotBindings[index];
			if (binding.definition != previous) continue;
			if (m_lowering) ++m_lowering->phases[static_cast<size_t>(m_loweringPhase)].dirtyEvictionStores;
			sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_S0), m_guestSlots[index] * sizeof(Value), cachedFloatRegister(selected), 0);
			binding.dirty = false;
			m_definitions[previous].home = m_guestSlots[index];
			break;
		}
	}
	m_registers[selected] = {definition, ++m_registerClock};
	return selected;
}

void NativeBlockCompiler::resetRegisterState(const RegisterState& registers) {
	m_definitions.clear();
	std::fill(m_slotBindings.begin(), m_slotBindings.end(), SlotBinding{});
	m_registers.fill(CachedValue{});
	m_registerClock = m_registerCount;
	for (int slot = 0; slot < m_registerCount; ++slot) {
		const auto& value = registers[slot];
		if (value.guest < 0) continue;
		const int definition = static_cast<int>(m_definitions.size());
		m_definitions.push_back({value.value, value.dirty ? -1 : value.guest});
		m_slotBindings[bindingIndex(value.guest)] = {definition, value.dirty};
		m_registers[slot] = {definition, value.lastUse};
	}
}

void NativeBlockCompiler::copyRegister(int guest, int source) {
	bindRegister(guest, definitionFor(source), true);
}

void NativeBlockCompiler::bindConstant(int guest, Value value) {
	const int definition = static_cast<int>(m_definitions.size());
	m_definitions.push_back({{RegisterValueKind::Constant, value}, -1});
	bindRegister(guest, definition, true);
}

void NativeBlockCompiler::discardRegisterRange(int first, int end) {
	preserveRangeHomes(first, end);
	for (size_t index = 0; index < m_slotBindings.size(); ++index)
		if (m_guestSlots[index] >= first && m_guestSlots[index] < end) m_slotBindings[index] = {};
	for (auto& cached : m_registers)
		if (cached.definition >= 0 && !hasBindings(cached.definition)) cached = {};
}

void NativeBlockCompiler::publishRegisterRange(int first, int end) {
	for (size_t index = 0; index < m_slotBindings.size(); ++index) {
		auto& binding = m_slotBindings[index];
		if (!binding.dirty || m_guestSlots[index] < first || m_guestSlots[index] >= end) continue;
		emitValueStore(m_guestSlots[index], valueLocation(binding.definition), m_loweringPhase);
		binding.dirty = false;
		if (m_definitions[binding.definition].home < 0) m_definitions[binding.definition].home = m_guestSlots[index];
	}
}

} // namespace bmsx
