#include "common/endian.h"
#include "machine/cpu/cpu.h"
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
	__builtin_unreachable();
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
	Memory memory(MemoryInit{system, test::cartridgeSlots(slot0, slot1)}, PSX_MACHINE_SPEC.ramBytes);
	size_t bytes = 0;
	for (int format = 0; format <= 5; ++format) for (const bool displaced : {false, true}) {
		const auto kind = static_cast<MemoryAccessKind>(format);
		const u32 width = format == 1 ? 1u : format == 2 ? 2u : format == 5 ? 8u : 4u;
		DecodedInstruction load;
		load.op = static_cast<u8>(displaced ? OpCode::LOAD_MEM_D : OpCode::LOAD_MEM);
		load.a = 0; load.b = 1; load.c = format; load.disp = displaced ? 255 : 0; load.width = 2; load.baseCycles = 2;
		const std::array source{NativeBlockInstruction{&load, 0x1000}};
		auto block = NativeBlock::compile(source, nullptr, bytes, memory);
		for (const u32 address : {0u, 4u, 16u, CART_ROM_BASE, CART_ROM_BASE + 4u, CART_ROM_BASE + 24u}) {
			std::array registers{valueNil(), valueNumber(address - static_cast<u32>(load.disp) * 4u)};
			require(block->run(registers.data(), nullptr) == &block->terminal
				&& registers[0] == scalarLoad(memory, kind, address), "backed system and cartridge ROM reads stay in the native block");
		}
		for (u32 address : {SYSTEM_ROM_SIZE - 4u, 72u, CART_ROM_BASE + 32u, CART_ROM_END - 4u}) {
			std::array registers{valueNumber(73), valueNumber(address - static_cast<u32>(load.disp) * 4u)};
			const bool backed = address >= CART_ROM_BASE && address < CART_ROM_END
				&& address - CART_ROM_BASE + width <= slot0.size();
			const auto* exit = block->run(registers.data(), nullptr);
			require((exit == &block->terminal) == backed, "short tails and logical boundary crossings use the ordered bus owner");
			if (!backed) require(registers[0] == valueNumber(73), "a ROM side exit has not committed its destination");
		}
		load.a = load.b;
		const std::array aliasSource{NativeBlockInstruction{&load, 0x1000}};
		auto alias = NativeBlock::compile(aliasSource, nullptr, bytes, memory);
		std::array registers{valueNil(), valueNumber(CART_ROM_BASE + 4u - load.disp * 4u)};
		require(alias->run(registers.data(), nullptr) == &alias->terminal
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
		auto& frame = *cpu.activeThread()->frames[0];
		frame.registers[1] = valueNumber(data); frame.registers[2] = valueNumber(1);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 1000);
		auto& page = *frame.decodedPage;
		const NativeBlock* block = scalar ? nullptr : page.nativeBlocks->entries[0].get();
		if (!scalar) require(block && block->sourceWords == 5, "ROM and arithmetic share an actual native RAM entry");
		auto replacement = rom.bytes;
		writeLE32(replacement.data() + data, 44);
		machine.memory.installSystemRom(replacement);
		cpu.runUntilDepth(0, 5);
		require(frame.registers[0] == valueNumber(44), "RAM code reads newly installed system ROM without a stale pointer");
		if (!scalar) require(page.nativeBlocks->entries[0].get() == block, "data replacement does not retire independent RAM code");
		frame.registers[1] = valueNumber(CART_ROM_BASE);
		for (u32 select : {0xfffffffeu, 0xffffffffu, 0u, 1u}) {
			machine.memory.writeMappedWord(IO_CART_SELECT, select);
			cpu.runUntilDepth(0, 5);
			require(frame.registers[0] == valueNumber((select & 1u) != 0u ? 33 : 22), "ROM reads consume the raw data SELECT latch, masking only bit zero");
		}
		writeLE32(replacement.data() + data, 55);
		machine.memory.cartridgeController().installRom(1, std::span<const u8>(replacement).subspan(data, 16));
		cpu.runUntilDepth(0, 5);
		require(frame.registers[0] == valueNumber(55), "selected cartridge ROM replacement updates its existing storage identity");
		if (!scalar) require(page.nativeBlocks->entries[0].get() == block, "cartridge ROM replacement preserves unrelated RAM code");
		const auto state = machine.memory.cartridgeController().captureState();
		machine.memory.cartridgeController().reset(); cpu.runUntilDepth(0, 5);
		require(frame.registers[0] == valueNumber(22), "reset changes data selection without recreating the native entry");
		machine.memory.cartridgeController().restoreState(state); cpu.runUntilDepth(0, 5);
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
			auto& frame = *machine->cpu.activeThread()->frames[0];
			frame.registers[1] = valueNumber(DYNAMIC_RAM_BASE + 0x1000u - (displaced ? 1020u : 0u));
			frame.registers[2] = valueNumber(1);
			machine->cpu.runUntilDepth(0, 1000);
		}
		for (u32 address : {0x800u, 0x804u, CART_ROM_BASE, CART_ROM_BASE + 4u}) for (int grant = 1; grant <= 17; ++grant) {
			for (auto* machine : {&native, &scalar}) {
				machine->cpu.activeThread()->frames[0]->registers[1] = valueNumber(address - (displaced ? 1020u : 0u));
				machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress);
				machine->cpu.runUntilDepth(0, grant);
			}
			require(native.cpu.readFrameRegister(0, 0) == scalar.cpu.readFrameRegister(0, 0)
				&& native.cpu.readFrameRegister(0, 5) == scalar.cpu.readFrameRegister(0, 5)
				&& native.cpu.readFramePc(0) == scalar.cpu.readFramePc(0) && native.cpu.lastPc == scalar.cpu.lastPc
				&& native.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining,
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
		auto& frame = *machine.cpu.activeThread()->frames[0];
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
		machine.cpu.runUntilDepth(0, 4);
		auto& frame = *machine.cpu.activeThread()->frames[0];
		require(frame.executionImage->executionDomainId == 0 && frame.pc == cart0.textAddress,
			"CP0.EXEC latches the selected instruction socket before cartridge execution");
		frame.registers[1] = valueNumber(CART_ROM_BASE + 0x800); frame.registers[2] = valueNumber(1);
		machine.memory.writeMappedWord(IO_CART_SELECT, 1);
		machine.cpu.runUntilDepth(0, 1000);
		require(frame.registers[0] == valueNumber(33), "cold instruction fetch ignores the ordinary data selector");
		for (u32 select : {0u, 1u, 0xfffffffeu, 0xffffffffu}) {
			machine.memory.writeMappedWord(IO_CART_SELECT, select);
			machine.cpu.runUntilDepth(0, 5);
			require(frame.registers[0] == valueNumber((select & 1u) != 0u ? 33 : 22)
				&& frame.executionImage->executionDomainId == 0,
				"ordinary ROM loads follow SELECT while executable instructions stay on their own physical socket");
		}
	}
}

} // namespace

int main() {
	try {
		directRomLoadsUseCurrentOwners(); romReplacementAndSelectionKeepRamCode();
		tailsAndShortBudgetsAgree(); emptySocketsAndCrossRegionDoubles();
		dataSelectionDoesNotSelectInstructionFetch();
		std::cout << "Compiled ROM tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
