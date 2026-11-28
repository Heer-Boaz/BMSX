#include "common/endian.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/decoded_instruction.h"
#include "common/compiler.h"
#include "machine/cpu/jit/runtime/block.h"
#include "support/gc_heap_reference.h"
#include "support/native_region_fixture.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"
#include "spec/blua32/cop0.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"
#include "spec/bmsx/rom_header.h"
#include "support/blua32_test_rom.h"
#include "support/closure_fixture.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"
#include "support/managed_fixture.h"

#include <algorithm>
#include <array>
#include <iostream>
#include <stdexcept>

namespace {
using namespace bmsx;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

Value scalarLoad(Memory& memory, MemoryAccessKind kind, u32 address) {
	switch (kind) {
		case MemoryAccessKind::Word: return valueInteger(memory.readMappedWord(address));
		case MemoryAccessKind::U8: return valueInteger(memory.readMappedU8(address));
		case MemoryAccessKind::U16LE: return valueInteger(memory.readMappedU16LE(address));
		case MemoryAccessKind::U32LE: return valueInteger(memory.readMappedU32LE(address));
		case MemoryAccessKind::F32LE: return valueFloatBits(memory.readMappedU32LE(address));
		case MemoryAccessKind::F64LE: return valueFloat(static_cast<float>(memory.readMappedF64LE(address)));
	}
	BMSX_UNREACHABLE();
}

struct CpuMachine {
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;
	DeviceScheduler scheduler;
	DmaController dma;
	CpuMachine(const test::Blua32TestRom& rom, const CartridgeSocketMediaPair& slots, bool scalar)
		: memory(MemoryInit{rom.bytes, slots}, PSX_MACHINE_SPEC.ramBytes), irq(memory), addresses(memory)
		, cpu(memory, irq, addresses), scheduler(cpu), dma(memory, cpu, irq, scheduler) {
		memory.cartridgeController().connect(memory, irq, dma);
		test::seedManagedFixture(cpu, addresses);
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	}
};

void sparseCodeLookupPreservesPageOwners() {
	NativeCodeLookup lookup;
	DecodedInstructionPage first(MappedPageBinding{0, true, nullptr, {}}), second(MappedPageBinding{0, true, nullptr, {}});
	for (const u32 address : {0u, 0x003ffc00u, 0x00400000u, DYNAMIC_RAM_BASE, CART_ROM_BASE, 0xfffffc00u}) {
		require(!lookup.find(address, 0) && !lookup.find(address, 1), "an uncompiled page is absent from both socket banks");
		lookup.install(address, 0, first);
		require(lookup.find(address + MAPPED_PAGE_BYTE_SIZE - INSTRUCTION_BYTES, 0) == &first,
			"the sparse index preserves page identity across unsigned address and group boundaries");
		if (address < CART_ROM_BASE) {
			require(lookup.find(address, 1) == &first, "system ROM and main RAM have no socket-dependent identity");
		} else {
			require(!lookup.find(address, 1), "a cold cartridge socket does not alias the other socket's page");
			lookup.install(address, 1, second);
			require(lookup.find(address, 0) == &first && lookup.find(address, 1) == &second,
				"each cartridge socket owns distinct code at the same virtual address");
		}
	}
}

test::Blua32TestImage loadLoop(MemoryAccessKind kind, bool displaced = false) {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(displaced ? OpCode::LOAD_MEM_D : OpCode::LOAD_MEM), 0, 1,
		static_cast<u8>(kind), displaced ? 255 : 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::ADD), 3, 0, 2);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::MOV), 5, 3, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 8}, {.firstWord = 5, .wordCount = 1}};
	image.exceptionFunctionIndex = 1;
	return image;
}

void directRomLoadsUseCurrentOwners() {
	std::vector<u8> systemBacking(73), slot0Backing(36), slot1Backing(46);
	auto system = std::span(systemBacking).subspan(1, 72);
	auto slot0 = std::span(slot0Backing).subspan(3, 33);
	auto slot1 = std::span(slot1Backing).subspan(5, 41);
	for (u32 i = 0; i < system.size(); ++i) system[i] = static_cast<u8>(i * 17u + 3u);
	for (u32 i = 0; i < slot0.size(); ++i) slot0[i] = static_cast<u8>(i * 7u + 11u);
	for (u32 i = 0; i < slot1.size(); ++i) slot1[i] = static_cast<u8>(i * 13u + 5u);
	// The same eight unaligned host bytes mean a raw signaling NaN to F32LE
	// and a negative NaN to F64LE, which rounds to the guest canonical Float.
	writeLE32(slot0.data() + 4, 0x7fa12345u);
	writeLE32(slot0.data() + 8, 0xfff80000u);
	writeLE32(slot1.data() + 4, 0x80000000u);
	writeLE32(slot1.data() + 8, 0x3ff00000u);
	Memory memory(MemoryInit{system, test::cartridgeSlots(slot0, slot1)}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory);
	ExecutionAddressSpace addresses(memory);
	CPU cpu(memory, irq, addresses);
	DeviceScheduler scheduler(cpu);
	DmaController dma(memory, cpu, irq, scheduler);
	memory.cartridgeController().connect(memory, irq, dma);
	for (int format = 0; format <= 5; ++format) for (const bool displaced : {false, true}) {
		const auto kind = static_cast<MemoryAccessKind>(format);
		const u32 width = format == 1 ? 1u : format == 2 ? 2u : format == 5 ? 8u : 4u;
		DecodedInstruction load;
		load.op = static_cast<u8>(displaced ? OpCode::LOAD_MEM_D : OpCode::LOAD_MEM);
		load.a = 0; load.b = 1; load.c = format; load.setBx(displaced ? 255 : 0); load.width = 2; load.baseCycles = BASE_CYCLES[load.op];
		const std::array source{NativeBlockInstruction{&load, 0x1000}};
		const int charge = BASE_CYCLES[load.op] + (kind == MemoryAccessKind::F64LE ? 2 : 0);
		auto block = test::compileNative(source, memory, cpu.stringPool());
		for (const u32 select : {0xfffffffdu, 0x80000000u}) {
			memory.writeMappedWord(IO_CART_SELECT, select);
			for (const u32 address : {0u, 4u, 16u, CART_ROM_BASE, CART_ROM_BASE + 4u, CART_ROM_BASE + 24u}) {
				ValueSlots registers(2);
				registers.set(1, valueInteger(address - static_cast<u32>(load.bx()) * 4u));
				NativeBlockRunState run{};
				run.remainingCycles = charge;
				require(block->run(registers.view(), run) == &block->terminal && run.remainingCycles == 0
					&& registers.get(0) == scalarLoad(memory, kind, address), "backed system and cartridge ROM reads stay in the native block");
			}
		}
		for (u32 address : {SYSTEM_ROM_SIZE - 4u, 72u, CART_ROM_BASE + 32u, CART_ROM_END - 4u}) {
			ValueSlots registers(2);
			registers.set(0, valueInteger(73));
			registers.set(1, valueInteger(address - static_cast<u32>(load.bx()) * 4u));
			const bool backed = address >= CART_ROM_BASE && address < CART_ROM_END
				&& address - CART_ROM_BASE + width <= slot0.size();
			NativeBlockRunState run{};
			run.remainingCycles = charge;
			const auto* exit = block->run(registers.view(), run);
			require((exit == &block->terminal) == backed, "short tails and logical boundary crossings use the ordered bus owner");
			if (!backed) require(registers.get(0) == valueInteger(73) && exit->exit == NativeBlockExit::ReadMemory
				&& registers.get(1) == valueInteger(address - static_cast<u32>(load.bx()) * 4u),
				"a ROM side exit preserves its raw address and has not committed its destination");
		}
		load.a = load.b;
		const std::array aliasSource{NativeBlockInstruction{&load, 0x1000}};
		auto alias = test::compileNative(aliasSource, memory, cpu.stringPool());
		ValueSlots registers(2);
		registers.set(1, valueInteger(CART_ROM_BASE + 4u - load.bx() * 4u));
		NativeBlockRunState run{};
		run.remainingCycles = charge;
		require(alias->run(registers.view(), run) == &alias->terminal
			&& registers.get(1) == scalarLoad(memory, kind, CART_ROM_BASE + 4u), "ROM loads can replace the address register");
	}
}

