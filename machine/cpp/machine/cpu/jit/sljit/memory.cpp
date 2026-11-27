#include "machine/cpu/jit/sljit/lowering.h"

#include <bit>
#include <limits>
#include "machine/cpu/cpu.h"
#include "machine/cpu/jit/runtime/execution.h"
#include "machine/memory/mapped_page.h"
#include "machine/memory/memory.h"
#include "spec/blua32/memory_access_kind.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {
namespace {
u32 SLJIT_FUNC writeLocalIoWord(Memory* memory, u32 address, u32 value) {
	return memory->tryWriteLocalIoWord(address, value);
}
} // namespace

void NativeLowering::emitRamWordWriteWatch(NativeBlockExitSite& slow, sljit_s32 address, sljit_sw addressArg,
	sljit_s32 bits, sljit_s32 group, std::optional<u32> codeWords, u32 byteWidth) {
	const u32 history = m_bindings.historyWriteWatches ? MAPPED_WATCH_HISTORY_CLEAN : 0u;
	const u32 observe = byteWidth != 0u ? MAPPED_WATCH_PHYSICAL_BYTES : 0u;
	if (!codeWords && (history | observe) == 0u) return;
	auto* c = m_compiler;
	sljit_emit_op2(c, SLJIT_LSHR32, bits, 0, address, addressArg, SLJIT_IMM, MAPPED_PAGE_BYTE_SHIFT - 2u);
	sljit_emit_op2(c, SLJIT_AND32, bits, 0, bits, 0, SLJIT_IMM, -4);
	sljit_emit_op1(c, SLJIT_MOV_U32, bits, 0, SLJIT_MEM1(bits), reinterpret_cast<sljit_sw>(m_bindings.ramWriteGroups));
	sljit_jump* clear = nullptr;
	if (codeWords) {
		clear = sljit_emit_cmp(c, SLJIT_EQUAL, bits, 0, SLJIT_IMM, 0);
	} else if (history != 0u && observe != 0u) {
		// The common private path still takes just one page-summary test.
		sljit_emit_op2(c, SLJIT_AND32, group, 0, bits, 0, SLJIT_IMM, history | observe);
		clear = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, group, 0, SLJIT_IMM, 0);
	}
	if (history != 0u) {
		sljit_emit_op2(c, SLJIT_AND32, group, 0, bits, 0, SLJIT_IMM, history);
		fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, group, 0, SLJIT_IMM, 0), slow, m_cache.state());
	}
	if (observe != 0u) {
		// In the private lane with history enabled, a nonempty summary after the
		// history exit means there is a physical watch on this page.
		sljit_jump* noWatch = nullptr;
		if (codeWords || history == 0u) {
			sljit_emit_op2(c, SLJIT_AND32, group, 0, bits, 0, SLJIT_IMM, observe);
			noWatch = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, group, 0, SLJIT_IMM, 0);
		}
		// A page bit only admits the sparse mask lookup. Aligned byte,
		// halfword and word transfers fit in one 32-byte mask.
		sljit_emit_op2(c, SLJIT_LSHR32, bits, 0, address, addressArg, SLJIT_IMM, MAPPED_PAGE_BYTE_SHIFT);
		sljit_emit_op1(c, SLJIT_MOV_P, group, 0, SLJIT_MEM0(), reinterpret_cast<sljit_sw>(m_bindings.ramByteMaskPages));
		sljit_emit_op1(c, SLJIT_MOV_P, group, 0, SLJIT_MEM2(group, bits), std::countr_zero(sizeof(const u32*)));
		sljit_emit_op2(c, SLJIT_LSHR32, bits, 0, address, addressArg, SLJIT_IMM, 5u);
		sljit_emit_op2(c, SLJIT_AND32, bits, 0, bits, 0, SLJIT_IMM, (MAPPED_PAGE_BYTE_SIZE / 32u) - 1u);
		sljit_emit_op1(c, SLJIT_MOV32, bits, 0, SLJIT_MEM2(group, bits), 2);
		sljit_emit_op2(c, SLJIT_MLSHR32, bits, 0, bits, 0, address, addressArg);
		sljit_emit_op2(c, SLJIT_AND32, bits, 0, bits, 0, SLJIT_IMM, (1u << byteWidth) - 1u);
		fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, bits, 0, SLJIT_IMM, 0), slow, m_cache.state());
		if (noWatch) sljit_set_label(noWatch, sljit_emit_label(c));
	}
	if (!codeWords) {
		if (clear) sljit_set_label(clear, sljit_emit_label(c));
		return;
	}
	// Retire decoded words only if the write overlaps their exact mask.
	sljit_emit_op2(c, SLJIT_LSHR32, group, 0, address, addressArg, SLJIT_IMM, MAPPED_WATCH_GROUP_BYTE_SHIFT - 2u);
	sljit_emit_op2(c, SLJIT_AND32, group, 0, group, 0, SLJIT_IMM, -4);
	sljit_emit_op1(c, SLJIT_MOV32, bits, 0, SLJIT_MEM1(group), reinterpret_cast<sljit_sw>(m_bindings.ramCodeWatchWords));
	sljit_emit_op2(c, SLJIT_LSHR32, group, 0, address, addressArg, SLJIT_IMM, 2);
	sljit_emit_op2(c, SLJIT_MLSHR32, bits, 0, bits, 0, group, 0);
	sljit_emit_op2(c, SLJIT_AND32, bits, 0, bits, 0, SLJIT_IMM, *codeWords);
	fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, bits, 0, SLJIT_IMM, 0), slow, m_cache.state());
	sljit_set_label(clear, sljit_emit_label(c));
}

