#include "machine/cpu/native_table_index.h"

#include <new>
#include <vector>
#include "common/scope_exit.h"
#include "machine/cpu/native_block.h"
#include "machine/cpu/native_value_emit.h"
#include "machine/cpu/table.h"
#if defined(BMSX_NATIVE_PERF_MAP)
#include "machine/cpu/native_perf_map.h"
#endif

namespace bmsx {
namespace {

// One code body per process, not a hash probe duplicated at each call site.
// S0..S3 keep the original leaf arguments; S4 is the physical RAM base.
// R1: StringId, R2: hash capacity, R3: node, R4/R5: key word/tag planes.
// R6 is the search bound until the probe ends, then the result tag.
class StringIndexEmitter {
public:
	explicit StringIndexEmitter(sljit_compiler* compiler) : c(compiler) {}
	void emit();
private:
	void header();
	void body();
	void ramLoad(sljit_s32 destination, sljit_s32 offset, bool word);
	void keyWord();
	void keyTag();
	void value();
	void predicted(sljit_sw hint, ValueTag required);
	void decline(sljit_jump* jump) { cold.push_back(jump); }

	sljit_compiler* c;
	std::vector<sljit_jump*> cold;
};

void StringIndexEmitter::header() {
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	// Cross-mirror headers use the semantic owner's individually mirrored reads.
	decline(sljit_emit_cmp(c, SLJIT_GREATER | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM,
		MAIN_RAM_SIZE - TableRecord::HEADER_BYTES));
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_S4, 0);
}

void StringIndexEmitter::body() {
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R4, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Storage));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R6, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Array));
	sljit_emit_op2(c, SLJIT_MUL32, SLJIT_R5, 0, SLJIT_R2, 0, SLJIT_IMM, 3);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R5, 0, SLJIT_R5, 0, SLJIT_R6, 0);
	sljit_emit_op2(c, SLJIT_SHL32, SLJIT_R5, 0, SLJIT_R5, 0, SLJIT_IMM, 2);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R5, 0, SLJIT_R5, 0, SLJIT_R4, 0);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R5, 0, SLJIT_R5, 0, SLJIT_R6, 0);
	sljit_emit_op2(c, SLJIT_SHL32, SLJIT_R6, 0, SLJIT_R6, 0, SLJIT_IMM, 2);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R4, 0, SLJIT_R4, 0, SLJIT_R6, 0);
}

void StringIndexEmitter::ramLoad(sljit_s32 destination, sljit_s32 offset, bool word) {
	sljit_emit_op2(c, SLJIT_AND32, destination, 0, offset, 0, SLJIT_IMM,
		word ? RAM_RECORD_WORD_MASK : MAIN_RAM_SIZE - 1u);
	sljit_emit_op2(c, SLJIT_ADD, destination, 0, destination, 0, SLJIT_S4, 0);
	sljit_emit_op1(c, word ? SLJIT_MOV32 : SLJIT_MOV_U8, destination, 0, SLJIT_MEM1(destination), 0);
}

void StringIndexEmitter::keyTag() {
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R5, 0, SLJIT_R3, 0);
	ramLoad(SLJIT_R0, SLJIT_R0, false);
}

void StringIndexEmitter::keyWord() {
	sljit_emit_op2(c, SLJIT_SHL32, SLJIT_R0, 0, SLJIT_R3, 0, SLJIT_IMM, 2);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_R4, 0);
	ramLoad(SLJIT_R0, SLJIT_R0, true);
}

void StringIndexEmitter::value() {
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R3, 0, SLJIT_R2, 0);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R6, 0, SLJIT_R0, 0, SLJIT_R5, 0);
	ramLoad(SLJIT_R6, SLJIT_R6, false);
	sljit_emit_op2(c, SLJIT_SHL32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 2);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_R4, 0);
	ramLoad(SLJIT_R0, SLJIT_R0, true);
}

void StringIndexEmitter::predicted(sljit_sw hint, ValueTag required) {
	header();
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Hash));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_S3), hint);
	decline(sljit_emit_cmp(c, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_R2, 0));
	body();
	keyTag();
	decline(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, static_cast<u8>(ValueTag::String)));
	keyWord();
	decline(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_R1, 0));
	value();
	decline(sljit_emit_cmp(c, (required == ValueTag::Nil ? SLJIT_EQUAL : SLJIT_NOT_EQUAL) | SLJIT_32,
		SLJIT_R6, 0, SLJIT_IMM, static_cast<u8>(required)));
}