void romReplacementAndSelectionKeepRamCode() {
	constexpr u32 data = 0x800u;
	auto image = loadLoop(MemoryAccessKind::Word);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::RFE), 0, 0, 0);
	auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image, test::RAM_CODE_FIXTURE_BYTES);
	rom.bytes.resize(0x1000);
	writeLE32(rom.bytes.data() + data, 11);
	std::vector<u8> slot0(16), slot1(16);
	writeLE32(slot0.data(), 22); writeLE32(slot1.data(), 33);
	for (const bool scalar : {false, true}) {
		CpuMachine machine(rom, test::cartridgeSlots(slot0, slot1), scalar);
		auto& cpu = machine.cpu;
		machine.memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
		auto& frame = *cpu.activeThread()->frameAtDepth(0);
		frame.registers.set(1, valueInteger(data)); frame.registers.set(2, valueInteger(1));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 1000);
		auto& page = *frame.decodedPage;
		if (!scalar) test::waitForNativeEntry(cpu, page, 0);
		const NativeBlock* block = scalar ? nullptr : page.nativeBlocks->entries[0].get();
		if (!scalar) require(block && block->sourceWords == 5, "ROM and arithmetic share an actual native RAM entry");
		auto replacement = rom.bytes;
		writeLE32(replacement.data() + data, 44);
		machine.memory.installSystemRom(replacement);
		cpu.runUntilDepth(0, 9);
		require(frame.registers.get(0) == valueInteger(44), "RAM code reads newly installed system ROM without a stale pointer");
		if (!scalar) require(page.nativeBlocks->entries[0].get() == block, "data replacement does not retire independent RAM code");
		frame.registers.set(1, valueInteger(CART_ROM_BASE));
		for (u32 select : {0xfffffffeu, 0xffffffffu, 0u, 1u}) {
			machine.memory.writeMappedWord(IO_CART_SELECT, select);
			cpu.runUntilDepth(0, 9);
			require(frame.registers.get(0) == valueInteger((select & 1u) != 0u ? 33 : 22), "ROM reads consume the raw data SELECT latch, masking only bit zero");
		}
		writeLE32(replacement.data() + data, 55);
		machine.memory.cartridgeController().installRom(1, std::span<const u8>(replacement).subspan(data, 16));
		cpu.runUntilDepth(0, 9);
		require(frame.registers.get(0) == valueInteger(55), "selected cartridge ROM replacement updates its existing storage identity");
		if (!scalar) require(page.nativeBlocks->entries[0].get() == block, "cartridge ROM replacement preserves unrelated RAM code");
		const std::array<u8, 3> tail{0x55, 0x33, 0x11};
		machine.memory.cartridgeController().installRom(1, tail);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		const auto oldTop = frame.readWindow(FrameField::Top);
		require(cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::LOAD_MEM)]) == RunResult::Yielded
			&& cpu.readCauseWord() == CPU_CAUSE_CODE_DATA_BUS_ERROR && cpu.readEpcWord() == DYNAMIC_RAM_BASE,
			"existing native code discovers a shortened ROM and takes the data-bus exception at the WIDE head");
		require(frame.registers.get(0) == valueInteger(55) && frame.readWindow(FrameField::Top) == oldTop
			&& machine.memory.readIoU32(IO_SYS_BUS_FAULT_CODE) == BUS_FAULT_UNMAPPED
			&& machine.memory.readIoU32(IO_SYS_BUS_FAULT_ADDR) == CART_ROM_BASE
			&& machine.memory.readIoU32(IO_SYS_BUS_FAULT_ACCESS) == (BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_WORD),
			"the unbacked word is not committed and retains the ordinary physical read address and width");
		const auto state = machine.memory.cartridgeController().captureState();
		machine.memory.cartridgeController().reset();
		require(cpu.runUntilDepth(1, 20) == RunResult::Halted, "RFE restores the interrupted RAM-code window");
		cpu.runUntilDepth(0, 9);
		require(frame.registers.get(0) == valueInteger(22), "reset changes data selection without recreating the native entry");
		machine.memory.cartridgeController().restoreState(state);
		machine.memory.cartridgeController().installRom(1, std::span<const u8>(replacement).subspan(data, 16));
		cpu.runUntilDepth(0, 9);
		require(frame.registers.get(0) == valueInteger(55), "existing native code readmits a complete read after media growth");
		if (!scalar) require(page.nativeBlocks->entries[0].get() == block,
			"changing the selected data range never needs to retire the independent native RAM code");
	}
}

