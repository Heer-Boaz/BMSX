#include "machine/cpu/native_block_compiler.h"

#include <bit>

#include "common/endian.h"
#include "machine/cpu/execution_image.h"
#include "machine/memory/memory.h"
#include "spec/blua32/memory_access_kind.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {

namespace {
// Called only after the complete span is admitted as unwatched, backed RAM.
// One pure native call consumes the Value bank without per-word bus dispatch.
void storeRamRegisterWords(u8* destination, const Value* source, u32 count) noexcept {
	for (u32 word = 0; word < count; ++word) writeLE32(destination + word * 4u, toU32(source[word]));
}
}

void NativeBlockCompiler::emitWordStores(const DecodedInstruction& instruction, NativeBlockExitSite* exit) {
	convertWord(instruction.b);
	SlowPath slow; slow.exit = exit; slow.registers = registerSnapshot();
	if (instruction.op == static_cast<u8>(OpCode::STORE_MEM_WORDS_D)) sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R0, 0,
		SLJIT_IMM, static_cast<u32>(instruction.disp) << 2u);
	sljit_emit_op2(m_compiler, SLJIT_AND32, SLJIT_R1, 0, SLJIT_R0, 0, SLJIT_IMM, 3);
	slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0);
	const u32 count = instruction.c, width = count * 4u;
	if (width > m_bindings.ramBytes) {
		slow.jumps[slow.count++] = sljit_emit_jump(m_compiler, SLJIT_JUMP);
		m_slowPaths.push_back(slow);
		return;
	}
	if (count != 0u) {
		sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_S2, 0, SLJIT_R0, 0, SLJIT_IMM, RAM_BASE);
		slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_LESS | SLJIT_32, SLJIT_S2, 0,
			SLJIT_IMM, IO_SLOT_COUNT * IO_WORD_SIZE);
		slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_GREATER | SLJIT_32, SLJIT_S2, 0,
			SLJIT_IMM, static_cast<sljit_sw>(m_bindings.ramBytes - width));
		sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_S2, 0, SLJIT_S2, 0);
		// Inspect every touched watch group before the first store, including
		// middle pages. A watched span leaves the native frame before acting.
		sljit_emit_op2(m_compiler, SLJIT_LSHR, SLJIT_R1, 0, SLJIT_S2, 0, SLJIT_IMM, MAPPED_PAGE_BYTE_SHIFT);
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R2, 0, SLJIT_S2, 0, SLJIT_IMM, width - 4u);
		sljit_emit_op2(m_compiler, SLJIT_LSHR, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, MAPPED_PAGE_BYTE_SHIFT);
		auto* watch = sljit_emit_label(m_compiler);
		sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R1),
			reinterpret_cast<sljit_sw>(m_bindings.ramWriteGroups));
		slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R3, 0, SLJIT_IMM, 0);
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 1);
		sljit_set_label(sljit_emit_cmp(m_compiler, SLJIT_LESS_EQUAL, SLJIT_R1, 0, SLJIT_R2, 0), watch);
		// Only the source range is observed by this non-allocating call. Keep
		// other definitions local, and retain clean cached sources afterwards.
		for (int slot = 0; slot < m_registerCount; ++slot) {
			auto& entry = m_registers[slot];
			if (!entry.dirty || entry.guest < instruction.a || entry.guest >= instruction.a + instruction.c) continue;
			sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_S0), entry.guest * sizeof(Value), cachedFloatRegister(slot), 0);
			entry.dirty = false;
		}
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R0, 0, SLJIT_S2, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(m_bindings.ram));
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R1, 0, SLJIT_S0, 0, SLJIT_IMM, instruction.a * sizeof(Value));
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_IMM, count);
		emitCallSpills(false);
		sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS3V(P, P, 32), SLJIT_IMM, SLJIT_FUNC_ADDR(&storeRamRegisterWords));
		emitCallSpills(true);
	}
	m_slowPaths.push_back(slow);
}