void NativeLowering::emitReferenceStoreGate(NativeGcBarrier plan, sljit_s32 tag, sljit_s32 scratch,
	NativeBlockExitSite& exit) {
	if (plan == NativeGcBarrier::None) return;
	auto* c = m_compiler;
	if (plan == NativeGcBarrier::Reference) {
		fault(sljit_emit_jump(c, SLJIT_JUMP), exit, m_cache.state());
		return;
	}
	constexpr auto first = static_cast<u8>(ValueTag::String);
	sljit_emit_op2(c, SLJIT_SUB32, scratch, 0, tag, 0, SLJIT_IMM, first);
	auto* outside = sljit_emit_cmp(c, SLJIT_GREATER | SLJIT_32, scratch, 0, SLJIT_IMM,
		static_cast<u8>(ValueTag::Thread) - first);
	auto* builtin = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, scratch, 0, SLJIT_IMM,
		static_cast<u8>(ValueTag::BuiltinFunction) - first);
	fault(sljit_emit_jump(c, SLJIT_JUMP), exit, m_cache.state());
	auto* direct = sljit_emit_label(c);
	sljit_set_label(outside, direct);
	sljit_set_label(builtin, direct);
}

void NativeLowering::emitBackingLoad(MemoryAccessKind kind, bool unaligned) {
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

void NativeLowering::emitLocalIoWrites() {
	auto* c = m_compiler;
	for (const auto& store : m_workspace.localIoWrites) {
		sljit_set_label(store.io, sljit_emit_label(c));
		m_cache.setState(store.registers);
		if (store.checkTag) fault(guardTag(store.slot, ValueTag::Integer, SLJIT_R2), *store.bus, store.registers);
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_R0, 0);
		emitPayload(store.slot, SLJIT_R2);
		m_cache.spillCall(false, 0, NativeRegisterCache::FrameSlots::Unchanged);
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(&m_bindings.cpu->memory()));
		sljit_emit_icall(c, SLJIT_CALL, SLJIT_ARGS3(32, P, 32, 32), SLJIT_IMM, SLJIT_FUNC_ADDR(&writeLocalIoWord));
		m_cache.spillCall(true, 0, NativeRegisterCache::FrameSlots::Unchanged);
		fault(sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0), *store.bus, store.registers);
		sljit_set_label(sljit_emit_jump(c, SLJIT_JUMP), store.resume);
	}
}