void tailsAndShortBudgetsAgree() {
	for (int format = 0; format <= 5; ++format) for (const bool displaced : {false, true}) {
		const auto kind = static_cast<MemoryAccessKind>(format);
		auto image = loadLoop(kind, displaced);
		writeInstruction(image.text, 5, static_cast<u8>(OpCode::RFE), 0, 0, 0);
		auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image, test::RAM_CODE_FIXTURE_BYTES);
		rom.bytes.resize(0x803); rom.bytes[0x800] = 0x55; rom.bytes[0x801] = 0x33; rom.bytes[0x802] = 0x11;
		std::vector<u8> card{0x55, 0x33, 0x11};
		CpuMachine native(rom, test::cartridgeSlots(card), false), scalar(rom, test::cartridgeSlots(card), true);
		for (auto* machine : {&native, &scalar}) {
			auto& frame = *machine->cpu.activeThread()->frameAtDepth(0);
			frame.registers.set(1, valueInteger(DYNAMIC_RAM_BASE + 0x1000u - (displaced ? 1020u : 0u)));
			frame.registers.set(2, valueInteger(1));
			machine->cpu.runUntilDepth(0, 1000);
		}
		for (u32 address : {0x800u, 0x804u, CART_ROM_BASE, CART_ROM_BASE + 4u}) for (int grant = 1; grant <= 17; ++grant) {
			for (auto* machine : {&native, &scalar}) {
				machine->cpu.activeThread()->frameAtDepth(0)->registers.set(1, valueInteger(address - (displaced ? 1020u : 0u)));
				machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress);
			}
			test::runCpuParity(native.cpu, scalar.cpu, grant);
			require(native.cpu.readFrameRegister(0, 0) == scalar.cpu.readFrameRegister(0, 0)
				&& native.cpu.readFrameRegister(0, 5) == scalar.cpu.readFrameRegister(0, 5)
				&& native.cpu.readFramePc(0) == scalar.cpu.readFramePc(0) && native.cpu.lastPc == scalar.cpu.lastPc,
				"ROM backing faults, WIDE extents and every short grant agree with scalar execution");
			require(native.memory.readBusFaultSequence() == scalar.memory.readBusFaultSequence()
				&& native.memory.readIoU32(IO_SYS_BUS_FAULT_ADDR) == scalar.memory.readIoU32(IO_SYS_BUS_FAULT_ADDR),
				"executable tiers attempt the same bus accesses");
			for (auto* machine : {&native, &scalar}) {
				if (machine->cpu.getFrameDepth() > 1u)
					require(machine->cpu.runUntilDepth(1, 20) == RunResult::Halted, "each trial returns from its exception");
				machine->memory.writeMappedWord(IO_SYS_BUS_FAULT_ACK, 1u);
			}
		}
	}
}

void romDoublesFaultAtTheFirstUnbackedWord() {
	auto rom = test::encodeBlua32TestRom(RomImageDomain::System, loadLoop(MemoryAccessKind::F64LE), test::RAM_CODE_FIXTURE_BYTES);
	const u32 data = (static_cast<u32>(rom.bytes.size()) + 3u) & ~3u;
	rom.bytes.resize(data + 7u);
	writeLE32(rom.bytes.data() + data, 0x12345678u);
	const std::array<u8, 7> cartridge{1, 2, 3, 4, 5, 6, 7};
	const CartridgeSocketMediaPair slots{CartridgeCardMedia{cartridge, 7u, false}, std::nullopt};
	for (const bool scalar : {false, true}) {
		struct Read { u32 address, slot, failingWord; };
		for (const auto [address, slot, failingWord] : std::array<Read, 5>{{
			{data, 0u, data + 4u},
			{data + 4u, 0u, data + 4u},
			{CART_ROM_BASE, 0u, CART_ROM_BASE + 4u},
			{CART_ROM_BASE, 1u, CART_ROM_BASE},
			{CART_RAM_BASE, 0u, CART_RAM_BASE + 4u},
		}}) {
			CpuMachine machine(rom, slots, scalar);
			auto& cpu = machine.cpu;
			auto& frame = *cpu.activeThread()->frameAtDepth(0);
			frame.registers.set(1, valueInteger(DYNAMIC_RAM_BASE));
			frame.registers.set(2, valueInteger(1));
			cpu.runUntilDepth(0, 1000);
			if (!scalar) {
				const u32 word = (rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
				test::waitForNativeEntry(cpu, *frame.decodedPage, word);
			}
			machine.memory.writeMappedWord(IO_CART_SELECT, slot);
			frame.registers.set(0, valueInteger(73));
			frame.registers.set(1, valueInteger(address));
			frame.writeControl(FrameField::Top, 0);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress);
			require(cpu.runUntilDepth(0, 20) == RunResult::Halted && frame.registers.get(0) == valueInteger(73)
				&& frame.readWindow(FrameField::Top) == 0 && cpu.readEpcWord() == rom.textAddress
				&& cpu.readCauseWord() == CPU_CAUSE_CODE_DATA_BUS_ERROR,
				"F64 faults preserve the destination and top at the WIDE head");
			require(machine.memory.readBusFaultSequence() == 1u
				&& machine.memory.readIoU32(IO_SYS_BUS_FAULT_CODE) == BUS_FAULT_UNMAPPED
				&& machine.memory.readIoU32(IO_SYS_BUS_FAULT_ADDR) == failingWord
				&& machine.memory.readIoU32(IO_SYS_BUS_FAULT_ACCESS) == (BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_F64),
				"F64 reports the first unbacked word with its full access kind and stops there");
		}
	}
}

void dataSelectionDoesNotSelectInstructionFetch() {
	auto image = loadLoop(MemoryAccessKind::Word);
	test::Blua32TestImage launcher;
	launcher.text.resize(4 * INSTRUCTION_BYTES);
	writeInstruction(launcher.text, 0, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
	writeInstruction(launcher.text, 1, static_cast<u8>(OpCode::LOAD_MEM), 0, 0, static_cast<u8>(MemoryAccessKind::Word));
	writeInstruction(launcher.text, 2, static_cast<u8>(OpCode::MTC0), 0, COP0_EXEC, 0);
	writeInstruction(launcher.text, 3, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	launcher.constants = {static_cast<i32>(CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET)};
	launcher.functions = {{.firstWord = 0, .wordCount = 3}, {.firstWord = 3, .wordCount = 1}};
	launcher.exceptionFunctionIndex = 1;
	const auto system = test::encodeBlua32TestRom(RomImageDomain::System, launcher, test::RAM_CODE_FIXTURE_BYTES);
	auto cart0 = test::encodeBlua32TestRom(RomImageDomain::Cartridge, image, test::RAM_CODE_FIXTURE_BYTES);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::K0), 0, 0, 0);
	auto cart1 = test::encodeBlua32TestRom(RomImageDomain::Cartridge, image, test::RAM_CODE_FIXTURE_BYTES);
	cart0.bytes.resize(0x1000); cart1.bytes.resize(0x1000);
	writeLE32(cart0.bytes.data() + 0x800, 22); writeLE32(cart1.bytes.data() + 0x800, 33);
	for (const bool scalar : {false, true}) {
		CpuMachine machine(system, test::cartridgeSlots(cart0.bytes, cart1.bytes), scalar);
		// Enter through CP0.EXEC, establishing socket 0 before any cartridge fetch.
		machine.cpu.runUntilDepth(0, 7);
		auto& frame = *machine.cpu.activeThread()->frameAtDepth(0);
		require(frame.executionImage->executionDomainId == 0 && frame.readControl(bmsx::FrameField::Pc) == cart0.textAddress,
			"CP0.EXEC latches the selected instruction socket before cartridge execution");
		frame.registers.set(1, valueInteger(CART_ROM_BASE + 0x800)); frame.registers.set(2, valueInteger(1));
		machine.memory.writeMappedWord(IO_CART_SELECT, 1);
		machine.cpu.runUntilDepth(0, 1000);
		require(frame.registers.get(0) == valueInteger(33), "cold instruction fetch ignores the ordinary data selector");
		for (u32 select : {0u, 1u, 0xfffffffeu, 0xffffffffu}) {
			machine.memory.writeMappedWord(IO_CART_SELECT, select);
			machine.cpu.runUntilDepth(0, 9);
			require(frame.registers.get(0) == valueInteger((select & 1u) != 0u ? 33 : 22)
				&& frame.executionImage->executionDomainId == 0,
				"ordinary ROM loads follow SELECT while executable instructions stay on their own physical socket");
		}
	}
}

