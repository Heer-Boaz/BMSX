#include "machine/cpu/native_block_compiler.h"
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
void NativeBlockCompiler::emitTableSlotOffset(sljit_s32 destination, bool word) {
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

void NativeBlockCompiler::emitTableSlotLoad(sljit_s32 destination, bool word) {
	emitTableSlotOffset(destination, word);
	NativeBlockAbi::emitRamAddress(m_compiler, destination, destination);
	sljit_emit_op1(m_compiler, word ? SLJIT_MOV32 : SLJIT_MOV_U8, destination, 0, SLJIT_MEM1(destination), 0);
}

void NativeBlockCompiler::emitTableWriteWatch(NativeBlockExitSite& exit, bool arraySlot) {
	for (bool word : {true, false}) {
		const auto address = word ? wordOffset : tagOffset;
		// A string hit has already latched the value tag's physical offset.
		if (word || arraySlot) {
			emitTableSlotOffset(SLJIT_R2, word);
			sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), address, SLJIT_R2, 0);
		}
		emitRamWordWriteWatch(exit, SLJIT_MEM1(SLJIT_SP), address, SLJIT_R2, SLJIT_R3);
	}
	if (arraySlot) {
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), slot, SLJIT_R1, 0);
		sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), receiver,
			SLJIT_IMM, static_cast<u32>(TableHeader::Length));
		sljit_emit_op2(m_compiler, SLJIT_AND32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
		emitRamWordWriteWatch(exit, SLJIT_R1, 0, SLJIT_R2, SLJIT_R3);
	}

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
	sljit_set_label(notBlack, sljit_emit_label(c));
}

void NativeBlockCompiler::emitTableSlotStore(int value) {
	emitRawLoad(value, SLJIT_R2, SLJIT_R3);
	for (bool word : {true, false}) {
		sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), word ? wordOffset : tagOffset);
		NativeBlockAbi::emitRamAddress(m_compiler, SLJIT_R1, SLJIT_R1);
		sljit_emit_op1(m_compiler, word ? SLJIT_MOV32 : SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R1), 0,
			word ? SLJIT_R2 : SLJIT_R3, 0);
	}
}

std::array<sljit_jump*, 2> NativeBlockCompiler::emitArrayRead() {
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

void NativeBlockCompiler::emitArrayStore(int value, NativeBlockExitSite& exit) {
	fault(sljit_emit_cmp(m_compiler, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0,
		SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Array)), exit, m_cache.state());
	emitTableWriteWatch(exit, true);
	emitTableSlotStore(value);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), slot);
	const int tag = knownTag(value);
	sljit_jump* nil = nullptr;
	if (tag < 0) {
		nil =
			sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_IMM, static_cast<u8>(ValueTag::Nil));
	}
	sljit_jump* retained = nullptr;
	sljit_jump* advanced = nullptr;
	if (tag != static_cast<int>(ValueTag::Nil)) {
		retained = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0),
								  static_cast<u32>(TableHeader::Length));
		sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Length), SLJIT_R1, 0, SLJIT_IMM, 1);
		if (nil)
			advanced = sljit_emit_jump(m_compiler, SLJIT_JUMP);
	}
	sljit_jump* unchanged = nullptr;
	if (tag < 0 || tag == static_cast<int>(ValueTag::Nil)) {
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

void NativeBlockCompiler::emitTableReadLeaf(bool stringKey, NativeBlockExitSite& exit) {
	auto* c = m_compiler;
	// The leaf only reads RAM. Charge additional visits after success; the
	// dispatcher owns faults and charges their full semantic work there.
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, heap));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), request + offsetof(TableReadRequest, indexKey),
		SLJIT_IMM, m_bindings.indexKey);
	sljit_get_local_base(c, SLJIT_R1, 0, request);
	sljit_get_local_base(c, SLJIT_R2, 0, result);
	m_cache.spillCall(false, 0);
	const auto lookup = stringKey ? &TableRecord::loadStringIndexInNative : &TableRecord::loadIndexInNative;
	sljit_emit_icall(c, SLJIT_CALL, SLJIT_ARGS3V(P, P, P), SLJIT_IMM, SLJIT_FUNC_ADDR(lookup));
	m_cache.spillCall(true, 0);
	fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_MEM1(SLJIT_SP),
		result + offsetof(TableLookupResult, status), SLJIT_IMM, static_cast<u32>(TableLookupStatus::Resolved)),
		exit, m_cache.state());
	sljit_emit_op2(c, SLJIT_MUL32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP),
		result + offsetof(TableLookupResult, extraVisits), SLJIT_IMM, TABLE_INDEX_VISIT_CYCLES);
	sljit_emit_op2(c, SLJIT_SUB32, NativeBlockAbi::budget, 0, NativeBlockAbi::budget, 0, SLJIT_R1, 0);
	if (stringKey) {
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM0(), reinterpret_cast<sljit_sw>(&exit.tableCacheSlot),
			SLJIT_MEM1(SLJIT_SP), result + offsetof(TableLookupResult, slot));
	}
	emitValueTransportLoad(c, SLJIT_SP, result + offsetof(TableLookupResult, value), SLJIT_R2, SLJIT_R3);
}

void NativeBlockCompiler::emitIndexRead(int key, NativeBlockExitSite& exit) {
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
	emitTableReadLeaf(false, exit);
	auto* resolved = sljit_emit_jump(c, SLJIT_JUMP);
	sljit_set_label(string, sljit_emit_label(c));
	emitStringSlot(true, key, exit);
	auto* done = sljit_emit_label(c);
	sljit_set_label(arrayHit, done);
	sljit_set_label(resolved, done);
}

