#include "machine/cpu/cpu.h"
#include "machine/cpu/native_block.h"
#include "common/endian.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "machine/runtime/history/ram_history.h"
#include "spec/bmsx/model.h"
#include "spec/bmsx/io.h"
#include "spec/blua32/memory_access_kind.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

#include <algorithm>
#include <array>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <tuple>

namespace {
using namespace bmsx;

constexpr int NATIVE_WARM_SCALE = (NATIVE_BLOCK_COMPILATION_THRESHOLD + 7) / 8;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

struct CpuMachine {
	test::Blua32TestRom rom;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;
	CpuMachine(const test::Blua32TestImage& image, bool scalar = false, u32 bssBytes = test::RAM_CODE_FIXTURE_BYTES)
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image, bssBytes))
		, memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes)
		, irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		cpu.reset();
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	}
};

void requireParity(CpuMachine& native, CpuMachine& scalar) {
	const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
	require((a == b && bmsx::test::sameLanguageRam(native.cpu, scalar.cpu))
		&& native.cpu.luaHeap().usedBytes() == scalar.cpu.luaHeap().usedBytes() && native.cpu.luaHeap().collectionTarget() == scalar.cpu.luaHeap().collectionTarget(),
		"the complete value graph, allocation roots and heap accounting agree");
	require(std::tie(a.statusWord, a.causeWord, a.epcWord, a.badAddressWord, a.luaFaultReasonWord, a.exceptionDomainWord,
		a.nmiReturnCauseWord, a.nmiReturnEpcWord, a.nmiReturnBadAddressWord, a.nmiReturnLuaFaultReasonWord,
		a.nmiReturnExceptionDomainWord, a.nonMaskableInterruptPending, a.hardHalted, a.haltedUntilIrqFrameDepth,
		a.haltedUntilIrqThreadAddress, a.interruptEventPending, a.memoryWriteBlocked, a.memoryWriteBlockedAddress, a.yieldRequested)
		== std::tie(b.statusWord, b.causeWord, b.epcWord, b.badAddressWord, b.luaFaultReasonWord, b.exceptionDomainWord,
		b.nmiReturnCauseWord, b.nmiReturnEpcWord, b.nmiReturnBadAddressWord, b.nmiReturnLuaFaultReasonWord,
		b.nmiReturnExceptionDomainWord, b.nonMaskableInterruptPending, b.hardHalted, b.haltedUntilIrqFrameDepth,
		b.haltedUntilIrqThreadAddress, b.interruptEventPending, b.memoryWriteBlocked, b.memoryWriteBlockedAddress, b.yieldRequested),
		"all control words, interrupt and execution latches agree");
	require(native.cpu.lastPc == scalar.cpu.lastPc && native.cpu.readCurrentInstructionPc() == scalar.cpu.readCurrentInstructionPc(),
		"the physical instruction prefix/body boundary agrees");
	const auto& left = *native.cpu.activeThread(); const auto& right = *scalar.cpu.activeThread();
	const CallFrame* x = left.firstFrame; const CallFrame* y = right.firstFrame;
	require(left.frameDepth() == right.frameDepth(), "frame depths agree");
	for (size_t i = 0; i < left.frameDepth(); ++i, x = x->next, y = y->next) require(x->readControl(bmsx::FrameField::Pc) == y->readControl(bmsx::FrameField::Pc) && static_cast<bmsx::i32>(x->readControl(bmsx::FrameField::Top)) == static_cast<bmsx::i32>(y->readControl(bmsx::FrameField::Top))
		&& x->stackBase() == y->stackBase() && x->stackCapacity() == y->stackCapacity(), "live frame extents agree");
}

test::Blua32TestImage wordLoop(int count, bool displaced = false) {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 6, 0, 0); writeInstruction(image.text, 1, static_cast<u8>(OpCode::MOV), 8, 12, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::K1), 9, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::WIDE), 0, 0, count >> (displaced ? 6 : 9));
	writeInstruction(image.text, 4, static_cast<u8>(displaced ? OpCode::STORE_MEM_WORDS_D : OpCode::STORE_MEM_WORDS), 8, 0, count & 63,
		displaced ? 255 : (count >> 6) & 7);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::ADD), 7, 6, 9); writeInstruction(image.text, 6, static_cast<u8>(OpCode::JMP), 0, 63, 57, 255);
	writeInstruction(image.text, 32, static_cast<u8>(OpCode::HALT), 0, 0, 0); writeInstruction(image.text, 33, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 7, .maxStack = static_cast<u32>(std::max(16, 8 + count))}, {.firstWord = 32, .wordCount = 2}};
	image.exceptionFunctionIndex = 1; return image;
}

