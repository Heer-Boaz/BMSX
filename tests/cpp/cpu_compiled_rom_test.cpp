#include "common/endian.h"
#include "machine/cpu/cpu.h"
#include "common/compiler.h"
#include "machine/cpu/native_block.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"
#include "spec/blua32/cop0.h"
#include "spec/bmsx/model.h"
#include "spec/bmsx/rom_header.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

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
		case MemoryAccessKind::Word: return valueNumber(memory.readMappedWord(address));
		case MemoryAccessKind::U8: return valueNumber(memory.readMappedU8(address));
		case MemoryAccessKind::U16LE: return valueNumber(memory.readMappedU16LE(address));
		case MemoryAccessKind::U32LE: return valueNumber(memory.readMappedU32LE(address));
		case MemoryAccessKind::F32LE: return valueNumber(memory.readMappedF32LE(address));
		case MemoryAccessKind::F64LE: return valueNumber(memory.readMappedF64LE(address));
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
		cpu.reset();
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	}
};

void sparseCodeLookupPreservesPageOwners() {
	NativeCodeLookup lookup;
	DecodedInstructionPage first(true, {}), second(true, {});
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
	NativeBlockRunState nativeRunState;
	std::vector<u8> systemBacking(73), slot0Backing(36), slot1Backing(46);
	auto system = std::span(systemBacking).subspan(1, 72);
	auto slot0 = std::span(slot0Backing).subspan(3, 33);
	auto slot1 = std::span(slot1Backing).subspan(5, 41);
	for (u32 i = 0; i < system.size(); ++i) system[i] = static_cast<u8>(i * 17u + 3u);
	for (u32 i = 0; i < slot0.size(); ++i) slot0[i] = static_cast<u8>(i * 7u + 11u);
	for (u32 i = 0; i < slot1.size(); ++i) slot1[i] = static_cast<u8>(i * 13u + 5u);
	Memory memory(MemoryInit{system, test::cartridgeSlots(slot0, slot1)}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory);
	ExecutionAddressSpace addresses(memory);
	CPU cpu(memory, irq, addresses);
	size_t bytes = 0;
	for (int format = 0; format <= 5; ++format) for (const bool displaced : {false, true}) {
		const auto kind = static_cast<MemoryAccessKind>(format);
		const u32 width = format == 1 ? 1u : format == 2 ? 2u : format == 5 ? 8u : 4u;
		DecodedInstruction load;
		load.op = static_cast<u8>(displaced ? OpCode::LOAD_MEM_D : OpCode::LOAD_MEM);
		load.a = 0; load.b = 1; load.c = format; load.disp = displaced ? 255 : 0; load.width = 2; load.baseCycles = 2;
		const std::array source{NativeBlockInstruction{&load, 0x1000}};
		auto block = NativeBlock::compile(source, nullptr, bytes, memory, cpu.stringPool());
		for (const u32 address : {0u, 4u, 16u, CART_ROM_BASE, CART_ROM_BASE + 4u, CART_ROM_BASE + 24u}) {
			std::array registers{valueNil(), valueNumber(address - static_cast<u32>(load.disp) * 4u)};
			require(block->run(nativeRunState = {.registers = registers.data(), .constants = nullptr, .remainingCycles = block->terminal.cycles}) == &block->terminal
				&& registers[0] == scalarLoad(memory, kind, address), "backed system and cartridge ROM reads stay in the native block");
		}
		for (u32 address : {SYSTEM_ROM_SIZE - 4u, 72u, CART_ROM_BASE + 32u, CART_ROM_END - 4u}) {
			std::array registers{valueNumber(73), valueNumber(address - static_cast<u32>(load.disp) * 4u)};
			const bool backed = address >= CART_ROM_BASE && address < CART_ROM_END
				&& address - CART_ROM_BASE + width <= slot0.size();
			const auto* exit = block->run(nativeRunState = {.registers = registers.data(), .constants = nullptr, .remainingCycles = block->terminal.cycles});
			require((exit == &block->terminal) == backed, "short tails and logical boundary crossings use the ordered bus owner");
			if (!backed) require(registers[0] == valueNumber(73) && nativeRunState.memoryAddress == address,
				"a ROM side exit preserves its raw address and has not committed its destination");
		}
		load.a = load.b;
		const std::array aliasSource{NativeBlockInstruction{&load, 0x1000}};
		auto alias = NativeBlock::compile(aliasSource, nullptr, bytes, memory, cpu.stringPool());
		std::array registers{valueNil(), valueNumber(CART_ROM_BASE + 4u - load.disp * 4u)};
		require(alias->run(nativeRunState = {.registers = registers.data(), .constants = nullptr, .remainingCycles = alias->terminal.cycles}) == &alias->terminal
			&& registers[1] == scalarLoad(memory, kind, CART_ROM_BASE + 4u), "ROM loads can replace the address register");
	}
}

