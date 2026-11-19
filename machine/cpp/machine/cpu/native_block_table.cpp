#include "machine/cpu/native_block_compiler.h"
#include "machine/cpu/native_value_emit.h"
#include "machine/cpu/execution_image.h"
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
constexpr auto keyWord = request + offsetof(TableReadRequest, key);
constexpr auto slot = scratch + offsetof(TableScratch, slot);
constexpr auto wordOffset = scratch + offsetof(TableScratch, wordOffset);
constexpr auto tagOffset = scratch + offsetof(TableScratch, tagOffset);
constexpr auto result = scratch + offsetof(TableScratch, result);
constexpr auto transport = scratch + offsetof(TableScratch, transport);
static_assert(scratch + sizeof(TableScratch) <= NativeBlockAbi::stackBytes);

// A raw record needs a host descriptor only for the interim collector barrier.
void emitTableWriteBarrier(sljit_compiler* compiler) {
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, heap));
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), receiver);
	sljit_emit_op2(compiler, SLJIT_AND, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, MAIN_RAM_SIZE - Table::HEADER_BYTES);
	emitPhysicalRecordPointer(compiler, SLJIT_R0, SLJIT_R0, SLJIT_R2);
	auto* unattached = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), offsetof(GCObject, type));
	auto* otherRecord = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0,
		SLJIT_IMM, static_cast<u8>(ObjType::Table));
	emitGcWriteBarrier(compiler, SLJIT_R0, SLJIT_R2, SLJIT_R3);
	auto* done = sljit_emit_label(compiler);
	sljit_set_label(unattached, done);
	sljit_set_label(otherRecord, done);
}
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
		emitTableSlotOffset(SLJIT_R2, word);
		const auto address = word ? wordOffset : tagOffset;
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), address, SLJIT_R2, 0);
		emitRamWordWriteWatch(exit, SLJIT_MEM1(SLJIT_SP), address, SLJIT_R2, SLJIT_R3);
	}
	if (arraySlot) {
		sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), receiver,
			SLJIT_IMM, static_cast<u32>(TableHeader::Length));
		sljit_emit_op2(m_compiler, SLJIT_AND32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), slot, SLJIT_R2, 0);
		emitRamWordWriteWatch(exit, SLJIT_MEM1(SLJIT_SP), slot, SLJIT_R2, SLJIT_R3);
	}
}

void NativeBlockCompiler::emitTableSlotTransfer(bool load, int value) {
	if (load) {
		emitTableSlotLoad(SLJIT_R2, true);
		emitTableSlotLoad(SLJIT_R3, false);
		return;
	}
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), slot, SLJIT_R1, 0);
	emitRawLoad(value, SLJIT_R2, SLJIT_R3);
	for (bool word : {true, false}) {
		sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), word ? wordOffset : tagOffset);
		NativeBlockAbi::emitRamAddress(m_compiler, SLJIT_R1, SLJIT_R1);
		sljit_emit_op1(m_compiler, word ? SLJIT_MOV32 : SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R1), 0,
			word ? SLJIT_R2 : SLJIT_R3, 0);
	}
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), slot);
}

void NativeBlockCompiler::emitArraySlot(bool load, int value, NativeBlockExitSite& exit) {
	fault(sljit_emit_cmp(m_compiler, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Array)), exit,
		  m_cache.state());
	if (load) {
		emitTableSlotTransfer(true, value);
		auto* own = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_IMM,
								   static_cast<u8>(ValueTag::Nil));
		fault(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Metatable), SLJIT_IMM, 0), exit,
			  m_cache.state());
		sljit_set_label(own, sljit_emit_label(m_compiler));
		return;
	}

	emitTableWriteWatch(exit, true);
	emitTableSlotTransfer(false, value);
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
	emitTableWriteBarrier(m_compiler);
}

// Hash keys start after the array; hash values start after all hash keys.
void NativeBlockCompiler::emitStringSlot(bool load, int value, NativeBlockExitSite& exit) {
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), keyWord, SLJIT_R3, 0);
	const sljit_sw prediction = reinterpret_cast<sljit_sw>(&exit.tableCacheSlot);
	std::array<sljit_jump*, 5> misses{};
	size_t n = 0;
	sljit_emit_op1(m_compiler, SLJIT_MOV_S32, SLJIT_R1, 0, SLJIT_MEM0(), prediction);
	misses[n++] = sljit_emit_cmp(m_compiler, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Hash));
	sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Array));
	emitTableSlotLoad(SLJIT_R2, false);
	misses[n++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM,
								 static_cast<u8>(ValueTag::String));
	emitTableSlotLoad(SLJIT_R2, true);
	misses[n++] =
		sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), keyWord);
	sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Hash));
	emitTableSlotLoad(SLJIT_R2, false);
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
		emitTableWriteWatch(exit, false);
		emitTableSlotTransfer(false, value);
		emitTableWriteBarrier(m_compiler);
	} else {
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_R2, 0);
		emitTableSlotLoad(SLJIT_R2, true);
	}
	auto* hit = sljit_emit_jump(m_compiler, SLJIT_JUMP);
	auto* miss = sljit_emit_label(m_compiler);
	for (size_t i = 0; i < n; ++i)
		sljit_set_label(misses[i], miss);

	// The read leaf neither allocates nor writes guest RAM.
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, heap));
	if (load) {
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), request + offsetof(TableReadRequest, indexKey),
			SLJIT_IMM, m_bindings.indexKey);
		sljit_get_local_base(m_compiler, SLJIT_R1, 0, request);
		sljit_get_local_base(m_compiler, SLJIT_R2, 0, result);
		m_cache.spillCall(false, 0);
		sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS3V(P, P, P), SLJIT_IMM,
			SLJIT_FUNC_ADDR(&TableRecord::loadStringIndexInNative));
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
		emitValueTransportStore(m_compiler, SLJIT_SP, transport, SLJIT_R1, SLJIT_R2);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), receiver);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), keyWord);
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
	emitRawLoad(base, SLJIT_R0, SLJIT_R1);
	if (op == OpCode::SELF)
		emitRawStore(instruction.a + 1, SLJIT_R0, SLJIT_R1);
	fault(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM,
						 static_cast<u8>(ValueTag::Table)),
		  exit, m_cache.state());
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), receiver, SLJIT_R0, 0);
	sljit_emit_op2(m_compiler, SLJIT_AND, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	fault(sljit_emit_cmp(m_compiler, SLJIT_GREATER, SLJIT_R0, 0, SLJIT_IMM,
		MAIN_RAM_SIZE - Table::HEADER_BYTES), exit, m_cache.state());
	NativeBlockAbi::emitRamAddress(m_compiler, SLJIT_R0, SLJIT_R0);
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
