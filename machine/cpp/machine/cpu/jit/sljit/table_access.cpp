#include "machine/cpu/jit/sljit/table_access.h"

#include "machine/cpu/table.h"
#include "spec/blua32/opcode.h"

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
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP),
		word ? NativeTableScratch::words : NativeTableScratch::tags);
	sljit_emit_op1(c, word ? SLJIT_MOV32 : SLJIT_MOV_U8, result, 0, SLJIT_MEM2(SLJIT_R2, SLJIT_R1), word ? 2 : 0);
}

// An own prediction miss is not an absence proof. Follow the live chain,
// with the signed cursor and visit bound of TableRecord::HashBody.
sljit_jump* emitReceiverSearch(sljit_compiler* c, bool stringKey) {
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R0), hash);
	auto* empty = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_IMM, 0);
	// The chain cannot allocate or re-enter the VM. Bind its two linear
	// planes once, as for ITERN; no guest cache register is reserved.
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0),
		static_cast<u32>(TableHeader::Storage), SLJIT_IMM, RAM_RECORD_WORD_MASK);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R1, SLJIT_R1);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), NativeTableScratch::words, SLJIT_R1, 0);
	sljit_emit_op2(c, SLJIT_MUL32, SLJIT_R2, 0, SLJIT_R3, 0, SLJIT_IMM, 3);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), array);
	sljit_emit_op2(c, SLJIT_SHL, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, 2);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_MEM1(SLJIT_SP), NativeTableScratch::tags, SLJIT_R1, 0, SLJIT_R2, 0);
	if (stringKey) {
		sljit_emit_op2(c, SLJIT_LSHR32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), NativeTableScratch::keyWord,
			SLJIT_IMM, BLUA32_STRING_RECORD_ALIGNMENT_SHIFT);
	} else {
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), NativeTableScratch::keyWord);
		sljit_emit_op2(c, SLJIT_ROTL32, SLJIT_R1, 0, SLJIT_R2, 0, SLJIT_IMM, TABLE_HASH_ROTATE);
		sljit_emit_op2(c, SLJIT_XOR32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_R2, 0);
		sljit_emit_op2(c, SLJIT_MUL32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, TABLE_HASH_MULTIPLIER);
		sljit_emit_op2(c, SLJIT_LSHR32, SLJIT_R2, 0, SLJIT_R1, 0, SLJIT_IMM, TABLE_HASH_SHIFT);
		sljit_emit_op2(c, SLJIT_XOR32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_R2, 0);
	}
	sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R2, 0, SLJIT_R3, 0, SLJIT_IMM, 1);
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_R2, 0);
	// The owner's signed chain cursor does not enter a negative home.
	auto* negativeHome = sljit_emit_cmp(c, SLJIT_SIG_LESS | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0);
	auto* node = sljit_emit_label(c);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), array);
	readTableSlot(c, SLJIT_R2, false);
	auto* otherTag = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0,
		stringKey ? SLJIT_IMM : SLJIT_MEM1(SLJIT_SP), stringKey ? stringTag : NativeTableScratch::keyTag);
	readTableSlot(c, SLJIT_R2, true);
	auto* otherKey = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0,
		SLJIT_MEM1(SLJIT_SP), NativeTableScratch::keyWord);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), hash);
	readTableSlot(c, SLJIT_R2, false);
	auto* found = stringKey ? sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, nilTag)
		: sljit_emit_jump(c, SLJIT_JUMP);
	auto* nilMatch = stringKey ? sljit_emit_jump(c, SLJIT_JUMP) : nullptr;

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
	for (auto* edge : {empty, negativeHome, last}) sljit_set_label(edge, absent);
	if (nilMatch) sljit_set_label(nilMatch, absent);
	return found;
}

void emitTableHeaderAddress(sljit_compiler* c) {
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R0, SLJIT_R0);
}

} // namespace

