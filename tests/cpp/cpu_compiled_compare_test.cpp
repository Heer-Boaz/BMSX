#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"
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

struct CpuMachine {
	test::Blua32TestRom rom;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;
	CpuMachine(const test::Blua32TestImage& image, bool scalar)
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image))
		, memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes)
		, irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		cpu.reset();
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; },
			nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	}
};

void changingSkippedBytesPreserveIndependentCode() {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::ADD), 3, 6, 6);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::EQ), 1, 0, 1);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::K1), 2, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::MOV), 5, 2, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::JMP), 0, 63, 58, 255);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 8}, {.firstWord = 6, .wordCount = 1}};
	image.exceptionFunctionIndex = 1;
	CpuMachine native(image, false), scalar(image, true);
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
		auto& frame = *machine->cpu.activeThread()->frames[0];
		frame.registers[0] = valueNumber(0); frame.registers[1] = valueNumber(1);
		frame.registers[2] = valueNumber(73); frame.registers[6] = valueNumber(1);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		machine->cpu.runUntilDepth(0, 800);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frames[0]->decodedPage;
	const auto* block = page.nativeBlocks->entries[0].get();
	require(block && block->sourceWords == 2 && block->sideExits.back().exit == NativeBlockExit::SkipInstruction,
		"the hot native block contains the comparison and its dirty arithmetic prefix");
#endif
	for (const bool wide : {false, true, false}) {
		std::array<u8, INSTRUCTION_BYTES> replacement{};
		writeInstruction(replacement, 0, static_cast<u8>(wide ? OpCode::WIDE : OpCode::K0), 0, 0, 0);
		for (auto* machine : {&native, &scalar}) {
			machine->memory.writeBytes(DYNAMIC_RAM_BASE + 2u * INSTRUCTION_BYTES, replacement.data(), replacement.size());
			auto& frame = *machine->cpu.activeThread()->frames[0]; frame.top = 0;
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
			machine->cpu.runUntilDepth(0, 2);
			require(frame.pc == DYNAMIC_RAM_BASE + (wide ? 4u : 3u) * INSTRUCTION_BYTES
				&& frame.registers[2] == valueNumber(73) && frame.registers[3] == valueNumber(2) && frame.top == 4,
				"only a taken comparison skip decodes the current complete successor without executing it");
		}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		require(page.nativeBlocks && page.nativeBlocks->entries[0].get() == block && page.refreshState[0] == 0,
			"a live native block does not depend on scalar fusion lookahead or on the skipped instruction's bytes");
#endif
		require(native.cpu.lastPc == scalar.cpu.lastPc && native.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining,
			"comparison and WIDE skips retain scalar budget and last-PC boundaries");
	}
}

void skipFetchBoundaries() {
	for (const auto flags : {std::array{false, false}, std::array{true, false}, std::array{false, true}}) {
		const bool currentWide = flags[0], skippedWide = flags[1];
		test::Blua32TestImage image;
		image.text.resize(2 * INSTRUCTION_BYTES);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		image.functions = {{.firstWord = 0, .wordCount = 1, .maxStack = 4}, {.firstWord = 1, .wordCount = 1}};
		image.exceptionFunctionIndex = 1;
		CpuMachine native(image, false), scalar(image, true);
		const u32 end = RAM_BASE + PSX_MACHINE_SPEC.ramBytes;
		const u32 nextPc = end - (skippedWide ? INSTRUCTION_BYTES : 0u);
		const u32 pc = nextPc - (currentWide ? 2u : 1u) * INSTRUCTION_BYTES;
		std::array<u8, 2 * INSTRUCTION_BYTES> code{};
		u32 word = 0;
		if (currentWide) writeInstruction(code, word++, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(code, word++, static_cast<u8>(OpCode::EQ), 1, 0, 1);
		if (skippedWide) { writeInstruction(code, word, static_cast<u8>(OpCode::WIDE), 0, 0, 0); ++word; }
		for (auto* machine : {&native, &scalar}) {
			machine->memory.writeBytes(pc, code.data(), word * INSTRUCTION_BYTES);
			auto& frame = *machine->cpu.activeThread()->frames[0];
			frame.registers[0] = frame.registers[1] = valueNumber(0);
			for (u32 visit = 0; visit < 10; ++visit) {
				machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], pc);
				require(machine->cpu.runUntilDepth(0, 1) == RunResult::Yielded && frame.pc == nextPc
					&& machine->memory.readIoU32(IO_SYS_BUS_FAULT_CODE) == BUS_FAULT_NONE,
					"an untaken skip performs no future fetch even after native warmup at a physical boundary");
			}
		}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		const auto& page = *native.cpu.activeThread()->frames[0]->decodedPage;
		require(page.nativeBlocks && page.nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) >> 2u],
			"a boundary comparison enters generated machine code rather than remaining a cold scalar opcode");
#endif
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.activeThread()->frames[0]->registers[1] = valueNumber(1);
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], pc);
			require(machine->cpu.runUntilDepth(0, 1) == RunResult::Yielded && machine->cpu.readEpcWord() == nextPc
				&& machine->memory.readIoU32(IO_SYS_BUS_FAULT_CODE) == BUS_FAULT_UNMAPPED
				&& machine->memory.readIoU32(IO_SYS_BUS_FAULT_ADDR) == end,
				"a taken skip retains the skipped prefix EPC and the actual failed body/fetch bus address");
		}
		require(native.cpu.lastPc == scalar.cpu.lastPc && native.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining,
			"native and scalar fetch-fault exits publish the same comparison boundary");
	}
}

} // namespace

int main() {
	try {
		changingSkippedBytesPreserveIndependentCode(); skipFetchBoundaries();
		std::cout << "Compiled comparison boundary tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
