#include "machine/cpu/native_block_compiler.h"

#include <bit>
#include <limits>

#include "machine/cpu/execution_image.h"
#include "machine/cpu/string_pool.h"
#include "machine/cpu/table.h"

namespace bmsx {

void NativeBlockCompiler::emitTableAccess(const DecodedInstruction& instruction, NativeBlockExitSite* exit) {
	const auto op = static_cast<OpCode>(instruction.op);
	const bool load = op == OpCode::GETT || op == OpCode::GETI || op == OpCode::GETFIELD || op == OpCode::SELF;
	const bool generic = op == OpCode::GETT || op == OpCode::SETT;
	const bool integer = op == OpCode::GETI || op == OpCode::SETI;
	const int base = load ? instruction.b : instruction.a;
	const int key = load ? instruction.c : instruction.b;
	if (op == OpCode::SELF) {
		loadOperand(base, SLJIT_FR0);
		writeRegister(static_cast<int>(instruction.a) + 1);
	}
	// Load all operands before taking a state map: cache admission may evict
	// a previous definition, but each branch below leaves the map unchanged.
	if (!load) loadOperand(instruction.c, SLJIT_FR2);
	if (generic) loadOperand(key, SLJIT_FR0);
	SlowPath slow; slow.exit = exit; slow.registers = registerSnapshot();
	const auto receiverFact = operandFact(base);
	if (receiverFact.kind != RegisterValueKind::Table) {
		loadHeader(base, SLJIT_R0);
		slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R0, 0,
			SLJIT_IMM, valueFromTag(ValueTag::Table) >> 48u);
		const int slot = base < 0 ? -1 : findRegister(base);
		if (slot >= 0) m_registers[slot].value = {RegisterValueKind::Table, 0};
	} else if (receiverFact.entrySource >= 0) {
		size_t index = m_currentEntry;
		int guest = receiverFact.entrySource;
		while (guest >= 0) {
			auto& entry = m_entries[index];
			int slot = 0;
			while (entry.registers[slot].guest != guest) ++slot;
			if (entry.tableGuards[slot]) break;
			entry.tableGuards[slot] = true;
			guest = entry.tableParents[slot];
			if (guest >= 0) --index;
		}
	}
	loadPayload(base, SLJIT_R0, SLJIT_R1);
	if (integer) {
		sljit_emit_op1(m_compiler, SLJIT_MOV, SLJIT_R1, 0, SLJIT_IMM, key - 1);
		emitArraySlot(load, instruction.c, slow);
	} else if (!generic) {
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_IMM, asStringId(m_constants[key]));
		emitStringSlot(load, instruction.c, slow);
	} else {
		loadHeader(key, SLJIT_R1);
		auto* string = sljit_emit_cmp(m_compiler, SLJIT_EQUAL, SLJIT_R1, 0, SLJIT_IMM, valueString(0) >> 48u);
		// A Number can have an ordinary IEEE header or the numeric NaN header.
		// Every other guest kind takes its typed index exit, not an FP cast.
		sljit_emit_op2(m_compiler, SLJIT_AND, SLJIT_R2, 0, SLJIT_R1, 0, SLJIT_IMM, VALUE_QNAN_MASK >> 48u);
		auto* number = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, VALUE_QNAN_MASK >> 48u);
		sljit_emit_op2(m_compiler, SLJIT_AND, SLJIT_R2, 0, SLJIT_R1, 0, SLJIT_IMM, VALUE_ENCODED_TAG_MASK >> 48u);
		slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, 0);
		sljit_set_label(number, sljit_emit_label(m_compiler));
		sljit_emit_fset64(m_compiler, SLJIT_FR1, 1.0);
		slow.jumps[slow.count++] = sljit_emit_fcmp(m_compiler, SLJIT_UNORDERED_OR_LESS, SLJIT_FR0, 0, SLJIT_FR1, 0);
		sljit_emit_fset64(m_compiler, SLJIT_FR1, static_cast<double>(std::numeric_limits<int>::max()));
		slow.jumps[slow.count++] = sljit_emit_fcmp(m_compiler, SLJIT_ORDERED_GREATER, SLJIT_FR0, 0, SLJIT_FR1, 0);
		sljit_emit_fop1(m_compiler, SLJIT_CONV_SW_FROM_F64, SLJIT_R1, 0, SLJIT_FR0, 0);
		sljit_emit_fop1(m_compiler, SLJIT_CONV_F64_FROM_SW, SLJIT_FR1, 0, SLJIT_R1, 0);
		slow.jumps[slow.count++] = sljit_emit_fcmp(m_compiler, SLJIT_ORDERED_NOT_EQUAL, SLJIT_FR0, 0, SLJIT_FR1, 0);
		sljit_emit_op2(m_compiler, SLJIT_SUB, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 1);
		emitArraySlot(load, instruction.c, slow);
		auto* done = sljit_emit_jump(m_compiler, SLJIT_JUMP);
		sljit_set_label(string, sljit_emit_label(m_compiler));
		loadPayload(key, SLJIT_R3, SLJIT_R1);
		emitStringSlot(load, instruction.c, slow);
		sljit_set_label(done, sljit_emit_label(m_compiler));
	}
	m_slowPaths.push_back(slow);
	if (load) writeRegister(instruction.a);
}