void romReplacementAndSelectionKeepRamCode() {
	constexpr u32 data = 0x800u;
	auto image = loadLoop(MemoryAccessKind::Word);
	auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
	rom.bytes.resize(0x1000);
	writeLE32(rom.bytes.data() + data, 11);
	std::vector<u8> slot0(16), slot1(16);
	writeLE32(slot0.data(), 22); writeLE32(slot1.data(), 33);
	for (const bool scalar : {false, true}) {
		CpuMachine machine(rom, test::cartridgeSlots(slot0, slot1), scalar);
		auto& cpu = machine.cpu;
		machine.memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
		auto& frame = *cpu.activeThread()->frameAtDepth(0);
		frame.registers[1] = valueNumber(data); frame.registers[2] = valueNumber(1);
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
		require(frame.registers[0] == valueNumber(44), "RAM code reads newly installed system ROM without a stale pointer");
		if (!scalar) require(page.nativeBlocks->entries[0].get() == block, "data replacement does not retire independent RAM code");
		frame.registers[1] = valueNumber(CART_ROM_BASE);
		for (u32 select : {0xfffffffeu, 0xffffffffu, 0u, 1u}) {
			machine.memory.writeMappedWord(IO_CART_SELECT, select);
			cpu.runUntilDepth(0, 9);
			require(frame.registers[0] == valueNumber((select & 1u) != 0u ? 33 : 22), "ROM reads consume the raw data SELECT latch, masking only bit zero");
		}
		writeLE32(replacement.data() + data, 55);
		machine.memory.cartridgeController().installRom(1, std::span<const u8>(replacement).subspan(data, 16));
		cpu.runUntilDepth(0, 9);
		require(frame.registers[0] == valueNumber(55), "selected cartridge ROM replacement updates its existing storage identity");
		if (!scalar) require(page.nativeBlocks->entries[0].get() == block, "cartridge ROM replacement preserves unrelated RAM code");
		const auto state = machine.memory.cartridgeController().captureState();
		machine.memory.cartridgeController().reset(); cpu.runUntilDepth(0, 9);
		require(frame.registers[0] == valueNumber(22), "reset changes data selection without recreating the native entry");
		machine.memory.cartridgeController().restoreState(state); cpu.runUntilDepth(0, 9);
		require(frame.registers[0] == valueNumber(55), "restore changes the same selector used by direct reads");
	}
}

