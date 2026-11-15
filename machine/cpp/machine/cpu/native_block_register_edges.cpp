#include "machine/cpu/native_block_compiler.h"

namespace bmsx {

void NativeBlockCompiler::emitRegisterTransfer(const RegisterState& targetRegisters,
	NativeBlockExitSite& exit, size_t targetIndex) {
	std::array<ValueLocation, REGISTER_CACHE_CAPACITY> sources{};
	for (int slot = 0; slot < m_registerCount; ++slot) {
		const int guest = targetRegisters[slot].guest;
		if (guest < 0) continue;
		const int definition = definitionFor(guest);
		sources[slot] = valueLocation(definition);
		if (targetIndex == m_currentEntry + 1u && m_sources[m_currentEntry].fallthrough) {
			auto& target = m_entries[targetIndex];
			const auto fact = m_definitions[definition].fact;
			target.registers[slot].value = fact.kind == RegisterValueKind::Table ? fact : RegisterValueFact{};
			target.tableParents[slot] = fact.kind == RegisterValueKind::Table ? fact.entrySource : -1;
		}
	}
	// Canonical targets deliberately split unknown public-entry values. Keep
	// any requested name of an incoming definition resident; publish every
	// other dirty architectural name before forgetting its alias binding.
	for (size_t index = 0; index < m_slotBindings.size(); ++index) {
		const auto& binding = m_slotBindings[index];
		if (!binding.dirty) continue;
		const int guest = m_guestSlots[index];
		int target = 0;
		while (target < m_registerCount && targetRegisters[target].guest != guest) ++target;
		if (target == m_registerCount || !targetRegisters[target].dirty)
			emitValueStore(guest, valueLocation(binding.definition), m_loweringPhase);
	}
	RegisterSnapshot retained;
	for (int slot = 0; slot < m_registerCount; ++slot)
		if (targetRegisters[slot].dirty) retained.primary[slot] = targetRegisters[slot].guest;
	setExitRegisterMap(exit, retained);

	struct Move { ValueLocation source; int destination; };
	std::array<Move, REGISTER_CACHE_CAPACITY> moves;
	int count = 0;
	for (int destination = 0; destination < m_registerCount; ++destination) {
		if (targetRegisters[destination].guest < 0) continue;
		const auto source = sources[destination];
		if (source.kind != ValueLocationKind::Register || source.index != destination)
			moves[count++] = {source, destination};
	}
	while (count != 0) {
		int ready = 0;
		for (; ready < count; ++ready) {
			int reader = 0;
			while (reader < count && (moves[reader].source.kind != ValueLocationKind::Register
				|| moves[reader].source.index != moves[ready].destination)) ++reader;
			if (reader == count) break;
		}
		if (ready == count) {
			const int saved = moves[0].destination;
			if (m_lowering) ++m_lowering->phases[static_cast<size_t>(m_loweringPhase)].rawFprCopies;
			sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_FR0, 0, cachedFloatRegister(saved), 0);
			for (int index = 0; index < count; ++index)
				if (moves[index].source.kind == ValueLocationKind::Register && moves[index].source.index == saved)
					moves[index].source.index = REGISTER_CACHE_CAPACITY;
			continue;
		}
		const auto move = moves[ready];
		const auto destination = cachedFloatRegister(move.destination);
		if (move.source.kind == ValueLocationKind::Register) {
			if (m_lowering) ++m_lowering->phases[static_cast<size_t>(m_loweringPhase)].rawFprCopies;
			sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, destination, 0,
				move.source.index == REGISTER_CACHE_CAPACITY ? SLJIT_FR0 : cachedFloatRegister(move.source.index), 0);
		} else if (move.source.kind == ValueLocationKind::Constant) {
			if (m_lowering) ++m_lowering->phases[static_cast<size_t>(m_loweringPhase)].rawRematerializations;
			sljit_emit_fset64(m_compiler, destination, asNumber(move.source.constant));
		} else {
			if (m_lowering) ++m_lowering->phases[static_cast<size_t>(m_loweringPhase)].registerValueLoads;
			sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, destination, 0,
				SLJIT_MEM1(SLJIT_S0), static_cast<sljit_sw>(move.source.index) * sizeof(Value));
		}
		moves[ready] = moves[--count];
	}
}

void NativeBlockCompiler::emitInternalBranches() {
	for (const auto& branch : m_internalBranches)
		sljit_set_label(branch.jump, m_entries[branch.target].guarded);
}

} // namespace bmsx