void NativeBlockCompiler::emitMemory(const DecodedInstruction& instruction, NativeBlockExitSite* exit) {
	const bool load = exit->exit == NativeBlockExit::ReadMemory;
	const auto kind = static_cast<MemoryAccessKind>(instruction.c);
	const u32 width = kind == MemoryAccessKind::U8 ? 1u : kind == MemoryAccessKind::U16LE ? 2u
		: kind == MemoryAccessKind::F64LE ? 8u : 4u;
	SlowPath slow;
	slow.exit = exit;
	ReadMapping* mapping = nullptr;
	convertWord(instruction.b);
	slow.registers = registerSnapshot();
	if (instruction.op == static_cast<u8>(OpCode::LOAD_MEM_D) || instruction.op == static_cast<u8>(OpCode::STORE_MEM_D)) {
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
	auto* belowRam = sljit_emit_cmp(m_compiler, SLJIT_LESS | SLJIT_32, SLJIT_S2, 0,
		SLJIT_IMM, IO_SLOT_COUNT * IO_WORD_SIZE);
	auto* aboveRam = sljit_emit_cmp(m_compiler, SLJIT_GREATER | SLJIT_32, SLJIT_S2, 0,
		SLJIT_IMM, static_cast<sljit_sw>(m_bindings.ramBytes - width));
	if (load) {
		mapping = &m_readMappings.emplace_back(ReadMapping{{belowRam, aboveRam}, exit, nullptr, width, slow.registers});
	} else {
		slow.jumps[slow.count++] = belowRam;
		slow.jumps[slow.count++] = aboveRam;
	}
	// SLJIT's 32-bit results are not host pointer-sized values. Promote the
	// admitted offset before using it in an address, including on 64-bit ports.
	sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_S2, 0, SLJIT_S2, 0);
	if (!load) {
		// Leave before writing a watched page. The ordinary owner consumes exact
		// word masks and may free this block only after its native frame returned.
		sljit_emit_op2(m_compiler, SLJIT_LSHR, SLJIT_R1, 0, SLJIT_S2, 0,
			SLJIT_IMM, MAPPED_PAGE_BYTE_SHIFT);
		sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R1),
			reinterpret_cast<sljit_sw>(m_bindings.ramWriteGroups));
		slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R1, 0, SLJIT_IMM, 0);
		if (width == 8u) {
			sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R1, 0, SLJIT_S2, 0, SLJIT_IMM, 4);
			sljit_emit_op2(m_compiler, SLJIT_LSHR, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, MAPPED_PAGE_BYTE_SHIFT);
			sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R1),
				reinterpret_cast<sljit_sw>(m_bindings.ramWriteGroups));
			slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R1, 0, SLJIT_IMM, 0);
		}
	}
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_S2, 0, SLJIT_S2, 0,
		SLJIT_IMM, reinterpret_cast<sljit_sw>(m_bindings.ram));
	if (load) {
		emitScalarLoad(kind, SLJIT_MEM_ALIGNED_32);
		mapping->done = sljit_emit_label(m_compiler);
	} else emitScalarStore(kind, instruction.a);
	if (slow.count != 0u) m_slowPaths.push_back(slow);
}


void NativeBlockCompiler::emitScalarLoad(MemoryAccessKind kind, sljit_s32 alignment) {
	if (kind != MemoryAccessKind::F32LE && kind != MemoryAccessKind::F64LE) {
		const sljit_s32 move = kind == MemoryAccessKind::U8 ? SLJIT_MOV32_U8
			: kind == MemoryAccessKind::U16LE ? SLJIT_MOV32_U16 : SLJIT_MOV32;
		if (alignment == SLJIT_MEM_UNALIGNED) sljit_emit_mem(m_compiler, move | alignment, SLJIT_R0, SLJIT_MEM1(SLJIT_S2), 0);
		else sljit_emit_op1(m_compiler, move, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_S2), 0);
		if constexpr (std::endian::native == std::endian::big) {
			if (kind != MemoryAccessKind::U8) sljit_emit_op1(m_compiler,
				kind == MemoryAccessKind::U16LE ? SLJIT_REV32_U16 : SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
		}
		sljit_emit_fop1(m_compiler, SLJIT_CONV_F64_FROM_U32, SLJIT_FR0, 0, SLJIT_R0, 0);
		return;
	}
	if constexpr (std::endian::native == std::endian::little) {
		if (kind == MemoryAccessKind::F64LE || alignment == SLJIT_MEM_UNALIGNED) {
			sljit_emit_fmem(m_compiler, (kind == MemoryAccessKind::F64LE ? SLJIT_MOV_F64 : SLJIT_MOV_F32) | alignment,
				SLJIT_FR0, SLJIT_MEM1(SLJIT_S2), 0);
		} else sljit_emit_fop1(m_compiler, SLJIT_MOV_F32, SLJIT_FR0, 0, SLJIT_MEM1(SLJIT_S2), 0);
	} else if (kind == MemoryAccessKind::F32LE) {
		if (alignment == SLJIT_MEM_UNALIGNED) sljit_emit_mem(m_compiler, SLJIT_MOV32 | alignment, SLJIT_R0, SLJIT_MEM1(SLJIT_S2), 0);
		else sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_S2), 0);
		sljit_emit_op1(m_compiler, SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
		sljit_emit_fcopy(m_compiler, SLJIT_COPY32_TO_F32, SLJIT_FR0, SLJIT_R0);
	} else {
#if defined(SLJIT_64BIT_ARCHITECTURE)
		sljit_emit_mem(m_compiler, SLJIT_MOV | alignment, SLJIT_R0, SLJIT_MEM1(SLJIT_S2), 0);
		sljit_emit_op1(m_compiler, SLJIT_REV, SLJIT_R0, 0, SLJIT_R0, 0);
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_TO_F64, SLJIT_FR0, SLJIT_R0);
#else
		if (alignment == SLJIT_MEM_UNALIGNED) {
			sljit_emit_mem(m_compiler, SLJIT_MOV32 | alignment, SLJIT_R0, SLJIT_MEM1(SLJIT_S2), 4);
			sljit_emit_mem(m_compiler, SLJIT_MOV32 | alignment, SLJIT_R1, SLJIT_MEM1(SLJIT_S2), 0);
		} else {
			sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_S2), 4);
			sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_S2), 0);
		}
		sljit_emit_op1(m_compiler, SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
		sljit_emit_op1(m_compiler, SLJIT_REV32, SLJIT_R1, 0, SLJIT_R1, 0);
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_TO_F64, SLJIT_FR0, SLJIT_REG_PAIR(SLJIT_R0, SLJIT_R1));
#endif
	}
	if (kind == MemoryAccessKind::F32LE) sljit_emit_fop1(m_compiler, SLJIT_CONV_F64_FROM_F32, SLJIT_FR0, 0, SLJIT_FR0, 0);
	canonicalizeNumber();
}

