#include "machine/cpu/jit/sljit/lowering.h"
#include "machine/cpu/decoded_instruction.h"
#include "machine/cpu/gc_heap.h"
#include "machine/cpu/gc_object.h"
#include "machine/cpu/jit/sljit/gate.h"
#include "machine/cpu/jit/sljit/table_access.h"
#include "machine/cpu/table.h"
#include "spec/blua32/opcode.h"

#include <algorithm>

namespace bmsx {

namespace {
constexpr auto receiver = NativeTableScratch::receiver;
constexpr auto keyWord = NativeTableScratch::keyWord;
constexpr auto arrayLength = NativeTableScratch::arrayLength;
constexpr auto wordOffset = NativeTableScratch::wordOffset;
constexpr auto tagOffset = NativeTableScratch::tagOffset;

void SLJIT_FUNC writeTableBarrier(GcHeap* heap, u32 receiver, u32 flags) {
	heap->writeBarrier(receiver, GC_RECORD_LINK, static_cast<u8>(flags));
}
} // namespace

void NativeLowering::admitTableValueWrite(NativeBlockExitSite& exit) {
	for (const auto address : {wordOffset, tagOffset})
		emitRamWordWriteWatch(exit, SLJIT_MEM1(SLJIT_SP), address, SLJIT_R2, SLJIT_R3, std::nullopt);
}

void NativeLowering::emitTableValueWrite(int value) {
	auto* c = m_compiler;
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
	emitTableSlotOffset(c, SLJIT_R2, true);
	emitTableSlotOffset(c, SLJIT_R3, false);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R2, SLJIT_R2);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R3, SLJIT_R3);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R3), 0);
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

	for (bool word : {true, false}) {
		emitTableSlotOffset(c, SLJIT_R3, word);
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), word ? wordOffset : tagOffset, SLJIT_R3, 0);
	}
	// An empty array slot is not an own entry. Only the CPU may select an
	// inherited assignment when its receiver has a metatable.
	auto* noMetatable = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32,
		SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Metatable), SLJIT_IMM, 0);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R2, SLJIT_R3);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
	fault(sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0,
		SLJIT_IMM, static_cast<u8>(ValueTag::Nil)), exit, m_cache.state());
	sljit_set_label(noMetatable, sljit_emit_label(c));

	// Table storage and its descriptor are independent allocations. The
	// value write cannot change which post-store length effect applies.
	admitTableValueWrite(exit);

	// R3 becomes the expected old hint, R1 the replacement. A valid slot
	// selected by SETI or a positive Integer key cannot produce UINT32_MAX.
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_R1, 0);
	switch (plan.arrayLength) {
	case NativeArrayLengthEffect::ByValue: {
		emitTag(value, SLJIT_R2);
		auto* present = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0,
			SLJIT_IMM, static_cast<u8>(ValueTag::Nil));
		sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, 1);
		auto* retreat = sljit_emit_jump(c, SLJIT_JUMP);
		sljit_set_label(present, sljit_emit_label(c));
		sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 1);
		sljit_set_label(retreat, sljit_emit_label(c));
		break;
	}
	case NativeArrayLengthEffect::AdvanceAtBoundary:
		sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 1);
		break;
	case NativeArrayLengthEffect::RetreatAtBoundary:
		sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, 1);
		break;
	}
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), arrayLength, SLJIT_IMM, -1);
	auto* unchanged = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R3, 0,
		SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Length));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), arrayLength, SLJIT_R1, 0);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), receiver,
		SLJIT_IMM, static_cast<u32>(TableHeader::Length));
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	emitRamWordWriteWatch(exit, SLJIT_R1, 0, SLJIT_R2, SLJIT_R3, std::nullopt);
	sljit_set_label(unchanged, sljit_emit_label(c));

	emitTableStoreBarrier(value, plan.barrier);
	emitTableValueWrite(value);
	auto* keep = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_MEM1(SLJIT_SP), arrayLength, SLJIT_IMM, -1);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Length),
		SLJIT_MEM1(SLJIT_SP), arrayLength);
	sljit_set_label(keep, sljit_emit_label(c));
}