sljit_label* emitStringReadProbe(sljit_compiler* c) {
	constexpr auto field = NativeTableScratch::fieldKey;
	constexpr auto cost = NativeTableScratch::visitCost;
	constexpr auto key = NativeTableScratch::keyWord;
	auto* entry = sljit_emit_label(c);
	sljit_emit_op_dst(c, SLJIT_FAST_ENTER, SLJIT_MEM1(SLJIT_SP), NativeTableScratch::returnAddress);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), field, SLJIT_MEM1(SLJIT_SP), key);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), cost, SLJIT_IMM, 0);
	auto* receiver = sljit_emit_label(c);
	auto* found = emitReceiverSearch(c, true);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), meta);
	auto* noMeta = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0);
	emitTableHeaderAddress(c);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), key,
		SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, tableIndexKey));
	auto* hasIndex = emitReceiverSearch(c, true);

	// End of the live path: nil is a successful guest result.
	sljit_set_label(noMeta, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_IMM, nilTag);
	auto* noOwnSlot = sljit_emit_jump(c, SLJIT_JUMP);

	sljit_set_label(hasIndex, sljit_emit_label(c));
	auto* semantic = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, static_cast<u8>(ValueTag::Table));
	readTableSlot(c, SLJIT_R0, true);
	emitTableHeaderAddress(c);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), key, SLJIT_MEM1(SLJIT_SP), field);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), cost, SLJIT_IMM, TABLE_INDEX_VISIT_CYCLES);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), cost, SLJIT_R1, 0);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_LESS | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM,
		TABLE_INDEX_CHAIN_LIMIT * TABLE_INDEX_VISIT_CYCLES), receiver);
	// Let the semantic owner handle calls, forwarding and loop faults.
	// No visit charge or guest result has been published on this path.
	sljit_set_label(semantic, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_IMM, -1);
	sljit_emit_op_src(c, SLJIT_FAST_RETURN, SLJIT_MEM1(SLJIT_SP), NativeTableScratch::returnAddress);

	sljit_set_label(found, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_R2, 0);
	readTableSlot(c, SLJIT_R2, true);
	sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), hash);
	sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), array);
	auto* own = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_MEM1(SLJIT_SP), cost, SLJIT_IMM, 0);
	sljit_set_label(noOwnSlot, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, -1);
	sljit_set_label(own, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), cost);
	sljit_emit_op_src(c, SLJIT_FAST_RETURN, SLJIT_MEM1(SLJIT_SP), NativeTableScratch::returnAddress);
	return entry;
}

sljit_label* emitOwnStringSlotProbe(sljit_compiler* c) {
	auto* entry = sljit_emit_label(c);
	sljit_emit_op_dst(c, SLJIT_FAST_ENTER, SLJIT_MEM1(SLJIT_SP), NativeTableScratch::returnAddress);
	auto* found = emitReceiverSearch(c, true);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, -1);
	sljit_emit_op_src(c, SLJIT_FAST_RETURN, SLJIT_MEM1(SLJIT_SP), NativeTableScratch::returnAddress);
	sljit_set_label(found, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_R2, 0);
	readTableSlot(c, SLJIT_R2, true);
	sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), hash);
	sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), array);
	sljit_emit_op_src(c, SLJIT_FAST_RETURN, SLJIT_MEM1(SLJIT_SP), NativeTableScratch::returnAddress);
	return entry;
}

sljit_label* emitIndexReadProbe(sljit_compiler* c) {
	auto* entry = sljit_emit_label(c);
	sljit_emit_op_dst(c, SLJIT_FAST_ENTER, SLJIT_MEM1(SLJIT_SP), NativeTableScratch::returnAddress);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), NativeTableScratch::keyWord, SLJIT_R3, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), NativeTableScratch::keyTag, SLJIT_R2, 0);
	auto* found = emitReceiverSearch(c, false);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_IMM, nilTag);
	sljit_emit_op_src(c, SLJIT_FAST_RETURN, SLJIT_MEM1(SLJIT_SP), NativeTableScratch::returnAddress);
	sljit_set_label(found, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_R2, 0);
	readTableSlot(c, SLJIT_R2, true);
	sljit_emit_op_src(c, SLJIT_FAST_RETURN, SLJIT_MEM1(SLJIT_SP), NativeTableScratch::returnAddress);
	return entry;
}

sljit_label* emitTableLengthProbe(sljit_compiler* c) {
	auto* entry = sljit_emit_label(c);
	constexpr auto ret = NativeTableScratch::returnAddress;
	sljit_emit_op_dst(c, SLJIT_FAST_ENTER, SLJIT_MEM1(SLJIT_SP), ret);
	emitTableHeaderAddress(c);
	auto* metatable = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_MEM1(SLJIT_R0), meta, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Length));
	auto* outside = sljit_emit_cmp(c, SLJIT_GREATER | SLJIT_32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), array);

	// Bind the tag at array[hint]. Neither a cached length nor an empty
	// array proves a boundary by itself: integer keys can live in the hash.
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R0),
		static_cast<u32>(TableHeader::Storage), SLJIT_IMM, RAM_RECORD_WORD_MASK);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R3, SLJIT_R3);
	sljit_emit_op2(c, SLJIT_MUL32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), hash, SLJIT_IMM, 3);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), array);
	sljit_emit_op2(c, SLJIT_SHL32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, 2);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R2, 0);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R1, 0);
	auto* zero = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), -1);
	auto* hole = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, nilTag);
	sljit_set_label(zero, sljit_emit_label(c));
	auto* inside = sljit_emit_cmp(c, SLJIT_LESS | SLJIT_32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), array);
	auto* hashTail = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_MEM1(SLJIT_R0), hash, SLJIT_IMM, 0);
	auto* end = sljit_emit_jump(c, SLJIT_JUMP);
	sljit_set_label(inside, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), 0);
	auto* extends = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, nilTag);
	sljit_set_label(end, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_R1, 0);
	sljit_emit_op_src(c, SLJIT_FAST_RETURN, SLJIT_MEM1(SLJIT_SP), ret);
	auto* search = sljit_emit_label(c);
	for (auto* miss : {metatable, outside, hole, hashTail, extends}) sljit_set_label(miss, search);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_IMM, -1);
	sljit_emit_op_src(c, SLJIT_FAST_RETURN, SLJIT_MEM1(SLJIT_SP), ret);
	return entry;
}

