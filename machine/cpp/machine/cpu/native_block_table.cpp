#include "machine/cpu/native_lowering.h"
#include "machine/cpu/native_value_emit.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/gc_object.h"
#include "machine/cpu/table.h"

namespace bmsx {

namespace {
struct TableScratch {
	TableReadRequest request;
	u32 slot, wordOffset, tagOffset;
	Value transport;
	TableLookupResult result;
};
constexpr auto scratch = NativeBlockAbi::helperResultOffset;
constexpr auto request = scratch + offsetof(TableScratch, request);
constexpr auto receiver = request + offsetof(TableReadRequest, address);
constexpr auto keyWord = request + offsetof(TableReadRequest, keyWord);
constexpr auto keyTag = request + offsetof(TableReadRequest, keyTag);
constexpr auto slot = scratch + offsetof(TableScratch, slot);
constexpr auto wordOffset = scratch + offsetof(TableScratch, wordOffset);
constexpr auto tagOffset = scratch + offsetof(TableScratch, tagOffset);
constexpr auto result = scratch + offsetof(TableScratch, result);
constexpr auto transport = scratch + offsetof(TableScratch, transport);
static_assert(scratch + sizeof(TableScratch) <= NativeBlockAbi::stackBytes);

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

void NativeLowering::emitTableWriteWatch(NativeBlockExitSite& exit, bool arraySlot, int value, NativeGcBarrier barrier) {
	if (arraySlot) {
		for (bool word : {true, false}) {
			const auto address = word ? wordOffset : tagOffset;
			emitTableSlotOffset(SLJIT_R2, word);
			sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), address, SLJIT_R2, 0);
			emitRamWordWriteWatch(exit, SLJIT_MEM1(SLJIT_SP), address, SLJIT_R2, SLJIT_R3);
		}
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), slot, SLJIT_R1, 0);
		sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), receiver,
			SLJIT_IMM, static_cast<u32>(TableHeader::Length));
		sljit_emit_op2(m_compiler, SLJIT_AND32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
		emitRamWordWriteWatch(exit, SLJIT_R1, 0, SLJIT_R2, SLJIT_R3);
	} else {
		// The string probe left the mirrored payload offset live in R1.
		emitRamWordWriteWatch(exit, SLJIT_R1, 0, SLJIT_R2, SLJIT_R3);
		emitRamWordWriteWatch(exit, SLJIT_MEM1(SLJIT_SP), tagOffset, SLJIT_R2, SLJIT_R3);
	}

	if (barrier == NativeGcBarrier::None) return;
	const auto scalar = barrier == NativeGcBarrier::Dynamic ? emitSkipScalarBarrier(value, SLJIT_R2) : std::array<sljit_jump*, 2>{};
	// All potential exits precede the actual slot store. A backward barrier
	// only enqueues work, so it may publish before the value reaches its lane.
	auto* c = m_compiler;
	// The header words discard the low address bits, but the mark is a byte.
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), receiver, SLJIT_IMM, sizeof(u32) - 1u);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, GC_COLOR_OFFSET);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R2, 0, SLJIT_MEM2(SLJIT_R0, SLJIT_R2), 0);
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R3, 0, SLJIT_R2, 0, SLJIT_IMM, GC_OLD | GC_REMEMBERED);
	fault(sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_IMM, GC_OLD), exit, m_cache.state());
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, GC_COLOR_MASK);
	auto* notBlack = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 3);
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), receiver,
		SLJIT_IMM, MAIN_RAM_SIZE - 1u);
	emitGrayChange(exit, SLJIT_R2, SLJIT_R0, GC_RECORD_LINK);
	auto* ready = sljit_emit_label(c);
	sljit_set_label(notBlack, ready);
	for (auto* skip : scalar) if (skip) sljit_set_label(skip, ready);
}

void NativeLowering::emitTableSlotStore(int value) {
	emitRawLoad(value, SLJIT_R2, SLJIT_R3);
	for (bool word : {true, false}) {
		sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), word ? wordOffset : tagOffset);
		NativeBlockAbi::emitRamAddress(m_compiler, SLJIT_R1, SLJIT_R1);
		sljit_emit_op1(m_compiler, word ? SLJIT_MOV32 : SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R1), 0,
			word ? SLJIT_R2 : SLJIT_R3, 0);
	}
}