void warmContinuationsFollowInBlockMuxWrites() {
	test::Blua32TestImage image;
	image.text.resize(INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 1, .maxStack = 8}};
	const auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image, test::RAM_CODE_FIXTURE_BYTES);
	std::array<std::vector<u8>, 2> cards;
	constexpr u32 second = MAPPED_PAGE_BYTE_SIZE / INSTRUCTION_BYTES;
	for (u32 slot = 0; slot < cards.size(); ++slot) {
		auto& code = cards[slot]; code.resize(2 * MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(code, 0, static_cast<u8>(slot == 0u ? OpCode::K1 : OpCode::K0), 0, 0, 0);
		writeInstruction(code, 1, static_cast<u8>(OpCode::JMP), 0, 3, 62); // next page, +254 words
		writeInstruction(code, second, static_cast<u8>(OpCode::MOV), 3, 0, 0);
		writeInstruction(code, second + 1, static_cast<u8>(OpCode::STORE_MEM), 4, 2, static_cast<u8>(MemoryAccessKind::Word));
		writeInstruction(code, second + 2, static_cast<u8>(slot == 0u ? OpCode::K1 : OpCode::K0), 5, 0, 0);
		writeInstruction(code, second + 3, static_cast<u8>(OpCode::MOV), 6, 5, 0);
		writeInstruction(code, second + 4, static_cast<u8>(OpCode::JMP), 0, 59, 59, 255); // first page, -261 words
	}
	CpuMachine native(rom, test::cartridgeSlots(cards[0], cards[1]), false);
	CpuMachine scalar(rom, test::cartridgeSlots(cards[0], cards[1]), true);
	for (auto* machine : {&native, &scalar}) {
		auto& frame = *machine->cpu.activeThread()->frameAtDepth(0);
		frame.registers.set(2, valueInteger(IO_CART_SELECT));
#if defined(BMSX_NATIVE_COMPILER_WORKER)
		for (const u32 slot : {0u, 1u}) {
			machine->memory.writeMappedWord(IO_CART_SELECT, slot); frame.registers.set(4, valueInteger(slot));
			for (int visit = 0; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++visit) {
				machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], CART_ROM_BASE + MAPPED_PAGE_BYTE_SIZE + 2u * INSTRUCTION_BYTES);
				machine->cpu.runUntilDepth(0, 1);
			}
			if (machine == &native) test::waitForNativeEntry(machine->cpu, *frame.decodedPage, 2);
		}
#endif
		for (const u32 slot : {0u, 1u}) {
			machine->memory.writeMappedWord(IO_CART_SELECT, slot); frame.registers.set(4, valueInteger(slot));
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], CART_ROM_BASE);
			machine->cpu.runUntilDepth(0, 10000);
		}
	}
	const auto& lookup = *native.cpu.activeThread()->frameAtDepth(0)->executionImage->nativeCodeLookup;
	for (const u32 slot : {0u, 1u}) {
		const auto* page = lookup.find(CART_ROM_BASE + MAPPED_PAGE_BYTE_SIZE, slot);
		require(page && page->nativeBlocks && page->nativeBlocks->entries[2], "both post-MMIO physical continuations are native, not merely interpreted");
	}
	for (const u32 slot : {0u, 1u, 1u, 0u}) {
		for (auto* machine : {&native, &scalar}) {
			auto& cpu = machine->cpu; auto& frame = *cpu.activeThread()->frameAtDepth(0);
			machine->memory.writeMappedWord(IO_CART_SELECT, slot);
			frame.registers.set(0, valueInteger(1u - slot)); frame.registers.set(4, valueInteger(slot ^ 1u));
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], CART_ROM_BASE + MAPPED_PAGE_BYTE_SIZE);
			require(cpu.runUntilDepth(0, 11) == RunResult::Yielded && frame.registers.get(3) == valueInteger(1u - slot)
				&& frame.registers.get(6) == valueInteger(slot) && frame.readControl(bmsx::FrameField::Pc) == CART_ROM_BASE && cpu.instructionBudgetRemaining == 0,
				"a mux write selects the newly selected physical ROM for the very next instruction at the exact grant boundary");
		}
		const auto& a = *native.cpu.activeThread()->frameAtDepth(0); const auto& b = *scalar.cpu.activeThread()->frameAtDepth(0);
		require(native.cpu.lastPc == scalar.cpu.lastPc && native.cpu.readCurrentInstructionPc() == scalar.cpu.readCurrentInstructionPc()
			&& static_cast<bmsx::i32>(a.readControl(bmsx::FrameField::Top)) == static_cast<bmsx::i32>(b.readControl(bmsx::FrameField::Top)) && a.readControl(bmsx::FrameField::Pc) == b.readControl(bmsx::FrameField::Pc), "native socket changes retain scalar PC and register-top publication");
		for (int reg = 0; reg < a.stackCapacity(); ++reg) require(a.registers.get(reg) == b.registers.get(reg), "all socket-switch registers agree");
	}
	const auto* page = lookup.find(CART_ROM_BASE + MAPPED_PAGE_BYTE_SIZE, 1);
	auto replacement = cards[1]; writeInstruction(replacement, second + 2, static_cast<u8>(OpCode::KSMI), 5, 0, 7);
	for (auto* machine : {&native, &scalar}) {
		machine->memory.cartridgeController().installRom(1, replacement);
		require(!page->nativeBlocks, "ROM replacement retires bodies without deleting the page retained by the native index");
		machine->memory.writeMappedWord(IO_CART_SELECT, 1);
		auto& frame = *machine->cpu.activeThread()->frameAtDepth(0); frame.registers.set(4, valueInteger(1));
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], CART_ROM_BASE + MAPPED_PAGE_BYTE_SIZE);
		machine->cpu.runUntilDepth(0, 11);
		require(frame.registers.get(6) == valueInteger(7), "a stale index entry never executes retired ROM code");
	}
	require(lookup.find(CART_ROM_BASE + MAPPED_PAGE_BYTE_SIZE, 1) == page, "ROM replacement preserves the page owner");
}