void NativeLowering::emitRomReads() {
	auto* c = m_compiler;
	for (const auto& read : m_workspace.romReads) {
		using Rom = Span<const u8>;
		sljit_set_label(read.ramMiss, sljit_emit_label(c));
		auto* system = sljit_emit_cmp(c, SLJIT_LESS | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, CART_ROM_BASE);
		sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, CART_ROM_BASE);
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(m_bindings.cartridgeRom));

		// Bound the complete transfer to a live ROM aperture. A short image
		// tail or another device still belongs to the ordered, scalar bus.
		auto* range = sljit_emit_label(c);
		sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_R0, 0);
		sljit_emit_op2(c, SLJIT_ADD, SLJIT_R1, 0, SLJIT_R0, 0, SLJIT_IMM, read.width);
		fault(sljit_emit_cmp(c, SLJIT_GREATER, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R2), offsetof(Rom, size_)),
			*read.bus, read.registers);
		sljit_emit_op2(c, SLJIT_ADD, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), offsetof(Rom, data_), SLJIT_R0, 0);
		emitBackingLoad(read.format, true);
		sljit_set_label(sljit_emit_jump(c, SLJIT_JUMP), read.result);

		sljit_set_label(system, sljit_emit_label(c));
		fault(sljit_emit_cmp(c, SLJIT_GREATER | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, SYSTEM_ROM_SIZE - read.width),
			*read.bus, read.registers);
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(m_bindings.systemRom));
		sljit_set_label(sljit_emit_jump(c, SLJIT_JUMP), range);
	}
}

