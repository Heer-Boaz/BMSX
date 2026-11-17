#pragma once

#include "machine/cpu/value.h"
#include "sljitLir.h"

namespace bmsx {

// Instruction sequences through which generated code inspects guest Values.
// value.h owns the layout; these sequences own its use by the block compiler
// and the shared gates. Registers are explicit and the 64-bit/32-bit host
// split stays inside each sequence (cf. JavaScriptCore's AssemblyHelpers).

// target := header of the Value stored at [base + offset].
inline void emitValueHeaderLoad(sljit_compiler* compiler, sljit_s32 target, sljit_s32 base, sljit_sw offset) {
	sljit_emit_op1(compiler, SLJIT_MOV_U16, target, 0, SLJIT_MEM1(base), offset + VALUE_HEADER_BYTE_OFFSET);
}

// A single register copied from a Value's float register holds its high word
// on a 32-bit host and the whole Value on a 64-bit host.
inline constexpr sljit_sw NATIVE_VALUE_HEADER_WORD_SHIFT = sizeof(sljit_sw) * 8u - (64u - VALUE_HEADER_SHIFT);

// target := header of the Value held in the floating-point register source.
inline void emitValueHeaderFromFloat(sljit_compiler* compiler, sljit_s32 target, sljit_s32 source) {
	sljit_emit_fcopy(compiler, SLJIT_COPY_FROM_F64, source, target);
	sljit_emit_op2(compiler, SLJIT_LSHR, target, 0, target, 0, SLJIT_IMM, NATIVE_VALUE_HEADER_WORD_SHIFT);
}

// Both headers of a Value pair. Both copies precede both shifts, so each
// float-to-core transfer has an independent instruction before its use.
inline void emitValueHeadersFromFloats(sljit_compiler* compiler, sljit_s32 first, sljit_s32 firstSource,
	sljit_s32 second, sljit_s32 secondSource) {
	sljit_emit_fcopy(compiler, SLJIT_COPY_FROM_F64, firstSource, first);
	sljit_emit_fcopy(compiler, SLJIT_COPY_FROM_F64, secondSource, second);
	sljit_emit_op2(compiler, SLJIT_LSHR, first, 0, first, 0, SLJIT_IMM, NATIVE_VALUE_HEADER_WORD_SHIFT);
	sljit_emit_op2(compiler, SLJIT_LSHR, second, 0, second, 0, SLJIT_IMM, NATIVE_VALUE_HEADER_WORD_SHIFT);
}

// target := object pointer or StringId payload of the Value at [base + offset].
inline void emitValuePayloadLoad(sljit_compiler* compiler, sljit_s32 target, sljit_s32 base, sljit_sw offset) {
#if defined(SLJIT_64BIT_ARCHITECTURE)
	sljit_emit_op1(compiler, SLJIT_MOV, target, 0, SLJIT_MEM1(base), offset);
	sljit_emit_op2(compiler, SLJIT_AND, target, 0, target, 0, SLJIT_IMM, VALUE_PAYLOAD_MASK);
#else
	sljit_emit_op1(compiler, SLJIT_MOV, target, 0, SLJIT_MEM1(base), offset + VALUE_LOW_WORD_BYTE_OFFSET);
#endif
}

// target := a word whose low 32 bits are the Value's low payload word. A
// 32-bit host also writes the high word to scratch.
inline void emitValueLowWordFromFloat(sljit_compiler* compiler, sljit_s32 target, sljit_s32 source, [[maybe_unused]] sljit_s32 scratch) {
#if defined(SLJIT_64BIT_ARCHITECTURE)
	sljit_emit_fcopy(compiler, SLJIT_COPY_FROM_F64, source, target);
#else
	sljit_emit_fcopy(compiler, SLJIT_COPY_FROM_F64, source, SLJIT_REG_PAIR(scratch, target));
#endif
}

// target := object pointer or StringId payload of the Value in source.
inline void emitValuePayloadFromFloat(sljit_compiler* compiler, sljit_s32 target, sljit_s32 source, sljit_s32 scratch) {
	emitValueLowWordFromFloat(compiler, target, source, scratch);
#if defined(SLJIT_64BIT_ARCHITECTURE)
	sljit_emit_op2(compiler, SLJIT_AND, target, 0, target, 0, SLJIT_IMM, VALUE_PAYLOAD_MASK);
#endif
}

// Both payloads of a Value pair, with the same copy-before-use ordering.
inline void emitValuePayloadsFromFloats(sljit_compiler* compiler, sljit_s32 first, sljit_s32 firstSource,
	sljit_s32 second, sljit_s32 secondSource, sljit_s32 scratch) {
	emitValueLowWordFromFloat(compiler, first, firstSource, scratch);
	emitValueLowWordFromFloat(compiler, second, secondSource, scratch);
#if defined(SLJIT_64BIT_ARCHITECTURE)
	sljit_emit_op2(compiler, SLJIT_AND, first, 0, first, 0, SLJIT_IMM, VALUE_PAYLOAD_MASK);
	sljit_emit_op2(compiler, SLJIT_AND, second, 0, second, 0, SLJIT_IMM, VALUE_PAYLOAD_MASK);
#endif
}

// Which non-ordinary header jumps from emitNumberHeaderSplit; the other falls through.
enum class NumberHeaderJump { NumericNaN, TaggedKind };

struct NumberHeaderJumps {
	sljit_jump* ordinaryNumber;
	sljit_jump* selected;
};

// Splits a Value header into an ordinary (non-NaN) Number, the canonical
// numeric NaN and a tagged kind. scratch is clobbered; tagBits receives the
// encoded tag bits and may be header itself.
inline NumberHeaderJumps emitNumberHeaderSplit(sljit_compiler* compiler, sljit_s32 header, sljit_s32 scratch,
	sljit_s32 tagBits, NumberHeaderJump jump) {
	sljit_emit_op2(compiler, SLJIT_AND, scratch, 0, header, 0, SLJIT_IMM, VALUE_NAN_HEADER_BITS);
	auto* ordinaryNumber = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL, scratch, 0, SLJIT_IMM, VALUE_NAN_HEADER_BITS);
	sljit_emit_op2(compiler, SLJIT_AND, tagBits, 0, header, 0, SLJIT_IMM, VALUE_TAG_HEADER_BITS);
	auto* selected = sljit_emit_cmp(compiler, jump == NumberHeaderJump::NumericNaN ? SLJIT_EQUAL : SLJIT_NOT_EQUAL,
		tagBits, 0, SLJIT_IMM, 0);
	return {ordinaryNumber, selected};
}

} // namespace bmsx
