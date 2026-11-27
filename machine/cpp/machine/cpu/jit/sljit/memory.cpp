#include "machine/cpu/jit/sljit/lowering.h"

#include <bit>
#include <limits>
#include "machine/cpu/cpu.h"
#include "machine/cpu/gc_heap.h"
#include "machine/cpu/gc_object.h"
#include "machine/cpu/jit/sljit/table_access.h"
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
void SLJIT_FUNC writeNativeTableBarrier(GcHeap* heap, u32 address, u32 word, u32 tag) {
	heap->writeBlackTableValue(address, valueFromTag(static_cast<ValueTag>(tag), word));
}
void SLJIT_FUNC markNativeGlobalWrite(GcHeap* heap, u32 word, u32 tag) {
	heap->markGlobalWrite(valueFromTag(static_cast<ValueTag>(tag), word));
}
} // namespace

void NativeLowering::emitRamWordWriteWatch(NativeBlockExitSite& slow, sljit_s32 address, sljit_sw addressArg,
	sljit_s32 bits, sljit_s32 group, std::optional<u32> codeWords, bool observeBytes) {
	const u32 ownerFlags = (m_bindings.historyWriteWatches ? MAPPED_WATCH_HISTORY_CLEAN : 0u)
		| (observeBytes ? MAPPED_WATCH_PHYSICAL_BYTES : 0u);
	if (!codeWords && ownerFlags == 0u) return;
	auto* c = m_compiler;
	sljit_emit_op2(c, SLJIT_LSHR32, bits, 0, address, addressArg, SLJIT_IMM, MAPPED_PAGE_BYTE_SHIFT - 2u);
	sljit_emit_op2(c, SLJIT_AND32, bits, 0, bits, 0, SLJIT_IMM, -4);
	sljit_emit_op1(c, SLJIT_MOV_U32, bits, 0, SLJIT_MEM1(bits), reinterpret_cast<sljit_sw>(m_bindings.ramWriteGroups));
	auto* clear = codeWords ? sljit_emit_cmp(c, SLJIT_EQUAL, bits, 0, SLJIT_IMM, 0) : nullptr;
	if (ownerFlags != 0u) {
		sljit_emit_op2(c, SLJIT_AND32, group, 0, bits, 0, SLJIT_IMM, ownerFlags);
		fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, group, 0, SLJIT_IMM, 0), slow, m_cache.state());
	}
	if (!codeWords) return;
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

void NativeLowering::emitStoreBarrier(int source, NativeGcBarrier barrier, StoreBarrierRecord record, NativeBlockExitSite& exit) {
	const bool global = record == StoreBarrierRecord::Global;
	if (barrier == NativeGcBarrier::None || (global && !m_bindings.gcPhase)) return;
	auto* c = m_compiler;
	// A Table already has its receiver in the scratch. A closed Cell
	// uses the same slow exit as a watched or open SETUP.
	const bool cell = record == StoreBarrierRecord::ClosedUpvalue;
	const auto address = cell ? SLJIT_R2 : SLJIT_R0;
	const auto flags = global ? SLJIT_R1 : cell ? SLJIT_R0 : SLJIT_R2;
	const auto test = cell ? SLJIT_R1 : SLJIT_R3;
	std::array<sljit_jump*, 2> scalar{};
	if (barrier == NativeGcBarrier::Dynamic) {
		// Match valueTagHasGcEdge: BuiltinFunction is not a heap edge.
		constexpr auto first = static_cast<u8>(ValueTag::String);
		// Global stores have just written their tag from R1.
		if (!global) emitTag(source, flags);
		sljit_emit_op2(c, SLJIT_SUB32, flags, 0, flags, 0, SLJIT_IMM, first);
		scalar = {
			sljit_emit_cmp(c, SLJIT_GREATER | SLJIT_32, flags, 0, SLJIT_IMM, static_cast<u8>(ValueTag::Thread) - first),
			sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, flags, 0, SLJIT_IMM, static_cast<u8>(ValueTag::BuiltinFunction) - first),
		};
	}
	sljit_jump* mutation;
	if (global) {
		sljit_emit_op1(c, SLJIT_MOV_U8, flags, 0, SLJIT_MEM0(), reinterpret_cast<sljit_sw>(m_bindings.gcPhase));
		sljit_emit_op2(c, SLJIT_AND32, flags, 0, flags, 0, SLJIT_IMM, 7);
		sljit_emit_op2(c, SLJIT_SUB32, flags, 0, flags, 0, SLJIT_IMM, static_cast<u8>(GcPhase::Mark));
		mutation = sljit_emit_cmp(c, SLJIT_LESS_EQUAL | SLJIT_32, flags, 0, SLJIT_IMM,
			static_cast<u8>(GcPhase::Atomic) - static_cast<u8>(GcPhase::Mark));
	} else {
		sljit_emit_op1(c, SLJIT_MOV_U8, flags, 0, SLJIT_MEM1(address), GC_COLOR_OFFSET);
		sljit_emit_op2(c, SLJIT_AND32, test, 0, flags, 0, SLJIT_IMM, GC_COLOR_MASK);
		mutation = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, test, 0, SLJIT_IMM, 3);
	}
	if (barrier == NativeGcBarrier::Dynamic) {
		auto* ready = sljit_emit_label(c);
		for (auto* skip : scalar) if (skip) sljit_set_label(skip, ready);
	}
	if (cell) {
		fault(mutation, exit, m_cache.state());
		return;
	}
	m_workspace.storeBarriers.push_back({mutation, m_cache.state(), sljit_emit_label(c), record, source});
}