void StringIndexEmitter::emit() {
	constexpr auto args = SLJIT_ARGS4V(P, P, P, P);
	sljit_emit_enter(c, 0, args, 7, 5, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_S4, 0, SLJIT_MEM1(SLJIT_S0), offsetof(NativeBlockRunState, ram));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_S1), offsetof(TableReadRequest, address));
	header();
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Hash));
	auto* noHash = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 0);
	body();
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_S1), offsetof(TableReadRequest, keyWord));
	sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R3, 0, SLJIT_R2, 0, SLJIT_IMM, 1);
	sljit_emit_op2(c, SLJIT_MUL32, SLJIT_R0, 0, SLJIT_R1, 0, SLJIT_IMM, STRING_VALUE_HASH_MULTIPLIER);
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R0, 0);
	auto* negativeHome = sljit_emit_cmp(c, SLJIT_SIG_LESS | SLJIT_32, SLJIT_R3, 0, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R6, 0, SLJIT_R2, 0);
	auto* probe = sljit_emit_label(c);
	keyTag();
	auto* notString = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, static_cast<u8>(ValueTag::String));
	keyWord();
	auto* found = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_R1, 0);
	sljit_set_label(notString, sljit_emit_label(c));
	sljit_emit_op2(c, SLJIT_SUB32 | SLJIT_SET_Z, SLJIT_R6, 0, SLJIT_R6, 0, SLJIT_IMM, 1);
	auto* exhausted = sljit_emit_jump(c, SLJIT_EQUAL);
	// Links are the word plane immediately following the hash values.
	sljit_emit_op2(c, SLJIT_SHL32, SLJIT_R0, 0, SLJIT_R2, 0, SLJIT_IMM, 1);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_R3, 0);
	sljit_emit_op2(c, SLJIT_SHL32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 2);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_R4, 0);
	ramLoad(SLJIT_R3, SLJIT_R0, true);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_SIG_GREATER_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_IMM, 0), probe);
	auto* noMatch = sljit_emit_jump(c, SLJIT_JUMP);
	sljit_set_label(found, sljit_emit_label(c));
	value();
	auto* nilValue = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R6, 0, SLJIT_IMM, static_cast<u8>(ValueTag::Nil));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S3), offsetof(TableStringReadCache, receiverSlot), SLJIT_R3, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, 0);
	auto* own = sljit_emit_jump(c, SLJIT_JUMP);

	auto* absent = sljit_emit_label(c);
	for (auto* edge : {noHash, negativeHome, exhausted, noMatch, nilValue}) sljit_set_label(edge, absent);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_S1), offsetof(TableReadRequest, address));
	header();
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(TableHeader::Metatable));
	auto* noMeta = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0);
	decline(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_MEM1(SLJIT_S3),
		offsetof(TableStringReadCache, holderDepth), SLJIT_IMM, 1));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_S1), offsetof(TableReadRequest, indexKey));
	predicted(offsetof(TableStringReadCache, indexSlots), ValueTag::Table);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_S1), offsetof(TableReadRequest, keyWord));
	predicted(offsetof(TableStringReadCache, holderSlot), ValueTag::Nil);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, 1);
	auto* inherited = sljit_emit_jump(c, SLJIT_JUMP);

	sljit_set_label(noMeta, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_IMM, -1);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R6, 0, SLJIT_IMM, static_cast<u8>(ValueTag::Nil));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, 0);
	auto* resolved = sljit_emit_label(c);
	sljit_set_label(own, resolved);
	sljit_set_label(inherited, resolved);
	emitValueTransportStore(c, SLJIT_S2, offsetof(TableLookupResult, value), SLJIT_R0, SLJIT_R6);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S2), offsetof(TableLookupResult, slot), SLJIT_R3, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S2), offsetof(TableLookupResult, extraVisits), SLJIT_R1, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S2), offsetof(TableLookupResult, status),
		SLJIT_IMM, static_cast<u32>(TableLookupStatus::Resolved));
	sljit_emit_return_void(c);

	auto* fallback = sljit_emit_label(c);
	for (auto* edge : cold) sljit_set_label(edge, fallback);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_S0), offsetof(NativeBlockRunState, heap));
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_S1, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_S2, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_S3, 0);
	sljit_emit_icall(c, SLJIT_CALL | SLJIT_CALL_RETURN, args, SLJIT_IMM, SLJIT_FUNC_ADDR(&TableRecord::loadStringIndexInNative));
}

class NativeStringIndex {
public:
	NativeStringIndex() {
		auto* c = sljit_create_compiler(nullptr);
		if (!c) throw std::bad_alloc();
		ScopeExit release([&] { sljit_free_compiler(c); });
		StringIndexEmitter(c).emit();
		code = sljit_generate_code(c, 0, nullptr);
		if (!code) throw std::bad_alloc();
#if defined(BMSX_NATIVE_PERF_MAP)
		const auto free = [](void* entry) { sljit_free_code(entry, nullptr); };
		std::unique_ptr<void, decltype(free)> owner(code, free);
		auto begin = static_cast<std::uintptr_t>(SLJIT_FUNC_ADDR(code));
#if defined(SLJIT_CONFIG_ARM_THUMB2) && SLJIT_CONFIG_ARM_THUMB2
		begin &= ~std::uintptr_t{1};
#endif
		const NativePerfMapRange range{begin, sljit_get_generated_code_size(c), "bmsx_native_fixed_string_lookup"};
		recordNativePerfMap(std::span(&range, 1));
		owner.release();
#endif
	}
	~NativeStringIndex() { sljit_free_code(code, nullptr); }
	void* code;
};
} // namespace

void* nativeFixedStringLookup() {
	static const NativeStringIndex leaf;
	return leaf.code;
}

} // namespace bmsx