void NativeLowering::emitTableStoreBarrier(int value, NativeGcBarrier barrier) {
	if (barrier == NativeGcBarrier::None) return;
	const auto mutations = emitGcMutationBranches(SLJIT_MEM1(SLJIT_R0), GC_COLOR_OFFSET, value, barrier, SLJIT_R2, SLJIT_R3);
	m_tableStoreBarriers.push_back({mutations, m_cache.state(), sljit_emit_label(m_compiler)});
}

void NativeLowering::emitTableStoreBarriers() {
	auto* c = m_compiler;
	for (const auto& barrier : m_tableStoreBarriers) {
		auto* entry = sljit_emit_label(c);
		for (auto* branch : barrier.mutations) sljit_set_label(branch, entry);
		m_cache.setState(barrier.registers);
		m_cache.spillCall(false, 0);
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, heap));
		sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), receiver);
		sljit_emit_icall(c, SLJIT_CALL, SLJIT_ARGS3V(P, 32, 32), SLJIT_IMM, SLJIT_FUNC_ADDR(&writeTableBarrier));
		m_cache.spillCall(true, 0);
		sljit_emit_op2(c, SLJIT_AND32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), receiver, SLJIT_IMM, RAM_RECORD_WORD_MASK);
		NativeBlockAbi::emitRamAddress(c, SLJIT_R0, SLJIT_R0);
		sljit_set_label(sljit_emit_jump(c, SLJIT_JUMP), barrier.resumeStore);
	}
}

// Hash keys start after the array; hash values start after all hash keys.
// The checked result is the pair of physical offsets in R1 and R3.
std::array<sljit_jump*, 3> NativeLowering::emitStringValueAddress(NativeBlockExitSite& exit, bool load,
	std::optional<StringId> fixedKey, std::optional<u8> temporary) {
	auto* c = m_compiler;
	auto& slot = load ? exit.tableRead.own : exit.tableStore;
	const sljit_sw prediction = reinterpret_cast<sljit_sw>(m_decodedPage ? slot.decoded : &slot.standalone);
	sljit_sw saved = 0;
	std::array<sljit_jump*, 3> checks;
	sljit_emit_op1(c, SLJIT_MOV_S32, SLJIT_R1, 0, SLJIT_MEM0(), prediction);
	checks[0] = sljit_emit_cmp(c, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0,
		SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Hash));
	if (temporary) {
		saved = NativeBlockAbi::fieldAddressOffset + *temporary * NativeBlockAbi::fieldAddressBytes;
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), saved + 2 * sizeof(u32), SLJIT_R1, 0);
		if (!fixedKey)
			sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), saved + 3 * sizeof(u32), SLJIT_MEM1(SLJIT_SP), keyWord);
	}
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0,
		SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Array));
	emitTableSlotOffset(c, SLJIT_R3, false);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R2, SLJIT_R3);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
	checks[1] = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0,
		SLJIT_IMM, static_cast<u8>(ValueTag::String));
	emitTableSlotOffset(c, SLJIT_R1, true);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R2, SLJIT_R1);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
	checks[2] = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0,
		fixedKey ? SLJIT_IMM : SLJIT_MEM1(SLJIT_SP), fixedKey ? static_cast<sljit_sw>(*fixedKey) : keyWord);

	emitHashValueOffsets(c);
	if (temporary) {
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), saved, SLJIT_R1, 0);
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), saved + sizeof(u32), SLJIT_R3, 0);
	}
	return checks;
}

sljit_jump* NativeLowering::emitStringValueTag(bool load, std::optional<ValueTag> resultTag) {
	auto* c = m_compiler;
	NativeBlockAbi::emitRamAddress(c, SLJIT_R2, SLJIT_R3);
	const sljit_s32 valueTagReg = load ? SLJIT_R3 : SLJIT_R2;
	sljit_emit_op1(c, SLJIT_MOV_U8, valueTagReg, 0, SLJIT_MEM1(SLJIT_R2), 0);
	return sljit_emit_cmp(c, (resultTag ? SLJIT_NOT_EQUAL : SLJIT_EQUAL) | SLJIT_32,
		valueTagReg, 0, SLJIT_IMM, static_cast<u8>(resultTag.value_or(ValueTag::Nil)));
}

void NativeLowering::emitStringPayload() {
	NativeBlockAbi::emitRamAddress(m_compiler, SLJIT_R2, SLJIT_R1);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
}

