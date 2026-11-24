#include "machine/cpu/jit/sljit/lowering.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/decoded_instruction.h"
#include "machine/cpu/gc_heap.h"
#include "machine/cpu/jit/sljit/gate.h"
#include "machine/cpu/jit/sljit/table_access.h"
#include "machine/cpu/jit/sljit/value_transport.h"
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
constexpr auto hashOperand = (NativeBlockAbi::helperResultOffset + alignof(Value) - 1) & ~(alignof(Value) - 1);
static_assert(hashOperand + sizeof(Value) <= NativeBlockAbi::stackBytes);
static_assert(alignof(NativeHintedFieldWrite) == alignof(Value));
static_assert(hashOperand + sizeof(NativeHintedFieldWrite) <= NativeBlockAbi::stackBytes);

u32 SLJIT_FUNC assignNativeTableIdentity(GcHeap* heap, u32 receiverAddress, u32 keyAddress, const Value* value) noexcept {
	return TableRecord(*heap, receiverAddress).tryAssignIdentityHash(valueTable(keyAddress), *value);
}

u32 SLJIT_FUNC assignNativeTableInteger(GcHeap* heap, u32 receiverAddress, i32 key, const Value* value) noexcept {
	return TableRecord(*heap, receiverAddress).tryAssignIntegerHash(key, *value);
}

} // namespace

void NativeLowering::lowerOperation(const NativeTableIterator& iterator, const NativeInstruction& row) {
	if (!iterator.ownsSkip()) return; // The semantic owner must fetch its skip.
	auto* c = m_compiler;
	const auto state = m_cache.state();
	const auto table = iterator.base + 1, control = iterator.base + 2;

	// On mismatch the ordinary iterator call at the following PC sees the
	// original result range and hidden control word.
	std::array<sljit_jump*, 4> miss;
	miss[0] = m_cache.guard(iterator.base, ValueTag::BuiltinFunction, SLJIT_R2);
	emitPayload(iterator.base, SLJIT_R0);
	miss[1] = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R0, 0,
		SLJIT_IMM, valuePayload(valueBuiltinFunction(BuiltinFunctionId::Next)));
	miss[2] = m_cache.guard(table, ValueTag::Table, SLJIT_R2);
	miss[3] = m_cache.guard(control, ValueTag::Nil, SLJIT_R2);
	emitPayload(table, SLJIT_R0);
	emitPayload(control, SLJIT_R1);
	sljit_emit_ijump(c, SLJIT_FAST_CALL, SLJIT_IMM, reinterpret_cast<sljit_sw>(nativeBlockGate().tableIteratorScan));
	// The admitted VM stack is already recorded for rewind by the grant.
	emitRawStore(iterator.first, SLJIT_R2, SLJIT_R0);
	if (iterator.count > 1) emitRawStore(iterator.first + 1, SLJIT_R3, SLJIT_R1);
	if (iterator.count > 2)
		lowerOperation(NativeClearSlots{static_cast<u16>(iterator.first + 2), static_cast<u16>(iterator.count - 2)}, row);
	// Store the hidden cursor last: result operands can name its slot.
	m_cache.discardRange(control, control + 1);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(NativeBlockAbi::words), control * sizeof(u32),
		SLJIT_MEM1(SLJIT_SP), NativeTableIteratorScratch::cursor);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_MEM1(NativeBlockAbi::tags), control, SLJIT_IMM, static_cast<u8>(ValueTag::Nil));
	emitExit(*sideExit(m_ir[m_current].taken), 1, EdgePosition::BeforeAlternate);

	auto* fallthrough = sljit_emit_label(c);
	for (auto* guard : miss) if (guard) sljit_set_label(guard, fallthrough);
	m_cache.setState(state);
	emitExit(m_blocks[m_current]->terminal);
}

void NativeLowering::admitTableValueWrite(NativeBlockExitSite& exit) {
	for (const auto address : {wordOffset, tagOffset})
		emitRamWordWriteWatch(exit, SLJIT_MEM1(SLJIT_SP), address, SLJIT_R2, SLJIT_R3, std::nullopt);
}

void NativeLowering::emitTableValueWrite(int value) {
	auto* c = m_compiler;
	emitRawLoad(value, SLJIT_R2, SLJIT_R3);
	for (bool word : {true, false}) {
		sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), word ? wordOffset : tagOffset);
		sljit_emit_op1(c, word ? SLJIT_MOV32 : SLJIT_MOV_U8, NativeBlockAbi::ramOperand(c, SLJIT_R1, SLJIT_R1), 0,
			word ? SLJIT_R2 : SLJIT_R3, 0);
	}
}

