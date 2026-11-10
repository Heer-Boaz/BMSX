#include "machine/cpu/native_block_compiler.h"

#include <bit>
#include <algorithm>
#include <limits>

#include "machine/cpu/execution_image.h"

namespace bmsx {

void NativeBlockCompiler::planResidentRegisters(std::span<const NativeBlockSource> sources) {
	std::vector<int> reads;
	size_t instructionCount = 0;
	for (const auto& source : sources) instructionCount += source.instructions.size();
	reads.reserve(instructionCount * 3u);
	for (const auto& source : sources) for (const auto& item : source.instructions) {
		const auto& op = *item.decoded;
		const auto kind = static_cast<OpCode>(op.op);
		// A zero counted transfer never consumes its address operand.
		if ((kind == OpCode::STORE_MEM_WORDS || kind == OpCode::STORE_MEM_WORDS_D) && op.c == 0) continue;
		const auto operands = OPCODE_SCALAR_REGISTER_READS[op.op];
		if (operands & REGISTER_OPERAND_A) reads.push_back(op.a);
		if ((operands & REGISTER_OPERAND_B) && op.b >= 0) reads.push_back(op.b);
		if ((operands & REGISTER_OPERAND_C) && op.c >= 0) reads.push_back(op.c);
	}
	std::sort(reads.begin(), reads.end());
	std::vector<std::pair<int, size_t>> counts;
	counts.reserve(reads.size());
	for (size_t index = 0; index < reads.size();) {
		const auto first = index++;
		while (index < reads.size() && reads[index] == reads[first]) ++index;
		if (index - first > 1u) counts.emplace_back(reads[first], index - first);
	}
	std::sort(counts.begin(), counts.end(), [](const auto& left, const auto& right) {
		return left.second != right.second ? left.second > right.second : left.first < right.first;
	});
	// Keep two slots for local operands/definitions that are not resident.
	m_residentCount = std::min(std::max(m_registerCount - 2, 0), static_cast<int>(counts.size()));
	for (int slot = 0; slot < m_residentCount; ++slot) {
		auto& resident = m_residentRegisters[slot];
		resident.guest = counts[slot].first;
		for (const auto& source : sources) for (const auto& item : source.instructions) {
			const auto& op = *item.decoded;
			resident.dirty |= OPCODE_WRITES_REGISTER_A[op.op] && op.a == resident.guest
				&& !nativeBlockEndsBlock(op.op, op.b);
			resident.dirty |= op.op == static_cast<u8>(OpCode::SELF) && op.a + 1 == resident.guest;
		}
	}
}

void NativeBlockCompiler::emitResidentWriteback() {
	for (int slot = 0; slot < m_residentCount; ++slot) if (m_residentRegisters[slot].dirty)
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_S0),
			m_residentRegisters[slot].guest * sizeof(Value), cachedFloatRegister(slot), 0);
}

void NativeBlockCompiler::reloadResidentRange(int first, int end) {
	for (int slot = 0; slot < m_residentCount; ++slot) {
		auto& resident = m_registers[slot];
		if (resident.guest < first || resident.guest >= end) continue;
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, cachedFloatRegister(slot), 0,
			SLJIT_MEM1(SLJIT_S0), resident.guest * sizeof(Value));
		resident.dirty = false;
	}
}

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
	for (int slot = m_residentCount; slot < m_registerCount; ++slot) {
		if (cachedFloatRegister(slot) == pinned) continue;
		if (m_registers[slot].guest < 0) {
			selected = slot;
			break;
		}
		if (selected < 0 || m_registers[slot].lastUse < m_registers[selected].lastUse) selected = slot;
	}
	if (selected < 0) return -1;
	auto& entry = m_registers[selected];
	if (entry.dirty) sljit_emit_fop1(m_compiler, SLJIT_MOV_F64,
		SLJIT_MEM1(SLJIT_S0), static_cast<sljit_sw>(entry.guest) * sizeof(Value), cachedFloatRegister(selected), 0);
	entry = CachedRegister{guest, false, ++m_registerClock};
	return selected;
}

sljit_s32 NativeBlockCompiler::destinationRegister(int guest) {
	int slot = findRegister(guest);
	if (slot < 0) slot = allocateRegister(guest);
	m_registers[slot].dirty = true;
	m_registers[slot].lastUse = ++m_registerClock;
	return cachedFloatRegister(slot);
}

void NativeBlockCompiler::writeRegister(int guest, sljit_s32 source) {
	const auto target = destinationRegister(guest);
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
			if (slot < m_residentCount) m_registers[slot].dirty = false;
			else m_registers[slot] = CachedRegister{};
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
	if (selector < 0) {
		sljit_emit_op1(m_compiler, SLJIT_MOV, target, 0, SLJIT_IMM,
			static_cast<sljit_sw>(valuePayload(m_constants[-selector - 1])));
		return;
	}
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
