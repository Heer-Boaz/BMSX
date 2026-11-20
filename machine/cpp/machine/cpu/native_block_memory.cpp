#include "machine/cpu/native_block_compiler.h"

#include <bit>
#include "machine/cpu/execution_image.h"
#include "machine/cpu/gc_heap.h"
#include "machine/memory/mapped_page.h"
#include "spec/blua32/memory_access_kind.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {
void NativeBlockCompiler::emitRamWordWriteWatch(NativeBlockExitSite& slow, sljit_s32 address, sljit_sw addressArg, sljit_s32 bits, sljit_s32 group, u32 wordMask) {
	auto* c = m_compiler;
	sljit_emit_op2(c, SLJIT_LSHR32, bits, 0, address, addressArg, SLJIT_IMM, MAPPED_PAGE_BYTE_SHIFT - 2u);
	sljit_emit_op2(c, SLJIT_AND32, bits, 0, bits, 0, SLJIT_IMM, -4);
	sljit_emit_op1(c, SLJIT_MOV_U32, bits, 0, SLJIT_MEM1(bits), reinterpret_cast<sljit_sw>(m_bindings.ramWriteGroups));
	auto* clear = sljit_emit_cmp(c, SLJIT_EQUAL, bits, 0, SLJIT_IMM, 0);
	sljit_emit_op2(c, SLJIT_AND32, group, 0, bits, 0, SLJIT_IMM, MAPPED_WATCH_HISTORY_CLEAN);
	fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, group, 0, SLJIT_IMM, 0), slow, m_cache.state());
	// Retire decoded words only if the write overlaps their exact mask.
	sljit_emit_op2(c, SLJIT_LSHR32, group, 0, address, addressArg, SLJIT_IMM, MAPPED_WATCH_GROUP_BYTE_SHIFT - 2u);
	sljit_emit_op2(c, SLJIT_AND32, group, 0, group, 0, SLJIT_IMM, -4);
	sljit_emit_op1(c, SLJIT_MOV32, bits, 0, SLJIT_MEM1(group), reinterpret_cast<sljit_sw>(m_bindings.ramCodeWatchWords));
	sljit_emit_op2(c, SLJIT_LSHR32, group, 0, address, addressArg, SLJIT_IMM, 2);
	sljit_emit_op2(c, SLJIT_MLSHR32, bits, 0, bits, 0, group, 0);
	sljit_emit_op2(c, SLJIT_AND32, bits, 0, bits, 0, SLJIT_IMM, wordMask);
	fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, bits, 0, SLJIT_IMM, 0), slow, m_cache.state());
	sljit_set_label(clear, sljit_emit_label(c));
}

// The caller proved the raw mark is black. This leaf reserves no memory
// and changes the queue only after admitting all its physical writes.
void NativeBlockCompiler::emitGrayChange(NativeBlockExitSite& exit, sljit_s32 offset, sljit_s32 record, u32 link) {
	auto* c = m_compiler;
	// This leaf uses the last word of the helper area, not the cache spill slots.
	constexpr auto savedRecord = NativeBlockAbi::stackBytes - sizeof(void*);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), savedRecord, record, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R1, 0, offset, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, heap));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_IMM, link);
	m_cache.spillCall(false, 0);
	sljit_emit_icall(c, SLJIT_CALL, SLJIT_ARGS3(32, P, 32, 32), SLJIT_IMM, SLJIT_FUNC_ADDR(&GcHeap::tryQueueChangedInNative));
	m_cache.spillCall(true, 0);
	fault(sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0), exit, m_cache.state());
	sljit_emit_op1(c, SLJIT_MOV_P, record, 0, SLJIT_MEM1(SLJIT_SP), savedRecord);
}