std::array<sljit_jump*, 2> NativeLowering::emitArrayRead() {
	auto* outside = sljit_emit_cmp(m_compiler, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0,
		SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Array));
	emitTableSlotLoad(SLJIT_R2, true);
	emitTableSlotLoad(SLJIT_R3, false);
	auto* own = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R3, 0,
		SLJIT_IMM, static_cast<u8>(ValueTag::Nil));
	auto* inherited = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32,
		SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Metatable), SLJIT_IMM, 0);
	sljit_set_label(own, sljit_emit_label(m_compiler));
	return {outside, inherited};
}

void NativeLowering::emitArrayStore(int value, NativeStorePlan plan, NativeBlockExitSite& exit) {
	fault(sljit_emit_cmp(m_compiler, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0,
		SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Array)), exit, m_cache.state());
	emitTableWriteWatch(exit, true, value, plan.barrier);
	emitTableSlotStore(value);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), slot);
	sljit_jump* nil = nullptr;
	if (plan.nilValue == NativeNilValue::Dynamic) {
		nil =
			sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_IMM, static_cast<u8>(ValueTag::Nil));
	}
	sljit_jump* retained = nullptr;
	sljit_jump* advanced = nullptr;
	if (plan.nilValue != NativeNilValue::Nil) {
		retained = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0),
								  static_cast<u32>(TableHeader::Length));
		sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Length), SLJIT_R1, 0, SLJIT_IMM, 1);
		if (nil)
			advanced = sljit_emit_jump(m_compiler, SLJIT_JUMP);
	}
	sljit_jump* unchanged = nullptr;
	if (plan.nilValue != NativeNilValue::Present) {
		if (nil)
			sljit_set_label(nil, sljit_emit_label(m_compiler));
		sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R2, 0, SLJIT_R1, 0, SLJIT_IMM, 1);
		unchanged = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0),
								   static_cast<u32>(TableHeader::Length));
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Length), SLJIT_R1, 0);
	}
	auto* done = sljit_emit_label(m_compiler);
	for (auto* edge : {retained, advanced, unchanged})
		if (edge)
			sljit_set_label(edge, done);

}

void NativeLowering::emitTableReadLeaf(bool fixedStringKey, NativeBlockExitSite& exit) {
	auto* c = m_compiler;
	// The leaf only reads RAM. Charge additional visits after success; the
	// dispatcher owns faults and charges their full semantic work there.
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, heap));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), request + offsetof(TableReadRequest, indexKey),
		SLJIT_IMM, m_bindings.indexKey);
	sljit_get_local_base(c, SLJIT_R1, 0, request);
	sljit_get_local_base(c, SLJIT_R2, 0, result);
	m_cache.spillCall(false, 0);
	const auto lookup = fixedStringKey ? &TableRecord::loadStringIndexInNative : &TableRecord::loadIndexInNative;
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(&exit.tableReadCache));
	sljit_emit_icall(c, SLJIT_CALL, SLJIT_ARGS4V(P, P, P, P), SLJIT_IMM, SLJIT_FUNC_ADDR(lookup));
	m_cache.spillCall(true, 0);
	fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_MEM1(SLJIT_SP),
		result + offsetof(TableLookupResult, status), SLJIT_IMM, static_cast<u32>(TableLookupStatus::Resolved)),
		exit, m_cache.state());
	sljit_emit_op2(c, SLJIT_MUL32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP),
		result + offsetof(TableLookupResult, extraVisits), SLJIT_IMM, TABLE_INDEX_VISIT_CYCLES);
	sljit_emit_op2(c, SLJIT_SUB32, NativeBlockAbi::budget, 0, NativeBlockAbi::budget, 0, SLJIT_R1, 0);
	emitValueTransportLoad(c, SLJIT_SP, result + offsetof(TableLookupResult, value), SLJIT_R2, SLJIT_R3);
}

void NativeLowering::emitIndexRead(int key, NativeBlockExitSite& exit) {
	auto* c = m_compiler;
	emitRawLoad(key, SLJIT_R3, SLJIT_R2);
	auto* string = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0,
		SLJIT_IMM, static_cast<u8>(ValueTag::String));
	auto* other = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0,
		SLJIT_IMM, static_cast<u8>(ValueTag::Integer));
	sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R3, 0, SLJIT_IMM, 1);
	const auto misses = emitArrayRead();
	auto* arrayHit = sljit_emit_jump(c, SLJIT_JUMP);
	auto* arrayMiss = sljit_emit_label(c);
	for (auto* miss : misses) sljit_set_label(miss, arrayMiss);
	// The array probe may have overwritten both key registers.
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_R1, 0, SLJIT_IMM, 1);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_IMM, static_cast<u8>(ValueTag::Integer));
	sljit_set_label(other, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), keyWord, SLJIT_R3, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), keyTag, SLJIT_R2, 0);
	auto* genericMiss = sljit_emit_jump(c, SLJIT_JUMP);
	sljit_set_label(string, sljit_emit_label(c));
	auto* stringHit = emitStringSlot(true, key, exit);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), keyTag, SLJIT_IMM, static_cast<u8>(ValueTag::String));
	sljit_set_label(genericMiss, sljit_emit_label(c));
	emitTableReadLeaf(false, exit);
	auto* done = sljit_emit_label(c);
	sljit_set_label(arrayHit, done);
	sljit_set_label(stringHit, done);
}