void NativeLowering::emitStoreBarriers() {
	auto* c = m_compiler;
	for (const auto& barrier : m_workspace.storeBarriers) {
		sljit_set_label(barrier.mutation, sljit_emit_label(c));
		m_cache.setState(barrier.registers);
		const bool global = barrier.record == StoreBarrierRecord::Global;
		constexpr auto savedAddress = NativeTableScratch::receiver;
		// The leaf marks or enqueues the exact input, without tracing,
		// allocating or inspecting any unpublished activation.
		emitRawLoad(barrier.source, global ? SLJIT_R1 : SLJIT_R2, global ? SLJIT_R2 : SLJIT_R3);
		m_cache.spillCall(false, 0, NativeRegisterCache::FrameSlots::Unchanged);
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, heap));
		if (global) {
			sljit_emit_icall(c, SLJIT_CALL, SLJIT_ARGS3V(P, 32, 32), SLJIT_IMM, SLJIT_FUNC_ADDR(&markNativeGlobalWrite));
		} else {
			sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), savedAddress);
			sljit_emit_icall(c, SLJIT_CALL, SLJIT_ARGS4V(P, 32, 32, 32), SLJIT_IMM, SLJIT_FUNC_ADDR(&writeNativeTableBarrier));
		}
		m_cache.spillCall(true, 0, NativeRegisterCache::FrameSlots::Unchanged);
		if (!global) {
			sljit_emit_op2(c, SLJIT_AND32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), savedAddress, SLJIT_IMM, RAM_RECORD_WORD_MASK);
			NativeBlockAbi::emitRamAddress(c, SLJIT_R0, SLJIT_R0);
		}
		sljit_set_label(sljit_emit_jump(c, SLJIT_JUMP), barrier.resume);
	}
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
	if (kind == MemoryAccessKind::Value) {
		// The private owner transfers both planes as one decoded instruction.
		emitLeave(slow, Charge::Pending);
		return;
	}
	const bool words = access.mode == NativeMemoryMode::StoreWords;
	const bool load = access.mode == NativeMemoryMode::Load;
	const u32 width = words ? static_cast<u32>(access.wordCount) * sizeof(u32)
		: kind == MemoryAccessKind::U8 ? 1u : kind == MemoryAccessKind::U16LE ? 2u : kind == MemoryAccessKind::F64LE ? 8u : 4u;
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
			emitRamWordWriteWatch(slow, SLJIT_R1, 0, SLJIT_R3, SLJIT_R2, std::nullopt, true);
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
		emitRamWordWriteWatch(slow, SLJIT_R1, 0, SLJIT_R3, SLJIT_R2, 1u, true);
		if (width == 8) {
			sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R0, 0, SLJIT_R1, 0, SLJIT_IMM, 4);
			emitRamWordWriteWatch(slow, SLJIT_R0, 0, SLJIT_R3, SLJIT_R2, 1u, true);
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