void crossPageLinksFollowTheInstructionChipSelect(bool cartridgeBound) {
	test::Blua32TestImage launcher; launcher.text.resize(4 * INSTRUCTION_BYTES);
	writeInstruction(launcher.text, 0, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
	writeInstruction(launcher.text, 1, static_cast<u8>(OpCode::LOAD_MEM), 0, 0, static_cast<u8>(MemoryAccessKind::Word));
	writeInstruction(launcher.text, 2, static_cast<u8>(OpCode::MTC0), 0, COP0_EXEC, 0);
	writeInstruction(launcher.text, 3, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	launcher.constants = {static_cast<i32>(CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET)};
	launcher.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 8}, {.firstWord = 3, .wordCount = 1}};
	launcher.exceptionFunctionIndex = 1;
	const auto system = test::encodeBlua32TestRom(RomImageDomain::System, launcher, test::RAM_CODE_FIXTURE_BYTES);
	test::Blua32TestImage source; source.text.resize(3 * INSTRUCTION_BYTES);
	writeInstruction(source.text, 0, static_cast<u8>(OpCode::KSMI), 3, 0, 11);
	writeInstruction(source.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(source.text, 2, static_cast<u8>(OpCode::JMP), 0, 0, 0);
	source.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 8}};
	auto card0 = test::encodeBlua32TestRom(RomImageDomain::Cartridge, source, test::RAM_CODE_FIXTURE_BYTES), card1 = card0;
	card0.bytes.resize(MAPPED_PAGE_BYTE_SIZE); card1.bytes.resize(MAPPED_PAGE_BYTE_SIZE);
	const u32 cardWord = (card0.textAddress - CART_ROM_BASE) / INSTRUCTION_BYTES;
	writeInstruction(card1.bytes, cardWord, static_cast<u8>(OpCode::KSMI), 3, 0, 22);
	const u32 back = ((DYNAMIC_RAM_BASE - (card0.textAddress + 3 * INSTRUCTION_BYTES)) >> 2u) & MAX_EXT_BX;
	for (auto* card : {&card0, &card1}) {
		writeInstruction(card->bytes, cardWord + 1, static_cast<u8>(OpCode::WIDE), 0, back >> BASE_BX_BITS, 0);
		writeInstruction(card->bytes, cardWord + 2, static_cast<u8>(OpCode::JMP), 0, (back >> 6u) & 63u, back & 63u, (back >> 12u) & 255u);
	}
	std::vector<u8> ram(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(ram, 0, static_cast<u8>(OpCode::LOAD_MEM), 0, 5, static_cast<u8>(MemoryAccessKind::Word));
	writeInstruction(ram, 1, static_cast<u8>(OpCode::MOV), 2, 0, 0);
	const u32 forward = (card0.textAddress - (DYNAMIC_RAM_BASE + 4 * INSTRUCTION_BYTES)) >> 2u;
	writeInstruction(ram, 2, static_cast<u8>(OpCode::WIDE), 0, forward >> BASE_BX_BITS, 0);
	writeInstruction(ram, 3, static_cast<u8>(OpCode::JMP), 0, (forward >> 6u) & 63u, forward & 63u, (forward >> 12u) & 255u);
	CpuMachine native(system, test::cartridgeSlots(card0.bytes, card1.bytes), false);
	CpuMachine scalar(system, test::cartridgeSlots(card0.bytes, card1.bytes), true);
	const auto domain = cartridgeBound ? 0 : SYSTEM_EXECUTION_DOMAIN_ID;
	const u32 function = cartridgeBound ? card0.functionAddresses[0] : system.functionAddresses[0];
	for (auto* machine : {&native, &scalar}) {
		if (cartridgeBound) {
			machine->cpu.runUntilDepth(0, 7);
			// Admit only KSMI before profiling hot worker requests. The
			// following cross-page jump still belongs to the tested traversal.
			require(machine->cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::KSMI)]) == RunResult::Yielded
				&& machine->cpu.instructionBudgetRemaining == 0
				&& machine->cpu.readFramePc(0) == card0.textAddress + INSTRUCTION_BYTES,
				"the positive cartridge grant stops before the WIDE RAM jump");
		}
#if defined(BMSX_NATIVE_COMPILER_WORKER)
		if (machine == &native) machine->cpu.setNativeCompilationProfiling(true);
#endif
		machine->memory.writeBytes(DYNAMIC_RAM_BASE, ram.data(), ram.size());
		auto& frame = *machine->cpu.activeThread()->frameAtDepth(0);
		frame.registers.set(5, valueInteger(IO_CART_SELECT)); frame.registers.set(4, valueInteger(73));
		for (const u32 slot : {0u, 1u}) {
			machine->memory.writeMappedWord(IO_CART_SELECT, slot);
			machine->cpu.writeFrameExecution(0, domain, function, DYNAMIC_RAM_BASE);
			machine->cpu.runUntilDepth(0, 1200);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
			if (machine == &native) {
				test::waitForFixtureWorkerRequests(machine->cpu);
				const auto available = [&] (u32 pc, u32 selected, u32 word) {
					const auto* lookup = frame.executionImage->nativeCodeLookup.get();
					const auto* page = lookup ? lookup->find(pc, selected) : nullptr;
					return page && page->nativeBlocks && page->nativeBlocks->entries[word];
				};
				const u32 codeWord = (card0.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
				for (int pass = 0; pass < 4 && (!available(DYNAMIC_RAM_BASE, 0, 0)
					|| !available(DYNAMIC_RAM_BASE, 0, 1)
					|| !available(card0.textAddress, cartridgeBound ? 0 : slot, codeWord)); ++pass) {
					machine->cpu.runUntilDepth(0, 1200);
					test::waitForFixtureWorkerRequests(machine->cpu);
				}
				// With both sides published, guest execution resolves their links.
				machine->cpu.runUntilDepth(0, 1200);
				test::waitForFixtureWorkerRequests(machine->cpu);
			}
#endif
		}
	}
	const auto& lookup = *native.cpu.activeThread()->frameAtDepth(0)->executionImage->nativeCodeLookup;
	const auto* shared = lookup.find(DYNAMIC_RAM_BASE, 0)->nativeBlocks->entries[1].get();
	require(shared && static_cast<bool>(shared->terminal.link.target) == cartridgeBound,
		"a RAM-to-cartridge edge links only when execution has pinned the physical instruction socket");
	std::array<const NativeBlock*, 2> returns{};
	for (u32 slot = 0; slot < (cartridgeBound ? 1u : 2u); ++slot) {
		const auto* page = lookup.find(card0.textAddress, slot);
		returns[slot] = page->nativeBlocks->entries[(card0.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES].get();
		require(returns[slot] && returns[slot]->terminal.link.target == lookup.find(DYNAMIC_RAM_BASE, 0)->nativeBlocks->entries[0].get(),
			"cartridge-to-shared-RAM edges link directly for either physical socket");
	}
	for (const u32 select : {0u, 1u, 0xffffffffu, 0xfffffffeu, 1u}) {
		for (auto* machine : {&native, &scalar}) {
			machine->memory.writeMappedWord(IO_CART_SELECT, select);
			machine->cpu.writeFrameExecution(0, domain, function, DYNAMIC_RAM_BASE);
			require(machine->cpu.runUntilDepth(0, 11) == RunResult::Yielded, "the complete two-window traversal uses its eleven base cycles");
			const auto& frame = *machine->cpu.activeThread()->frameAtDepth(0);
			require(frame.registers.get(0) == valueInteger(select) && frame.registers.get(2) == valueInteger(select)
				&& frame.registers.get(3) == valueInteger(!cartridgeBound && (select & 1u) != 0u ? 22 : 11)
				&& frame.readControl(bmsx::FrameField::Pc) == DYNAMIC_RAM_BASE && machine->cpu.instructionBudgetRemaining == 0,
				"ordinary MMIO data selection and the instruction socket remain distinct across warm cross-page links");
		}
	}
	std::array<u8, INSTRUCTION_BYTES> replacement{}; writeInstruction(replacement, 0, static_cast<u8>(OpCode::MOV), 0, 4, 0);
	for (auto* machine : {&native, &scalar}) machine->memory.writeBytes(DYNAMIC_RAM_BASE, replacement.data(), replacement.size());
	for (const auto* block : returns) if (block) require(!block->terminal.link.target, "rewriting shared RAM unlinks incoming edges from every socket");
	for (auto* machine : {&native, &scalar}) {
		machine->cpu.writeFrameExecution(0, domain, function, DYNAMIC_RAM_BASE); machine->cpu.runUntilDepth(0, 1200);
		require(machine->cpu.activeThread()->frameAtDepth(0)->registers.get(0) == valueInteger(73), "regenerated RAM executes the replacement, not a retired linked body");
	}
}