void NativeLowering::emitReusedFieldAddress(u8 temporary, u16 keyIndex, NativeBlockExitSite& exit, std::optional<ValueTag> resultTag) {
	auto* c = m_compiler;
	const sljit_sw saved = NativeBlockAbi::fieldAddressOffset + temporary * NativeBlockAbi::fieldAddressBytes;
	// Each callsite can change its own prediction independently. Check
	// identity before allowing the consumer to use a different site's proof.
	fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32,
		SLJIT_MEM0(), reinterpret_cast<sljit_sw>(m_decodedPage ? exit.tableRead.own.decoded : &exit.tableRead.own.standalone),
		SLJIT_MEM1(SLJIT_SP), saved + 2 * sizeof(u32)), exit, m_cache.state());
	if (!nativeImageConstant(m_constants, keyIndex)) {
		emitPoolWord(keyIndex, SLJIT_R0);
		fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R0, 0,
			SLJIT_MEM1(SLJIT_SP), saved + 3 * sizeof(u32)), exit, m_cache.state());
	}
	sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), saved);
	sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_SP), saved + sizeof(u32));
	fault(emitStringValueTag(true, resultTag), exit, m_cache.state());
	emitStringPayload();
}

void NativeLowering::emitStringSlot(bool load, int value, NativeBlockExitSite& exit,
	std::optional<u16> keyIndex, std::optional<ValueTag> resultTag, NativeStorePlan plan,
	NativeTableReadPlan readPlan, std::optional<u8> temporary) {
	auto* c = m_compiler;
	if (!load && plan.nilValue == NativeNilValue::Nil) {
		fault(sljit_emit_jump(c, SLJIT_JUMP), exit, m_cache.state());
		return;
	}

	std::optional<StringId> fixedKey;
	if (keyIndex) {
		if (const auto constant = nativeImageConstant(m_constants, *keyIndex)) fixedKey = asStringId(*constant);
		else emitPoolWord(*keyIndex, SLJIT_R3);
	}
	if (!fixedKey) sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), keyWord, SLJIT_R3, 0);
	const auto address = emitStringValueAddress(exit, load, fixedKey, temporary);
	auto* valueFailure = emitStringValueTag(load, resultTag);
	if (const auto peer = exit.operands.table.reusePeerWord; peer && m_decodedPage) {
		// A worker can publish this baseline after scalar execution has
		// already learned both slots. Confirm the actual own hit before
		// using the semantic continuation to reproject the source.
		auto* prediction = exit.tableRead.own.decoded;
		const auto peerSlot = &m_decodedPage[*peer].tableCacheSlot();
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM0(), reinterpret_cast<sljit_sw>(prediction));
		fault(sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0,
			SLJIT_MEM0(), reinterpret_cast<sljit_sw>(peerSlot)), exit, m_cache.state());
	}
	// An own-only read can be inside a fixed-cost segment. Only
	// checkpointed reads can complete a returning variable-cost lookup.
	if (readPlan == NativeTableReadPlan::OneHopIndex) {
		emitStringPayload();
		m_singleStringReads.push_back({{address[0], address[1], address[2], valueFailure}, fixedKey,
			m_cache.state(), &exit, sljit_emit_label(c)});
		return;
	}
	for (auto* guard : address) fault(guard, exit, m_cache.state());
	fault(valueFailure, exit, m_cache.state());
	if (load) {
		emitStringPayload();
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
	admitTableValueWrite(exit);
	emitTableStoreBarrier(value, plan.barrier);
	emitTableValueWrite(value);
}

void NativeLowering::emitSingleStringReads() {
	auto* c = m_compiler;
	for (const auto& read : m_singleStringReads) {
		auto* entry = sljit_emit_label(c);
		for (auto* miss : read.ownMisses) sljit_set_label(miss, entry);
		m_cache.setState(read.registers);
		const auto& slots = read.exit->tableRead.path;
		fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32,
			SLJIT_MEM0(), reinterpret_cast<sljit_sw>(&slots.holderDepth), SLJIT_IMM, 1), *read.exit, read.registers);
		if (read.fixedKey)
			sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), keyWord, SLJIT_IMM, *read.fixedKey);
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(&slots));
		// Each own miss leaves the aligned receiver header in R0. The leaf
		// preserves the guest register cache and returns the live value lanes.
		sljit_emit_ijump(c, SLJIT_FAST_CALL, SLJIT_IMM,
			reinterpret_cast<sljit_sw>(nativeBlockGate().oneHopStringRead));
		fault(sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R3, 0,
			SLJIT_IMM, static_cast<u8>(ValueTag::Nil)), *read.exit, m_cache.state());
		sljit_emit_op2(c, SLJIT_SUB32, NativeBlockAbi::budget, 0, NativeBlockAbi::budget, 0, SLJIT_IMM, TABLE_INDEX_VISIT_CYCLES);
		sljit_set_label(sljit_emit_jump(c, SLJIT_JUMP), read.result);
	}
}