sljit_jump* NativeLowering::emitArrayRead(NativeBlockExitSite& exit, bool routeOutside) {
	auto* c = m_compiler;
	auto* outside = sljit_emit_cmp(c, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0,
		SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Array));
	if (!routeOutside) fault(outside, exit, m_cache.state());
	emitTableSlotOffset(c, SLJIT_R2, true);
	emitTableSlotOffset(c, SLJIT_R3, false);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, NativeBlockAbi::ramOperand(c, SLJIT_R2, SLJIT_R2), 0);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R3, 0, NativeBlockAbi::ramOperand(c, SLJIT_R3, SLJIT_R3), 0);
	auto* own = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R3, 0,
		SLJIT_IMM, static_cast<u8>(ValueTag::Nil));
	fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32,
		SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Metatable), SLJIT_IMM, 0), exit, m_cache.state());
	sljit_set_label(own, sljit_emit_label(c));
	return outside;
}

sljit_jump* NativeLowering::emitArrayStore(int value, NativeStorePlan plan, NativeBlockExitSite& exit, bool routeOutside) {
	auto* c = m_compiler;
	auto* outside = sljit_emit_cmp(c, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0,
		SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Array));
	if (!routeOutside) fault(outside, exit, m_cache.state());

	for (bool word : {true, false}) {
		emitTableSlotOffset(c, SLJIT_R3, word);
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), word ? wordOffset : tagOffset, SLJIT_R3, 0);
	}
	// Only an absent own element can dispatch __newindex. For an empty
	// element, consult the shared metatable's current proof before leaving.
	sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Metatable));
	auto* noMetatable = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R3, 0, NativeBlockAbi::ramOperand(c, SLJIT_R3, SLJIT_R3), 0);
	auto* own = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_IMM, static_cast<u8>(ValueTag::Nil));
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R2, SLJIT_R2);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), TABLE_NEW_INDEX_ABSENT_BYTE);
	fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 1), exit, m_cache.state());
	auto* direct = sljit_emit_label(c);
	sljit_set_label(noMetatable, direct);
	sljit_set_label(own, direct);

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
	if (m_bindings.historyWriteWatches) {
		sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), receiver,
			SLJIT_IMM, static_cast<u32>(TableHeader::Length));
		sljit_emit_op2(c, SLJIT_AND32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
		emitRamWordWriteWatch(exit, SLJIT_R1, 0, SLJIT_R2, SLJIT_R3, std::nullopt);
	}
	sljit_set_label(unchanged, sljit_emit_label(c));

	emitStoreBarrier(value, plan.barrier, StoreBarrierRecord::Table, exit);
	emitTableValueWrite(value);
	auto* keep = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_MEM1(SLJIT_SP), arrayLength, SLJIT_IMM, -1);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Length),
		SLJIT_MEM1(SLJIT_SP), arrayLength);
	sljit_set_label(keep, sljit_emit_label(c));
	return outside;
}

// The Integer and Table arms share a generated tagged-key chain walk.
// Only a missing own mapping can make __index observable.
void NativeLowering::emitOwnIndexRead(NativeBlockExitSite& exit, std::optional<ValueTag> keyTag) {
	auto* c = m_compiler;
	if (keyTag)
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_IMM, static_cast<u8>(*keyTag));
	sljit_emit_ijump(c, SLJIT_FAST_CALL, SLJIT_IMM, reinterpret_cast<sljit_sw>(nativeBlockGate().indexReadProbe));
	auto* own = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_IMM, static_cast<u8>(ValueTag::Nil));
	fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_MEM1(SLJIT_R0),
		static_cast<u32>(TableHeader::Metatable), SLJIT_IMM, 0), exit, m_cache.state());
	sljit_set_label(own, sljit_emit_label(c));
}