void NativeBlockCompiler::emitScalarStore(MemoryAccessKind kind, int source) {
	if (kind != MemoryAccessKind::F32LE && kind != MemoryAccessKind::F64LE) {
		convertWord(source);
		if constexpr (std::endian::native == std::endian::big) {
			if (kind != MemoryAccessKind::U8) sljit_emit_op1(m_compiler,
				kind == MemoryAccessKind::U16LE ? SLJIT_REV32_U16 : SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
		}
		const sljit_s32 move = kind == MemoryAccessKind::U8 ? SLJIT_MOV32_U8
			: kind == MemoryAccessKind::U16LE ? SLJIT_MOV32_U16 : SLJIT_MOV32;
		sljit_emit_op1(m_compiler, move, SLJIT_MEM1(SLJIT_S2), 0, SLJIT_R0, 0);
		return;
	}
	loadOperand(source, SLJIT_FR0);
	// Preserve numeric bits; only tagged Values decode to canonical numeric NaN.
	loadHeader(source, SLJIT_R0);
	sljit_emit_op2(m_compiler, SLJIT_AND, SLJIT_R1, 0, SLJIT_R0, 0, SLJIT_IMM, VALUE_QNAN_MASK >> 48u);
	auto* number = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R1, 0, SLJIT_IMM, VALUE_QNAN_MASK >> 48u);
	sljit_emit_op2(m_compiler, SLJIT_AND, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, VALUE_ENCODED_TAG_MASK >> 48u);
	auto* numericNaN = sljit_emit_cmp(m_compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_IMM, 0);
	sljit_emit_fset64(m_compiler, SLJIT_FR0, asNumber(VALUE_QNAN_MASK));
	auto* decoded = sljit_emit_label(m_compiler);
	sljit_set_label(number, decoded); sljit_set_label(numericNaN, decoded);
	if (kind == MemoryAccessKind::F32LE) sljit_emit_fop1(m_compiler, SLJIT_CONV_F32_FROM_F64, SLJIT_FR0, 0, SLJIT_FR0, 0);
	if constexpr (std::endian::native == std::endian::little) {
		if (kind == MemoryAccessKind::F64LE) sljit_emit_fmem(m_compiler, SLJIT_MOV_F64 | SLJIT_MEM_ALIGNED_32 | SLJIT_MEM_STORE,
			SLJIT_FR0, SLJIT_MEM1(SLJIT_S2), 0);
		else sljit_emit_fop1(m_compiler, SLJIT_MOV_F32, SLJIT_MEM1(SLJIT_S2), 0, SLJIT_FR0, 0);
	} else if (kind == MemoryAccessKind::F32LE) {
		sljit_emit_fcopy(m_compiler, SLJIT_COPY32_FROM_F32, SLJIT_FR0, SLJIT_R0);
		sljit_emit_op1(m_compiler, SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S2), 0, SLJIT_R0, 0);
	} else {
#if defined(SLJIT_64BIT_ARCHITECTURE)
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, SLJIT_FR0, SLJIT_R0);
		sljit_emit_op1(m_compiler, SLJIT_REV, SLJIT_R0, 0, SLJIT_R0, 0);
		sljit_emit_mem(m_compiler, SLJIT_MOV | SLJIT_MEM_ALIGNED_32 | SLJIT_MEM_STORE, SLJIT_R0, SLJIT_MEM1(SLJIT_S2), 0);