void callsUseExecutionSocketAndAmbientImage(bool ramRecord) {
	const u32 record = DYNAMIC_RAM_BASE + 0x4000u, code = record + 0x800u;
	test::Blua32TestImage launcher; launcher.text.resize(11 * INSTRUCTION_BYTES);
	writeInstruction(launcher.text, 0, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
	writeInstruction(launcher.text, 1, static_cast<u8>(OpCode::LOAD_MEM), 0, 0, static_cast<u8>(MemoryAccessKind::Word));
	writeInstruction(launcher.text, 2, static_cast<u8>(OpCode::MTC0), 0, COP0_EXEC, 0);
	writeInstruction(launcher.text, 3, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(launcher.text, 4, static_cast<u8>(OpCode::CLOSURE), 4, 0, 0);
	writeInstruction(launcher.text, 5, static_cast<u8>(OpCode::MOV), 0, 4, 0);
	writeInstruction(launcher.text, 6, static_cast<u8>(OpCode::CALL), 0, 1, 2);
	writeInstruction(launcher.text, 7, static_cast<u8>(OpCode::RET), 0, 2, 0);
	writeInstruction(launcher.text, 8, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(launcher.text, 9, static_cast<u8>(OpCode::LOADK), 0, 0, 1);
	writeInstruction(launcher.text, 10, static_cast<u8>(OpCode::RET), 0, 2, 0);
	launcher.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 8},
		{.firstWord = 3, .wordCount = 5, .maxStack = 8}, {.firstWord = 8, .wordCount = 1},
		{.firstWord = 9, .wordCount = 2, .maxStack = 8}};
	launcher.constants = {static_cast<i32>(CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET), 11};
	launcher.exceptionFunctionIndex = 2;
	launcher.closureRelocations = {{4, record}};
	const auto system = test::encodeBlua32TestRom(RomImageDomain::System, launcher, test::RAM_CODE_FIXTURE_BYTES);
	constexpr u32 callerWord = 3, calleeWord = 7, alternateWord = 9;
	test::Blua32TestImage source; source.text.resize(11 * INSTRUCTION_BYTES);
	// Admit this branch before profiling without creating the closure until
	// after the physical SELECT write.
	writeInstruction(source.text, 0, static_cast<u8>(OpCode::JMP), 0, 0, 0);
	writeInstruction(source.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(source.text, 2, static_cast<u8>(OpCode::CLOSURE), 4, 0, 0);
	writeInstruction(source.text, callerWord, static_cast<u8>(OpCode::MOV), 0, 4, 0);
	writeInstruction(source.text, callerWord + 1, static_cast<u8>(OpCode::CALL), 0, 1, 2);
	writeInstruction(source.text, callerWord + 2, static_cast<u8>(OpCode::MOV), 3, 0, 0);
	writeInstruction(source.text, callerWord + 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	writeInstruction(source.text, calleeWord, static_cast<u8>(OpCode::LOADK), 0, 0, 1);
	writeInstruction(source.text, calleeWord + 1, static_cast<u8>(OpCode::RET), 0, 2, 0);
	writeInstruction(source.text, alternateWord, static_cast<u8>(OpCode::LOADK), 0, 0, 2);
	writeInstruction(source.text, alternateWord + 1, static_cast<u8>(OpCode::RET), 0, 2, 0);
	source.functions = {{.firstWord = 0, .wordCount = calleeWord, .maxStack = 8},
		{.firstWord = calleeWord, .wordCount = 2, .maxStack = 8}, {.firstWord = alternateWord, .wordCount = 2, .maxStack = 8}};
	source.constants = {0, 22, 44};
	source.closureRelocations = {{2, test::blua32TestFunctionAddress(ramRecord ? RomImageDomain::System : RomImageDomain::Cartridge, 1)}};
	const auto card0 = test::encodeBlua32TestRom(RomImageDomain::Cartridge, source, test::RAM_CODE_FIXTURE_BYTES);
	source.constants = {0, 33, 55};
	auto card1 = test::encodeBlua32TestRom(RomImageDomain::Cartridge, source, test::RAM_CODE_FIXTURE_BYTES);
	const u32 otherRecord = card1.functionAddresses[1] - CART_ROM_BASE;
	writeLE32(card1.bytes.data() + otherRecord + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, card1.textAddress + alternateWord * INSTRUCTION_BYTES);
	writeLE32(card1.bytes.data() + otherRecord + BLUA32_FUNCTION_MAX_STACK_OFFSET, 12);
	CpuMachine native(system, test::cartridgeSlots(card0.bytes, card1.bytes), false);
	CpuMachine scalar(system, test::cartridgeSlots(card0.bytes, card1.bytes), true);
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(record, system.bytes.data() + system.functionAddresses[3], BLUA32_FUNCTION_RECORD_SIZE);
		machine->memory.writeMappedU32LE(record + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, code);
		machine->memory.writeBytes(code, launcher.text.data() + 9u * INSTRUCTION_BYTES, 2u * INSTRUCTION_BYTES);
		if (ramRecord) test::seedTestMappedClosure(machine->cpu, record);
		require(machine->cpu.runUntilDepth(0, 7) == RunResult::Yielded && machine->cpu.readFrameExecutionDomain(0) == 0,
			"EXEC establishes socket 0 before SELECT changes");
		test::seedTestRomClosure(machine->cpu, ramRecord ? system.functionAddresses[1] : card0.functionAddresses[1],
			ramRecord ? SYSTEM_EXECUTION_DOMAIN_ID : ExecutionDomainId{0});
		require(machine->cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::JMP)]) == RunResult::Yielded
			&& machine->cpu.instructionBudgetRemaining == 0
			&& machine->cpu.readFramePc(0) == card0.textAddress + INSTRUCTION_BYTES,
			"the positive cartridge grant leaves the WIDE closure for execution after SELECT");
		machine->memory.writeMappedWord(IO_CART_SELECT, 1);
		require(machine->memory.readMappedU32LE(card0.functionAddresses[1]) == card1.textAddress + alternateWord * INSTRUCTION_BYTES,
			"ordinary data reads see the different record fitted to socket 1");
	}