void NativeBlockCompiler::emitBackingLoad(MemoryAccessKind kind, bool unaligned) {
	const auto move = kind == MemoryAccessKind::U8 ? SLJIT_MOV32_U8 : kind == MemoryAccessKind::U16LE ? SLJIT_MOV32_U16 : SLJIT_MOV32;
	if (kind != MemoryAccessKind::F64LE) {
		if (unaligned && kind != MemoryAccessKind::U8)
			sljit_emit_mem(m_compiler, move | SLJIT_MEM_UNALIGNED, SLJIT_R0, SLJIT_MEM1(SLJIT_R2), 0);
		else
			sljit_emit_op1(m_compiler, move, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R2), 0);
		if constexpr (std::endian::native == std::endian::big)
			if (kind != MemoryAccessKind::U8)
				sljit_emit_op1(m_compiler, kind == MemoryAccessKind::U16LE ? SLJIT_REV32_U16 : SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
		return;
	}
	const auto alignment = unaligned ? SLJIT_MEM_UNALIGNED : SLJIT_MEM_ALIGNED_32;
	if constexpr (std::endian::native == std::endian::little)
		sljit_emit_fmem(m_compiler, SLJIT_MOV_F64 | alignment, SLJIT_FR0, SLJIT_MEM1(SLJIT_R2), 0);
	else {
		for (int i = 0; i < 2; ++i) {
			const auto reg = i == 0 ? SLJIT_R0 : SLJIT_R1;
			if (unaligned) sljit_emit_mem(m_compiler, SLJIT_MOV32 | SLJIT_MEM_UNALIGNED, reg, SLJIT_MEM1(SLJIT_R2), i * 4);
			else sljit_emit_op1(m_compiler, SLJIT_MOV32, reg, 0, SLJIT_MEM1(SLJIT_R2), i * 4);
			sljit_emit_op1(m_compiler, SLJIT_REV32, reg, 0, reg, 0);
		}
#if defined(SLJIT_64BIT_ARCHITECTURE)
		sljit_emit_op2(m_compiler, SLJIT_SHL, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 32);
		sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_R0, 0);
		sljit_emit_op2(m_compiler, SLJIT_OR, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_R1, 0);
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_TO_F64, SLJIT_FR0, SLJIT_R0);
#else
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_TO_F64, SLJIT_FR0, SLJIT_REG_PAIR(SLJIT_R1, SLJIT_R0));
#endif
	}
}

void NativeBlockCompiler::emitRomReads() {
	for (const auto& read : m_romReads) {
		const auto kind = static_cast<MemoryAccessKind>(read.bus->exitC);
		sljit_set_label(read.ramMiss, sljit_emit_label(m_compiler));
		auto* system = sljit_emit_cmp(m_compiler, SLJIT_LESS_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, SYSTEM_ROM_SIZE - read.width);
		sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R0, 0, SLJIT_IMM, CART_ROM_BASE);
		auto* other = sljit_emit_cmp(m_compiler, SLJIT_GREATER | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, CART_ROM_SIZE - read.width);
		sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_R1, 0);
		// SELECT belongs to the ordinary data bus, not the closure's execution domain.
		sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(m_bindings.cartridgeRom[0]));
		if (m_bindings.cartridgeRom[0] != m_bindings.cartridgeRom[1]) {
			sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_MEM0(), reinterpret_cast<sljit_sw>(m_bindings.cartridgeSelection));
			sljit_emit_op2u(m_compiler, SLJIT_AND32 | SLJIT_SET_Z, SLJIT_R3, 0, SLJIT_IMM, 1);
			sljit_emit_select(m_compiler, SLJIT_NOT_ZERO, SLJIT_R2, SLJIT_IMM, reinterpret_cast<sljit_sw>(m_bindings.cartridgeRom[1]), SLJIT_R2);
		}
		sljit_jump* empty = nullptr;
		if (!m_bindings.cartridgeRom[0] || !m_bindings.cartridgeRom[1])
			empty = sljit_emit_cmp(m_compiler, SLJIT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, 0);
		auto* cartridge = sljit_emit_jump(m_compiler, SLJIT_JUMP);
		sljit_set_label(system, sljit_emit_label(m_compiler));
		sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_R0, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(m_bindings.systemRom));
		sljit_set_label(cartridge, sljit_emit_label(m_compiler));
		// ROM replacement changes the span, not the address of its descriptor.
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R3, 0, SLJIT_R1, 0, SLJIT_IMM, read.width);
		auto* tail = sljit_emit_cmp(m_compiler, SLJIT_GREATER, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R2), offsetof(Span<const u8>, size_));
		sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), offsetof(Span<const u8>, data_));
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_R1, 0);
		emitBackingLoad(kind, true);
		sljit_set_label(sljit_emit_jump(m_compiler, SLJIT_JUMP), read.result);
		if (empty) {
			sljit_set_label(empty, sljit_emit_label(m_compiler));
			if (kind == MemoryAccessKind::F64LE) sljit_emit_fset64(m_compiler, SLJIT_FR0, 0);
			else sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_IMM, 0);
			sljit_set_label(sljit_emit_jump(m_compiler, SLJIT_JUMP), read.result);
		}
		auto* bus = sljit_emit_label(m_compiler);
		sljit_set_label(other, bus);
		sljit_set_label(tail, bus);
		m_cache.setState(read.registers);
		emitLeave(*read.bus, false);
	}
}

