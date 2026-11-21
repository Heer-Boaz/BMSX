#include "machine/cpu/native_lowering.h"
#include "machine/cpu/gc_object.h"
#include "machine/cpu/native_value_emit.h"
#include "machine/cpu/table.h"
#include "spec/blua32/opcode.h"

namespace bmsx {

namespace {
struct TableScratch {
	u32 receiver, keyWord, wordOffset, tagOffset;
};
constexpr auto scratch = NativeBlockAbi::helperResultOffset;
constexpr auto receiver = scratch + offsetof(TableScratch, receiver);
constexpr auto keyWord = scratch + offsetof(TableScratch, keyWord);
constexpr auto wordOffset = scratch + offsetof(TableScratch, wordOffset);
constexpr auto tagOffset = scratch + offsetof(TableScratch, tagOffset);
static_assert(scratch + sizeof(TableScratch) <= NativeBlockAbi::stackBytes);
constexpr auto singleIndex = (scratch + sizeof(TableScratch) + alignof(TableSingleIndexProbe) - 1)
	& -static_cast<sljit_sw>(alignof(TableSingleIndexProbe));
static_assert(singleIndex + sizeof(TableSingleIndexProbe) <= NativeBlockAbi::stackBytes);
} // namespace

// R0 addresses the aligned table header; R1 is the slot. The stored backing
// address and capacities are guest words: mirror each derived access.
void NativeLowering::emitTableSlotOffset(sljit_s32 destination, bool word) {
	if (word) {
		sljit_emit_op2(m_compiler, SLJIT_SHL32, destination, 0, SLJIT_R1, 0, SLJIT_IMM, 2);
	} else {
		sljit_emit_op2(m_compiler, SLJIT_MUL32, destination, 0, SLJIT_MEM1(SLJIT_R0),
			static_cast<u32>(TableHeader::Hash), SLJIT_IMM, 3);
		sljit_emit_op2(m_compiler, SLJIT_ADD32, destination, 0, destination, 0, SLJIT_MEM1(SLJIT_R0),
			static_cast<u32>(TableHeader::Array));
		sljit_emit_op2(m_compiler, SLJIT_SHL32, destination, 0, destination, 0, SLJIT_IMM, 2);
		sljit_emit_op2(m_compiler, SLJIT_ADD32, destination, 0, destination, 0, SLJIT_R1, 0);
	}
	sljit_emit_op2(m_compiler, SLJIT_ADD32, destination, 0, destination, 0, SLJIT_MEM1(SLJIT_R0),
		static_cast<u32>(TableHeader::Storage));
	sljit_emit_op2(m_compiler, SLJIT_AND, destination, 0, destination, 0, SLJIT_IMM,
		word ? RAM_RECORD_WORD_MASK : MAIN_RAM_SIZE - 1u);
}

void NativeLowering::emitTableSlotLoad(sljit_s32 destination, bool word) {
	emitTableSlotOffset(destination, word);
	NativeBlockAbi::emitRamAddress(m_compiler, destination, destination);
	sljit_emit_op1(m_compiler, word ? SLJIT_MOV32 : SLJIT_MOV_U8, destination, 0, SLJIT_MEM1(destination), 0);
}

void NativeLowering::emitTableOverwrite(NativeBlockExitSite& exit, int value, NativeGcBarrier barrier) {
	auto* c = m_compiler;
	for (const auto address : {wordOffset, tagOffset})
		emitRamWordWriteWatch(exit, SLJIT_MEM1(SLJIT_SP), address, SLJIT_R2, SLJIT_R3);

	if (barrier != NativeGcBarrier::None) {
		// The header words discard low address bits, but the mark is a byte.
		sljit_emit_op2(c, SLJIT_AND32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_SP), receiver, SLJIT_IMM, sizeof(u32) - 1u);
		sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, GC_COLOR_OFFSET);
		emitGuardNoGcMutation(exit, SLJIT_MEM2(SLJIT_R0, SLJIT_R3), 0, value, barrier, SLJIT_R2, SLJIT_R3);
	}

	emitRawLoad(value, SLJIT_R2, SLJIT_R3);
	for (bool word : {true, false}) {
		sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), word ? wordOffset : tagOffset);
		NativeBlockAbi::emitRamAddress(c, SLJIT_R1, SLJIT_R1);
		sljit_emit_op1(c, word ? SLJIT_MOV32 : SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R1), 0,
			word ? SLJIT_R2 : SLJIT_R3, 0);
	}
}