void pageTailEntry(int width, bool straddles) {
	test::Blua32TestImage image; image.text.resize(INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 1, .maxStack = 4}};
	CpuMachine native(image), scalar(image, true);
	const u32 pc = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE - (straddles ? 1u : width) * INSTRUCTION_BYTES;
	const u32 bodyPc = pc + (width - 1u) * INSTRUCTION_BYTES;
	std::array<u8, 2 * INSTRUCTION_BYTES> code{};
	if (width == 2) writeInstruction(code, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(code, width - 1, static_cast<u8>(OpCode::ADD), 3, 0, 1);
	for (auto* m : {&native, &scalar}) m->memory.writeBytes(pc, code.data(), width * INSTRUCTION_BYTES);
	for (int expected : {42, 34}) {
		for (int visit = 0; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++visit) {
			for (auto* m : {&native, &scalar}) {
				m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], pc);
				auto& frame = *m->cpu.activeThread()->frameAtDepth(0);
				frame.registers.set(0, valueInteger(38)); frame.registers.set(1, valueInteger(4)); frame.registers.set(3, valueInteger(7));
			}
			test::runCpuParity(native.cpu, scalar.cpu, 1); requireParity(native, scalar);
			require(native.cpu.readFrameRegister(0, 3) == valueInteger(expected)
				&& native.cpu.readFramePc(0) == pc + width * INSTRUCTION_BYTES && native.cpu.lastPc == bodyPc,
				"one cycle executes only the complete standalone tail instruction");
		}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		const u32 index = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		const auto& decoded = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
		test::waitForNativeEntry(native.cpu, decoded, index);
		DecodedInstructionPage* page = nullptr;
		for (auto& [key, candidate] : native.cpu.activeThread()->frameAtDepth(0)->executionImage->decodedPages) {
			if (candidate.nativeBlocks && candidate.nativeBlocks->entries[index]
				&& candidate.nativeBlocks->entries[index]->firstPc == pc) page = &candidate;
		}
		require(page && page->nativeBlocks->entries[index]->sourceWords == static_cast<u32>(width),
			"the hot page-tail instruction has its own generated entry and complete source extent");
#endif
		if (expected == 42) {
			writeInstruction(code, width - 1, static_cast<u8>(OpCode::SUB), 3, 0, 1);
			for (auto* m : {&native, &scalar}) m->memory.writeBytes(bodyPc, code.data() + (width - 1) * INSTRUCTION_BYTES, INSTRUCTION_BYTES);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			require(!page->nativeBlocks || !page->nativeBlocks->entries[index], "rewriting the body retires its owner, including a second-page WIDE body");
#endif
		} else {
			std::array<u32, 2> observations{}; size_t machine = 0;
			for (auto* m : {&native, &scalar}) {
				InstructionObserverBinding observer; observer.points[0].insert(pc); observer.context = &observations[machine++];
				observer.observe = [](void* context, ExecutionDomainId, u32, ConstValueSpan) { ++*static_cast<u32*>(context); };
				m->cpu.setInstructionObserver(std::move(observer));
				m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], pc);
			}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			require(!page->nativeBlocks || !page->nativeBlocks->entries[index], "installing an observer retires the page-tail body");
#endif
			test::runCpuParity(native.cpu, scalar.cpu, 1); requireParity(native, scalar);
			require(observations[0] == 1u && observations[1] == 1u, "both observers see the exact tail instruction once");
		}
	}
}

void pageTailBeforeFetchFault(bool wide) {
	test::Blua32TestImage image; image.text.resize(2 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::HALT), 0, 0, 0); writeInstruction(image.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 1, .maxStack = 4}, {.firstWord = 1, .wordCount = 1}};
	image.exceptionFunctionIndex = 1;
	CpuMachine native(image), scalar(image, true);
	const u32 end = native.memory.ramBusEnd(), width = wide ? 2u : 1u, pc = end - width * INSTRUCTION_BYTES;
	std::array<u8, 2 * INSTRUCTION_BYTES> code{};
	if (wide) writeInstruction(code, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(code, width - 1u, static_cast<u8>(OpCode::K1), 3, 0, 0);
	for (auto* m : {&native, &scalar}) m->memory.writeBytes(pc, code.data(), width * INSTRUCTION_BYTES);
	for (int visit = 0; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++visit) {
		for (auto* m : {&native, &scalar}) m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], pc);
		test::runCpuParity(native.cpu, scalar.cpu, 1); requireParity(native, scalar);
		require(native.cpu.readFrameRegister(0, 3) == valueInteger(1) && native.cpu.readFramePc(0) == end
			&& native.memory.readIoU32(IO_SYS_BUS_FAULT_CODE) == BUS_FAULT_NONE,
			"the final backed instruction completes without prefetching the absent next page");
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	test::waitForNativeEntry(native.cpu, page, (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
	require(page.nativeBlocks && page.nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES], "the last backed instruction is generated");
#endif
	test::runCpuParity(native.cpu, scalar.cpu, 1); requireParity(native, scalar);
	require(native.cpu.readEpcWord() == end && native.memory.readIoU32(IO_SYS_BUS_FAULT_CODE) == BUS_FAULT_UNMAPPED
		&& native.memory.readIoU32(IO_SYS_BUS_FAULT_ADDR) == end, "only the following grant raises the precise successor fetch fault");
}