// The key payload is in R3; the receiver precedes the Value transport
// in the scratch lifetime. The own write cannot call guest code.
void NativeLowering::emitOwnIndexStore(int value, NativeBlockExitSite& exit, NativeHashStore key) {
	auto* c = m_compiler;
	emitRawLoad(value, SLJIT_R0, SLJIT_R2);
	sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), receiver);
	emitValueTransportStore(c, SLJIT_SP, hashOperand, SLJIT_R0, SLJIT_R2);
	m_cache.spillCall(false, 0, NativeRegisterCache::FrameSlots::Unchanged);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, heap));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_R3, 0);
	sljit_get_local_base(c, SLJIT_R3, 0, hashOperand);
	const auto target = key == NativeHashStore::Integer
		? SLJIT_FUNC_ADDR(&assignNativeTableInteger) : SLJIT_FUNC_ADDR(&assignNativeTableIdentity);
	sljit_emit_icall(c, SLJIT_CALL, SLJIT_ARGS4(32, P, 32, 32, P), SLJIT_IMM, target);
	m_cache.spillCall(true, 0, NativeRegisterCache::FrameSlots::Unchanged);
	// Declining has not written anything; execute the semantic exit once.
	fault(sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0), exit, m_cache.state());
}

// Hash keys start after the array; hash values start after all hash keys.
// The checked result is the pair of physical offsets in R1 and R3.
std::array<sljit_jump*, 3> NativeLowering::emitStringValueAddress(NativeBlockExitSite& exit, bool load,
	std::optional<StringId> fixedKey, std::optional<u8> temporary) {
	auto* c = m_compiler;
	auto& slot = load ? exit.tableRead : exit.tableStore;
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
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R2, 0, NativeBlockAbi::ramOperand(c, SLJIT_R2, SLJIT_R3), 0);
	checks[1] = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0,
		SLJIT_IMM, static_cast<u8>(ValueTag::String));
	emitTableSlotOffset(c, SLJIT_R1, true);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, NativeBlockAbi::ramOperand(c, SLJIT_R2, SLJIT_R1), 0);
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
	const sljit_s32 valueTagReg = load ? SLJIT_R3 : SLJIT_R2;
	sljit_emit_op1(c, SLJIT_MOV_U8, valueTagReg, 0, NativeBlockAbi::ramOperand(c, SLJIT_R2, SLJIT_R3), 0);
	return sljit_emit_cmp(c, (resultTag ? SLJIT_NOT_EQUAL : SLJIT_EQUAL) | SLJIT_32,
		valueTagReg, 0, SLJIT_IMM, static_cast<u8>(resultTag.value_or(ValueTag::Nil)));
}

void NativeLowering::emitStringPayload() {
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R2, 0, NativeBlockAbi::ramOperand(m_compiler, SLJIT_R2, SLJIT_R1), 0);
}