// Hash keys start after the array; hash values start after all hash keys.
sljit_jump* NativeLowering::emitStringSlot(bool load, int value, NativeBlockExitSite& exit,
	std::optional<StringId> constantKey, std::optional<ValueTag> resultTag, NativeStorePlan plan) {
	if (!constantKey)
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), keyWord, SLJIT_R3, 0);
	const sljit_s32 keySource = constantKey ? SLJIT_IMM : SLJIT_MEM1(SLJIT_SP);
	const sljit_sw keyOperand = constantKey ? static_cast<sljit_sw>(*constantKey) : keyWord;
	const sljit_sw prediction = reinterpret_cast<sljit_sw>(load ? &exit.tableReadCache.receiverSlot : &exit.tableStoreSlot);
	std::array<sljit_jump*, 5> misses{};
	size_t n = 0;
	sljit_emit_op1(m_compiler, SLJIT_MOV_S32, SLJIT_R1, 0, SLJIT_MEM0(), prediction);
	misses[n++] = sljit_emit_cmp(m_compiler, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Hash));
	sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Array));
	emitTableSlotOffset(SLJIT_R3, false);
	NativeBlockAbi::emitRamAddress(m_compiler, SLJIT_R2, SLJIT_R3);
	sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
	misses[n++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM,
								 static_cast<u8>(ValueTag::String));
	emitTableSlotOffset(SLJIT_R1, true);
	NativeBlockAbi::emitRamAddress(m_compiler, SLJIT_R2, SLJIT_R1);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
	misses[n++] =
		sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, keySource, keyOperand);
	// Keep the key's two physical offsets. The value is one hash plane
	// later, in bytes for the tag and words for the payload. Each can wrap.
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Hash));
	sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R2, 0);
	sljit_emit_op2(m_compiler, SLJIT_AND, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, MAIN_RAM_SIZE - 1u);
	sljit_emit_op2(m_compiler, SLJIT_SHL32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, 2);
	sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_R2, 0);
	sljit_emit_op2(m_compiler, SLJIT_AND, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	NativeBlockAbi::emitRamAddress(m_compiler, SLJIT_R2, SLJIT_R3);
	const sljit_s32 valueTagReg = load ? SLJIT_R3 : SLJIT_R2;
	sljit_emit_op1(m_compiler, SLJIT_MOV_U8, valueTagReg, 0, SLJIT_MEM1(SLJIT_R2), 0);
	misses[n++] = sljit_emit_cmp(m_compiler, (resultTag ? SLJIT_NOT_EQUAL : SLJIT_EQUAL) | SLJIT_32,
		valueTagReg, 0, SLJIT_IMM, static_cast<u8>(resultTag.value_or(ValueTag::Nil)));
	if (!load) {
		// Deletion has to retain a dead key for next(), not just overwrite the tag.
		if (plan.nilValue == NativeNilValue::Dynamic) {
			emitTag(value, SLJIT_R2);
			misses[n++] = sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM,
										 static_cast<u8>(ValueTag::Nil));
		} else if (plan.nilValue == NativeNilValue::Nil)
			misses[n++] = sljit_emit_jump(m_compiler, SLJIT_JUMP);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), wordOffset, SLJIT_R1, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), tagOffset, SLJIT_R3, 0);
		emitTableWriteWatch(exit, false, value, plan.barrier);
		emitTableSlotStore(value);
	} else {
		NativeBlockAbi::emitRamAddress(m_compiler, SLJIT_R2, SLJIT_R1);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
	}
	if (resultTag) {
		// Guard failure completes the original read in the semantic owner.
		// No typed destination or additional successor cycles are visible yet.
		for (size_t i = 0; i < n; ++i) fault(misses[i], exit, m_cache.state());
		return nullptr;
	}
	auto* hit = sljit_emit_jump(m_compiler, SLJIT_JUMP);
	auto* miss = sljit_emit_label(m_compiler);
	for (size_t i = 0; i < n; ++i)
		sljit_set_label(misses[i], miss);

	if (load) {
		if (constantKey)
			sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), keyWord, keySource, keyOperand);
		return hit;
	}
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, heap));
	emitRawLoad(value, SLJIT_R1, SLJIT_R2);
	emitValueTransportStore(m_compiler, SLJIT_SP, transport, SLJIT_R1, SLJIT_R2);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), receiver);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R2, 0, keySource, keyOperand);
	sljit_get_local_base(m_compiler, SLJIT_R3, 0, transport);
	m_cache.spillCall(false, 0);
	sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS4(32, P, 32, 32, P), SLJIT_IMM,
		SLJIT_FUNC_ADDR(&TableRecord::storeStringKeyInNative));
	m_cache.spillCall(true, 0);
	fault(sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, TABLE_STORE_REQUIRES_GROWTH),
		exit, m_cache.state());
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM0(), prediction, SLJIT_R0, 0);
	sljit_set_label(hit, sljit_emit_label(m_compiler));
	return nullptr;
}