void plainSpansAndCycles(int count, bool displaced) {
	const auto image = wordLoop(count, displaced); CpuMachine native(image), scalar(image, true);
	const u32 target = DYNAMIC_RAM_BASE + 0x2ffcu; const int surcharge = count;
	for (auto* m : {&native, &scalar}) {
		auto& r = m->cpu.activeThread()->frameAtDepth(0)->registers; r.set(0, valueInteger(target - (displaced ? 1020u : 0u))); r.set(12, valueInteger(73));
		for (int i = 0; i < count; ++i) if (i != 4) r.set(8 + i, valueInteger(i + 100));
		m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 20 * (7 + surcharge));
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	test::waitForNativeEntry(native.cpu, *native.cpu.activeThread()->frameAtDepth(0)->decodedPage,
		(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
	const auto& block = native.cpu.activeThread()->frameAtDepth(0)->decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(block && block->sourceWords == 5 && block->terminal.cycles == 9 + surcharge,
		"an admitted counted-store segment retains its complete surcharge");
	require(block->sideExits[0].exit == NativeBlockExit::WriteWords && block->sideExits[0].cycles == 9, "the checked exit precedes its own readiness surcharge");
#endif
	const std::array values{valueFloat(-0.f), valueFloat(-1.75f), valueFloat(0x1.000002p32f),
		valueFloat(std::numeric_limits<float>::max()), valueInteger(-1)};
	for (Value value : values) for (int grant : {1, 3, 4, 5, 5 + surcharge, 6 + surcharge, 7 + surcharge, 4 * (7 + surcharge)}) {
		for (auto* m : {&native, &scalar}) {
			m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
			auto& frame = *m->cpu.activeThread()->frameAtDepth(0); frame.registers.set(12, value); frame.writeControl(bmsx::FrameField::Top, 0);
		}
		test::runCpuParity(native.cpu, scalar.cpu, grant);
		requireParity(native, scalar); require(std::equal(native.memory.ramData(), native.memory.ramData() + PSX_MACHINE_SPEC.ramBytes, scalar.memory.ramData()), "all plain-RAM bytes agree at every short grant");
	}
	require(static_cast<bmsx::i32>(native.cpu.activeThread()->frameAtDepth(0)->readControl(bmsx::FrameField::Top)) == 10 && native.cpu.readFrameRegister(0, 7) == valueInteger(2), "source ranges never inflate top and clean cached values remain live after the native call");
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
void nativeRegisterSpillIsDirty() {
	test::Blua32TestImage image;
	image.text.resize(2 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::ADD), 3, 0, 1);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 2, .maxStack = 1025}};
	CpuMachine machine(image);
	const u32 pc = machine.rom.textAddress;
	auto& frame = *machine.cpu.activeThread()->currentFrame;
	frame.registers.set(0, valueInteger(40));
	frame.registers.set(1, valueInteger(2));
	for (int visit = 0; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++visit) {
		machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], pc);
		machine.cpu.runUntilDepth(0, 1);
	}
	const auto& decoded = *frame.decodedPage;
	const u32 index = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	test::waitForNativeEntry(machine.cpu, decoded, index);
	require(decoded.nativeBlocks && decoded.nativeBlocks->entries[index], "the spill fixture runs generated code");
	machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], pc);
	frame.registers.set(3, valueInteger(87));
	RamHistory archive;
	RamHistory::PageMap saved;
	archive.capture(machine.memory, nullptr, saved);
	const u32 page = frame.registers.wordAddress() >> MAPPED_PAGE_BYTE_SHIFT;
	require(page != frame.controlOffset >> MAPPED_PAGE_BYTE_SHIFT, "a PC write cannot dirty the register word page");
	machine.cpu.runUntilDepth(0, 1);
	require(frame.registers.get(3) == valueInteger(42), "the native spill publishes the new integer");
	require(machine.memory.ramWriteWatches().historyPageDirty(page, page + 1), "native spills dirty their backing page");
	archive.restore(machine.memory, saved, saved);
	require(frame.registers.get(3) == valueInteger(87), "a seek to the same base still restores its dirty register page");
}
#endif

void invalidWordAfterCommittedPrefix() {
	const auto image = wordLoop(3);
	for (const Value invalid : {valueFloatBits(0xffc01234u), valueFloatBits(0x7f800000u), valueNil(), valueBool(true)}) {
		CpuMachine native(image), scalar(image, true);
		const u32 pc = native.rom.textAddress + 3 * INSTRUCTION_BYTES;
		for (auto* m : {&native, &scalar}) {
			auto& r = m->cpu.activeThread()->currentFrame->registers;
			r.set(0, valueInteger(DYNAMIC_RAM_BASE)); r.set(8, valueFloat(-1.75f));
			r.set(9, valueInteger(92)); r.set(10, valueInteger(93));
			for (int i = 0; i < NATIVE_BLOCK_COMPILATION_THRESHOLD + 1; ++i) {
				m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], pc);
				m->cpu.runUntilDepth(0, 1);
			}
		}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		test::waitForNativeEntry(native.cpu, *native.cpu.activeThread()->currentFrame->decodedPage,
			(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
#endif
		for (auto* m : {&native, &scalar}) {
			for (u32 offset : {0u, 4u, 8u}) m->memory.writeMappedU32LE(DYNAMIC_RAM_BASE + offset, 0x87654321);
			m->cpu.activeThread()->currentFrame->registers.set(9, invalid);
			m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], pc);
		}
		test::runCpuParity(native.cpu, scalar.cpu, 1); requireParity(native, scalar);
		for (auto* m : {&native, &scalar}) {
			require(m->cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INVALID_ARGUMENT && m->cpu.readEpcWord() == pc
				&& m->cpu.instructionBudgetRemaining == 1 - 3 - 3, "invalid second word pays for the admitted span and faults at WIDE");
			require(m->memory.readMappedU32LE(DYNAMIC_RAM_BASE) == 0xffffffffu
				&& m->memory.readMappedU32LE(DYNAMIC_RAM_BASE + 4) == 0x87654321u
				&& m->memory.readMappedU32LE(DYNAMIC_RAM_BASE + 8) == 0x87654321u, "only the converted prefix commits");
		}
	}
}