void NativeLowering::emitReusedFieldAddress(u8 temporary, u16 keyIndex, NativeBlockExitSite& exit, std::optional<ValueTag> resultTag) {
	auto* c = m_compiler;
	const sljit_sw saved = NativeBlockAbi::fieldAddressOffset + temporary * NativeBlockAbi::fieldAddressBytes;
	// Each callsite can change its own prediction independently. Check
	// identity before allowing the consumer to use a different site's proof.
	fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32,
		SLJIT_MEM0(), reinterpret_cast<sljit_sw>(m_decodedPage ? exit.tableRead.decoded : &exit.tableRead.standalone),
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
	const bool returnMiss = !load && m_bindings.cpu && m_decodedPage
		&& (plan.hash == NativeHashStore::String || plan.hash == NativeHashStore::Index);
	const auto& missState = m_cache.state();
	if (!load && plan.nilValue == NativeNilValue::Nil) {
		if (returnMiss && !keyIndex)
			sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), keyWord, SLJIT_R3, 0);
		auto* erase = sljit_emit_jump(c, SLJIT_JUMP);
		if (returnMiss)
			m_workspace.stringStoreMisses.push_back({{erase}, missState, &exit, sljit_emit_label(c), value, keyIndex});
		else fault(erase, exit, missState);
		return;
	}

	std::optional<StringId> fixedKey;
	if (keyIndex) {
		if (const auto constant = nativeImageConstant(m_constants, *keyIndex)) fixedKey = asStringId(*constant);
		else emitPoolWord(*keyIndex, SLJIT_R3);
	}
	if (!fixedKey) sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), keyWord, SLJIT_R3, 0);
	const bool ownOnly = load && readPlan == NativeTableReadPlan::OwnSlot;
	auto* retry = ownOnly && (temporary || exit.operands.table.reusePeerWord) ? sljit_emit_label(c) : nullptr;
	const auto address = emitStringValueAddress(exit, load, fixedKey, temporary);
	auto* valueFailure = emitStringValueTag(load, resultTag);
	if (const auto peer = exit.operands.table.reusePeerWord; peer && m_decodedPage) {
		// A worker can publish this baseline after scalar execution has
		// already learned both slots. Confirm the actual own hit before
		// using the semantic continuation to reproject the source.
		auto* prediction = exit.tableRead.decoded;
		const auto peerSlot = &m_decodedPage[*peer].tableCacheSlot();
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM0(), reinterpret_cast<sljit_sw>(prediction));
		fault(sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0,
			SLJIT_MEM0(), reinterpret_cast<sljit_sw>(peerSlot)), exit, m_cache.state());
	}
	// An own-only read can be inside a fixed-cost segment. Only
	// checkpointed reads can complete a returning variable-cost lookup.
	if (readPlan == NativeTableReadPlan::StringLookup ||
		readPlan == NativeTableReadPlan::IndexLookup) {
		auto* ownPrediction = m_decodedPage ? exit.tableRead.decoded : &exit.tableRead.standalone;
		emitStringPayload();
		m_workspace.singleStringReads.push_back({{address[0], address[1], address[2], valueFailure}, fixedKey,
			m_cache.state(), &exit, sljit_emit_label(c), ownPrediction, false});
		return;
	}
	if (ownOnly) {
		fault(valueFailure, exit, missState);
		emitStringPayload();
		auto* prediction = m_decodedPage ? exit.tableRead.decoded : &exit.tableRead.standalone;
		m_workspace.singleStringReads.push_back({{address[0], address[1], address[2], nullptr}, fixedKey,
			m_cache.state(), &exit, retry ? retry : sljit_emit_label(c), prediction, true});
		return;
	} else if (!returnMiss) {
		for (auto* guard : address) fault(guard, exit, missState);
		fault(valueFailure, exit, missState);
	}
	if (load) {
		emitStringPayload();
		return;
	}

	// A predicted but absent entry or a nil source needs the hash mutation
	// owner, not a write to the payload and tag of the candidate slot.
	sljit_jump* erase = nullptr;
	if (plan.nilValue == NativeNilValue::Dynamic) {
		emitTag(value, SLJIT_R2);
		erase = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, static_cast<u8>(ValueTag::Nil));
		if (!returnMiss) fault(erase, exit, missState);
	}
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), wordOffset, SLJIT_R1, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), tagOffset, SLJIT_R3, 0);
	admitTableValueWrite(exit);
	emitStoreBarrier(value, plan.barrier, StoreBarrierRecord::Table, exit);
	emitTableValueWrite(value);
	if (returnMiss)
		m_workspace.stringStoreMisses.push_back({{address[0], address[1], address[2], valueFailure, erase},
			missState, &exit, sljit_emit_label(c), value, keyIndex});
}

void NativeLowering::emitStringStoreMisses() {
	auto* c = m_compiler;
	for (const auto& store : m_workspace.stringStoreMisses) {
		auto* entry = sljit_emit_label(c);
		for (auto* miss : store.misses)
			if (miss) sljit_set_label(miss, entry);
		m_cache.setState(store.registers);
		emitRawLoad(store.value, SLJIT_R0, SLJIT_R3);
		// Load the receiver before reusing its scratch as a Value.
		sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), receiver);
		if (store.keyIndex) emitPoolWord(*store.keyIndex, SLJIT_R2);
		else sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), keyWord);
		emitValueTransportStore(c, SLJIT_SP, hashOperand, SLJIT_R0, SLJIT_R3);
		const u8 extraHashSlots = store.exit->operands.table.extraHashSlots;
		if (extraHashSlots)
			sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_SP), hashOperand + offsetof(NativeHintedFieldWrite, extraHashSlots),
				SLJIT_IMM, extraHashSlots);
		m_cache.spillCall(false, 0, NativeRegisterCache::FrameSlots::Unchanged);
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(m_bindings.cpu));
		sljit_get_local_base(c, SLJIT_R3, 0, hashOperand);
		const auto target = extraHashSlots ? SLJIT_FUNC_ADDR(&CPU::assignNativeHintedTableField) : SLJIT_FUNC_ADDR(&CPU::assignNativeTableField);
		sljit_emit_icall(c, SLJIT_CALL, SLJIT_ARGS4(32, P, 32, 32, P), SLJIT_IMM, target);
		m_cache.spillCall(true, 0, NativeRegisterCache::FrameSlots::Unchanged);
		fault(sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM,
			TableRecord::HASH_STORE_DECLINED), *store.exit, store.registers);
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM0(), reinterpret_cast<sljit_sw>(store.exit->tableStore.decoded), SLJIT_R0, 0);
		sljit_set_label(sljit_emit_jump(c, SLJIT_JUMP), store.resume);
	}
}

