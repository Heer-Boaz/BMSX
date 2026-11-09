#include "machine/cpu/native_block_compiler.h"

#include <bit>

#include "machine/cpu/execution_image.h"
#include "machine/memory/memory.h"
#include "spec/blua32/memory_access_kind.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {

void NativeBlockCompiler::emitMemory(const DecodedInstruction& instruction, const NativeBlockExitSite* exit) {
	const bool load = exit->exit == NativeBlockExit::ReadMemory;
	const auto kind = static_cast<MemoryAccessKind>(instruction.c);
	const u32 width = kind == MemoryAccessKind::U8 ? 1u : kind == MemoryAccessKind::U16LE ? 2u
		: kind == MemoryAccessKind::F64LE ? 8u : 4u;
	SlowPath slow;
	slow.exit = exit;
	convertWord(instruction.b);
	if (exit->displaced) {
		sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R0, 0,
			SLJIT_IMM, static_cast<u32>(instruction.disp) << 2u);
	}
	const auto alignment = MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[static_cast<size_t>(kind)];
	if (alignment != 0u) {
		sljit_emit_op2(m_compiler, SLJIT_AND32, SLJIT_R1, 0, SLJIT_R0, 0, SLJIT_IMM, alignment);
		slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0);
	}
	sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_S2, 0, SLJIT_R0, 0, SLJIT_IMM, RAM_BASE);
	// The decoded IO aperture overlays the start of RAM. The rest of the fixed
	// allocation has no device side effects and remains stable across restoration.
	slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_LESS | SLJIT_32, SLJIT_S2, 0,
		SLJIT_IMM, IO_SLOT_COUNT * IO_WORD_SIZE);
	slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_GREATER | SLJIT_32, SLJIT_S2, 0,
		SLJIT_IMM, static_cast<sljit_sw>(m_memory.ramByteCount() - width));
	// SLJIT's 32-bit results are not host pointer-sized values. Promote the
	// admitted offset before using it in an address, including on 64-bit ports.
	sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_S2, 0, SLJIT_S2, 0);
	if (!load) {
		// Leave before writing a watched page. The ordinary owner consumes exact
		// word masks and may free this block only after its native frame returned.
		sljit_emit_op2(m_compiler, SLJIT_LSHR, SLJIT_R1, 0, SLJIT_S2, 0,
			SLJIT_IMM, MAPPED_PAGE_BYTE_SHIFT);
		sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R1),
			reinterpret_cast<sljit_sw>(m_memory.ramWriteWatches().groupData()));
		slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R1, 0, SLJIT_IMM, 0);
		if (width == 8u) {
			sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R1, 0, SLJIT_S2, 0, SLJIT_IMM, 4);
			sljit_emit_op2(m_compiler, SLJIT_LSHR, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, MAPPED_PAGE_BYTE_SHIFT);
			sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R1),
				reinterpret_cast<sljit_sw>(m_memory.ramWriteWatches().groupData()));
			slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R1, 0, SLJIT_IMM, 0);
		}
	}
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_S2, 0, SLJIT_S2, 0,
		SLJIT_IMM, reinterpret_cast<sljit_sw>(m_memory.ramData()));
	if (kind == MemoryAccessKind::F32LE || kind == MemoryAccessKind::F64LE) {
		if (!load) {
			loadOperand(instruction.a, SLJIT_FR0);
			// decodeNumber preserves numeric bits but replaces tagged Values by
			// the numeric NaN. Do not mistake a signalling NaN for a guest tag.
			constexpr sljit_sw headerOffset = std::endian::native == std::endian::little ? 6 : 0;
			sljit_emit_op1(m_compiler, SLJIT_MOV_U16, SLJIT_R0, 0,
				SLJIT_MEM1(SLJIT_S0), instruction.a * sizeof(Value) + headerOffset);
			sljit_emit_op2(m_compiler, SLJIT_AND, SLJIT_R1, 0, SLJIT_R0, 0, SLJIT_IMM, VALUE_QNAN_MASK >> 48u);
			auto* number = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R1, 0, SLJIT_IMM, VALUE_QNAN_MASK >> 48u);
			sljit_emit_op2(m_compiler, SLJIT_AND, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, VALUE_ENCODED_TAG_MASK >> 48u);
			auto* numericNaN = sljit_emit_cmp(m_compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_IMM, 0);
			sljit_emit_fset64(m_compiler, SLJIT_FR0, asNumber(VALUE_QNAN_MASK));
			auto* decoded = sljit_emit_label(m_compiler);
			sljit_set_label(number, decoded);
			sljit_set_label(numericNaN, decoded);
			if (width == 4u) sljit_emit_fop1(m_compiler, SLJIT_CONV_F32_FROM_F64, SLJIT_FR0, 0, SLJIT_FR0, 0);
		}
		if constexpr (std::endian::native == std::endian::little) {
			// F64LE is only four-byte aligned, including at a page's last word.
			if (width == 8u) sljit_emit_fmem(m_compiler, SLJIT_MOV_F64 | SLJIT_MEM_ALIGNED_32
				| (load ? 0 : SLJIT_MEM_STORE), SLJIT_FR0, SLJIT_MEM1(SLJIT_S2), 0);
			else if (load) sljit_emit_fop1(m_compiler, SLJIT_MOV_F32, SLJIT_FR0, 0, SLJIT_MEM1(SLJIT_S2), 0);
			else sljit_emit_fop1(m_compiler, SLJIT_MOV_F32, SLJIT_MEM1(SLJIT_S2), 0, SLJIT_FR0, 0);
		} else if (width == 4u) {
			if (load) {
				sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_S2), 0);
				sljit_emit_op1(m_compiler, SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
				sljit_emit_fcopy(m_compiler, SLJIT_COPY32_TO_F32, SLJIT_FR0, SLJIT_R0);
			} else {
				sljit_emit_fcopy(m_compiler, SLJIT_COPY32_FROM_F32, SLJIT_FR0, SLJIT_R0);
				sljit_emit_op1(m_compiler, SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
				sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S2), 0, SLJIT_R0, 0);
			}
		} else {
#if defined(SLJIT_64BIT_ARCHITECTURE)
			if (load) {
				sljit_emit_mem(m_compiler, SLJIT_MOV | SLJIT_MEM_ALIGNED_32, SLJIT_R0, SLJIT_MEM1(SLJIT_S2), 0);
				sljit_emit_op1(m_compiler, SLJIT_REV, SLJIT_R0, 0, SLJIT_R0, 0);
				sljit_emit_fcopy(m_compiler, SLJIT_COPY_TO_F64, SLJIT_FR0, SLJIT_R0);
			} else {
				sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, SLJIT_FR0, SLJIT_R0);
				sljit_emit_op1(m_compiler, SLJIT_REV, SLJIT_R0, 0, SLJIT_R0, 0);
				sljit_emit_mem(m_compiler, SLJIT_MOV | SLJIT_MEM_ALIGNED_32 | SLJIT_MEM_STORE,
					SLJIT_R0, SLJIT_MEM1(SLJIT_S2), 0);
			}