void NativeBlockCompiler::emitMemory(const DecodedInstruction& instruction, NativeBlockExitSite& slow) {
	const bool words = slow.exit == NativeBlockExit::WriteWords;
	const auto kind = words ? MemoryAccessKind::Word : static_cast<MemoryAccessKind>(instruction.c);
	const bool load = slow.exit == NativeBlockExit::ReadMemory;
	const u32 width = words ? static_cast<u32>(instruction.c) * 4u : kind == MemoryAccessKind::U8 ? 1 : kind == MemoryAccessKind::U16LE ? 2
		: kind == MemoryAccessKind::F64LE ? 8 : 4;
	// The instruction has started. Even invalid address operands retain this
	// charge; ordinary bus exits and retained retries must not charge it again.
	if (kind == MemoryAccessKind::F64LE)
		sljit_emit_op2(m_compiler, SLJIT_SUB32, NativeBlockAbi::budget, 0, NativeBlockAbi::budget, 0, SLJIT_IMM, 2);
	if (knownTag(instruction.b) == static_cast<int>(ValueTag::Integer)) {
		const auto address = readTyped(instruction.b, ValueTag::Integer);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, address.reg, 0);
	} else {
		emitRawLoad(instruction.b, SLJIT_R0, SLJIT_R1);
		fault(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM,
			static_cast<u8>(ValueTag::Integer)), slow, m_cache.state());
	}
	if (instruction.op == static_cast<u8>(OpCode::LOAD_MEM_D) || instruction.op == static_cast<u8>(OpCode::STORE_MEM_D)
		|| instruction.op == static_cast<u8>(OpCode::STORE_MEM_WORDS_D))
		sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM,
			static_cast<u32>(instruction.disp) << 2u);
	const auto alignment = MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[static_cast<size_t>(kind)];
	if (alignment) {
		sljit_emit_op2(m_compiler, SLJIT_AND32, SLJIT_R1, 0, SLJIT_R0, 0, SLJIT_IMM, alignment);
		fault(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0), slow, m_cache.state());
	}
	if (width == 0) return; // Zero-count stores still require an aligned address.
	if (width > m_bindings.ramBytes) {
		emitExit(slow);
		return;
	}
	// Keep ordinary RAM on the fall-through path. MMIO always goes to the bus.
	sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R0, 0, SLJIT_IMM, RAM_BASE);
	fault(sljit_emit_cmp(m_compiler, SLJIT_LESS | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM,
		IO_SLOT_COUNT * IO_WORD_SIZE), slow, m_cache.state());
	// The public bus stops at the live heap floor, not at physical RAM's end.
	// Keep the owner's address stable so a published block sees later changes.
	sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_R2, 0, SLJIT_MEM0(),
		reinterpret_cast<sljit_sw>(m_bindings.ramBusEnd), SLJIT_IMM, RAM_BASE + width);
	auto* ramMiss = sljit_emit_cmp(m_compiler, SLJIT_GREATER | SLJIT_32, SLJIT_R1, 0, SLJIT_R2, 0);
	if (!load) fault(ramMiss, slow, m_cache.state());
	sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_R1, 0);
	if (words) {
		// A watch anywhere in the sequence hands the untouched instruction to the bus.
		sljit_emit_op2(m_compiler, SLJIT_LSHR, SLJIT_R2, 0, SLJIT_R1, 0, SLJIT_IMM, MAPPED_PAGE_BYTE_SHIFT - 2u);
		sljit_emit_op2(m_compiler, SLJIT_AND, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, -4);
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R0, 0, SLJIT_R1, 0, SLJIT_IMM, width - 4u);
		sljit_emit_op2(m_compiler, SLJIT_LSHR, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, MAPPED_PAGE_BYTE_SHIFT - 2u);
		sljit_emit_op2(m_compiler, SLJIT_AND, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, -4);
		auto* page = sljit_emit_label(m_compiler);
		sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R2), reinterpret_cast<sljit_sw>(m_bindings.ramWriteGroups));
		fault(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R3, 0, SLJIT_IMM, 0), slow, m_cache.state());
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, 4);
		sljit_set_label(sljit_emit_cmp(m_compiler, SLJIT_LESS_EQUAL, SLJIT_R2, 0, SLJIT_R0, 0), page);
		// Admit the Integer span before copying any payload. The bus owner
		// converts mixed spans in order, including partial writes on a fault.
		m_cache.publishRange(instruction.a, instruction.a + instruction.c);
		sljit_emit_op1(m_compiler, SLJIT_MOV, SLJIT_R0, 0, SLJIT_IMM, instruction.a);
		auto* tag = sljit_emit_label(m_compiler);
		sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R3, 0, SLJIT_MEM2(NativeBlockAbi::tags, SLJIT_R0), 0);
		fault(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R3, 0, SLJIT_IMM, static_cast<u8>(ValueTag::Integer)), slow, m_cache.state());
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 1);
		sljit_set_label(sljit_emit_cmp(m_compiler, SLJIT_LESS, SLJIT_R0, 0, SLJIT_IMM, instruction.a + instruction.c), tag);
		NativeBlockAbi::emitRamAddress(m_compiler, SLJIT_R2, SLJIT_R1);
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R1, 0, NativeBlockAbi::words, 0, SLJIT_IMM, instruction.a * sizeof(u32));
		sljit_emit_op1(m_compiler, SLJIT_MOV, SLJIT_R0, 0, SLJIT_IMM, 0);
		auto* copy = sljit_emit_label(m_compiler);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_MEM2(SLJIT_R1, SLJIT_R0), 2);
		if constexpr (std::endian::native == std::endian::big)
			sljit_emit_op1(m_compiler, SLJIT_REV32, SLJIT_R3, 0, SLJIT_R3, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM2(SLJIT_R2, SLJIT_R0), 2, SLJIT_R3, 0);
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 1);
		sljit_set_label(sljit_emit_cmp(m_compiler, SLJIT_LESS, SLJIT_R0, 0, SLJIT_IMM, instruction.c), copy);
		return;
	}
	if (!load) {
		emitRamWordWriteWatch(slow, SLJIT_R1, 0, SLJIT_R3, SLJIT_R2);
		if (width == 8) {
			sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R0, 0, SLJIT_R1, 0, SLJIT_IMM, 4);
			emitRamWordWriteWatch(slow, SLJIT_R0, 0, SLJIT_R3, SLJIT_R2);
		}
	}
	NativeBlockAbi::emitRamAddress(m_compiler, SLJIT_R2, SLJIT_R1);
	const auto move = kind == MemoryAccessKind::U8 ? SLJIT_MOV32_U8 : kind == MemoryAccessKind::U16LE ? SLJIT_MOV32_U16 : SLJIT_MOV32;
	if (load) {
		emitBackingLoad(kind, false);
		m_romReads.push_back({ramMiss, sljit_emit_label(m_compiler), &slow, m_cache.state(), width});
		if (kind != MemoryAccessKind::F64LE) {
			const auto target = m_cache.write(instruction.a, kind == MemoryAccessKind::F32LE ? ValueTag::Float : ValueTag::Integer);
			if (target.tag == ValueTag::Float)
				sljit_emit_fcopy(m_compiler, SLJIT_COPY32_TO_F32, target.reg, SLJIT_R0);
			else
				sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, SLJIT_R0, 0);
		} else {
			sljit_emit_fop1(m_compiler, SLJIT_CONV_F32_FROM_F64, SLJIT_FR0, 0, SLJIT_FR0, 0);
			emitFloatCanonicalization(SLJIT_FR0);
			const auto target = m_cache.write(instruction.a, ValueTag::Float);
			sljit_emit_fop1(m_compiler, SLJIT_MOV_F32, target.reg, 0, SLJIT_FR0, 0);
		}
		return;
	}
	if (kind == MemoryAccessKind::F32LE || kind == MemoryAccessKind::F64LE) {
		const int tag = knownTag(instruction.a);
		const auto conversion = kind == MemoryAccessKind::F32LE ? SLJIT_CONV_F32_FROM_S32 : SLJIT_CONV_F64_FROM_S32;
		if (tag == static_cast<int>(ValueTag::Integer)) {
			const auto source = readTyped(instruction.a, ValueTag::Integer);
			sljit_emit_fop1(m_compiler, conversion, SLJIT_FR0, 0, source.reg, 0);
		} else if (tag == static_cast<int>(ValueTag::Float)) {
			const auto source = readTyped(instruction.a, ValueTag::Float);
			sljit_emit_fop1(m_compiler, kind == MemoryAccessKind::F32LE ? SLJIT_MOV_F32 : SLJIT_CONV_F64_FROM_F32,
				SLJIT_FR0, 0, source.reg, 0);
		} else {
			emitRawLoad(instruction.a, SLJIT_R0, SLJIT_R1);
			auto* integer = sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, static_cast<u8>(ValueTag::Integer));
			fault(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM,
				static_cast<u8>(ValueTag::Float)), slow, m_cache.state());
			sljit_emit_fcopy(m_compiler, SLJIT_COPY32_TO_F32, SLJIT_FR0, SLJIT_R0);
			if (kind == MemoryAccessKind::F64LE)
				sljit_emit_fop1(m_compiler, SLJIT_CONV_F64_FROM_F32, SLJIT_FR0, 0, SLJIT_FR0, 0);
			auto* ready = sljit_emit_jump(m_compiler, SLJIT_JUMP);
			sljit_set_label(integer, sljit_emit_label(m_compiler));
			sljit_emit_fop1(m_compiler, conversion, SLJIT_FR0, 0, SLJIT_R0, 0);
			sljit_set_label(ready, sljit_emit_label(m_compiler));
		}
		if constexpr (std::endian::native == std::endian::little) {
			// Four-byte alignment is natural for F32, but not for F64.
			if (kind == MemoryAccessKind::F32LE)
				sljit_emit_fop1(m_compiler, SLJIT_MOV_F32, SLJIT_MEM1(SLJIT_R2), 0, SLJIT_FR0, 0);
			else
				sljit_emit_fmem(m_compiler, SLJIT_MOV_F64 | SLJIT_MEM_ALIGNED_32 | SLJIT_MEM_STORE, SLJIT_FR0, SLJIT_MEM1(SLJIT_R2), 0);
		} else if (kind == MemoryAccessKind::F32LE) {
			sljit_emit_fcopy(m_compiler, SLJIT_COPY32_FROM_F32, SLJIT_FR0, SLJIT_R0);
			sljit_emit_op1(m_compiler, SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
			sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), 0, SLJIT_R0, 0);
		} else {
#if defined(SLJIT_64BIT_ARCHITECTURE)
			sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, SLJIT_FR0, SLJIT_R0);
			sljit_emit_op2(m_compiler, SLJIT_LSHR, SLJIT_R1, 0, SLJIT_R0, 0, SLJIT_IMM, 32);
#else
			sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, SLJIT_FR0, SLJIT_REG_PAIR(SLJIT_R1, SLJIT_R0));
#endif
			sljit_emit_op1(m_compiler, SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
			sljit_emit_op1(m_compiler, SLJIT_REV32, SLJIT_R1, 0, SLJIT_R1, 0);
			sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), 0, SLJIT_R0, 0);
			sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), 4, SLJIT_R1, 0);
		}
	} else {
		if (knownTag(instruction.a) == static_cast<int>(ValueTag::Integer)) {
			const auto source = readTyped(instruction.a, ValueTag::Integer);
			sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, source.reg, 0);
		} else {
			emitRawLoad(instruction.a, SLJIT_R0, SLJIT_R1);
			fault(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM,
				static_cast<u8>(ValueTag::Integer)), slow, m_cache.state());
		}
		if constexpr (std::endian::native == std::endian::big)
			if (width != 1)
				sljit_emit_op1(m_compiler, width == 2 ? SLJIT_REV32_U16 : SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
		sljit_emit_op1(m_compiler, move, SLJIT_MEM1(SLJIT_R2), 0, SLJIT_R0, 0);
	}
}
} // namespace bmsx