void NativeLowering::emitSingleStringReads() {
	auto* c = m_compiler;
	for (const auto& read : m_workspace.singleStringReads) {
		auto* entry = sljit_emit_label(c);
		for (auto* miss : read.ownMisses) if (miss) sljit_set_label(miss, entry);
		m_cache.setState(read.registers);
		if (read.fixedKey)
			sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), keyWord, SLJIT_IMM, *read.fixedKey);
		if (read.ownOnly) {
			// Fixed-cost segments may recover the slot, not change their value or
			// visit-cost proofs. Address reuse still needs the original spill sequence.
			sljit_emit_ijump(c, SLJIT_FAST_CALL, SLJIT_IMM,
				reinterpret_cast<sljit_sw>(nativeBlockGate().ownStringSlotProbe));
			fault(sljit_emit_cmp(c, SLJIT_SIG_LESS | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0), *read.exit, read.registers);
			sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM0(), reinterpret_cast<sljit_sw>(read.ownPrediction), SLJIT_R1, 0);
			if (read.exit->operands.table.resultProof) {
				fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_IMM,
					static_cast<u8>(*read.exit->operands.table.resultProof)), *read.exit, read.registers);
			}
			sljit_set_label(sljit_emit_jump(c, SLJIT_JUMP), read.result);
			continue;
		}
		sljit_emit_ijump(c, SLJIT_FAST_CALL, SLJIT_IMM,
			reinterpret_cast<sljit_sw>(nativeBlockGate().stringReadProbe));
		fault(sljit_emit_cmp(c, SLJIT_SIG_LESS | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0), *read.exit, read.registers);
		auto* noOwnSlot = sljit_emit_cmp(c, SLJIT_SIG_LESS | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0);
		if (read.exit->operands.table.reusePeerWord) {
			// Only the publication owner may reproject paired fields.
			fault(sljit_emit_jump(c, SLJIT_JUMP), *read.exit, read.registers);
		} else {
			sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM0(), reinterpret_cast<sljit_sw>(read.ownPrediction), SLJIT_R1, 0);
		}
		sljit_set_label(noOwnSlot, sljit_emit_label(c));
		sljit_emit_op2(c, SLJIT_SUB32, NativeBlockAbi::budget, 0, NativeBlockAbi::budget, 0, SLJIT_R0, 0);
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
		emitTableReadResult(value, access.resultTag);
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
		const bool hashLeaf = m_bindings.cpu && access.readPlan == NativeTableReadPlan::IndexLookup;
		const auto hashStore = access.store.hash;
		const bool identityStore = m_bindings.cpu && (hashStore == NativeHashStore::Identity || hashStore == NativeHashStore::Index);
		const bool integerStore = m_bindings.cpu && (hashStore == NativeHashStore::Integer || hashStore == NativeHashStore::Index);
		if (access.indexType == NativeTableIndexType::String) {
			emitPayload(key, SLJIT_R3);
			emitStringSlot(load, value, exit, std::nullopt, std::nullopt, access.store, access.readPlan);
			break;
		}
		if (access.indexType == NativeTableIndexType::Table) {
			if (!hashLeaf && !identityStore) {
				emitLeave(exit, Charge::Pending);
				return;
			}
			emitPayload(key, SLJIT_R3);
			if (hashLeaf) emitOwnIndexRead(exit, ValueTag::Table);
			else emitOwnIndexStore(value, exit, NativeHashStore::Identity);
			break;
		}
		// A proven Integer needs the same array path, but no tag load,
		// String arm, or second key comparison on a hash miss.
		const bool dynamic = access.indexType == NativeTableIndexType::Dynamic;
		sljit_jump* string = nullptr;
		sljit_jump* otherKey = nullptr;
		if (dynamic) {
			emitRawLoad(key, SLJIT_R3, SLJIT_R2);
			string = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0,
				SLJIT_IMM, static_cast<u8>(ValueTag::String));
			otherKey = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0,
				SLJIT_IMM, static_cast<u8>(ValueTag::Integer));
			if (!hashLeaf && !identityStore) fault(otherKey, exit, m_cache.state());
		} else {
			emitPayload(key, SLJIT_R3);
		}
		sljit_jump* nonpositive = nullptr;
		if (!integerStore) {
			nonpositive = sljit_emit_cmp(c, SLJIT_SIG_LESS_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_IMM, 0);
			if (!hashLeaf) fault(nonpositive, exit, m_cache.state());
		}
		// For a returning integer store, the unsigned array check also
		// routes zero and negative keys outside the private array extent.
		sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R3, 0, SLJIT_IMM, 1);
		auto* outside = load ? emitArrayRead(exit, hashLeaf) : emitArrayStore(value, access.store, exit, integerStore);
		if (!dynamic && !hashLeaf && !integerStore) break;
		auto* joined = sljit_emit_jump(c, SLJIT_JUMP);
		sljit_jump* hashJoined = nullptr;
		sljit_jump* integerJoined = nullptr;
		if (integerStore) {
			sljit_set_label(outside, sljit_emit_label(c));
			emitOwnIndexStore(value, exit, NativeHashStore::Integer);
			if (dynamic) integerJoined = sljit_emit_jump(c, SLJIT_JUMP);
		}
		if (hashLeaf) {
			auto* probe = sljit_emit_label(c);
			sljit_set_label(nonpositive, probe);
			sljit_set_label(outside, probe);
			// Both range failures still carry the raw key and table header.
			// Never turn an in-array nil into a hash probe.
			if (dynamic) {
				sljit_set_label(otherKey, probe);
				auto* integer = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0,
					SLJIT_IMM, static_cast<u8>(ValueTag::Integer));
				fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0,
					SLJIT_IMM, static_cast<u8>(ValueTag::Table)), exit, m_cache.state());
				sljit_set_label(integer, sljit_emit_label(c));
				emitOwnIndexRead(exit);
				hashJoined = sljit_emit_jump(c, SLJIT_JUMP);
			} else emitOwnIndexRead(exit, ValueTag::Integer);
		} else if (dynamic && identityStore) {
			sljit_set_label(otherKey, sljit_emit_label(c));
			fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0,
				SLJIT_IMM, static_cast<u8>(ValueTag::Table)), exit, m_cache.state());
			emitOwnIndexStore(value, exit, NativeHashStore::Identity);
			hashJoined = sljit_emit_jump(c, SLJIT_JUMP);
		}
		if (dynamic) {
			sljit_set_label(string, sljit_emit_label(c));
			emitStringSlot(load, value, exit, std::nullopt, std::nullopt, access.store, access.readPlan);
		}
		auto* done = sljit_emit_label(c);
		sljit_set_label(joined, done);
		if (hashJoined) sljit_set_label(hashJoined, done);
		if (integerJoined) sljit_set_label(integerJoined, done);
		break;
	}
	case NativeTableKey::Integer:
		sljit_emit_op1(c, SLJIT_MOV, SLJIT_R1, 0, SLJIT_IMM, key - 1);
		if (load) emitArrayRead(exit);
		else {
			const bool integerStore = m_bindings.cpu && access.store.hash == NativeHashStore::Integer;
			auto* outside = emitArrayStore(value, access.store, exit, integerStore);
			if (integerStore) {
				auto* inside = sljit_emit_jump(c, SLJIT_JUMP);
				sljit_set_label(outside, sljit_emit_label(c));
				sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_IMM, key);
				emitOwnIndexStore(value, exit, NativeHashStore::Integer);
				sljit_set_label(inside, sljit_emit_label(c));
			}
		}
		break;
	case NativeTableKey::Field:
		emitStringSlot(load, value, exit, static_cast<u16>(key), access.resultTag, access.store,
			access.readPlan, spill);
		if (load) {
			emitTableReadResult(value, access.resultTag);
			return;
		}
		break;
	}
	if (load)
		emitTableReadResult(value, std::nullopt);
}

void NativeLowering::emitTableReadResult(int slot, std::optional<ValueTag> resultTag) {
	if (!resultTag) {
		emitRawStore(slot, SLJIT_R2, SLJIT_R3, m_uses.nextOperandDemand(m_instruction, slot));
		return;
	}
	const auto target = m_cache.write(slot, *resultTag);
	if (target.tag == ValueTag::Float)
		sljit_emit_fcopy(m_compiler, SLJIT_COPY32_TO_F32, target.reg, SLJIT_R2);
	else
		sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, SLJIT_R2, 0);
}
} // namespace bmsx