// R0: actual Table; R1: zero-based array slot; FR2: raw stored Value.
void NativeBlockCompiler::emitArraySlot(bool load, int value, SlowPath& slow) {
	const auto fields = Table::nativeFieldOffsets();
	constexpr sljit_sw headerOffset = std::endian::native == std::endian::little ? 6 : 0;
	slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_GREATER_EQUAL,
		SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), fields.arraySize);
	sljit_emit_op2(m_compiler, SLJIT_SHL, SLJIT_S2, 0, SLJIT_R1, 0, SLJIT_IMM, 3);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), fields.arrayData);
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_S2, 0, SLJIT_S2, 0, SLJIT_R2, 0);
	if (load) {
		sljit_emit_op1(m_compiler, SLJIT_MOV_U16, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_S2), headerOffset);
		auto* present = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, valueNil() >> 48u);
		slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL,
			SLJIT_MEM1(SLJIT_R0), fields.metatable, SLJIT_IMM, 0);
		sljit_set_label(present, sljit_emit_label(m_compiler));
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_FR0, 0, SLJIT_MEM1(SLJIT_S2), 0);
		return;
	}
	loadHeader(value, SLJIT_R2);
	sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_S2), 0, SLJIT_FR2, 0);
	auto* nil = sljit_emit_cmp(m_compiler, SLJIT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, valueNil() >> 48u);
	sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), fields.lengthHint);
	auto* retained = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R1, 0, SLJIT_R2, 0);
	sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, 1);
	sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_MEM1(SLJIT_R0), fields.lengthHint, SLJIT_R2, 0);
	auto* advanced = sljit_emit_jump(m_compiler, SLJIT_JUMP);
	sljit_set_label(nil, sljit_emit_label(m_compiler));
	sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), fields.lengthHint);
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 1);
	auto* unchanged = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R1, 0, SLJIT_R2, 0);
	sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, 1);
	sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_MEM1(SLJIT_R0), fields.lengthHint, SLJIT_R2, 0);
	auto* done = sljit_emit_label(m_compiler);
	sljit_set_label(retained, done); sljit_set_label(advanced, done); sljit_set_label(unchanged, done);
}