void NativeLowering::assignFieldAddressSpills(std::span<const NativeOwnFieldAddress> addresses) {
	std::array<int, NATIVE_OWN_FIELD_TEMPORARIES> ends;
	ends.fill(-1);
	for (size_t id = 0; id < addresses.size(); ++id) {
		const auto& address = addresses[id];
		if (!address.lastUseRow) continue;
		const auto slot = std::ranges::find_if(ends, [&](int end) { return end < address.definingRow; });
		m_fieldAddressSpills[id] = static_cast<u8>(slot - ends.begin());
		*slot = *address.lastUseRow;
	}
}

void NativeLowering::lowerOperation(const NativeTableAccess& access, const NativeInstruction& instruction) {
	auto* c = m_compiler;
	auto& exit = *sideExit(instruction.slow);
	const bool load = access.mode != NativeTableMode::Write;
	const auto* address = access.ownFieldAddress
		? &m_ir[m_current].ownFieldAddresses[*access.ownFieldAddress] : nullptr;
	const int base = address ? address->receiver : access.receiver;
	const int key = address ? address->key : access.key;
	const int value = access.value;
	const auto spill = address && address->lastUseRow ? std::optional{m_fieldAddressSpills[*access.ownFieldAddress]}
		: std::nullopt;
	if (address && address->definingRow + 1u != m_instruction) {
		emitReusedFieldAddress(*spill, address->key, exit, access.resultTag);
		emitFieldResult(value, access.resultTag);
		return;
	}
	if (access.mode == NativeTableMode::ReadMethod) {
		emitRawLoad(base, SLJIT_R0, SLJIT_R1);
		emitRawStore(value + 1, SLJIT_R0, SLJIT_R1);
		if (access.receiverCheck == NativeTagCheck::Dynamic)
			fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0,
				SLJIT_IMM, static_cast<u8>(ValueTag::Table)), exit, m_cache.state());
	} else if (access.receiverCheck != NativeTagCheck::Rejected) {
		if (access.receiverCheck == NativeTagCheck::Dynamic)
			fault(guardTag(base, ValueTag::Table, SLJIT_R1), exit, m_cache.state());
		emitPayload(base, SLJIT_R0);
	}
	if (access.receiverCheck == NativeTagCheck::Rejected) {
		emitLeave(exit, Charge::Pending);
		return;
	}
	if (!load)
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), receiver, SLJIT_R0, 0);
	sljit_emit_op2(c, SLJIT_AND, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
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
		emitStringSlot(load, value, exit, std::nullopt, std::nullopt, access.store, access.readPlan);
		sljit_set_label(joined, sljit_emit_label(c));
		break;
	}
	case NativeTableKey::Integer:
		sljit_emit_op1(c, SLJIT_MOV, SLJIT_R1, 0, SLJIT_IMM, key - 1);
		if (load) emitArrayRead(exit);
		else emitArrayStore(value, access.store, exit);
		break;
	case NativeTableKey::Field:
		emitStringSlot(load, value, exit, static_cast<u16>(key), access.resultTag, access.store,
			access.readPlan, spill);
		if (load) {
			emitFieldResult(value, access.resultTag);
			return;
		}
		break;
	}
	if (load)
		emitRawStore(value, SLJIT_R2, SLJIT_R3);
}

void NativeLowering::emitFieldResult(int slot, std::optional<ValueTag> resultTag) {
	if (!resultTag) {
		emitRawStore(slot, SLJIT_R2, SLJIT_R3);
		return;
	}
	const auto target = m_cache.write(slot, *resultTag);
	if (target.tag == ValueTag::Float)
		sljit_emit_fcopy(m_compiler, SLJIT_COPY32_TO_F32, target.reg, SLJIT_R2);
	else
		sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, SLJIT_R2, 0);
}
} // namespace bmsx