#else
			if (load) {
				sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_S2), 4);
				sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_S2), 0);
			} else sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, SLJIT_FR0, SLJIT_REG_PAIR(SLJIT_R0, SLJIT_R1));
			sljit_emit_op1(m_compiler, SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
			sljit_emit_op1(m_compiler, SLJIT_REV32, SLJIT_R1, 0, SLJIT_R1, 0);
			if (load) sljit_emit_fcopy(m_compiler, SLJIT_COPY_TO_F64, SLJIT_FR0, SLJIT_REG_PAIR(SLJIT_R0, SLJIT_R1));
			else {
				sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S2), 4, SLJIT_R0, 0);
				sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S2), 0, SLJIT_R1, 0);
			}
#endif
		}
		if (load) {
			if (width == 4u) sljit_emit_fop1(m_compiler, SLJIT_CONV_F64_FROM_F32, SLJIT_FR0, 0, SLJIT_FR0, 0);
			canonicalizeNumber();
		}
	} else {
		const sljit_s32 move = width == 1u ? SLJIT_MOV32_U8 : width == 2u ? SLJIT_MOV32_U16 : SLJIT_MOV32;
		if (load) sljit_emit_op1(m_compiler, move, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_S2), 0);
		else convertWord(instruction.a);
		if constexpr (std::endian::native == std::endian::big) {
			if (width > 1u) sljit_emit_op1(m_compiler, width == 2u ? SLJIT_REV32_U16 : SLJIT_REV32,
				SLJIT_R0, 0, SLJIT_R0, 0);
		}
		if (load) sljit_emit_fop1(m_compiler, SLJIT_CONV_F64_FROM_U32, SLJIT_FR0, 0, SLJIT_R0, 0);
		else sljit_emit_op1(m_compiler, move, SLJIT_MEM1(SLJIT_S2), 0, SLJIT_R0, 0);
	}
	m_slowPaths.push_back(slow);
}

} // namespace bmsx
