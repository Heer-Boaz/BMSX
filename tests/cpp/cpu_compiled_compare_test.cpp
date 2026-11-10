#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"

#include <algorithm>
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

void changingSkippedBytesRetireResolvedEdges() {
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
	require(block && block->sourceWords == 4 && block->sideExits.back().exit == NativeBlockExit::Continue
		&& block->sideExits.back().nextPc == DYNAMIC_RAM_BASE + 4u * INSTRUCTION_BYTES,
		"the hot native comparison retains the fetched WIDE dependency and a fixed skip edge");
#endif
	for (const bool wide : {false, true, false}) {
		std::array<u8, INSTRUCTION_BYTES> replacement{};
		writeInstruction(replacement, 0, static_cast<u8>(wide ? OpCode::WIDE : OpCode::K0), 0, 0, 0);
		for (auto* machine : {&native, &scalar}) {
			machine->memory.writeBytes(DYNAMIC_RAM_BASE + 2u * INSTRUCTION_BYTES, replacement.data(), replacement.size());
			auto& frame = *machine->cpu.activeThread()->frames[0]; frame.top = 0; frame.registers[2] = valueNumber(73);
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
			machine->cpu.runUntilDepth(0, 2);
			require(frame.pc == DYNAMIC_RAM_BASE + (wide ? 4u : 3u) * INSTRUCTION_BYTES
				&& frame.registers[2] == valueNumber(73) && frame.registers[3] == valueNumber(2) && frame.top == 4,
				"only a taken comparison skip decodes the current complete successor without executing it");
		}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		require(!page.nativeBlocks || !page.nativeBlocks->entries[0],
			"rewriting the skipped instruction retires the resolved native edge before reusing its width");
#endif
		require(native.cpu.lastPc == scalar.cpu.lastPc && native.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining,
			"comparison and WIDE skips retain scalar budget and last-PC boundaries");
		for (auto* machine : {&native, &scalar}) machine->cpu.runUntilDepth(0, 800);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		require(page.nativeBlocks && page.nativeBlocks->entries[0], "the changed comparison warms and compiles again");
#endif
	}
}

void maximumLengthSkipDependencyRetires() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	for (int instruction = 0; instruction < 63; ++instruction) {
		writeInstruction(image.text, instruction * 2, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(image.text, instruction * 2 + 1, static_cast<u8>(OpCode::MOV), 3, 3, 0);
	}
	writeInstruction(image.text, 126, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 127, static_cast<u8>(OpCode::EQ), 1, 0, 1);
	writeInstruction(image.text, 128, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 129, static_cast<u8>(OpCode::K1), 2, 0, 0);
	writeInstruction(image.text, 130, static_cast<u8>(OpCode::JMP), 0, 61, 61, 255);
	image.functions = {{.firstWord = 0, .wordCount = 131, .maxStack = 4}};
	CpuMachine native(image, false), scalar(image, true);
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
		auto& frame = *machine->cpu.activeThread()->frames[0]; frame.registers[0] = valueNumber(0); frame.registers[1] = valueNumber(1);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		machine->cpu.runUntilDepth(0, 8192);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frames[0]->decodedPage;
	require(page.nativeBlocks->entries[0] && page.nativeBlocks->entries[0]->sourceWords == 130,
		"the maximum-size body also retains both skipped WIDE words");
#endif
	std::array<u8, INSTRUCTION_BYTES> replacement{};
	writeInstruction(replacement, 0, static_cast<u8>(OpCode::K0), 2, 0, 0);
	for (auto* machine : {&native, &scalar}) machine->memory.writeBytes(DYNAMIC_RAM_BASE + 129u * INSTRUCTION_BYTES,
		replacement.data(), replacement.size());
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	require(!page.nativeBlocks || !page.nativeBlocks->entries[0], "the last dependent word retires the complete native body");
#endif
	for (auto* machine : {&native, &scalar}) machine->cpu.runUntilDepth(0, 8192);
	const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
	require(std::ranges::equal(a.snapshot.words(), b.snapshot.words())
		&& native.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining && native.cpu.lastPc == scalar.cpu.lastPc,
		"updated WIDE skip dependencies preserve exact execution boundaries");
}

void resolvedComparisonLinksBothPaths() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::EQ), 1, 0, 2);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 0, 2);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::ADD), 3, 3, 1);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::ADD), 4, 4, 1);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::JMP), 0, 63, 58, 255);
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 5}};
	CpuMachine native(image, false), scalar(image, true);
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
		for (int reg = 0; reg < 5; ++reg) machine->cpu.activeThread()->frames[0]->registers[reg] = valueNumber(reg == 1 ? 1 : 0);
	}
	for (const int value : {0, 1}) for (auto* machine : {&native, &scalar}) {
		machine->cpu.activeThread()->frames[0]->registers[0] = valueNumber(value);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		machine->cpu.runUntilDepth(0, 2048);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& cache = *native.cpu.activeThread()->frames[0]->decodedPage->nativeBlocks;
	const auto& root = *cache.entries[0];
	require(root.sourceWords == 2 && cache.entries[1] && cache.entries[2]
		&& root.region == cache.entries[1]->region && root.region == cache.entries[2]->region
		&& root.sideExits.back().exit == NativeBlockExit::Continue
		&& !root.terminal.link.code && !root.sideExits.back().link.code,
		"both comparison outcomes stay in their code region without dynamic skip or link dispatch");
#endif
	for (const int value : {0, 1}) for (int grant = 1; grant <= 32; ++grant) {
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.activeThread()->frames[0]->registers[0] = valueNumber(value);
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
			machine->cpu.runUntilDepth(0, grant);
		}
		const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
		require(std::ranges::equal(a.snapshot.words(), b.snapshot.words()) && native.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining
			&& native.cpu.readCurrentInstructionPc() == scalar.cpu.readCurrentInstructionPc() && native.cpu.lastPc == scalar.cpu.lastPc,
			"linked comparisons preserve each exact short grant, including between the comparison and its JMP");
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
		changingSkippedBytesRetireResolvedEdges(); maximumLengthSkipDependencyRetires(); resolvedComparisonLinksBothPaths(); skipFetchBoundaries();
		std::cout << "Compiled comparison boundary tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