void NativeLowering::lowerOperation(const NativeTableAccess& access, const NativeInstruction& instruction) {
	auto& exit = *instruction.slow;
	const bool load = access.mode != NativeTableMode::Write;
	const int base = access.receiver;
	const int key = access.key;
	const int value = access.value;
	if (access.mode == NativeTableMode::ReadMethod) {
		emitRawLoad(base, SLJIT_R0, SLJIT_R1);
		emitRawStore(value + 1, SLJIT_R0, SLJIT_R1);
		if (access.receiverCheck == NativeTagCheck::Dynamic)
			fault(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM,
				static_cast<u8>(ValueTag::Table)), exit, m_cache.state());
	} else if (access.receiverCheck != NativeTagCheck::Rejected) {
		if (access.receiverCheck == NativeTagCheck::Dynamic)
			fault(m_cache.guard(base, ValueTag::Table, SLJIT_R1), exit, m_cache.state());
		emitPayload(base, SLJIT_R0);
	}
	if (access.receiverCheck == NativeTagCheck::Rejected) {
		emitLeave(exit, Charge::Pending);
		return;
	}
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), receiver, SLJIT_R0, 0);
	sljit_emit_op2(m_compiler, SLJIT_AND, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	fault(sljit_emit_cmp(m_compiler, SLJIT_GREATER, SLJIT_R0, 0, SLJIT_IMM,
		MAIN_RAM_SIZE - TableRecord::HEADER_BYTES), exit, m_cache.state());
	NativeBlockAbi::emitRamAddress(m_compiler, SLJIT_R0, SLJIT_R0);
	switch (access.keyKind) {
	case NativeTableKey::Value: {
		if (load) {
			emitIndexRead(key, exit);
			break;
		}
		emitRawLoad(key, SLJIT_R3, SLJIT_R2);
		auto* string = sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM,
			static_cast<u8>(ValueTag::String));
		fault(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM,
			static_cast<u8>(ValueTag::Integer)), exit, m_cache.state());
		sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R3, 0, SLJIT_IMM, 1);
		emitArrayStore(value, access.store, exit);
		auto* joined = sljit_emit_jump(m_compiler, SLJIT_JUMP);
		sljit_set_label(string, sljit_emit_label(m_compiler));
		emitStringSlot(false, value, exit, std::nullopt, std::nullopt, access.store);
		sljit_set_label(joined, sljit_emit_label(m_compiler));
		break;
	}
	case NativeTableKey::Integer:
		sljit_emit_op1(m_compiler, SLJIT_MOV, SLJIT_R1, 0, SLJIT_IMM, key - 1);
		if (load) {
			for (auto* miss : emitArrayRead()) fault(miss, exit, m_cache.state());
		} else {
			emitArrayStore(value, access.store, exit);
		}
		break;
	case NativeTableKey::Field: {
		auto* hit = emitStringSlot(load, value, exit, m_constants.payload(key), access.resultTag, access.store);
		if (access.resultTag) {
			const auto target = m_cache.write(value, *access.resultTag);
			if (target.tag == ValueTag::Float)
				sljit_emit_fcopy(m_compiler, SLJIT_COPY32_TO_F32, target.reg, SLJIT_R2);
			else
				sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, SLJIT_R2, 0);
			return;
		}
		if (load) {
			emitTableReadLeaf(true, exit);
			sljit_set_label(hit, sljit_emit_label(m_compiler));
		}
		break;
	}
	}
	if (load)
		emitRawStore(value, SLJIT_R2, SLJIT_R3);
}
} // namespace bmsx