#if defined(BMSX_NATIVE_COMPILER_WORKER)
		native.cpu.setNativeCompilationProfiling(true);
#endif
	test::runCpuParity(native.cpu, scalar.cpu, 20000);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	for (int pass = 0; pass < 8; ++pass) {
		test::waitForFixtureWorkerRequests(native.cpu);
		const int targetDepth = ramRecord ? 3 : 2;
		for (int step = 0; step < 32 && native.cpu.getFrameDepth() < targetDepth; ++step)
			test::runCpuParity(native.cpu, scalar.cpu, 1);
		require(native.cpu.getFrameDepth() == targetDepth, "warm execution reaches the active closure chain");
		const auto* root = native.cpu.rootThread()->frameAtDepth(0);
		const auto* relay = native.cpu.rootThread()->frameAtDepth(1);
		const auto* calleeFrame = native.cpu.rootThread()->frameAtDepth(targetDepth - 1);
		const auto published = [](const CallFrame* frame, u32 pc) {
			const auto* lookup = frame->executionImage->nativeCodeLookup.get();
			const auto* page = lookup ? lookup->find(pc, 0) : nullptr;
			return page && page->nativeBlocks && page->nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
		};
		const bool ready = published(root, card0.textAddress + callerWord * INSTRUCTION_BYTES)
			&& published(calleeFrame, ramRecord ? code : card0.textAddress + calleeWord * INSTRUCTION_BYTES)
			&& (!ramRecord || published(relay, system.textAddress + 5u * INSTRUCTION_BYTES));
		if (ready) break;
		test::runCpuParity(native.cpu, scalar.cpu, 20000);
	}
	test::waitForFixtureWorkerRequests(native.cpu);