void tailsAndShortBudgetsAgree() {
	for (int format = 0; format <= 5; ++format) for (const bool displaced : {false, true}) {
		const auto kind = static_cast<MemoryAccessKind>(format);
		auto image = loadLoop(kind, displaced);
		auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
		rom.bytes.resize(0x803); rom.bytes[0x800] = 0x55; rom.bytes[0x801] = 0x33; rom.bytes[0x802] = 0x11;
		std::vector<u8> card{0x55, 0x33, 0x11};
		CpuMachine native(rom, test::cartridgeSlots(card), false), scalar(rom, test::cartridgeSlots(card), true);
		for (auto* machine : {&native, &scalar}) {
			auto& frame = *machine->cpu.activeThread()->frameAtDepth(0);
			frame.registers[1] = valueNumber(DYNAMIC_RAM_BASE + 0x1000u - (displaced ? 1020u : 0u));
			frame.registers[2] = valueNumber(1);
			machine->cpu.runUntilDepth(0, 1000);
		}
		for (u32 address : {0x800u, 0x804u, CART_ROM_BASE, CART_ROM_BASE + 4u}) for (int grant = 1; grant <= 17; ++grant) {
			for (auto* machine : {&native, &scalar}) {
				machine->cpu.activeThread()->frameAtDepth(0)->registers[1] = valueNumber(address - (displaced ? 1020u : 0u));
				machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress);
			}
			test::runCpuParity(native.cpu, scalar.cpu, grant);
			require(native.cpu.readFrameRegister(0, 0) == scalar.cpu.readFrameRegister(0, 0)
				&& native.cpu.readFrameRegister(0, 5) == scalar.cpu.readFrameRegister(0, 5)
				&& native.cpu.readFramePc(0) == scalar.cpu.readFramePc(0) && native.cpu.lastPc == scalar.cpu.lastPc,
				"ROM zero-filled tails, WIDE extents and every short grant agree with scalar execution");
		}
	}
}

