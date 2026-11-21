#include "machine/cpu/jit/sljit/table_access.h"

#include "machine/cpu/table.h"

namespace bmsx {

void emitTableSlotOffset(sljit_compiler* c, sljit_s32 destination, bool word) {
	if (word) {
		sljit_emit_op2(c, SLJIT_SHL32, destination, 0, SLJIT_R1, 0, SLJIT_IMM, 2);
	} else {
		sljit_emit_op2(c, SLJIT_MUL32, destination, 0, SLJIT_MEM1(SLJIT_R0),
			static_cast<u32>(TableHeader::Hash), SLJIT_IMM, 3);
		sljit_emit_op2(c, SLJIT_ADD32, destination, 0, destination, 0, SLJIT_MEM1(SLJIT_R0),
			static_cast<u32>(TableHeader::Array));
		sljit_emit_op2(c, SLJIT_SHL32, destination, 0, destination, 0, SLJIT_IMM, 2);
		sljit_emit_op2(c, SLJIT_ADD32, destination, 0, destination, 0, SLJIT_R1, 0);
	}
	sljit_emit_op2(c, SLJIT_ADD32, destination, 0, destination, 0, SLJIT_MEM1(SLJIT_R0),
		static_cast<u32>(TableHeader::Storage));
	sljit_emit_op2(c, SLJIT_AND, destination, 0, destination, 0, SLJIT_IMM,
		word ? RAM_RECORD_WORD_MASK : MAIN_RAM_SIZE - 1u);
}

void emitHashValueOffsets(sljit_compiler* c) {
	// Advance to the value lane and mirror the two offsets independently.
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Hash));
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R2, 0);
	sljit_emit_op2(c, SLJIT_AND, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, MAIN_RAM_SIZE - 1u);
	sljit_emit_op2(c, SLJIT_SHL32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, 2);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_R2, 0);
	sljit_emit_op2(c, SLJIT_AND, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
}

namespace {

constexpr sljit_sw array = static_cast<u32>(TableHeader::Array);
constexpr sljit_sw hash = static_cast<u32>(TableHeader::Hash);
constexpr sljit_sw meta = static_cast<u32>(TableHeader::Metatable);
constexpr sljit_sw stringTag = static_cast<u8>(ValueTag::String);
constexpr sljit_sw nilTag = static_cast<u8>(ValueTag::Nil);

void readTableSlot(sljit_compiler* c, sljit_s32 result, bool word) {
	emitTableSlotOffset(c, SLJIT_R2, word);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R2, SLJIT_R2);
	sljit_emit_op1(c, word ? SLJIT_MOV32 : SLJIT_MOV_U8, result, 0, SLJIT_MEM1(SLJIT_R2), 0);
}

// An own prediction miss is not an absence proof. Follow the live chain,
// with the same signed cursor and visit bound as HashBody::findString.
sljit_jump* emitReceiverAbsence(sljit_compiler* c) {
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R0), hash);
	auto* empty = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_IMM, 0);
	sljit_emit_op2(c, SLJIT_MUL32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), NativeTableScratch::keyWord,
		SLJIT_IMM, STRING_VALUE_HASH_MULTIPLIER);
	sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R2, 0, SLJIT_R3, 0, SLJIT_IMM, 1);
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_R2, 0);
	// The owner's signed chain cursor does not enter a negative home.
	auto* negativeHome = sljit_emit_cmp(c, SLJIT_SIG_LESS | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0);
	auto* node = sljit_emit_label(c);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), array);
	readTableSlot(c, SLJIT_R2, false);
	auto* otherTag = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, stringTag);
	readTableSlot(c, SLJIT_R2, true);
	auto* otherKey = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0,
		SLJIT_MEM1(SLJIT_SP), NativeTableScratch::keyWord);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), hash);
	readTableSlot(c, SLJIT_R2, false);
	auto* shadowed = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, nilTag);
	auto* nilMatch = sljit_emit_jump(c, SLJIT_JUMP);

	auto* different = sljit_emit_label(c);
	sljit_set_label(otherTag, different);
	sljit_set_label(otherKey, different);
	sljit_emit_op2(c, SLJIT_SUB32 | SLJIT_SET_Z, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, 1);
	auto* last = sljit_emit_jump(c, SLJIT_EQUAL);
	sljit_emit_op2(c, SLJIT_SHL32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), hash, SLJIT_IMM, 1);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_R2, 0);
	readTableSlot(c, SLJIT_R1, true);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_SIG_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0), node);

	auto* absent = sljit_emit_label(c);
	for (auto* edge : {empty, negativeHome, nilMatch, last}) sljit_set_label(edge, absent);
	return shadowed;
}

// R0 is the address of an owned table descriptor. Probe the hinted slot
// against the live key and value, not a pinned table.
std::array<sljit_jump*, 5> emitPredictedString(sljit_compiler* c, sljit_sw slot,
	sljit_s32 keyBase, sljit_sw keyOffset, ValueTag tag) {
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R0, SLJIT_R0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), NativeTableScratch::path);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R1), slot);
	auto* untrained = sljit_emit_cmp(c, SLJIT_SIG_LESS | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0);
	auto* outside = sljit_emit_cmp(c, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), hash);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), array);
	emitTableSlotOffset(c, SLJIT_R3, false);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R2, SLJIT_R3);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
	auto* otherTag = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, stringTag);
	emitTableSlotOffset(c, SLJIT_R1, true);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R2, SLJIT_R1);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
	auto* otherKey = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_MEM1(keyBase), keyOffset);
	emitHashValueOffsets(c);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R2, SLJIT_R3);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R2), 0);
	auto* otherValue = sljit_emit_cmp(c, (tag == ValueTag::Nil ? SLJIT_EQUAL : SLJIT_NOT_EQUAL) | SLJIT_32,
		SLJIT_R3, 0, SLJIT_IMM, static_cast<u8>(tag));
	NativeBlockAbi::emitRamAddress(c, SLJIT_R2, SLJIT_R1);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
	return {untrained, outside, otherTag, otherKey, otherValue};
}

} // namespace

sljit_label* emitOneHopStringRead(sljit_compiler* c) {
	auto* entry = sljit_emit_label(c);
	sljit_emit_op_dst(c, SLJIT_FAST_ENTER, SLJIT_MEM1(SLJIT_SP), NativeTableScratch::returnAddress);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), NativeTableScratch::path, SLJIT_R1, 0);
	auto* shadowed = emitReceiverAbsence(c);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), meta);
	auto* noMeta = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0);
	const auto indexMisses = emitPredictedString(c, offsetof(TableStringPathCache, indexSlots),
		NativeBlockAbi::state, offsetof(NativeBlockRunState, tableIndexKey), ValueTag::Table);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_R2, 0);
	const auto holderMisses = emitPredictedString(c, offsetof(TableStringPathCache, holderSlot),
		SLJIT_SP, NativeTableScratch::keyWord, ValueTag::Nil);
	sljit_emit_op_src(c, SLJIT_FAST_RETURN, SLJIT_MEM1(SLJIT_SP), NativeTableScratch::returnAddress);

	auto* decline = sljit_emit_label(c);
	sljit_set_label(noMeta, decline);
	sljit_set_label(shadowed, decline);
	for (auto* edge : indexMisses) sljit_set_label(edge, decline);
	for (auto* edge : holderMisses) sljit_set_label(edge, decline);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_IMM, nilTag);
	sljit_emit_op_src(c, SLJIT_FAST_RETURN, SLJIT_MEM1(SLJIT_SP), NativeTableScratch::returnAddress);
	return entry;
}

} // namespace bmsx