void wideConstantAddress() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE); constexpr u32 target = DYNAMIC_RAM_BASE + 0x4000u;
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 2, 63, 1);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::STORE_MEM_WORDS), 0, 63, 1, 56);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 1025}}; image.constants = {static_cast<i32>(target)};
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) { for (int i = 0; i < 513; ++i) m->cpu.activeThread()->frameAtDepth(0)->registers.set(512 + i, valueInteger(i - 1)); m->cpu.runUntilDepth(0, (NATIVE_BLOCK_COMPILATION_THRESHOLD + 8) * (3 + 513 + 2)); }
	requireParity(native, scalar);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	test::waitForNativeEntry(native.cpu, *native.cpu.activeThread()->frameAtDepth(0)->decodedPage,
		(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
	const auto& block = native.cpu.activeThread()->frameAtDepth(0)->decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(block && block->sideExits[0].operands.memory.slot == 512 && block->sideExits[0].operands.memory.address == -1 && block->sideExits[0].operands.memory.wordCount == 513, "the native descriptor preserves the complete WIDE register range and signed RK address");
#endif
	require(native.memory.readMappedWord(target) == 0xffffffffu && native.memory.readMappedWord(target + 512u * 4u) == 511u && static_cast<bmsx::i32>(native.cpu.activeThread()->frameAtDepth(0)->readControl(bmsx::FrameField::Top)) == 0,
		"wide sources are converted as unsigned words without extending top");
}

void zeroCount(bool unaligned) {
	const auto image = wordLoop(0); CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) { m->cpu.activeThread()->frameAtDepth(0)->registers.set(0, valueInteger(DYNAMIC_RAM_BASE)); m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 140); }
	const std::array aligned{0u, 0xfffffffcu, IO_BASE + 0x5000u};
	for (size_t i = 0; i < (unaligned ? 1u : aligned.size()); ++i) {
		const u32 address = unaligned ? IO_BASE + 0x5001u : aligned[i];
		std::array<int, 2> probeCounts{};
		size_t index = 0;
		for (auto* m : {&native, &scalar}) {
			auto& probes = probeCounts[index++];
			m->memory.mapIoWrite(IO_BASE + 0x5000u, &probes, [](void*, u32, u32, MappedBusSignals) { throw std::runtime_error("an empty span must never write"); });
			m->memory.mapIoWriteReady(IO_BASE + 0x5000u, [](void* context, u32, MappedBusSignals) { ++*static_cast<int*>(context); return false; });
			m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
			m->cpu.activeThread()->frameAtDepth(0)->registers.set(0, valueInteger(address));
		}
		test::runCpuParity(native.cpu, scalar.cpu, 20);
		index = 0;
		for (auto* m : {&native, &scalar}) {
			require(probeCounts[index++] == 0 && m->memory.readBusFaultSequence() == 0u && !m->cpu.captureRuntimeState().memoryWriteBlocked, "empty spans neither preflight readiness nor access the bus");
			if (unaligned) require(m->cpu.readCauseWord() == CPU_CAUSE_CODE_ADDRESS_ERROR_STORE && m->cpu.readBadAddressWord() == address
				&& m->cpu.readEpcWord() == m->rom.textAddress + 3u * INSTRUCTION_BYTES, "alignment still faults at the WIDE prefix for an empty span");
			else require(m->cpu.readCauseWord() == 0u, "an aligned empty span accepts every raw mapped or unmapped address");
		}
		requireParity(native, scalar);
	}
}

void laterReadinessBeforeEarlierFault() {
	const auto image = wordLoop(3); CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		auto& r = m->cpu.activeThread()->frameAtDepth(0)->registers; r.set(0, valueInteger(DYNAMIC_RAM_BASE));
		for (int i = 8; i <= 12; ++i) r.set(i, valueInteger(0));
		m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 160);
	}
	struct Device { bool ready = false; std::vector<u32> probes; int writes = 0; }; std::array<Device, 2> devices;
	size_t index = 0;
	for (auto* m : {&native, &scalar}) {
		auto& device = devices[index++];
		for (u32 i = 0; i < 2u; ++i) {
			m->memory.mapIoWrite(IO_BASE + i * 4u, &device, [](void* context, u32, u32, MappedBusSignals) { ++static_cast<Device*>(context)->writes; });
			m->memory.mapIoWriteReady(IO_BASE + i * 4u, [](void* context, u32 address, MappedBusSignals) { auto& d = *static_cast<Device*>(context); d.probes.push_back(address); return address == IO_BASE || d.ready; });
		}
		m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
		m->cpu.activeThread()->frameAtDepth(0)->registers.set(0, valueInteger(IO_BASE - 4u));
		require(m->cpu.runUntilDepth(0, 20) == RunResult::Halted && m->cpu.instructionBudgetRemaining == 11 && m->memory.readBusFaultSequence() == 0u,
			"later not-ready IO wins over an earlier fault before charging the sequence");
		require(m->cpu.readFramePc(0) == m->rom.textAddress + 3u * INSTRUCTION_BYTES && m->cpu.stalledMemoryWriteAddress() == IO_BASE + 4u
			&& device.probes == std::vector<u32>{IO_BASE, IO_BASE + 4u} && device.writes == 0, "the first blocked raw word and prefix PC are retained");
		m->cpu.resumeMemoryWrite(IO_BASE); require(m->cpu.captureRuntimeState().memoryWriteBlocked, "an unrelated ready event does not release this store");
		device.ready = true; m->cpu.resumeMemoryWrite(IO_BASE + 4u); m->cpu.runUntilDepth(0, 1);
		require(m->cpu.instructionBudgetRemaining == -2 && m->cpu.readCauseWord() == CPU_CAUSE_CODE_DATA_BUS_ERROR
			&& m->cpu.readEpcWord() == m->rom.textAddress + 3u * INSTRUCTION_BYTES && device.writes == 0,
			"the resumed instruction charges its successful preflight, not its base again, before the earlier fault");
	}
	requireParity(native, scalar); require(devices[0].probes == devices[1].probes, "both paths issue identical readiness probes");
}