void emptySocketsAndCrossRegionDoubles() {
	for (bool scalar : {false, true}) {
		auto image = loadLoop(MemoryAccessKind::F64LE);
		auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
		CartridgeSocketMediaPair slots{};
		slots[0] = CartridgeCardMedia{std::nullopt, 8u, false};
		CpuMachine machine(rom, slots, scalar);
		auto& frame = *machine.cpu.activeThread()->frameAtDepth(0);
		frame.registers[1] = valueNumber(CART_ROM_BASE); frame.registers[2] = valueNumber(1);
		machine.cpu.runUntilDepth(0, 1000);
		require(frame.registers[0] == valueNumber(0), "a present RAM-only card has a zero-valued ROM bus");
		machine.memory.writeMappedWord(IO_CART_SELECT, 1); machine.cpu.runUntilDepth(0, 5);
		require(frame.registers[0] == valueNumber(0), "an empty socket has a zero-valued ROM bus");
		machine.memory.writeMappedWord(IO_CART_SELECT, 0);
		machine.memory.writeMappedWord(CART_RAM_BASE, 0x3ff00000u);
		frame.registers[1] = valueNumber(CART_ROM_END - 4u); machine.cpu.runUntilDepth(0, 5);
		require(frame.registers[0] == valueNumber(1), "F64 executes two ordered words across ROM and RAM rather than returning a whole-region zero");
		frame.registers[0] = valueNumber(73); frame.registers[1] = valueNumber(SYSTEM_ROM_SIZE - 4u); frame.top = 0;
		machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress);
		require(machine.cpu.runUntilDepth(0, 20) == RunResult::Halted && frame.registers[0] == valueNumber(73)
			&& frame.top == 0 && machine.cpu.readEpcWord() == rom.textAddress,
			"a high-half system-ROM boundary fault preserves the load destination and WIDE prefix EPC");
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
	launcher.constants = {static_cast<f64>(CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET)};
	launcher.functions = {{.firstWord = 0, .wordCount = 3}, {.firstWord = 3, .wordCount = 1}};
	launcher.exceptionFunctionIndex = 1;
	const auto system = test::encodeBlua32TestRom(RomImageDomain::System, launcher);
	auto cart0 = test::encodeBlua32TestRom(RomImageDomain::Cartridge, image);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::K0), 0, 0, 0);
	auto cart1 = test::encodeBlua32TestRom(RomImageDomain::Cartridge, image);
	cart0.bytes.resize(0x1000); cart1.bytes.resize(0x1000);
	writeLE32(cart0.bytes.data() + 0x800, 22); writeLE32(cart1.bytes.data() + 0x800, 33);
	for (const bool scalar : {false, true}) {
		CpuMachine machine(system, test::cartridgeSlots(cart0.bytes, cart1.bytes), scalar);
		// Enter through CP0.EXEC, establishing socket 0 before any cartridge fetch.
		machine.cpu.runUntilDepth(0, 7);
		auto& frame = *machine.cpu.activeThread()->frameAtDepth(0);
		require(frame.executionImage->executionDomainId == 0 && frame.pc == cart0.textAddress,
			"CP0.EXEC latches the selected instruction socket before cartridge execution");
		frame.registers[1] = valueNumber(CART_ROM_BASE + 0x800); frame.registers[2] = valueNumber(1);
		machine.memory.writeMappedWord(IO_CART_SELECT, 1);
		machine.cpu.runUntilDepth(0, 1000);
		require(frame.registers[0] == valueNumber(33), "cold instruction fetch ignores the ordinary data selector");
		for (u32 select : {0u, 1u, 0xfffffffeu, 0xffffffffu}) {
			machine.memory.writeMappedWord(IO_CART_SELECT, select);
			machine.cpu.runUntilDepth(0, 9);
			require(frame.registers[0] == valueNumber((select & 1u) != 0u ? 33 : 22)
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
	const auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
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
		frame.registers[2] = valueNumber(IO_CART_SELECT);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
		for (const u32 slot : {0u, 1u}) {
			machine->memory.writeMappedWord(IO_CART_SELECT, slot); frame.registers[4] = valueNumber(slot);
			for (int visit = 0; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++visit) {
				machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], CART_ROM_BASE + MAPPED_PAGE_BYTE_SIZE + 2u * INSTRUCTION_BYTES);
				machine->cpu.runUntilDepth(0, 1);
			}
			if (machine == &native) test::waitForNativeEntry(machine->cpu, *frame.decodedPage, 2);
		}
#endif
		for (const u32 slot : {0u, 1u}) {
			machine->memory.writeMappedWord(IO_CART_SELECT, slot); frame.registers[4] = valueNumber(slot);
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
			frame.registers[0] = valueNumber(1u - slot); frame.registers[4] = valueNumber(slot ^ 1u);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], CART_ROM_BASE + MAPPED_PAGE_BYTE_SIZE);
			require(cpu.runUntilDepth(0, 11) == RunResult::Yielded && frame.registers[3] == valueNumber(1u - slot)
				&& frame.registers[6] == valueNumber(slot) && frame.pc == CART_ROM_BASE && cpu.instructionBudgetRemaining == 0,
				"a mux write selects the newly selected physical ROM for the very next instruction at the exact grant boundary");
		}
		const auto& a = *native.cpu.activeThread()->frameAtDepth(0); const auto& b = *scalar.cpu.activeThread()->frameAtDepth(0);
		require(native.cpu.lastPc == scalar.cpu.lastPc && native.cpu.readCurrentInstructionPc() == scalar.cpu.readCurrentInstructionPc()
			&& a.top == b.top && a.pc == b.pc, "native socket changes retain scalar PC and register-top publication");
		for (int reg = 0; reg < a.stackCapacity; ++reg) require(a.registers[reg] == b.registers[reg], "all socket-switch registers agree");
	}
	const auto* page = lookup.find(CART_ROM_BASE + MAPPED_PAGE_BYTE_SIZE, 1);
	auto replacement = cards[1]; writeInstruction(replacement, second + 2, static_cast<u8>(OpCode::KSMI), 5, 0, 7);
	for (auto* machine : {&native, &scalar}) {
		machine->memory.cartridgeController().installRom(1, replacement);
		require(!page->nativeBlocks, "ROM replacement retires bodies without deleting the page retained by the native index");
		machine->memory.writeMappedWord(IO_CART_SELECT, 1);
		auto& frame = *machine->cpu.activeThread()->frameAtDepth(0); frame.registers[4] = valueNumber(1);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], CART_ROM_BASE + MAPPED_PAGE_BYTE_SIZE);
		machine->cpu.runUntilDepth(0, 11);
		require(frame.registers[6] == valueNumber(7), "a stale index entry never executes retired ROM code");
	}
	require(lookup.find(CART_ROM_BASE + MAPPED_PAGE_BYTE_SIZE, 1) == page, "ROM replacement preserves the page owner");
}

