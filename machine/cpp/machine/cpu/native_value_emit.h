#pragma once

#include "machine/cpu/value.h"
#include "sljitLir.h"

namespace bmsx {
// Complete Values are temporary C++ helper transports only. The generated
// register/cache banks and guest storage use their separate payload and tag.
inline void emitValueTransportStore(
	sljit_compiler* compiler, sljit_s32 base, sljit_sw offset, sljit_s32 word, sljit_s32 tag) {
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(base), offset + VALUE_LOW_WORD_BYTE_OFFSET, word, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(base), offset + VALUE_HEADER_BYTE_OFFSET, tag, 0);
}
inline void emitValueTransportLoad(
	sljit_compiler* compiler, sljit_s32 base, sljit_sw offset, sljit_s32 word, sljit_s32 tag) {
	sljit_emit_op1(compiler, SLJIT_MOV32, word, 0, SLJIT_MEM1(base), offset + VALUE_LOW_WORD_BYTE_OFFSET);
	sljit_emit_op1(compiler, SLJIT_MOV32, tag, 0, SLJIT_MEM1(base), offset + VALUE_HEADER_BYTE_OFFSET);
}
} // namespace bmsx