void NativeLowering::emitArrayRead(NativeBlockExitSite& exit) {
	auto* c = m_compiler;
	fault(sljit_emit_cmp(c, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0,
		SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Array)), exit, m_cache.state());
	emitTableSlotLoad(SLJIT_R2, true);
	emitTableSlotLoad(SLJIT_R3, false);
	auto* own = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R3, 0,
		SLJIT_IMM, static_cast<u8>(ValueTag::Nil));
	fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32,
		SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Metatable), SLJIT_IMM, 0), exit, m_cache.state());
	sljit_set_label(own, sljit_emit_label(c));
}

void NativeLowering::emitArrayStore(int value, NativeStorePlan plan, NativeBlockExitSite& exit) {
	auto* c = m_compiler;
	fault(sljit_emit_cmp(c, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0,
		SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Array)), exit, m_cache.state());

	// The owner advances the hint at slot == hint for a present value, or
	// retreats it at slot + 1 == hint for nil. Neither effect belongs here.
	sljit_s32 boundary = SLJIT_R1;
	if (plan.nilValue != NativeNilValue::Present) {
		sljit_jump* present = nullptr;
		if (plan.nilValue == NativeNilValue::Dynamic) {
			emitTag(value, SLJIT_R2);
			sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_R1, 0);
			present = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0,
				SLJIT_IMM, static_cast<u8>(ValueTag::Nil));
		}
		sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_R1, 0, SLJIT_IMM, 1);
		if (present) sljit_set_label(present, sljit_emit_label(c));
		boundary = SLJIT_R3;
	}
	fault(sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, boundary, 0,
		SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Length)), exit, m_cache.state());

	// TableRecord observes the hint after writing both lanes. A physical
	// mirror can put either lane in that word even when the pre-write hint
	// did not select an update.
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), receiver,
		SLJIT_IMM, static_cast<u32>(TableHeader::Length));
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	for (bool word : {true, false}) {
		emitTableSlotOffset(SLJIT_R3, word);
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), word ? wordOffset : tagOffset, SLJIT_R3, 0);
		if (!word)
			sljit_emit_op2(c, SLJIT_AND32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
		fault(sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_R2, 0), exit, m_cache.state());
	}
	emitTableOverwrite(exit, value, plan.barrier);
}