void orderedIoFaultPrefix() {
	const auto image = wordLoop(5); CpuMachine native(image), scalar(image, true); constexpr u32 target = IO_BASE + 0x5000u;
	for (auto* m : {&native, &scalar}) {
		auto& r = m->cpu.activeThread()->frameAtDepth(0)->registers; r.set(0, valueInteger(DYNAMIC_RAM_BASE));
		for (int i = 8; i <= 12; ++i) r.set(i, valueInteger(0));
		m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 180);
	}
	struct Device { Memory* memory; bool ready = true; std::vector<std::string> trace; std::vector<u32> values; };
	std::array<Device, 2> devices{{{&native.memory, true, {}, {}}, {&scalar.memory, true, {}, {}}}}; size_t index = 0;
	for (auto* m : {&native, &scalar}) {
		auto& device = devices[index++];
		for (u32 i = 0; i < 5u; ++i) {
			m->memory.mapIoWrite(target + i * 4u, &device, [](void* context, u32 address, u32 value, MappedBusSignals) {
				auto& d = *static_cast<Device*>(context); d.trace.push_back("w" + std::to_string((address - target) / 4u)); d.values.push_back(value); d.ready = false;
				if (address == target + 8u) d.memory->writeMappedWord(0xdead0000u, value);
			});
			m->memory.mapIoWriteReady(target + i * 4u, [](void* context, u32 address, MappedBusSignals) {
				auto& d = *static_cast<Device*>(context); d.trace.push_back("r" + std::to_string((address - target) / 4u)); return d.ready;
			});
		}
		auto& frame = *m->cpu.activeThread()->frameAtDepth(0); frame.registers.set(0, valueInteger(target)); frame.registers.set(12, valueInteger(42)); frame.registers.set(10, valueInteger(73)); frame.registers.set(7, valueInteger(99));
		m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress); m->cpu.runUntilDepth(0, 20);
		require(device.trace == std::vector<std::string>{"r0", "r1", "r2", "r3", "r4", "w0", "w1", "w2"} && device.values == std::vector<u32>{42u, 1u, 73u},
			"preflight happens once before the ordered store prefix, even if readiness changes while writing");
		require(m->cpu.readCauseWord() == CPU_CAUSE_CODE_DATA_BUS_ERROR && m->cpu.readEpcWord() == m->rom.textAddress + 3u * INSTRUCTION_BYTES
			&& frame.registers.get(7) == valueInteger(99) && !m->cpu.captureRuntimeState().memoryWriteBlocked, "the fault retains all completed effects without executing the successor");
	}
	requireParity(native, scalar); require(std::equal(native.memory.ramData(), native.memory.ramData() + PSX_MACHINE_SPEC.ramBytes, scalar.memory.ramData()), "retained IO words and bus fault registers agree");
}

void ownCodeInMiddleWatchPage() {
	constexpr int count = MAPPED_PAGE_BYTE_SIZE / 2 + 1, cycles = 13 + count;
	const auto image = wordLoop(count); CpuMachine native(image), scalar(image, true); constexpr u32 pc = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE;
	std::array<u8, 4> halt; writeInstruction(halt, 0, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	for (auto* m : {&native, &scalar}) {
		m->memory.writeBytes(pc, m->rom.bytes.data() + m->rom.textAddress, MAPPED_PAGE_BYTE_SIZE);
		m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], pc);
		for (int i = 0; i < count; ++i) m->cpu.activeThread()->frameAtDepth(0)->registers.set(8 + i, valueInteger(0));
		m->cpu.activeThread()->frameAtDepth(0)->registers.set(0, valueInteger(pc + 8u * MAPPED_PAGE_BYTE_SIZE)); m->cpu.runUntilDepth(0, (NATIVE_BLOCK_COMPILATION_THRESHOLD + 8) * cycles);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	test::waitForNativeEntry(native.cpu, page, 0);
	require(page.nativeBlocks->entries[0] != nullptr, "the watched source really has a native body");
#endif
	for (auto* m : {&native, &scalar}) {
		auto& frame = *m->cpu.activeThread()->frameAtDepth(0); for (int i = 0; i < count; ++i) frame.registers.set(8 + i, valueInteger(0));
		frame.registers.set(8 + MAPPED_PAGE_BYTE_SIZE / 4 + 5, valueInteger(readLE32(halt.data()))); frame.registers.set(7, valueInteger(99)); frame.registers.set(0, valueInteger(DYNAMIC_RAM_BASE));
		m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], pc);
		require(m->cpu.runUntilDepth(0, cycles) == RunResult::Halted && frame.registers.get(7) == valueInteger(99) && frame.readControl(bmsx::FrameField::Pc) == pc + 6u * INSTRUCTION_BYTES,
			"a middle-page watch leaves before storing and the replacement HALT, not stale ADD/JMP, runs afterwards");
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	require(!page.nativeBlocks, "writing the entire source page retires its native bodies and releases the empty entry bank");
#endif
	requireParity(native, scalar); require(std::equal(native.memory.ramData(), native.memory.ramData() + PSX_MACHINE_SPEC.ramBytes, scalar.memory.ramData()), "the full three-page write agrees");
}