#else
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, SLJIT_FR0, SLJIT_REG_PAIR(SLJIT_R0, SLJIT_R1));
		sljit_emit_op1(m_compiler, SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
		sljit_emit_op1(m_compiler, SLJIT_REV32, SLJIT_R1, 0, SLJIT_R1, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S2), 4, SLJIT_R0, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S2), 0, SLJIT_R1, 0);
#endif
	}
}

sljit_jump* NativeBlockCompiler::emitRomStorage(const Span<const u8>* storage, u32 width,
	sljit_label* load, sljit_label* done) {
	if (!storage) {
		// An empty socket or a card without ROM supplies zero on its ROM bus.
		sljit_emit_fset64(m_compiler, SLJIT_FR0, 0.0);
		sljit_set_label(sljit_emit_jump(m_compiler, SLJIT_JUMP), done);
		return nullptr;
	}
	// Reload the actual owner's descriptor. Replacing bytes does not change
	// that descriptor's identity or require retiring unrelated RAM code.
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R1, 0, SLJIT_S2, 0, SLJIT_IMM, width);
	auto* tail = sljit_emit_cmp(m_compiler, SLJIT_GREATER, SLJIT_R1, 0,
		SLJIT_MEM0(), reinterpret_cast<sljit_sw>(&storage->size_));
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM0(), reinterpret_cast<sljit_sw>(&storage->data_));
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_S2, 0, SLJIT_S2, 0, SLJIT_R1, 0);
	sljit_set_label(sljit_emit_jump(m_compiler, SLJIT_JUMP), load);
	return tail;
}

void NativeBlockCompiler::emitReadMappings() {
	for (const auto& mapping : m_readMappings) {
		// A ROM is a byte span; its host backing need not share the guest's
		// alignment. Keep this decoder off the aligned RAM fall-through path.
		auto* romLoad = sljit_emit_label(m_compiler);
		emitScalarLoad(static_cast<MemoryAccessKind>(mapping.exit->exitC), SLJIT_MEM_UNALIGNED);
		sljit_set_label(sljit_emit_jump(m_compiler, SLJIT_JUMP), mapping.done);
		auto* entry = sljit_emit_label(m_compiler);
		for (auto* miss : mapping.ramMisses) sljit_set_label(miss, entry);
		// R0 is the computed guest address. ROM selection may overwrite it;
		// keep it in the cold decoder for an eventual bus exit.
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_R0, 0);
		const u32 width = mapping.width;
		auto* system = sljit_emit_cmp(m_compiler, SLJIT_LESS_EQUAL | SLJIT_32,
			SLJIT_R0, 0, SLJIT_IMM, SYSTEM_ROM_SIZE - width);
		sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_S2, 0, SLJIT_R0, 0, SLJIT_IMM, CART_ROM_BASE);
		std::array<sljit_jump*, 4> misses;
		size_t count = 0;
		misses[count++] = sljit_emit_cmp(m_compiler, SLJIT_GREATER | SLJIT_32,
			SLJIT_S2, 0, SLJIT_IMM, CART_ROM_SIZE - width);
		sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_S2, 0, SLJIT_S2, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM0(), reinterpret_cast<sljit_sw>(m_bindings.cartridgeSelection));
		sljit_emit_op2(m_compiler, SLJIT_AND32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 1);
		auto* slot1 = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0);
		if (auto* tail = emitRomStorage(m_bindings.cartridgeRom[0], width, romLoad, mapping.done)) misses[count++] = tail;
		sljit_set_label(slot1, sljit_emit_label(m_compiler));
		if (auto* tail = emitRomStorage(m_bindings.cartridgeRom[1], width, romLoad, mapping.done)) misses[count++] = tail;
		sljit_set_label(system, sljit_emit_label(m_compiler));
		sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_S2, 0, SLJIT_R0, 0);
		misses[count++] = emitRomStorage(m_bindings.systemRom, width, romLoad, mapping.done);
		auto* busExit = sljit_emit_label(m_compiler);
		for (size_t i = 0; i < count; ++i) sljit_set_label(misses[i], busExit);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, memoryAddress), SLJIT_R3, 0);
		emitSharedExit(*mapping.exit, mapping.registers);
	}
}

} // namespace bmsx