// Hash keys start after the array; hash values start after all hash keys.
void NativeLowering::emitStringSlot(bool load, int value, NativeBlockExitSite& exit,
	std::optional<StringId> constantKey, std::optional<ValueTag> resultTag, NativeStorePlan plan) {
	auto* c = m_compiler;
	if (!load && plan.nilValue == NativeNilValue::Nil) {
		fault(sljit_emit_jump(c, SLJIT_JUMP), exit, m_cache.state());
		return;
	}

	if (!constantKey)
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), keyWord, SLJIT_R3, 0);
	const sljit_s32 keySource = constantKey ? SLJIT_IMM : SLJIT_MEM1(SLJIT_SP);
	const sljit_sw keyOperand = constantKey ? static_cast<sljit_sw>(*constantKey) : keyWord;
	const sljit_sw prediction = reinterpret_cast<sljit_sw>(load ? &exit.tableReadCache.receiverSlot : &exit.tableStore.slot);
	// A result-specialized field may be inside a fixed-cost segment. Only
	// the untyped reads already end at a checkpoint for variable work.
	const bool allowSingleIndex = load && !resultTag;
	std::array<sljit_jump*, 4> ownMisses;
	size_t misses = 0;
	const auto rejectOwn = [&](sljit_jump* jump) {
		if (allowSingleIndex) ownMisses[misses++] = jump;
		else fault(jump, exit, m_cache.state());
	};
	sljit_emit_op1(c, SLJIT_MOV_S32, SLJIT_R1, 0, SLJIT_MEM0(), prediction);
	rejectOwn(sljit_emit_cmp(c, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0,
		SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Hash)));
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0,
		SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Array));
	emitTableSlotOffset(SLJIT_R3, false);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R2, SLJIT_R3);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
	rejectOwn(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0,
		SLJIT_IMM, static_cast<u8>(ValueTag::String)));
	emitTableSlotOffset(SLJIT_R1, true);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R2, SLJIT_R1);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
	rejectOwn(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, keySource, keyOperand));

	// Advance to the value lane and mirror the two offsets independently.
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Hash));
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R2, 0);
	sljit_emit_op2(c, SLJIT_AND, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, MAIN_RAM_SIZE - 1u);
	sljit_emit_op2(c, SLJIT_SHL32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, 2);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_R2, 0);
	sljit_emit_op2(c, SLJIT_AND, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R2, SLJIT_R3);
	const sljit_s32 valueTagReg = load ? SLJIT_R3 : SLJIT_R2;
	sljit_emit_op1(c, SLJIT_MOV_U8, valueTagReg, 0, SLJIT_MEM1(SLJIT_R2), 0);
	rejectOwn(sljit_emit_cmp(c, (resultTag ? SLJIT_NOT_EQUAL : SLJIT_EQUAL) | SLJIT_32,
		valueTagReg, 0, SLJIT_IMM, static_cast<u8>(resultTag.value_or(ValueTag::Nil))));
	if (load) {
		NativeBlockAbi::emitRamAddress(c, SLJIT_R2, SLJIT_R1);
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
		if (allowSingleIndex)
			m_singleStringReads.push_back({ownMisses, constantKey, m_cache.state(), &exit, sljit_emit_label(c)});
		return;
	}

	// A predicted but absent entry or a nil source needs the hash mutation
	// owner, not a write to the payload and tag of the candidate slot.
	if (plan.nilValue == NativeNilValue::Dynamic) {
		emitTag(value, SLJIT_R2);
		fault(sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM,
			static_cast<u8>(ValueTag::Nil)), exit, m_cache.state());
	}
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), wordOffset, SLJIT_R1, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), tagOffset, SLJIT_R3, 0);
	emitTableOverwrite(exit, value, plan.barrier);
}

void NativeLowering::emitSingleStringReads() {
	auto* c = m_compiler;
	for (const auto& read : m_singleStringReads) {
		auto* entry = sljit_emit_label(c);
		for (auto* miss : read.ownMisses) sljit_set_label(miss, entry);
		m_cache.setState(read.registers);
		auto& slots = read.exit->tableReadCache;
		fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32,
			SLJIT_MEM0(), reinterpret_cast<sljit_sw>(&slots.holderDepth), SLJIT_IMM, 1), *read.exit, read.registers);
		// Each own-slot miss leaves R0 pointing at the aligned receiver
		// header. All Table header fields use the RAM word port.
		sljit_emit_op2(c, SLJIT_SUB, SLJIT_R0, 0, SLJIT_R0, 0,
			SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, ram));
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), singleIndex + offsetof(TableSingleIndexProbe, receiver),
			SLJIT_R0, 0);
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), singleIndex + offsetof(TableSingleIndexProbe, key),
			read.key ? SLJIT_IMM : SLJIT_MEM1(SLJIT_SP), read.key ? static_cast<sljit_sw>(*read.key) : keyWord);
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), singleIndex + offsetof(TableSingleIndexProbe, indexKey),
			SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, tableIndexKey));
		m_cache.spillCall(false, 0);
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, heap));
		sljit_get_local_base(c, SLJIT_R1, 0, singleIndex);
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(&slots));
		sljit_emit_icall(c, SLJIT_CALL, SLJIT_ARGS3(32, P, P, P), SLJIT_IMM, SLJIT_FUNC_ADDR(&TableRecord::trySingleStringIndex));
		m_cache.spillCall(true, 0);
		fault(sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0), *read.exit, read.registers);
		sljit_emit_op2(c, SLJIT_SUB32, NativeBlockAbi::budget, 0, NativeBlockAbi::budget, 0, SLJIT_IMM, TABLE_INDEX_VISIT_CYCLES);
		emitValueTransportLoad(c, SLJIT_SP, singleIndex + offsetof(TableSingleIndexProbe, result), SLJIT_R2, SLJIT_R3);
		sljit_set_label(sljit_emit_jump(c, SLJIT_JUMP), read.result);
	}
}

