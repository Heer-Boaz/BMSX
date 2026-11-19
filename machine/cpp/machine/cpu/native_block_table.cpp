#include "machine/cpu/native_block_compiler.h"
#include "machine/cpu/native_value_emit.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/table.h"

namespace bmsx {

// R0: receiver; R1: physical slot in the compact table. Read results join in
// R2/R3 (word/tag) before committing the destination, including aliased GETT.
void NativeBlockCompiler::emitTableSlotTransfer(bool load, int value) {
	const auto fields = Table::nativeFieldOffsets();
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), fields.words);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R0), fields.tags);
	if (load) {
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM2(SLJIT_R2, SLJIT_R1), 2);
		sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R3, 0, SLJIT_MEM2(SLJIT_R3, SLJIT_R1), 0);
	} else {
		sljit_emit_op2(m_compiler, SLJIT_SHL, SLJIT_R0, 0, SLJIT_R1, 0, SLJIT_IMM, 2);
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_R0, 0);
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R1, 0);
		emitRawLoad(value, SLJIT_R0, SLJIT_R1);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), 0, SLJIT_R0, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R3), 0, SLJIT_R1, 0);
	}
}

void NativeBlockCompiler::emitArraySlot(bool load, int value, NativeBlockExitSite& exit) {
	const auto fields = Table::nativeFieldOffsets();
	fault(sljit_emit_cmp(m_compiler, SLJIT_GREATER_EQUAL, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), fields.arraySize), exit,
		  m_cache.state());
	if (load) {
		emitTableSlotTransfer(true, value);
		auto* own = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_IMM,
								   static_cast<u8>(ValueTag::Nil));
		fault(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_MEM1(SLJIT_R0), fields.metatable, SLJIT_IMM, 0), exit,
			  m_cache.state());
		sljit_set_label(own, sljit_emit_label(m_compiler));
		return;
	}

	emitGcWriteBarrier(m_compiler, SLJIT_R0, SLJIT_R2, SLJIT_R3);
	const int tag = knownTag(value);
	sljit_jump* nil = nullptr;
	if (tag < 0) {
		sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::tags), value);
		nil =
			sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, static_cast<u8>(ValueTag::Nil));
	}
	sljit_jump* retained = nullptr;
	sljit_jump* advanced = nullptr;
	if (tag != static_cast<int>(ValueTag::Nil)) {
		retained = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0),
								  fields.lengthHint);
		sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_MEM1(SLJIT_R0), fields.lengthHint, SLJIT_R1, 0, SLJIT_IMM, 1);
		if (nil)
			advanced = sljit_emit_jump(m_compiler, SLJIT_JUMP);
	}
	sljit_jump* unchanged = nullptr;
	if (tag < 0 || tag == static_cast<int>(ValueTag::Nil)) {
		if (nil)
			sljit_set_label(nil, sljit_emit_label(m_compiler));
		sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R2, 0, SLJIT_R1, 0, SLJIT_IMM, 1);
		unchanged = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0),
								   fields.lengthHint);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R0), fields.lengthHint, SLJIT_R1, 0);
	}
	auto* done = sljit_emit_label(m_compiler);
	for (auto* edge : {retained, advanced, unchanged})
		if (edge)
			sljit_set_label(edge, done);
	emitTableSlotTransfer(false, value);
}