void previousChargesSurviveLaterExit(bool blocked) {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 6, 0, 0); writeInstruction(image.text, 1, static_cast<u8>(OpCode::STORE_MEM_WORDS), 8, 0, 5);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::STORE_MEM_WORDS), 20, 1, 3); writeInstruction(image.text, 3, static_cast<u8>(OpCode::MOV), 7, 6, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255); writeInstruction(image.text, 32, static_cast<u8>(OpCode::HALT), 0, 0, 0); writeInstruction(image.text, 33, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 32}, {.firstWord = 32, .wordCount = 2}}; image.exceptionFunctionIndex = 1;
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) { auto& r = m->cpu.activeThread()->frameAtDepth(0)->registers;
		for (int i = 8; i < 23; ++i) r.set(i, valueInteger(0));
		r.set(0, valueInteger(DYNAMIC_RAM_BASE)); r.set(1, valueInteger(DYNAMIC_RAM_BASE + 64u)); m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 200); }
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	test::waitForNativeEntry(native.cpu, *native.cpu.activeThread()->frameAtDepth(0)->decodedPage,
		(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
	const auto& block = native.cpu.activeThread()->frameAtDepth(0)->decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(block && block->terminal.cycles == 10 && block->sideExits[0].cycles == 5, "the first block charges its successful surcharge");
	const auto* second = native.cpu.activeThread()->frameAtDepth(0)->decodedPage->nativeBlocks->entries[(block->terminal.nextPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES].get();
	require(second && second->region == block->region && second->terminal.cycles == 6 && second->sideExits[0].cycles == 3,
		"an internal counted entry separates admission, success and blocked preflight charges");
#endif
	for (auto* m : {&native, &scalar}) {
		m->memory.mapIoWrite(IO_BASE + 0x5000u, nullptr, [](void*, u32, u32, MappedBusSignals) { throw std::runtime_error("not ready"); });
		m->memory.mapIoWriteReady(IO_BASE + 0x5000u, [](void*, u32, MappedBusSignals) { return false; });
		auto& frame = *m->cpu.activeThread()->frameAtDepth(0); frame.writeControl(bmsx::FrameField::Top, 0); frame.registers.set(1, valueInteger(blocked ? IO_BASE + 0x5000u : m->memory.ramBusEnd() - 4u));
		frame.registers.set(7, valueInteger(99)); frame.registers.set(20, valueInteger(73));
		m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress); m->cpu.runUntilDepth(0, 20);
		require(frame.registers.get(7) == valueInteger(99) && static_cast<bmsx::i32>(frame.readControl(bmsx::FrameField::Top)) == 7, "the failing second store does not execute or publish a later definition");
		if (blocked) require(m->cpu.instructionBudgetRemaining == 7, "a later blocked preflight excludes only its own surcharge");
		else require(m->cpu.readCauseWord() == CPU_CAUSE_CODE_DATA_BUS_ERROR && m->memory.readMappedWord(m->memory.ramBusEnd() - 4u) == 73u, "a later fault keeps its committed word");
	}
	requireParity(native, scalar);
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
void typedSuccessorRechecksLoopEntry() {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 0, 1); // -> word 3
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::ADD), 1, 0, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::MOV), 2, 1, 0);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
	writeInstruction(image.text, 7, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255); // -5 -> word 3
	image.constants.emplace_back(Blua32FloatConstant{0x3fa00000u}); // 1.25
	image.functions = {{.firstWord = 0, .wordCount = 8, .maxStack = 3}};

	CpuMachine native(image), scalar(image, true);
	native.cpu.prepareSystemNativeCode();
	const u32 start = native.rom.textAddress;
	const u32 add = start + 3u * INSTRUCTION_BYTES;
	const u32 save = start + 5u * INSTRUCTION_BYTES;
	const auto* lookup = native.cpu.activeThread()->frameAtDepth(0)->executionImage->nativeCodeLookup.get();
	require(lookup, "the backed instruction page is published before the fixture runs");
	for (const u32 pc : {start, add}) {
		const auto* page = lookup->find(pc, 0);
		require(page && page->nativeBlocks && page->nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES],
			"both the forward producer and loop target have published native entries");
	}

	// First leave enough cycles to admit a whole second iteration. The Float
	// result must not depend on a short grant forcing scalar execution.
	constexpr int firstIterationCycles = 12; // K1, JMP, ADD, MOV, LOADK, JMP
	constexpr int subsequentIterationCycles = 8; // ADD, MOV, LOADK, JMP
	require(test::runCpuParity(native.cpu, scalar.cpu, firstIterationCycles + subsequentIterationCycles) == RunResult::Yielded,
		"both paths complete two loop iterations in the same grant");
	requireParity(native, scalar);
	const auto& frame = *native.cpu.activeThread()->frameAtDepth(0);
	const u32 backedge = start + 7u * INSTRUCTION_BYTES;
	require(frame.registers.get(2) == valueFloat(2.5f) && native.cpu.instructionBudgetRemaining == 0
		&& native.cpu.readCurrentInstructionPc() == backedge && native.cpu.lastPc == backedge
		&& frame.readControl(FrameField::Pc) == add,
		"the Float iteration completes at its backedge without the forward edge's Integer assumption");

	// Repeat with just one cycle left on the second arrival: it starts ADD,
	// but must not execute the following MOV.
	for (auto* machine : {&native, &scalar})
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], start);
	require(test::runCpuParity(native.cpu, scalar.cpu, firstIterationCycles + 1) == RunResult::Yielded,
		"both paths yield before the second MOV");
	requireParity(native, scalar);
	require(frame.registers.get(2) == valueInteger(2) && frame.registers.get(1) == valueFloat(2.5f),
		"the first sum stays Integer and the second sum uses the Float from the backedge");
	require(native.cpu.instructionBudgetRemaining == -1 && native.cpu.readCurrentInstructionPc() == add
		&& native.cpu.lastPc == add + INSTRUCTION_BYTES && frame.readControl(FrameField::Pc) == save,
		"the short grant pays only the started WIDE ADD and stops at its successor");
}
#endif

