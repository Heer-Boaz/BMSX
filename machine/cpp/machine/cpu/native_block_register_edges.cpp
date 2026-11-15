#include "machine/cpu/native_block_compiler.h"

namespace bmsx {

bool NativeBlockCompiler::emitRegisterTransfer(const RegisterState& sourceRegisters,
	const RegisterState& targetRegisters, NativeBlockExitSite& exit) {
	RegisterSnapshot stores, retained;
	stores.fill(-1);
	retained.fill(-1);
	for (int source = 0; source < m_registerCount; ++source) {
		const auto& value = sourceRegisters[source];
		if (!value.dirty) continue;
		int destination = 0;
		while (destination < m_registerCount && targetRegisters[destination].guest != value.guest) ++destination;
		if (destination == m_registerCount || !targetRegisters[destination].dirty) stores[source] = value.guest;
		else retained[destination] = value.guest;
	}
	setExitRegisterMap(exit, retained);
	struct Move { int source; int destination; };
	std::array<Move, REGISTER_CACHE_CAPACITY> moves;
	int count = 0;
	for (int destination = 0; destination < m_registerCount; ++destination) {
		const int guest = targetRegisters[destination].guest;
		if (guest < 0 || guest == sourceRegisters[destination].guest) continue;
		int source = 0;
		while (source < m_registerCount && sourceRegisters[source].guest != guest) ++source;
		moves[count++] = {source == m_registerCount ? -1 : source, destination};
	}
	bool materialize = false;
	for (int guest : stores) materialize |= guest >= 0;
	if (count == 0 && !materialize) return false;
	emitRegisterSnapshot(stores);
	// Parallel moves can contain permutations at a join. Break each cycle
	// with an instruction scratch FPR, never with guest-memory round trips.
	while (count != 0) {
		int ready = 0;
		for (; ready < count; ++ready) {
			int reader = 0;
			while (reader < count && moves[reader].source != moves[ready].destination) ++reader;
			if (reader == count) break;
		}
		if (ready == count) {
			const int saved = moves[0].destination;
			sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_FR0, 0, cachedFloatRegister(saved), 0);
			for (int index = 0; index < count; ++index) if (moves[index].source == saved) moves[index].source = REGISTER_CACHE_CAPACITY;
			continue;
		}
		const auto move = moves[ready];
		if (move.source < 0) sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, cachedFloatRegister(move.destination), 0,
			SLJIT_MEM1(SLJIT_S0), targetRegisters[move.destination].guest * sizeof(Value));
		else sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, cachedFloatRegister(move.destination), 0,
			move.source == REGISTER_CACHE_CAPACITY ? SLJIT_FR0 : cachedFloatRegister(move.source), 0);
		moves[ready] = moves[--count];
	}
	return true;
}

void NativeBlockCompiler::emitInternalBranches() {
	for (const auto& branch : m_internalBranches) {
		const auto& target = m_entries[branch.target];
		if (!branch.transferDeferred) {
			sljit_set_label(branch.jump, target.guarded);
			continue;
		}
		auto* transfer = sljit_emit_label(m_compiler);
		if (emitRegisterTransfer(branch.registers, target.registers, *branch.exit)) {
			sljit_set_label(branch.jump, transfer);
			sljit_set_label(sljit_emit_jump(m_compiler, SLJIT_JUMP), target.guarded);
		} else sljit_set_label(branch.jump, target.guarded);
	}
}

} // namespace bmsx