#endif
	test::runCpuParity(native.cpu, scalar.cpu, 100, 1);
	const u32 entry = card0.textAddress + callerWord * INSTRUCTION_BYTES;
	for (auto* machine : {&native, &scalar}) {
		require(machine->cpu.rootThread()->frameAtDepth(0)->registers.get(3) == valueInteger(ramRecord ? 11 : 22), "the warmed call loop returns the closure-bound constants");
		machine->cpu.writeFrameExecution(0, 0, card0.functionAddresses[0], entry);
	}
	const auto* root = native.cpu.rootThread()->frameAtDepth(0);
	require(root->executionImage->nativeCodeLookup->find(entry, 0)->nativeBlocks->entries[(entry & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES] != nullptr,
		"the repeated caller has a generated entry");
	for (int grant = 1; grant <= 128; ++grant) {
		test::runCpuParity(native.cpu, scalar.cpu, grant);
		const auto& first = *native.cpu.activeThread(); const auto& second = *scalar.cpu.activeThread();
		require(first.frameDepth() == second.frameDepth() && first.stackTop() == second.stackTop()
			&& native.cpu.readCurrentInstructionPc() == scalar.cpu.readCurrentInstructionPc()
			&& native.cpu.lastPc == scalar.cpu.lastPc && native.cpu.readLastExecutionDomain() == scalar.cpu.readLastExecutionDomain()
			&& native.cpu.readCauseWord() == scalar.cpu.readCauseWord() && native.cpu.readEpcWord() == scalar.cpu.readEpcWord(),
			"native and scalar CALL preserve frame, PC, domain and fault state at every short grant");
		for (size_t depth = 0; depth < first.frameDepth(); ++depth) {
			const auto& a = *first.frameAtDepth(depth); const auto& b = *second.frameAtDepth(depth);
			require(a.executionImage->executionDomainId == b.executionImage->executionDomainId && a.readControl(bmsx::FrameField::Pc) == b.readControl(bmsx::FrameField::Pc)
				&& a.readControl(FrameField::Function) == b.readControl(FrameField::Function) && a.stackCapacity() == b.stackCapacity() && a.stackBase() == b.stackBase()
				&& static_cast<bmsx::i32>(a.readControl(bmsx::FrameField::Top)) == static_cast<bmsx::i32>(b.readControl(bmsx::FrameField::Top)) && static_cast<bmsx::i32>(a.readControl(bmsx::FrameField::ReturnBase)) == static_cast<bmsx::i32>(b.readControl(bmsx::FrameField::ReturnBase)) && static_cast<bmsx::i32>(a.readControl(bmsx::FrameField::ReturnCount)) == static_cast<bmsx::i32>(b.readControl(bmsx::FrameField::ReturnCount)) && a.readControl(FrameField::CallSite) == b.readControl(FrameField::CallSite),
				"record selection and activation windows agree at each call boundary");
			for (int reg = 0; reg < a.stackCapacity(); ++reg) {
				const Value left = a.registers.get(reg), right = b.registers.get(reg);
				if (valueIsClosure(left)) require(valueIsClosure(right) && native.cpu.readClosureBinding(bmsx::test::asClosure(left, bmsx::test::GcHeap(native.cpu))).functionAddress == scalar.cpu.readClosureBinding(bmsx::test::asClosure(right, bmsx::test::GcHeap(scalar.cpu))).functionAddress,
					"corresponding closure values retain their function-record addresses");
				else require(left == right, "every retained register agrees across record-domain transitions");
			}
		}
		require(first.firstFrame->registers.get(3) == valueInteger(ramRecord ? 11 : 22), "short grants preserve the closure-bound constants");
	}
	test::runCpuParity(native.cpu, scalar.cpu, 100, 1);
	for (auto* machine : {&native, &scalar}) machine->cpu.writeFrameExecution(0, 0, card0.functionAddresses[0], entry);
	test::runCpuParity(native.cpu, scalar.cpu, 3);
	if (ramRecord) {
		require(native.cpu.readFrameExecutionDomain(1) == SYSTEM_EXECUTION_DOMAIN_ID, "the intermediate caller belongs to the system image");
		const auto* relay = native.cpu.rootThread()->frameAtDepth(1);
		const u32 relayEntry = system.textAddress + 5u * INSTRUCTION_BYTES;
		require(relay->executionImage->nativeCodeLookup->find(relayEntry, 0)->nativeBlocks->entries[(relayEntry & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES] != nullptr,
			"the system relay is also generated");
		for (int step = 0; step < 8 && native.cpu.getFrameDepth() != 3; ++step) test::runCpuParity(native.cpu, scalar.cpu, 1);
	}
	require(native.cpu.getFrameDepth() == (ramRecord ? 3 : 2), "the grant reaches the selected callee activation");
	const auto* callee = native.cpu.rootThread()->currentFrame;
	require(callee->executionImage->executionDomainId == (ramRecord ? SYSTEM_EXECUTION_DOMAIN_ID : 0) && callee->stackCapacity() == 8
		&& callee->readControl(bmsx::FrameField::Pc) == (ramRecord ? code : card0.textAddress + calleeWord * INSTRUCTION_BYTES),
		"CALL uses the closure-bound domain and record, not SELECT metadata");
	require(callee->executionImage->nativeCodeLookup->find(callee->readControl(bmsx::FrameField::Pc), 0)->nativeBlocks->entries[(callee->readControl(bmsx::FrameField::Pc) & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES] != nullptr,
		"the callee body is generated as well as its caller");
	test::runCpuParity(native.cpu, scalar.cpu, 100, 1);
	for (auto* machine : {&native, &scalar}) require(machine->cpu.rootThread()->frameAtDepth(0)->registers.get(0) == valueInteger(ramRecord ? 11 : 22),
		"the result uses the closure-bound constants, not the data-selected socket");

	if (ramRecord) return;
	// Keep the same live closure and a generated RAM caller while replacing
	// the ROM words of its function record. The bank on the closure still
	// wins over ordinary SELECT, which points at the other cartridge.
	const u32 ramCaller = DYNAMIC_RAM_BASE;
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(ramCaller, source.text.data() + callerWord * INSTRUCTION_BYTES, 4u * INSTRUCTION_BYTES);
		machine->cpu.writeFrameExecution(0, 0, card0.functionAddresses[0], ramCaller);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 4000);
	auto& caller = *native.cpu.rootThread()->firstFrame;
	auto& ramPage = *caller.decodedPage;
	test::waitForNativeEntry(native.cpu, ramPage, 0);
	test::runCpuParity(native.cpu, scalar.cpu, 100);
	test::runCpuParity(native.cpu, scalar.cpu, 100, 1);
	const auto* ramBlock = ramPage.nativeBlocks->entries[0].get();
	const auto& bindings = caller.executionImage->romCallBindings;
	const u32 prototype = card0.functionAddresses[1];
	const auto boundPrototype = [&](const auto& slots) {
		return std::find_if(slots.begin(), slots.end(), [&](const auto& binding) {
			return binding.functionAddress == prototype;
		});
	};
	const auto& scalarBindings = scalar.cpu.rootThread()->firstFrame->executionImage->romCallBindings;
	const auto generated = boundPrototype(bindings);
	require(generated != bindings.end() && generated->entry.maxStack == 8u
		&& generated->entryCells[0] && *generated->entryCells[0] && !generated->entryCells[1],
		"the warm ROM call binds a live cell on the fetch bank, not the data bank");
	const auto interpreted = boundPrototype(scalarBindings);
	require(interpreted != scalarBindings.end() && interpreted->entry == generated->entry
		&& !interpreted->entryCells[0] && !interpreted->entryCells[1],
		"scalar CALL binds the same prototype without acquiring a native continuation");
	const u32 encodedTarget = card0.functionAddresses[1] - CART_ROM_BASE;
	const u32 ramTarget = ramCaller + MAPPED_PAGE_BYTE_SIZE;
	std::array<u8, 2 * INSTRUCTION_BYTES> ramBody{};
	writeInstruction(ramBody, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(ramBody, 1, static_cast<u8>(OpCode::RET), 0, 2, 0);
	auto replacement = card0.bytes;
	writeLE32(replacement.data() + encodedTarget + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, ramTarget);
	writeLE32(replacement.data() + encodedTarget + BLUA32_FUNCTION_MAX_STACK_OFFSET, 10u);
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(ramTarget, ramBody.data(), ramBody.size());
		machine->memory.cartridgeController().installRom(0, replacement);
	}
	require(ramPage.nativeBlocks->entries[0].get() == ramBlock && boundPrototype(bindings) == bindings.end()
		&& boundPrototype(scalarBindings) == scalarBindings.end(),
		"reinstall invalidates the prototype decode, not the generated RAM caller");
	for (auto* machine : {&native, &scalar}) machine->cpu.writeFrameExecution(0, 0, card0.functionAddresses[0], ramCaller);
	test::runCpuParity(native.cpu, scalar.cpu, 4000);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	test::waitForFixtureWorkerRequests(native.cpu);
#endif
	test::runCpuParity(native.cpu, scalar.cpu, 100);
	test::runCpuParity(native.cpu, scalar.cpu, 100, 1);
	for (auto* machine : {&native, &scalar}) require(machine->cpu.readFrameRegister(0, 3) == valueInteger(1),
		"the same closure enters the code named by the newly fitted ROM record");
	require(boundPrototype(bindings) != bindings.end() && boundPrototype(bindings)->entry.maxStack == 10u
		&& boundPrototype(bindings)->entryCells[0] && *boundPrototype(bindings)->entryCells[0],
		"warm native CALL decodes the replacement layout and binds its RAM target");
	auto* cell = boundPrototype(bindings)->entryCells[0];

	writeInstruction(ramBody, 0, static_cast<u8>(OpCode::K0), 0, 0, 0);
	for (auto* machine : {&native, &scalar}) machine->memory.writeBytes(ramTarget, ramBody.data(), ramBody.size());
	require(boundPrototype(bindings)->entryCells[0] == cell && *cell == nullptr,
		"RAM code retirement withdraws the entry without replacing the ROM binding or its cell");
	test::runCpuParity(native.cpu, scalar.cpu, 4000);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	test::waitForFixtureWorkerRequests(native.cpu);
#endif
	test::runCpuParity(native.cpu, scalar.cpu, 100);
	for (auto* machine : {&native, &scalar}) require(machine->cpu.readFrameRegister(0, 3) == valueInteger(0),
		"CALL enters the replacement code instead of a retired body");
	require(boundPrototype(bindings)->entryCells[0] == cell && *cell, "publication refills the same cached cell");

}

} // namespace

int main() {
	try {
		directRomLoadsUseCurrentOwners(); romReplacementAndSelectionKeepRamCode();
		tailsAndShortBudgetsAgree(); romDoublesFaultAtTheFirstUnbackedWord();
		dataSelectionDoesNotSelectInstructionFetch();
		callsUseExecutionSocketAndAmbientImage(false); callsUseExecutionSocketAndAmbientImage(true);
		sparseCodeLookupPreservesPageOwners(); warmContinuationsFollowInBlockMuxWrites();
		crossPageLinksFollowTheInstructionChipSelect(false); crossPageLinksFollowTheInstructionChipSelect(true);
		std::cout << "Compiled ROM tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
