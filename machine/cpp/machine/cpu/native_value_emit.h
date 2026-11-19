#pragma once

#include "machine/cpu/value.h"
#include "machine/cpu/gc_heap.h"
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
// The position in this attachment array comes from an aligned RAM offset,
// never from an object identity or host pointer packed into a Value.
inline void emitPhysicalRecordPointer(sljit_compiler* compiler, sljit_s32 offset, sljit_s32 object, sljit_s32 heap) {
	sljit_emit_op1(compiler, SLJIT_MOV_P, heap, 0, SLJIT_MEM1(heap), GcHeap::nativePhysicalRecordsOffset());
	if constexpr (sizeof(void*) == 4) {
		sljit_emit_op2(compiler, SLJIT_LSHR, object, 0, offset, 0, SLJIT_IMM, 1);
		sljit_emit_op1(compiler, SLJIT_MOV_P, object, 0, SLJIT_MEM2(heap, object), 0);
	} else {
		sljit_emit_op1(compiler, SLJIT_MOV_P, object, 0, SLJIT_MEM2(heap, offset), 0);
	}
}

// The collector's backward barrier is nonallocating. Mirror the header's
// exact gray-again transition; no GC step can run between this store and it.
inline void emitGcWriteBarrier(sljit_compiler* compiler, sljit_s32 object, sljit_s32 scratch, sljit_s32 link) {
	sljit_emit_op1(compiler, SLJIT_MOV_P, scratch, 0, SLJIT_MEM1(object), offsetof(GCObject, gcRecord));
	sljit_emit_op1(compiler, SLJIT_MOV_U8, link, 0, SLJIT_MEM1(scratch), GC_COLOR_OFFSET);
	auto* scanned = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, link, 0, SLJIT_IMM, 3);
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_MEM1(scratch), GC_COLOR_OFFSET, SLJIT_IMM, 2);
	sljit_emit_op1(compiler, SLJIT_MOV_P, scratch, 0, SLJIT_MEM1(object), offsetof(GCObject, grayHead));
	sljit_emit_op1(compiler, SLJIT_MOV_P, link, 0, SLJIT_MEM1(scratch), 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(object), offsetof(GCObject, grayNext), link, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(scratch), 0, object, 0);
	sljit_set_label(scanned, sljit_emit_label(compiler));
}
} // namespace bmsx