void NativeLowering::lowerOperation(const NativeMemoryAccess& access, const NativeInstruction& instruction) {
	auto& slow = *sideExit(instruction.slow);
	const auto kind = access.format;
	const bool tagged = kind == MemoryAccessKind::Value;
	if (tagged && (m_bindings.privateFirmware || !m_bindings.cpu || instruction.pc - SYSTEM_ROM_BASE >= SYSTEM_ROM_SIZE)) {
		// The old private port and non-System execution keep the CPU exit.
		emitLeave(slow, Charge::Pending);
		return;
	}
	const bool words = access.mode == NativeMemoryMode::StoreWords;
	const bool load = access.mode == NativeMemoryMode::Load;
	const u32 width = words ? static_cast<u32>(access.wordCount) * sizeof(u32)
		: kind == MemoryAccessKind::U8 ? 1u : kind == MemoryAccessKind::U16LE ? 2u
		: kind == MemoryAccessKind::F64LE ? 8u : tagged ? VALUE_MEMORY_SIZE : 4u;
	const bool floatStore = kind == MemoryAccessKind::F32LE || kind == MemoryAccessKind::F64LE;
	if (access.addressCheck == NativeTagCheck::Rejected || (!load && !words
		&& (access.store == NativeWordSource::Invalid || (access.store == NativeWordSource::Float && !floatStore)))) {
		emitLeave(slow, Charge::Pending);
		return;
	}
	if (access.addressCheck == NativeTagCheck::Dynamic)
		fault(guardTag(access.address, ValueTag::Integer, SLJIT_R1), slow, m_cache.state());
	emitPayload(access.address, SLJIT_R0);
	if (access.displacement != 0u)
		sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM,
			access.displacement);
	const auto alignment = MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[static_cast<size_t>(kind)];
	if (alignment) {
		sljit_emit_op2(m_compiler, SLJIT_AND32, SLJIT_R1, 0, SLJIT_R0, 0, SLJIT_IMM, alignment);
		fault(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0), slow, m_cache.state());
	}
	if (width == 0) return; // Zero-count stores still require an aligned address.
	if (width > m_bindings.ramBytes) {
		emitLeave(slow, Charge::Pending);
		return;
	}
	if (tagged) {
		auto* c = m_compiler;
		fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_MEM1(NativeBlockAbi::state),
			offsetof(NativeCpuRunState, frameBank), SLJIT_IMM, frameBankWord(SYSTEM_EXECUTION_DOMAIN_ID)), slow, m_cache.state());
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, cop0Words));
		sljit_emit_op2(c, SLJIT_AND32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), COP0_STATUS * sizeof(u32),
			SLJIT_IMM, CPU_STATUS_USER_MODE_CURRENT);
		fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 0), slow, m_cache.state());

		sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R0, 0, SLJIT_IMM, RAM_BASE);
		fault(sljit_emit_cmp(c, SLJIT_GREATER | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, m_bindings.ramBytes - width), slow, m_cache.state());
		fault(sljit_emit_cmp(c, SLJIT_LESS | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM,
			IO_BASE - RAM_BASE + IO_SLOT_COUNT * IO_WORD_SIZE), slow, m_cache.state());
		// Reject overlap of the complete span with either dedicated backing.
		for (const auto& [begin, end] : {std::pair{CPU_RESET_BANK_ADDRESS, CPU_RESET_BANK_END},
			std::pair{CPU_FIXED_FRAME_ADDRESS, CPU_FIXED_VALUE_END}}) {
			sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R2, 0, SLJIT_R1, 0, SLJIT_IMM, begin - RAM_BASE - (width - 1u));
			fault(sljit_emit_cmp(c, SLJIT_LESS | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, end - begin + width - 1u), slow, m_cache.state());
		}

		// A tagged access can alias an unpublished register or control word.
		// Use the live frame's bound backing, not an edited dormant descriptor.
		// The fixed bank's backing was already excluded by the physical check.
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, frame));
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R3), offsetof(CallFrame, thread));
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), SLJIT_OFFSETOF(Thread, address));
		auto* fixed = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, CPU_RESET_BANK_ADDRESS);
		sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R1, 0, SLJIT_IMM, VALUE_MEMORY_TAG_OFFSET);
		sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R2, 0, SLJIT_R0, 0, SLJIT_R2, 0);
		sljit_emit_op2(c, SLJIT_AND32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, MAIN_RAM_SIZE - 1u);
		fault(sljit_emit_cmp(c, SLJIT_LESS | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, THREAD_HEAP_BYTES + VALUE_MEMORY_TAG_OFFSET), slow, m_cache.state());

		// Compare the five touched bytes in the physical RAM record address
		// space; a backed control range can straddle the record-port wrap.
		for (bool values : {true, false}) {
			if (values) {
				const auto stack = SLJIT_OFFSETOF(Thread, stack);
				sljit_emit_op2(c, SLJIT_SUB, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), stack + ValueSpan::wordsOffset(),
					SLJIT_IMM, reinterpret_cast<sljit_sw>(m_bindings.ram));
				sljit_emit_op1(c, SLJIT_MOV, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R3), stack + ValueSpan::sizeOffset());
			} else {
				sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), SLJIT_OFFSETOF(Thread, boundFrameOffset));
				sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R3), SLJIT_OFFSETOF(Thread, boundFrameCapacity));
			}
			sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R2, 0, SLJIT_R1, 0, SLJIT_R2, 0);
			sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, VALUE_MEMORY_TAG_OFFSET);
			sljit_emit_op2(c, SLJIT_AND32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, MAIN_RAM_SIZE - 1u);
			sljit_emit_op2(c, SLJIT_MUL32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, values ? THREAD_STACK_SLOT_BYTES : FRAME_CONTROL_BYTES);
			sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, VALUE_MEMORY_TAG_OFFSET);
			fault(sljit_emit_cmp(c, SLJIT_LESS | SLJIT_32, SLJIT_R2, 0, SLJIT_R0, 0), slow, m_cache.state());
		}
		sljit_set_label(fixed, sljit_emit_label(c));

		if (!load) {
			emitRamWordWriteWatch(slow, SLJIT_R1, 0, SLJIT_R3, SLJIT_R2, 1u, sizeof(u32));
			sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R1, 0, SLJIT_IMM, VALUE_MEMORY_TAG_OFFSET);
			emitRamWordWriteWatch(slow, SLJIT_R0, 0, SLJIT_R3, SLJIT_R2, 1u, 1u);
		}
		sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_R1, 0);
		NativeBlockAbi::emitRamAddress(c, SLJIT_R2, SLJIT_R1);
		if (load) {
			emitBackingLoad(kind, false);
			sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R2), VALUE_MEMORY_TAG_OFFSET);
			emitRawStore(access.slot, SLJIT_R0, SLJIT_R1, m_uses.nextOperandDemand(m_instruction, access.slot));
		} else {
			emitRawLoad(access.slot, SLJIT_R0, SLJIT_R1);
			if constexpr (std::endian::native == std::endian::big)
				sljit_emit_op1(c, SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
			sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), 0, SLJIT_R0, 0);
			sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R2), VALUE_MEMORY_TAG_OFFSET, SLJIT_R1, 0);
		}
		return;
	}
	if (m_bindings.privateFirmware) {
		if (!load) {
			// Only the allocator aperture is writable, not the pinned stack.
			// Projection writes issue a notification; no RAM store occurs.
			fault(sljit_emit_cmp(m_compiler, SLJIT_LESS | SLJIT_32, SLJIT_R0, 0,
				SLJIT_MEM0(), reinterpret_cast<sljit_sw>(m_bindings.ramBusEnd)), slow, m_cache.state());
			fault(sljit_emit_cmp(m_compiler, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R0, 0,
				SLJIT_IMM, m_bindings.privateStoreEnd), slow, m_cache.state());
			sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R0, 0, SLJIT_IMM, m_bindings.privateProjection);
			fault(sljit_emit_cmp(m_compiler, SLJIT_LESS | SLJIT_32, SLJIT_R1, 0,
				SLJIT_IMM, sizeof(u32)), slow, m_cache.state());
		}
		sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R0, 0, SLJIT_IMM, RAM_BASE);
		if (load) {
			// Synthetic root planes and socket-encoded ROM use the typed port.
			fault(sljit_emit_cmp(m_compiler, SLJIT_GREATER | SLJIT_32, SLJIT_R1, 0,
				SLJIT_IMM, m_bindings.ramBytes - width), slow, m_cache.state());
		} else {
			// A watched physical byte or first history write retires at the RAM owner.
			emitRamWordWriteWatch(slow, SLJIT_R1, 0, SLJIT_R3, SLJIT_R2, std::nullopt, width);
			if (access.store == NativeWordSource::Dynamic)
				fault(guardTag(access.slot, ValueTag::Integer, SLJIT_R2), slow, m_cache.state());
		}
		sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_R1, 0);
		NativeBlockAbi::emitRamAddress(m_compiler, SLJIT_R2, SLJIT_R1);
		if (load) {
			emitBackingLoad(kind, false);
			const auto target = m_cache.write(access.slot, ValueTag::Integer);
			sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, SLJIT_R0, 0);
		} else {
			emitPayload(access.slot, SLJIT_R0);
			if constexpr (std::endian::native == std::endian::big)
				if (width != 1u) sljit_emit_op1(m_compiler, SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
			sljit_emit_op1(m_compiler, width == 1u ? SLJIT_MOV_U8 : SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), 0, SLJIT_R0, 0);
		}
		return;
	}
	// Keep ordinary RAM on the fall-through path. MMIO always goes to the bus.
	sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R0, 0, SLJIT_IMM, RAM_BASE);
	auto* io = sljit_emit_cmp(m_compiler, SLJIT_LESS | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, IO_SLOT_COUNT * IO_WORD_SIZE);
	const bool localIo = m_bindings.cpu && !load && !words && (kind == MemoryAccessKind::Word || kind == MemoryAccessKind::U32LE);
	if (!localIo) fault(io, slow, m_cache.state());
	// The public bus stops at the live heap floor, not at physical RAM's end.
	// The allocator never publishes a floor below DYNAMIC_RAM_BASE, and even
	// the full word-count lane cannot borrow when subtracted from that floor.
	static_assert(std::numeric_limits<u16>::max() * sizeof(u32) < MIN_RAM_SIZE);
	sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_R2, 0, SLJIT_MEM0(),
		reinterpret_cast<sljit_sw>(m_bindings.ramBusEnd), SLJIT_IMM, RAM_BASE + width);
	auto* ramMiss = sljit_emit_cmp(m_compiler, SLJIT_GREATER | SLJIT_32, SLJIT_R1, 0, SLJIT_R2, 0);
	if (!load) fault(ramMiss, slow, m_cache.state());
	// Value windows and frame latches are above the aperture; admitted
	// public transfers do not observe or overwrite either.
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
		m_cache.publishRange(access.slot, access.slot + access.wordCount);
		sljit_emit_op1(m_compiler, SLJIT_MOV, SLJIT_R0, 0, SLJIT_IMM, access.slot);
		auto* tag = sljit_emit_label(m_compiler);
		sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R3, 0, SLJIT_MEM2(NativeBlockAbi::tags, SLJIT_R0), 0);
		fault(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R3, 0, SLJIT_IMM, static_cast<u8>(ValueTag::Integer)), slow, m_cache.state());
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 1);
		sljit_set_label(sljit_emit_cmp(m_compiler, SLJIT_LESS, SLJIT_R0, 0, SLJIT_IMM, access.slot + access.wordCount), tag);
		NativeBlockAbi::emitRamAddress(m_compiler, SLJIT_R2, SLJIT_R1);
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R1, 0, NativeBlockAbi::words, 0, SLJIT_IMM, access.slot * sizeof(u32));
		sljit_emit_op1(m_compiler, SLJIT_MOV, SLJIT_R0, 0, SLJIT_IMM, 0);
		auto* copy = sljit_emit_label(m_compiler);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_MEM2(SLJIT_R1, SLJIT_R0), 2);
		if constexpr (std::endian::native == std::endian::big)
			sljit_emit_op1(m_compiler, SLJIT_REV32, SLJIT_R3, 0, SLJIT_R3, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM2(SLJIT_R2, SLJIT_R0), 2, SLJIT_R3, 0);
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 1);
		sljit_set_label(sljit_emit_cmp(m_compiler, SLJIT_LESS, SLJIT_R0, 0, SLJIT_IMM, access.wordCount), copy);
		return;
	}
	if (!load) {
		emitRamWordWriteWatch(slow, SLJIT_R1, 0, SLJIT_R3, SLJIT_R2, 1u, width == 8u ? 4u : width);
		if (width == 8) {
			sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R0, 0, SLJIT_R1, 0, SLJIT_IMM, 4);
			emitRamWordWriteWatch(slow, SLJIT_R0, 0, SLJIT_R3, SLJIT_R2, 1u, 4u);
		}
	}
	NativeBlockAbi::emitRamAddress(m_compiler, SLJIT_R2, SLJIT_R1);
	const auto move = kind == MemoryAccessKind::U8 ? SLJIT_MOV32_U8 : kind == MemoryAccessKind::U16LE ? SLJIT_MOV32_U16 : SLJIT_MOV32;
	if (load) {
		emitBackingLoad(kind, false);
		m_workspace.romReads.push_back({ramMiss, sljit_emit_label(m_compiler), &slow, m_cache.state(), width, kind});
		if (kind != MemoryAccessKind::F64LE) {
			const auto target = m_cache.write(access.slot, kind == MemoryAccessKind::F32LE ? ValueTag::Float : ValueTag::Integer);
			if (target.tag == ValueTag::Float)
				sljit_emit_fcopy(m_compiler, SLJIT_COPY32_TO_F32, target.reg, SLJIT_R0);
			else
				sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, SLJIT_R0, 0);
		} else {
			sljit_emit_fop1(m_compiler, SLJIT_CONV_F32_FROM_F64, SLJIT_FR0, 0, SLJIT_FR0, 0);
			emitFloatCanonicalization(SLJIT_FR0);
			const auto target = m_cache.write(access.slot, ValueTag::Float);
			sljit_emit_fop1(m_compiler, SLJIT_MOV_F32, target.reg, 0, SLJIT_FR0, 0);
		}
		return;
	}
	if (floatStore) {
		const auto conversion = kind == MemoryAccessKind::F32LE ? SLJIT_CONV_F32_FROM_S32 : SLJIT_CONV_F64_FROM_S32;
		if (access.store == NativeWordSource::Integer) {
			const auto source = readTyped(access.slot, ValueTag::Integer);
			sljit_emit_fop1(m_compiler, conversion, SLJIT_FR0, 0, source.reg, 0);
		} else if (access.store == NativeWordSource::Float) {
			const auto source = readTyped(access.slot, ValueTag::Float);
			sljit_emit_fop1(m_compiler, kind == MemoryAccessKind::F32LE ? SLJIT_MOV_F32 : SLJIT_CONV_F64_FROM_F32,
				SLJIT_FR0, 0, source.reg, 0);
		} else {
			emitRawLoad(access.slot, SLJIT_R0, SLJIT_R1);
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
		if (access.store == NativeWordSource::Dynamic)
			fault(guardTag(access.slot, ValueTag::Integer, SLJIT_R1), slow, m_cache.state());
		emitPayload(access.slot, SLJIT_R0);
		if constexpr (std::endian::native == std::endian::big)
			if (width != 1)
				sljit_emit_op1(m_compiler, width == 2 ? SLJIT_REV32_U16 : SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
		sljit_emit_op1(m_compiler, move, SLJIT_MEM1(SLJIT_R2), 0, SLJIT_R0, 0);
	}
	if (localIo) m_workspace.localIoWrites.push_back({io, sljit_emit_label(m_compiler), &slow, m_cache.state(),
		access.slot, access.store == NativeWordSource::Dynamic});
}
} // namespace bmsx