void crossPageLinksFollowTheInstructionChipSelect(bool cartridgeBound) {
	test::Blua32TestImage launcher; launcher.text.resize(4 * INSTRUCTION_BYTES);
	writeInstruction(launcher.text, 0, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
	writeInstruction(launcher.text, 1, static_cast<u8>(OpCode::LOAD_MEM), 0, 0, static_cast<u8>(MemoryAccessKind::Word));
	writeInstruction(launcher.text, 2, static_cast<u8>(OpCode::MTC0), 0, COP0_EXEC, 0);
	writeInstruction(launcher.text, 3, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	launcher.constants = {static_cast<f64>(CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET)};
	launcher.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 8}, {.firstWord = 3, .wordCount = 1}};
	launcher.exceptionFunctionIndex = 1;
	const auto system = test::encodeBlua32TestRom(RomImageDomain::System, launcher);
	test::Blua32TestImage source; source.text.resize(3 * INSTRUCTION_BYTES);
	writeInstruction(source.text, 0, static_cast<u8>(OpCode::KSMI), 3, 0, 11);
	writeInstruction(source.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(source.text, 2, static_cast<u8>(OpCode::JMP), 0, 0, 0);
	source.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 8}};
	auto card0 = test::encodeBlua32TestRom(RomImageDomain::Cartridge, source), card1 = card0;
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
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	native.cpu.setNativeCompilationProfiling(true);
#endif
	const auto domain = cartridgeBound ? 0 : SYSTEM_EXECUTION_DOMAIN_ID;
	const u32 function = cartridgeBound ? card0.functionAddresses[0] : system.functionAddresses[0];
	for (auto* machine : {&native, &scalar}) {
		if (cartridgeBound) machine->cpu.runUntilDepth(0, 7);
		machine->memory.writeBytes(DYNAMIC_RAM_BASE, ram.data(), ram.size());
		auto& frame = *machine->cpu.activeThread()->frameAtDepth(0);
		frame.registers[5] = valueNumber(IO_CART_SELECT); frame.registers[4] = valueNumber(73);
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
			require(frame.registers[0] == valueNumber(select) && frame.registers[2] == valueNumber(select)
				&& frame.registers[3] == valueNumber(!cartridgeBound && (select & 1u) != 0u ? 22 : 11)
				&& frame.pc == DYNAMIC_RAM_BASE && machine->cpu.instructionBudgetRemaining == 0,
				"ordinary MMIO data selection and the instruction socket remain distinct across warm cross-page links");
		}
	}
	std::array<u8, INSTRUCTION_BYTES> replacement{}; writeInstruction(replacement, 0, static_cast<u8>(OpCode::MOV), 0, 4, 0);
	for (auto* machine : {&native, &scalar}) machine->memory.writeBytes(DYNAMIC_RAM_BASE, replacement.data(), replacement.size());
	for (const auto* block : returns) if (block) require(!block->terminal.link.target, "rewriting shared RAM unlinks incoming edges from every socket");
	for (auto* machine : {&native, &scalar}) {
		machine->cpu.writeFrameExecution(0, domain, function, DYNAMIC_RAM_BASE); machine->cpu.runUntilDepth(0, 1200);
		require(machine->cpu.activeThread()->frameAtDepth(0)->registers[0] == valueNumber(73), "regenerated RAM executes the replacement, not a retired linked body");
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
	launcher.constants = {static_cast<f64>(CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET), 11.0};
	launcher.exceptionFunctionIndex = 2;
	launcher.closureRelocations = {{4, record}};
	const auto system = test::encodeBlua32TestRom(RomImageDomain::System, launcher);
	test::Blua32TestImage source; source.text.resize(10 * INSTRUCTION_BYTES);
	writeInstruction(source.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(source.text, 1, static_cast<u8>(OpCode::CLOSURE), 4, 0, 0);
	writeInstruction(source.text, 2, static_cast<u8>(OpCode::MOV), 0, 4, 0);
	writeInstruction(source.text, 3, static_cast<u8>(OpCode::CALL), 0, 1, 2);
	writeInstruction(source.text, 4, static_cast<u8>(OpCode::MOV), 3, 0, 0);
	writeInstruction(source.text, 5, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	writeInstruction(source.text, 6, static_cast<u8>(OpCode::LOADK), 0, 0, 1);
	writeInstruction(source.text, 7, static_cast<u8>(OpCode::RET), 0, 2, 0);
	writeInstruction(source.text, 8, static_cast<u8>(OpCode::LOADK), 0, 0, 2);
	writeInstruction(source.text, 9, static_cast<u8>(OpCode::RET), 0, 2, 0);
	source.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 8},
		{.firstWord = 6, .wordCount = 2, .maxStack = 8}, {.firstWord = 8, .wordCount = 2, .maxStack = 8}};
	source.constants = {0.0, 22.0, 44.0};
	source.closureRelocations = {{1, test::blua32TestFunctionAddress(ramRecord ? RomImageDomain::System : RomImageDomain::Cartridge, 1)}};
	const auto card0 = test::encodeBlua32TestRom(RomImageDomain::Cartridge, source);
	source.constants = {0.0, 33.0, 55.0};
	auto card1 = test::encodeBlua32TestRom(RomImageDomain::Cartridge, source);
	const u32 otherRecord = card1.functionAddresses[1] - CART_ROM_BASE;
	writeLE32(card1.bytes.data() + otherRecord + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, card1.textAddress + 8u * INSTRUCTION_BYTES);
	writeLE32(card1.bytes.data() + otherRecord + BLUA32_FUNCTION_MAX_STACK_OFFSET, 12);
	CpuMachine native(system, test::cartridgeSlots(card0.bytes, card1.bytes), false);
	CpuMachine scalar(system, test::cartridgeSlots(card0.bytes, card1.bytes), true);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	native.cpu.setNativeCompilationProfiling(true);
#endif
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(record, system.bytes.data() + system.functionAddresses[3], BLUA32_FUNCTION_RECORD_SIZE);
		machine->memory.writeMappedU32LE(record + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, code);
		machine->memory.writeBytes(code, launcher.text.data() + 9u * INSTRUCTION_BYTES, 2u * INSTRUCTION_BYTES);
		require(machine->cpu.runUntilDepth(0, 7) == RunResult::Yielded && machine->cpu.readFrameExecutionDomain(0) == 0,
			"EXEC establishes socket 0 before SELECT changes");
		machine->memory.writeMappedWord(IO_CART_SELECT, 1);
		require(machine->memory.readMappedU32LE(card0.functionAddresses[1]) == card1.textAddress + 8u * INSTRUCTION_BYTES,
			"ordinary data reads see the different record fitted to socket 1");
	}
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
		const auto* callee = native.cpu.rootThread()->frameAtDepth(targetDepth - 1);
		const auto published = [](const CallFrame* frame, u32 pc) {
			const auto* lookup = frame->executionImage->nativeCodeLookup.get();
			const auto* page = lookup ? lookup->find(pc, 0) : nullptr;
			return page && page->nativeBlocks && page->nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
		};
		const bool ready = published(root, card0.textAddress + 2u * INSTRUCTION_BYTES)
			&& published(callee, ramRecord ? code : card0.textAddress + 6u * INSTRUCTION_BYTES)
			&& (!ramRecord || published(relay, system.textAddress + 5u * INSTRUCTION_BYTES));
		if (ready) break;
		test::runCpuParity(native.cpu, scalar.cpu, 20000);
	}
	test::waitForFixtureWorkerRequests(native.cpu);