sljit_label* emitTableIteratorScan(sljit_compiler* c) {
	using Scratch = NativeTableIteratorScratch;
	auto* entry = sljit_emit_label(c);
	sljit_emit_op_dst(c, SLJIT_FAST_ENTER, SLJIT_MEM1(SLJIT_SP), Scratch::returnAddress);
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R0, SLJIT_R0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), array);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R0), hash);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Storage));
	if constexpr (std::endian::native == std::endian::big) {
		for (const auto reg : {SLJIT_R0, SLJIT_R2, SLJIT_R3})
			sljit_emit_op1(c, SLJIT_REV32, reg, 0, reg, 0);
	}
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), Scratch::arrayEnd, SLJIT_R2, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), Scratch::hashCount, SLJIT_R3, 0);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_R3, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), Scratch::hashEnd, SLJIT_R2, 0);
	sljit_emit_op2(c, SLJIT_SHL32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, 1);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_R3, 0);
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R0, SLJIT_R0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), Scratch::words, SLJIT_R0, 0);
	sljit_emit_op2(c, SLJIT_SHL, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, 2);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_R2, 0);

	// R0 is the tag lane, R1 is the logical position. As in LuaJIT ARM
	// BC_ITERN, scan array holes before hash nodes and retain that position
	// as the next cursor. The split planes let holes skip payload loads.
	auto* arrayLoop = sljit_emit_label(c);
	auto* arrayDone = sljit_emit_cmp(c, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0,
		SLJIT_MEM1(SLJIT_SP), Scratch::arrayEnd);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R3, 0, SLJIT_MEM2(SLJIT_R0, SLJIT_R1), 0);
	auto* arrayHit = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_IMM, nilTag);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 1);
	sljit_set_label(sljit_emit_jump(c, SLJIT_JUMP), arrayLoop);

	sljit_set_label(arrayHit, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), Scratch::words);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R2, 0, SLJIT_R1, 0, SLJIT_IMM, 1);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), Scratch::cursor, SLJIT_R2, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM2(SLJIT_R0, SLJIT_R1), 2);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_R3, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_R0, 0);
	if constexpr (std::endian::native == std::endian::big)
		sljit_emit_op1(c, SLJIT_REV32, SLJIT_R3, 0, SLJIT_R3, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_IMM, static_cast<u8>(ValueTag::Integer));
	sljit_emit_op_src(c, SLJIT_FAST_RETURN, SLJIT_MEM1(SLJIT_SP), Scratch::returnAddress);

	auto* hashLoop = sljit_emit_label(c);
	sljit_set_label(arrayDone, hashLoop);
	auto* exhausted = sljit_emit_cmp(c, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0,
		SLJIT_MEM1(SLJIT_SP), Scratch::hashEnd);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R2, 0, SLJIT_MEM2(SLJIT_R0, SLJIT_R1), 0);
	auto* missingKey = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, nilTag);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), Scratch::hashCount);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R2, 0, SLJIT_MEM2(SLJIT_R0, SLJIT_R3), 0);
	auto* hashHit = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, nilTag);
	sljit_set_label(missingKey, sljit_emit_label(c));
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 1);
	sljit_set_label(sljit_emit_jump(c, SLJIT_JUMP), hashLoop);

	sljit_set_label(hashHit, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), Scratch::valueTag, SLJIT_R2, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), Scratch::words);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_MEM2(SLJIT_R2, SLJIT_R3), 2);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R0, 0, SLJIT_MEM2(SLJIT_R0, SLJIT_R1), 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM2(SLJIT_R2, SLJIT_R1), 2);
	if constexpr (std::endian::native == std::endian::big) {
		sljit_emit_op1(c, SLJIT_REV32, SLJIT_R2, 0, SLJIT_R2, 0);
		sljit_emit_op1(c, SLJIT_REV32, SLJIT_R3, 0, SLJIT_R3, 0);
	}
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 1);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), Scratch::cursor, SLJIT_R1, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), Scratch::valueTag);
	sljit_emit_op_src(c, SLJIT_FAST_RETURN, SLJIT_MEM1(SLJIT_SP), Scratch::returnAddress);

	sljit_set_label(exhausted, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), Scratch::cursor, SLJIT_IMM, 0);
	for (const auto reg : {SLJIT_R0, SLJIT_R1, SLJIT_R2, SLJIT_R3})
		sljit_emit_op1(c, SLJIT_MOV32, reg, 0, SLJIT_IMM, 0);
	sljit_emit_op_src(c, SLJIT_FAST_RETURN, SLJIT_MEM1(SLJIT_SP), Scratch::returnAddress);
	return entry;
}

} // namespace bmsx