void terminalSpanStartsWithOneCycle(int count, bool displaced) {
	const auto image = wordLoop(count, displaced);
	const u32 bssBytes = std::max(test::RAM_CODE_FIXTURE_BYTES, 0x4000u + static_cast<u32>(count) * 4u);
	CpuMachine native(image, false, bssBytes), scalar(image, true, bssBytes);
	const u32 start = native.rom.textAddress + 3u * INSTRUCTION_BYTES, target = DYNAMIC_RAM_BASE + 0x4000u;
	const int charge = 3 + count;
	for (int attempt = 0; attempt < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++attempt) for (auto* m : {&native, &scalar}) {
		auto& frame = *m->cpu.activeThread()->frameAtDepth(0); frame.registers.set(0, valueInteger(target - (displaced ? 1020u : 0u))); frame.registers.set(7, valueInteger(99));
		for (int i = 0; i < count; ++i) frame.registers.set(8 + i, valueInteger(0x20000000u | i));
		m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], start);
		require(m->cpu.runUntilDepth(0, 1) == RunResult::Yielded && m->cpu.instructionBudgetRemaining == 1 - charge
			&& frame.readControl(bmsx::FrameField::Pc) == start + 2u * INSTRUCTION_BYTES && m->cpu.lastPc == start + INSTRUCTION_BYTES
			&& frame.registers.get(7) == valueInteger(99), "one cycle starts the complete WIDE store, but never the following ADD");
	}
	requireParity(native, scalar);
	require(std::equal(native.memory.ramData(), native.memory.ramData() + PSX_MACHINE_SPEC.ramBytes, scalar.memory.ramData()), "all RAM agrees after overrun by a terminal store");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	test::waitForNativeEntry(native.cpu, *native.cpu.activeThread()->frameAtDepth(0)->decodedPage,
		(start & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
	const auto& block = native.cpu.activeThread()->frameAtDepth(0)->decodedPage->nativeBlocks->entries[(start & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(block && block->sourceWords == 2 && block->terminal.cycles == charge,
		"a single counted WIDE store has a native body even when its cost exceeds every grant");
#endif
	if (count > 0) require(native.memory.readMappedWord(target) == 0x20000000u
		&& native.memory.readMappedWord(target + (count - 1) * 4u) == (0x20000000u | (count - 1)), "the entire terminal RAM span was written");
	if (count > 0) {
		for (auto* m : {&native, &scalar}) {
			m->memory.mapIoWrite(IO_BASE + 0x5000u, nullptr, [](void*, u32, u32, MappedBusSignals) { throw std::runtime_error("blocked store wrote a word"); });
			m->memory.mapIoWriteReady(IO_BASE + 0x5000u, [](void*, u32, MappedBusSignals) { return false; });
			auto& frame = *m->cpu.activeThread()->frameAtDepth(0); frame.registers.set(0, valueInteger(IO_BASE + 0x5000u - (displaced ? 1020u : 0u)));
			m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], start);
			require(m->cpu.runUntilDepth(0, 1) == RunResult::Halted && m->cpu.instructionBudgetRemaining == -2
				&& frame.readControl(bmsx::FrameField::Pc) == start && frame.registers.get(7) == valueInteger(99) && m->cpu.stalledMemoryWriteAddress() == IO_BASE + 0x5000u,
				"a one-cycle checked exit pays only the base charge and retains the WIDE retry address");
		}
		requireParity(native, scalar);
	}
}

// Alongside the pin-level candidate, report actual interpreter/native guest
// charges for the same public RAM operations. Pin clocks are not CPU prices.
void characterizeRamCharges() {
	for (int count : {0, 1, 4, 16, 256}) {
		const auto image = wordLoop(count); CpuMachine native(image), scalar(image, true);
		const u32 pc = native.rom.textAddress + 3u * INSTRUCTION_BYTES;
		for (auto* m : {&native, &scalar}) {
			auto& frame = *m->cpu.activeThread()->frameAtDepth(0);
			frame.registers.set(0, valueInteger(DYNAMIC_RAM_BASE));
			for (int i = 0; i < count; ++i) frame.registers.set(8 + i, valueInteger(0xcafe0000u + i));
			for (int visit = 0; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++visit) {
				for (int i = 0; i < std::max(count, 1); ++i) m->memory.writeMappedU32LE(DYNAMIC_RAM_BASE + 4u * i, 0xa5a5a5a5u);
				m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], pc);
				m->cpu.runUntilDepth(0, 1);
				for (int i = 0; i < count; ++i) require(m->memory.readMappedU32LE(DYNAMIC_RAM_BASE + 4u * i) == 0xcafe0000u + static_cast<u32>(i), "counted RAM characterization writes every word on every visit");
				if (count == 0) require(m->memory.readMappedU32LE(DYNAMIC_RAM_BASE) == 0xa5a5a5a5u, "empty counted write leaves the target untouched");
			}
		}
		require(native.cpu.instructionBudgetRemaining == 1 - 3 - count
			&& scalar.cpu.instructionBudgetRemaining == 1 - 3 - count, "both counted paths pay literal3 plus exactly C words, including zero");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		test::waitForNativeEntry(native.cpu, *native.cpu.activeThread()->frameAtDepth(0)->decodedPage,
			(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
		const auto& entry = native.cpu.activeThread()->frameAtDepth(0)->decodedPage->nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
		require(static_cast<bool>(entry), "counted RAM characterization produces a native entry");
#endif
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		const char* mode = "cpp_native_enabled";
#else
		const char* mode = "cpp_native_off";
#endif
		std::cout << "RAM_CHARACTERIZE candidate=runtime backend=" << mode << " workload=cpu_counted_u32_write words=" << count << " guest_cycles=" << 1 - native.cpu.instructionBudgetRemaining << '\n';
		std::cout << "RAM_CHARACTERIZE candidate=runtime backend=cpp_instrumented_interpreter workload=cpu_counted_u32_write words=" << count << " guest_cycles=" << 1 - scalar.cpu.instructionBudgetRemaining << '\n';
	}
	for (OpCode op : {OpCode::STORE_MEM, OpCode::LOAD_MEM}) for (MemoryAccessKind kind : {MemoryAccessKind::U8, MemoryAccessKind::U16LE, MemoryAccessKind::U32LE, MemoryAccessKind::F32LE, MemoryAccessKind::F64LE}) {
		test::Blua32TestImage image; image.text.resize(2 * INSTRUCTION_BYTES);
		writeInstruction(image.text, 0, static_cast<u8>(op), 1, 0, static_cast<u8>(kind));
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		image.functions = {{.firstWord = 0, .wordCount = 2, .maxStack = 2}};
		CpuMachine native(image), scalar(image, true);
		for (auto* m : {&native, &scalar}) {
			auto& frame = *m->cpu.activeThread()->frameAtDepth(0);
			frame.registers.set(0, valueInteger(DYNAMIC_RAM_BASE));
			for (int visit = 0; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++visit) {
				if (op == OpCode::LOAD_MEM) {
					frame.registers.set(1, valueInteger(-123));
					if (kind == MemoryAccessKind::F64LE) m->memory.writeMappedF64LE(DYNAMIC_RAM_BASE, 17);
					else if (kind == MemoryAccessKind::F32LE) m->memory.writeMappedF32LE(DYNAMIC_RAM_BASE, 17.f);
					else m->memory.writeMappedU32LE(DYNAMIC_RAM_BASE, 17);
				} else {
					frame.registers.set(1, valueInteger(17));
					m->memory.writeMappedU32LE(DYNAMIC_RAM_BASE, 0xa5a5a5a5);
					m->memory.writeMappedU32LE(DYNAMIC_RAM_BASE + 4, 0xa5a5a5a5);
				}
				m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
				m->cpu.runUntilDepth(0, 1);
				if (op == OpCode::LOAD_MEM) require(frame.registers.get(1) == (kind == MemoryAccessKind::F32LE || kind == MemoryAccessKind::F64LE ? valueFloat(17.f) : valueInteger(17)), "scalar RAM load replaces the sentinel register");
				else if (kind == MemoryAccessKind::F64LE) {
					require(m->memory.readMappedF64LE(DYNAMIC_RAM_BASE) == 17 && m->memory.readMappedU32LE(DYNAMIC_RAM_BASE) == 0
						&& m->memory.readMappedU32LE(DYNAMIC_RAM_BASE + 4) == 0x40310000u, "F64 RAM store replaces both sentinel words");
				} else {
					const u32 expected = kind == MemoryAccessKind::U8 ? 0xa5a5a511u : kind == MemoryAccessKind::U16LE ? 0xa5a50011u : kind == MemoryAccessKind::F32LE ? 0x41880000u : 17u;
					require(m->memory.readMappedU32LE(DYNAMIC_RAM_BASE) == expected && m->memory.readMappedU32LE(DYNAMIC_RAM_BASE + 4) == 0xa5a5a5a5u,
						"scalar RAM store replaces only the addressed bytes");
				}
			}
		}
		require(native.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining, "native/interpreter scalar guest charges agree");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		test::waitForNativeEntry(native.cpu, *native.cpu.activeThread()->frameAtDepth(0)->decodedPage,
			(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
		const auto& entry = native.cpu.activeThread()->frameAtDepth(0)->decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
		require(static_cast<bool>(entry), "scalar RAM characterization produces a native entry");
#endif
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		const char* mode = "cpp_native_enabled";
#else
		const char* mode = "cpp_native_off";
#endif
		for (auto [name, m] : {std::pair{mode, &native}, std::pair{"cpp_instrumented_interpreter", &scalar}})
			std::cout << "RAM_CHARACTERIZE candidate=runtime backend=" << name << " workload=cpu_scalar_" << (op == OpCode::STORE_MEM ? "write" : "read") << " kind=" << static_cast<int>(kind) << " guest_cycles=" << 1 - m->cpu.instructionBudgetRemaining << '\n';
	}
}
} // namespace

int main() {
	try {
		characterizeRamCharges();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		require(!nativeBlockSupports(static_cast<u8>(OpCode::WIDE)), "WIDE is a decode prefix");
		for (size_t op = 1; op < OPCODE_COUNT; ++op) require(nativeBlockSupports(op), "every executable BLua32 opcode is admitted by native codegen");
		nativeRegisterSpillIsDirty();
		typedSuccessorRechecksLoopEntry();
#endif
		for (bool displaced : {false, true}) for (int count : {0, 5, 1025}) plainSpansAndCycles(count, displaced);
		pageTailEntry(1, false); pageTailEntry(2, false); pageTailEntry(2, true);
		pageTailBeforeFetchFault(false); pageTailBeforeFetchFault(true);
		invalidWordAfterCommittedPrefix(); wideConstantAddress(); zeroCount(false); zeroCount(true); laterReadinessBeforeEarlierFault(); orderedIoFaultPrefix(); ownCodeInMiddleWatchPage();
		previousChargesSurviveLaterExit(false); previousChargesSurviveLaterExit(true);
		for (bool displaced : {false, true}) for (int count : {0, 1025, displaced ? 4095 : 32767}) terminalSpanStartsWithOneCycle(count, displaced);
		std::cout << "Compiled CPU word-span tests passed\n"; return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