#endif
	test::runCpuParity(native.cpu, scalar.cpu, 100, 1);
	const u32 entry = card0.textAddress + 2u * INSTRUCTION_BYTES;
	for (auto* machine : {&native, &scalar}) {
		require(machine->cpu.rootThread()->frameAtDepth(0)->registers[3] == valueNumber(ramRecord ? 11 : 22), "the warmed call loop returns the closure-bound constants");
		machine->cpu.writeFrameExecution(0, 0, card0.functionAddresses[0], entry);
	}
	const auto* root = native.cpu.rootThread()->frameAtDepth(0);
	require(root->executionImage->nativeCodeLookup->find(entry, 0)->nativeBlocks->entries[(entry & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES] != nullptr,
		"the repeated caller has a generated entry");
	for (int grant = 1; grant <= 128; ++grant) {
		test::runCpuParity(native.cpu, scalar.cpu, grant);
		const auto& first = *native.cpu.activeThread(); const auto& second = *scalar.cpu.activeThread();
		require(first.frameDepth == second.frameDepth && first.stackTop == second.stackTop
			&& native.cpu.readCurrentInstructionPc() == scalar.cpu.readCurrentInstructionPc()
			&& native.cpu.lastPc == scalar.cpu.lastPc && native.cpu.readLastExecutionDomain() == scalar.cpu.readLastExecutionDomain()
			&& native.cpu.readCauseWord() == scalar.cpu.readCauseWord() && native.cpu.readEpcWord() == scalar.cpu.readEpcWord(),
			"native and scalar CALL preserve frame, PC, domain and fault state at every short grant");
		for (size_t depth = 0; depth < first.frameDepth; ++depth) {
			const auto& a = *first.frameAtDepth(depth); const auto& b = *second.frameAtDepth(depth);
			require(a.executionImage->executionDomainId == b.executionImage->executionDomainId && a.pc == b.pc
				&& a.functionAddress == b.functionAddress && a.stackCapacity == b.stackCapacity && a.stackBase == b.stackBase
				&& a.top == b.top && a.returnBase == b.returnBase && a.returnCount == b.returnCount && a.callSitePc == b.callSitePc,
				"record selection and activation windows agree at each call boundary");
			for (int reg = 0; reg < a.stackCapacity; ++reg) {
				const Value left = a.registers[reg], right = b.registers[reg];
				if (valueIsClosure(left)) require(valueIsClosure(right) && asClosure(left)->functionAddress == asClosure(right)->functionAddress,
					"corresponding closure values retain their function-record addresses");
				else require(left == right, "every retained register agrees across record-domain transitions");
			}
		}
		require(first.firstFrame->registers[3] == valueNumber(ramRecord ? 11 : 22), "short grants preserve the closure-bound constants");
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
	require(callee->executionImage->executionDomainId == (ramRecord ? SYSTEM_EXECUTION_DOMAIN_ID : 0) && callee->stackCapacity == 8
		&& callee->pc == (ramRecord ? code : card0.textAddress + 6u * INSTRUCTION_BYTES),
		"CALL uses the closure-bound domain and record, not SELECT metadata");
	require(callee->executionImage->nativeCodeLookup->find(callee->pc, 0)->nativeBlocks->entries[(callee->pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES] != nullptr,
		"the callee body is generated as well as its caller");
	test::runCpuParity(native.cpu, scalar.cpu, 100, 1);
	for (auto* machine : {&native, &scalar}) require(machine->cpu.rootThread()->frameAtDepth(0)->registers[0] == valueNumber(ramRecord ? 11 : 22),
		"the result uses the closure-bound constants, not the data-selected socket");
}

} // namespace

int main() {
	try {
		directRomLoadsUseCurrentOwners(); romReplacementAndSelectionKeepRamCode();
		tailsAndShortBudgetsAgree(); emptySocketsAndCrossRegionDoubles();
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