void NativeLowering::lowerOperation(const NativeTableAccess& access, const NativeInstruction& instruction) {
	auto* c = m_compiler;
	auto& exit = *instruction.slow;
	const bool load = access.mode != NativeTableMode::Write;
	const int base = access.receiver;
	const int key = access.key;
	const int value = access.value;
	if (access.mode == NativeTableMode::ReadMethod) {
		emitRawLoad(base, SLJIT_R0, SLJIT_R1);
		emitRawStore(value + 1, SLJIT_R0, SLJIT_R1);
		if (access.receiverCheck == NativeTagCheck::Dynamic)
			fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0,
				SLJIT_IMM, static_cast<u8>(ValueTag::Table)), exit, m_cache.state());
	} else if (access.receiverCheck != NativeTagCheck::Rejected) {
		if (access.receiverCheck == NativeTagCheck::Dynamic)
			fault(m_cache.guard(base, ValueTag::Table, SLJIT_R1), exit, m_cache.state());
		emitPayload(base, SLJIT_R0);
	}
	if (access.receiverCheck == NativeTagCheck::Rejected) {
		emitLeave(exit, Charge::Pending);
		return;
	}
	if (!load)
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), receiver, SLJIT_R0, 0);
	sljit_emit_op2(c, SLJIT_AND, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	fault(sljit_emit_cmp(c, SLJIT_GREATER, SLJIT_R0, 0, SLJIT_IMM,
		MAIN_RAM_SIZE - TableRecord::HEADER_BYTES), exit, m_cache.state());
	NativeBlockAbi::emitRamAddress(c, SLJIT_R0, SLJIT_R0);
	switch (access.keyKind) {
	case NativeTableKey::Value: {
		emitRawLoad(key, SLJIT_R3, SLJIT_R2);
		auto* string = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0,
			SLJIT_IMM, static_cast<u8>(ValueTag::String));
		fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM,
			static_cast<u8>(ValueTag::Integer)), exit, m_cache.state());
		fault(sljit_emit_cmp(c, SLJIT_SIG_LESS_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_IMM, 0), exit, m_cache.state());
		sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R3, 0, SLJIT_IMM, 1);
		if (load) emitArrayRead(exit);
		else emitArrayStore(value, access.store, exit);
		auto* joined = sljit_emit_jump(c, SLJIT_JUMP);
		sljit_set_label(string, sljit_emit_label(c));
		emitStringSlot(load, value, exit, std::nullopt, std::nullopt, access.store);
		sljit_set_label(joined, sljit_emit_label(c));
		break;
	}
	case NativeTableKey::Integer:
		sljit_emit_op1(c, SLJIT_MOV, SLJIT_R1, 0, SLJIT_IMM, key - 1);
		if (load) emitArrayRead(exit);
		else emitArrayStore(value, access.store, exit);
		break;
	case NativeTableKey::Field:
		emitStringSlot(load, value, exit, m_constants.payload(key), access.resultTag, access.store);
		if (access.resultTag) {
			const auto target = m_cache.write(value, *access.resultTag);
			if (target.tag == ValueTag::Float)
				sljit_emit_fcopy(c, SLJIT_COPY32_TO_F32, target.reg, SLJIT_R2);
			else
				sljit_emit_op1(c, SLJIT_MOV32, target.reg, 0, SLJIT_R2, 0);
			return;
		}
		break;
	}
	if (load)
		emitRawStore(value, SLJIT_R2, SLJIT_R3);
}
} // namespace bmsx