// R0: actual Table; R3: runtime StringId; FR2: raw stored Value.
void NativeBlockCompiler::emitStringSlot(bool load, int value, SlowPath& slow) {
	const auto fields = Table::nativeFieldOffsets();
	std::array<sljit_jump*, 5> misses;
	size_t missCount = 0;
	constexpr sljit_sw headerOffset = std::endian::native == std::endian::little ? 6 : 0;
	constexpr sljit_sw payloadOffset = std::endian::native == std::endian::little ? 0 : 4;
	sljit_emit_op1(m_compiler, SLJIT_MOV_S32, SLJIT_R1, 0, SLJIT_MEM0(), reinterpret_cast<sljit_sw>(&slow.exit->tableCacheSlot));
	misses[missCount++] = sljit_emit_cmp(m_compiler, SLJIT_GREATER_EQUAL, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), fields.hashSize);
	sljit_emit_op2(m_compiler, SLJIT_SHL, SLJIT_S2, 0, SLJIT_R1, 0, SLJIT_IMM, 3);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), fields.keys);
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_S2, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV_U16, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), headerOffset);
	misses[missCount++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, valueString(0) >> 48u);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), payloadOffset);
	misses[missCount++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_R3, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), fields.values);
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_S2, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV_U16, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), headerOffset);
	misses[missCount++] = sljit_emit_cmp(m_compiler, SLJIT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, valueNil() >> 48u);
	if (load) {
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_FR0, 0, SLJIT_MEM1(SLJIT_R1), 0);
		auto* done = sljit_emit_jump(m_compiler, SLJIT_JUMP);
		auto* lookup = sljit_emit_label(m_compiler);
		for (size_t i = 0; i < missCount; ++i) sljit_set_label(misses[i], lookup);
		// This leaf cannot allocate or execute guest code. Keep all cached
		// Values live; a failed chain must not overwrite the guest destination.
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_R3, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, m_bindings.indexKey);
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R3, 0, SLJIT_SP, 0, SLJIT_IMM, NativeBlockAbi::helperResultOffset);
		emitCallSpills(false);
		sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS4V(P, 32, 32, P), SLJIT_IMM,
			SLJIT_FUNC_ADDR(&Table::loadStringIndex));
		emitCallSpills(true);
		const auto result = NativeBlockAbi::helperResultOffset;
		// A failed leaf is replayed by the semantic exit to construct the fault.
		// Charge its visited Tables there once, not in both attempts.
		slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32,
			SLJIT_MEM1(SLJIT_SP), result + offsetof(TableLookupResult, status),
			SLJIT_IMM, static_cast<u32>(TableLookupStatus::ChainExhausted));
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0,
			SLJIT_MEM1(SLJIT_SP), result + offsetof(TableLookupResult, extraVisits));
		sljit_emit_op2(m_compiler, SLJIT_MUL32, SLJIT_R0, 0, SLJIT_R0, 0,
			SLJIT_IMM, TABLE_INDEX_VISIT_CYCLES);
		sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_S4, 0, SLJIT_S4, 0, SLJIT_R0, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0,
			SLJIT_MEM1(SLJIT_SP), result + offsetof(TableLookupResult, slot));
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM0(), reinterpret_cast<sljit_sw>(&slow.exit->tableCacheSlot), SLJIT_R0, 0);
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_FR0, 0, SLJIT_MEM1(SLJIT_SP), result + offsetof(TableLookupResult, value));
		sljit_set_label(done, sljit_emit_label(m_compiler));
	} else {
		loadHeader(value, SLJIT_R2);
		misses[missCount++] = sljit_emit_cmp(m_compiler, SLJIT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, valueNil() >> 48u);
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_R1), 0, SLJIT_FR2, 0);
		auto* done = sljit_emit_jump(m_compiler, SLJIT_JUMP);
		auto* store = sljit_emit_label(m_compiler);
		for (size_t i = 0; i < missCount; ++i) sljit_set_label(misses[i], store);
		// No allocation or guest callbacks: preserve the native frame and all
		// cached values. Only the raw store operand needs an address for the ABI.
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_R3, 0);
		if (value < 0) {
			sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_IMM,
				reinterpret_cast<sljit_sw>(&m_constants[-value - 1]));
		} else {
			sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_S0), value * sizeof(Value), SLJIT_FR2, 0);
			sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R2, 0, SLJIT_S0, 0, SLJIT_IMM, value * sizeof(Value));
		}
		emitCallSpills(false);
		sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS3(32, P, 32, P), SLJIT_IMM,
			SLJIT_FUNC_ADDR(&Table::storeStringKeyWithoutGrowth));
		emitCallSpills(true);
		slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0,
			SLJIT_IMM, TABLE_STORE_REQUIRES_GROWTH);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM0(), reinterpret_cast<sljit_sw>(&slow.exit->tableCacheSlot), SLJIT_R0, 0);
		sljit_set_label(done, sljit_emit_label(m_compiler));
	}
}

void NativeBlockCompiler::emitLength(const DecodedInstruction& instruction, NativeBlockExitSite* exit) {
	loadHeader(instruction.b, SLJIT_R0);
	auto* string = sljit_emit_cmp(m_compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_IMM, valueString(0) >> 48u);
	SlowPath slow; slow.exit = exit; slow.registers = registerSnapshot();
	slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R0, 0, SLJIT_IMM, valueFromTag(ValueTag::Table) >> 48u);
	loadPayload(instruction.b, SLJIT_R0, SLJIT_R1);
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R1, 0, SLJIT_SP, 0, SLJIT_IMM, NativeBlockAbi::helperResultOffset);
	emitCallSpills(false);
	sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS2(F64, P, P), SLJIT_IMM, SLJIT_FUNC_ADDR(&Table::length));
	emitCallSpills(true);
	// FR0 retains the complete boundary while the scalar logical work reaches
	// the live budget. The completed LEN segment owns its successor deadline.
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0,
		SLJIT_MEM1(SLJIT_SP), NativeBlockAbi::helperResultOffset);
	sljit_emit_op2(m_compiler, SLJIT_MUL32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, TABLE_LENGTH_PROBE_CYCLES);
	sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_S4, 0, SLJIT_S4, 0, SLJIT_R0, 0);
	auto* done = sljit_emit_jump(m_compiler, SLJIT_JUMP);
	sljit_set_label(string, sljit_emit_label(m_compiler));
	loadPayload(instruction.b, SLJIT_R1, SLJIT_R0);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(m_bindings.strings));
	emitCallSpills(false);
	sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS2(32, P, 32), SLJIT_IMM, SLJIT_FUNC_ADDR(stringCodepointCount));
	emitCallSpills(true);
	sljit_emit_fop1(m_compiler, SLJIT_CONV_F64_FROM_S32, SLJIT_FR0, 0, SLJIT_R0, 0);
	sljit_set_label(done, sljit_emit_label(m_compiler));
	m_slowPaths.push_back(slow);
	writeRegister(instruction.a);
}
} // namespace bmsx