// R3 retains the requested StringId until a miss transfers to the table owner.
// Hash keys start after the array; hash values start after all hash keys.
void NativeBlockCompiler::emitStringSlot(bool load, int value, NativeBlockExitSite& exit) {
	const auto fields = Table::nativeFieldOffsets();
	const sljit_sw prediction = reinterpret_cast<sljit_sw>(&exit.tableCacheSlot);
	std::array<sljit_jump*, 5> misses{};
	size_t n = 0;
	sljit_emit_op1(m_compiler, SLJIT_MOV_S32, SLJIT_R1, 0, SLJIT_MEM0(), prediction);
	misses[n++] = sljit_emit_cmp(m_compiler, SLJIT_GREATER_EQUAL, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), fields.hashSize);
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), fields.arraySize);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), fields.tags);
	sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R2, 0, SLJIT_MEM2(SLJIT_R2, SLJIT_R1), 0);
	misses[n++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM,
								 static_cast<u8>(ValueTag::String));
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), fields.words);
	misses[n++] =
		sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_MEM2(SLJIT_R2, SLJIT_R1), 2, SLJIT_R3, 0);
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), fields.hashSize);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), fields.tags);
	sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R2, 0, SLJIT_MEM2(SLJIT_R2, SLJIT_R1), 0);
	misses[n++] =
		sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, static_cast<u8>(ValueTag::Nil));
	if (!load) {
		// Deletion has to retain a dead key for next(), not just overwrite the tag.
		const int tag = knownTag(value);
		if (tag < 0) {
			sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::tags), value);
			misses[n++] = sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM,
										 static_cast<u8>(ValueTag::Nil));
		} else if (tag == static_cast<int>(ValueTag::Nil))
			misses[n++] = sljit_emit_jump(m_compiler, SLJIT_JUMP);
		emitGcWriteBarrier(m_compiler, SLJIT_R0, SLJIT_R2, SLJIT_R3);
		emitTableSlotTransfer(false, value);
	} else {
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_R2, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), fields.words);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM2(SLJIT_R2, SLJIT_R1), 2);
	}
	auto* hit = sljit_emit_jump(m_compiler, SLJIT_JUMP);
	auto* miss = sljit_emit_label(m_compiler);
	for (size_t i = 0; i < n; ++i)
		sljit_set_label(misses[i], miss);

	// Neither leaf allocates or invokes guest code. Keep the native frame;
	// only allocating growth or a chain fault requires a semantic exit.
	constexpr auto result = NativeBlockAbi::helperResultOffset;
	if (load) {
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_R3, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, m_bindings.indexKey);
		sljit_get_local_base(m_compiler, SLJIT_R3, 0, result);
		m_cache.spillCall(false, 0);
		sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS4V(P, 32, 32, P), SLJIT_IMM,
						 SLJIT_FUNC_ADDR(&Table::loadStringIndex));
		m_cache.spillCall(true, 0);
		fault(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_MEM1(SLJIT_SP),
							 result + offsetof(TableLookupResult, status), SLJIT_IMM,
							 static_cast<u32>(TableLookupStatus::Resolved)),
			  exit, m_cache.state());
		sljit_emit_op2(m_compiler, SLJIT_MUL32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP),
					   result + offsetof(TableLookupResult, extraVisits), SLJIT_IMM, TABLE_INDEX_VISIT_CYCLES);
		sljit_emit_op2(m_compiler, SLJIT_SUB32, NativeBlockAbi::budget, 0, NativeBlockAbi::budget, 0, SLJIT_R1, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM0(), prediction, SLJIT_MEM1(SLJIT_SP),
					   result + offsetof(TableLookupResult, slot));
		emitValueTransportLoad(m_compiler, SLJIT_SP, result + offsetof(TableLookupResult, value), SLJIT_R2, SLJIT_R3);
	} else {
		emitRawLoad(value, SLJIT_R1, SLJIT_R2);
		emitValueTransportStore(m_compiler, SLJIT_SP, result, SLJIT_R1, SLJIT_R2);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_R3, 0);
		sljit_get_local_base(m_compiler, SLJIT_R2, 0, result);
		m_cache.spillCall(false, 0);
		sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS3(32, P, 32, P), SLJIT_IMM,
						 SLJIT_FUNC_ADDR(&Table::storeStringKeyWithoutGrowth));
		m_cache.spillCall(true, 0);
		fault(sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, TABLE_STORE_REQUIRES_GROWTH),
			  exit, m_cache.state());
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM0(), prediction, SLJIT_R0, 0);
	}
	sljit_set_label(hit, sljit_emit_label(m_compiler));
}

void NativeBlockCompiler::emitTableAccess(const DecodedInstruction& instruction, NativeBlockExitSite& exit) {
	const auto op = static_cast<OpCode>(instruction.op);
	const bool load = op == OpCode::GETT || op == OpCode::GETI || op == OpCode::GETFIELD || op == OpCode::SELF;
	const int base = load ? instruction.b : instruction.a;
	const int key = load ? instruction.c : instruction.b;
	emitRawLoad(base, SLJIT_R0, SLJIT_R1);
	if (op == OpCode::SELF)
		emitRawStore(instruction.a + 1, SLJIT_R0, SLJIT_R1);
	fault(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM,
						 static_cast<u8>(ValueTag::Table)),
		  exit, m_cache.state());
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(NativeBlockAbi::state),
				   offsetof(NativeBlockRunState, heap));
	emitObjectReference(m_compiler, SLJIT_R0, SLJIT_R0, SLJIT_R1);
	if (op == OpCode::GETT || op == OpCode::SETT) {
		emitRawLoad(key, SLJIT_R3, SLJIT_R2);
		auto* string = sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM,
									  static_cast<u8>(ValueTag::String));
		fault(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM,
							 static_cast<u8>(ValueTag::Integer)),
			  exit, m_cache.state());
		sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R3, 0, SLJIT_IMM, 1);
		emitArraySlot(load, instruction.c, exit);
		auto* joined = sljit_emit_jump(m_compiler, SLJIT_JUMP);
		sljit_set_label(string, sljit_emit_label(m_compiler));
		emitStringSlot(load, instruction.c, exit);
		sljit_set_label(joined, sljit_emit_label(m_compiler));
	} else if (op == OpCode::GETI || op == OpCode::SETI) {
		sljit_emit_op1(m_compiler, SLJIT_MOV, SLJIT_R1, 0, SLJIT_IMM, key - 1);
		emitArraySlot(load, instruction.c, exit);
	} else {
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_IMM, m_constants.payload(key));
		emitStringSlot(load, instruction.c, exit);
	}
	if (load)
		emitRawStore(instruction.a, SLJIT_R2, SLJIT_R3);
}
} // namespace bmsx