// Hash keys start after the array; hash values start after all hash keys.
void NativeBlockCompiler::emitStringSlot(bool load, int value, NativeBlockExitSite& exit, std::optional<StringId> constantKey) {
	if (!constantKey)
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), keyWord, SLJIT_R3, 0);
	const sljit_s32 keySource = constantKey ? SLJIT_IMM : SLJIT_MEM1(SLJIT_SP);
	const sljit_sw keyOperand = constantKey ? static_cast<sljit_sw>(*constantKey) : keyWord;
	const sljit_sw prediction = reinterpret_cast<sljit_sw>(&exit.tableCacheSlot);
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
	emitTableSlotLoad(SLJIT_R2, true);
	misses[n++] =
		sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, keySource, keyOperand);
	// The value tag is one hash plane after the key tag, even at the RAM seam.
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Hash));
	sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_R2, 0);
	sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R2, 0);
	sljit_emit_op2(m_compiler, SLJIT_AND, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, MAIN_RAM_SIZE - 1u);
	NativeBlockAbi::emitRamAddress(m_compiler, SLJIT_R2, SLJIT_R3);
	const sljit_s32 valueTagReg = load ? SLJIT_R3 : SLJIT_R2;
	sljit_emit_op1(m_compiler, SLJIT_MOV_U8, valueTagReg, 0, SLJIT_MEM1(SLJIT_R2), 0);
	misses[n++] =
		sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, valueTagReg, 0, SLJIT_IMM, static_cast<u8>(ValueTag::Nil));
	if (!load) {
		// Deletion has to retain a dead key for next(), not just overwrite the tag.
		const int tag = knownTag(value);
		if (tag < 0) {
			sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::tags), value);
			misses[n++] = sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM,
										 static_cast<u8>(ValueTag::Nil));
		} else if (tag == static_cast<int>(ValueTag::Nil))
			misses[n++] = sljit_emit_jump(m_compiler, SLJIT_JUMP);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), tagOffset, SLJIT_R3, 0);
		emitTableWriteWatch(exit, false);
		emitTableSlotStore(value);

	} else {
		emitTableSlotLoad(SLJIT_R2, true);
	}
	auto* hit = sljit_emit_jump(m_compiler, SLJIT_JUMP);
	auto* miss = sljit_emit_label(m_compiler);
	for (size_t i = 0; i < n; ++i)
		sljit_set_label(misses[i], miss);

	if (load) {
		if (constantKey)
			sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), keyWord, keySource, keyOperand);
		emitTableReadLeaf(true, exit);
	} else {
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
	}
	sljit_set_label(hit, sljit_emit_label(m_compiler));
}

void NativeBlockCompiler::emitTableAccess(const DecodedInstruction& instruction, NativeBlockExitSite& exit) {
	const auto op = static_cast<OpCode>(instruction.op);
	const bool load = op == OpCode::GETT || op == OpCode::GETI || op == OpCode::GETFIELD || op == OpCode::SELF;
	const int base = load ? instruction.b : instruction.a;
	const int key = load ? instruction.c : instruction.b;
	const int baseTag = knownTag(base);
	constexpr int tableTag = static_cast<int>(ValueTag::Table);
	if (op == OpCode::SELF) {
		emitRawLoad(base, SLJIT_R0, SLJIT_R1);
		emitRawStore(instruction.a + 1, SLJIT_R0, SLJIT_R1);
	} else if (baseTag == tableTag) {
		const auto word = readTyped(base, ValueTag::Table);
		if (word.reg != SLJIT_R0)
			sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, word.reg, 0);
	} else if (baseTag < 0) {
		emitRawLoad(base, SLJIT_R0, SLJIT_R1);
	}
	if (baseTag < 0) {
		fault(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, tableTag),
			exit, m_cache.state());
	} else if (baseTag != tableTag) {
		fault(sljit_emit_jump(m_compiler, SLJIT_JUMP), exit, m_cache.state());
		m_terminal = true;
		return;
	}
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), receiver, SLJIT_R0, 0);
	sljit_emit_op2(m_compiler, SLJIT_AND, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	fault(sljit_emit_cmp(m_compiler, SLJIT_GREATER, SLJIT_R0, 0, SLJIT_IMM,
		MAIN_RAM_SIZE - TableRecord::HEADER_BYTES), exit, m_cache.state());
	NativeBlockAbi::emitRamAddress(m_compiler, SLJIT_R0, SLJIT_R0);
	if (op == OpCode::GETT) {
		emitIndexRead(key, exit);
	} else if (op == OpCode::SETT) {
		emitRawLoad(key, SLJIT_R3, SLJIT_R2);
		auto* string = sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM,
									  static_cast<u8>(ValueTag::String));
		fault(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM,
							 static_cast<u8>(ValueTag::Integer)),
			  exit, m_cache.state());
		sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R3, 0, SLJIT_IMM, 1);
		emitArrayStore(instruction.c, exit);
		auto* joined = sljit_emit_jump(m_compiler, SLJIT_JUMP);
		sljit_set_label(string, sljit_emit_label(m_compiler));
		emitStringSlot(false, instruction.c, exit);
		sljit_set_label(joined, sljit_emit_label(m_compiler));
	} else if (op == OpCode::GETI || op == OpCode::SETI) {
		sljit_emit_op1(m_compiler, SLJIT_MOV, SLJIT_R1, 0, SLJIT_IMM, key - 1);
		if (load) {
			for (auto* miss : emitArrayRead()) fault(miss, exit, m_cache.state());
		} else emitArrayStore(instruction.c, exit);
	} else {
		emitStringSlot(load, instruction.c, exit, m_constants.payload(key));
	}
	if (load)
		emitRawStore(instruction.a, SLJIT_R2, SLJIT_R3);
}
} // namespace bmsx
