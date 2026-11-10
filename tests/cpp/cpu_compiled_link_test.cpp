#include "machine/cpu/cpu.h"
#include "machine/common/numeric.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
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

void requireParity(CpuMachine& native, CpuMachine& scalar) {
	const auto& first = *native.cpu.activeThread()->frames[0];
	const auto& second = *scalar.cpu.activeThread()->frames[0];
	require(first.pc == second.pc && first.top == second.top
		&& native.cpu.readCurrentInstructionPc() == scalar.cpu.readCurrentInstructionPc()
		&& native.cpu.lastPc == scalar.cpu.lastPc && native.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining,
		"linked blocks publish the same PC, WIDE body, register extent and cycle boundary as scalar instructions");
	for (int reg = 0; reg < 12; ++reg) require(first.registers[reg] == second.registers[reg],
		"linked execution preserves each raw live register at every grant");
}

void grantsAndTargetRetirement() {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::ADD), 8, 8, 1);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMPIF), 2, 0, 2);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::UNM), 0, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 0, 2);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::SHL), 0, 0, 1);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::MOV), 3, 8, 0);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 7, static_cast<u8>(OpCode::ADD), 4, 0, 8);
	writeInstruction(image.text, 8, static_cast<u8>(OpCode::JMP), 0, 63, 55, 255);
	image.functions = {{.firstWord = 0, .wordCount = 9, .maxStack = 12}};
	CpuMachine native(image, false), scalar(image, true);
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
		auto& frame = *machine->cpu.activeThread()->frames[0];
		frame.registers[0] = valueNumber(2); frame.registers[1] = valueNumber(1); frame.registers[8] = valueNumber(0);
	}
	for (const bool flag : {true, false}) for (auto* machine : {&native, &scalar}) {
		machine->cpu.activeThread()->frames[0]->registers[2] = valueBool(flag);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		require(machine->cpu.runUntilDepth(0, 2048) == RunResult::Yielded, "warm both branch paths");
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frames[0]->decodedPage;
	const auto* root = page.nativeBlocks->entries[0].get();
	const auto& taken = root->sideExits.back();
	require(page.nativeBlocks->entries[2] && page.nativeBlocks->entries[4]
		&& root->region == page.nativeBlocks->entries[2]->region && root->region == page.nativeBlocks->entries[4]->region
		&& !root->terminal.link.code && !taken.link.code,
		"both branch targets are internal entries of one code region, not dispatcher links");
	for (const bool flag : {false, true}) for (const u32 start : {0u, 2u, 4u, 6u}) for (int grant = 2; grant <= 64; ++grant) {
		std::array<Value, 12> registers; registers.fill(valueNumber(0));
		registers[0] = valueNumber(2); registers[1] = valueNumber(1); registers[2] = valueBool(flag);
		auto expected = registers;
		int remaining = grant, top = 0;
		u32 segment = start;
		const NativeBlockExitSite* expectedExit;
		for (;;) {
			const auto& current = *page.nativeBlocks->entries[segment];
			expectedExit = &current.terminal;
			if (segment == 0) {
				expected[8] = valueNumber(asNumber(expected[8]) + 1); top = std::max(top, 9);
				if (flag) expectedExit = &current.sideExits.back();
				segment = flag ? 4u : 2u;
			} else if (segment == 2) {
				expected[0] = valueNumber(-asNumber(expected[0])); top = std::max(top, 1); segment = 6;
			} else if (segment == 4) {
				expected[0] = valueNumber(static_cast<i32>(toU32(expected[0]) << 1u));
				expected[3] = expected[8]; top = std::max(top, 4); segment = 6;
			} else {
				expected[4] = valueNumber(asNumber(expected[0]) + asNumber(expected[8])); top = std::max(top, 5); segment = 0;
			}
			remaining -= 2;
			if (remaining < 2) break;
		}
		NativeBlockRunState run{.registers = registers.data(), .constants = native.cpu.activeThread()->frames[0]->executionImage->constPool.data(),
			.remainingCycles = grant};
		const auto* exit = page.nativeBlocks->entries[start]->run(run);
		require(exit == expectedExit && registers == expected && run.remainingCycles == remaining && run.registerTop == top,
			"one native entry traverses both branches, a WIDE merge and a backedge without a CPU dispatcher or intermediate frame");
	}

#endif
	for (const Value flag : {valueBool(true), valueBool(false), valueNumber(0), VALUE_QNAN_MASK}) for (int grant = 1; grant <= 96; ++grant) {
		for (auto* machine : {&native, &scalar}) {
			auto& frame = *machine->cpu.activeThread()->frames[0]; frame.registers[2] = flag; frame.top = 0;
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
			require(machine->cpu.runUntilDepth(0, grant) == RunResult::Yielded, "each short grant yields an exact prefix");
		}
		requireParity(native, scalar);
	}
	std::array<u8, INSTRUCTION_BYTES> replacement{};
	writeInstruction(replacement, 0, static_cast<u8>(OpCode::SUB), 4, 0, 8);
	for (auto* machine : {&native, &scalar}) machine->memory.writeBytes(DYNAMIC_RAM_BASE + 7u * INSTRUCTION_BYTES,
		replacement.data(), replacement.size());
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	require(!page.nativeBlocks,
		"a write to an internal target retires every reachable label before reusing the source region");
#endif
	for (auto* machine : {&native, &scalar}) {
		machine->cpu.activeThread()->frames[0]->registers[2] = valueBool(true);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		machine->cpu.runUntilDepth(0, 2048);
	}
	requireParity(native, scalar);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	require(page.nativeBlocks && page.nativeBlocks->entries[0] && page.nativeBlocks->entries[4]
		&& page.nativeBlocks->entries[0]->region == page.nativeBlocks->entries[4]->region,
		"the updated target regenerates in the same region as its branch source");
#endif
	for (auto* machine : {&native, &scalar}) machine->cpu.runUntilDepth(0, 600002);
	requireParity(native, scalar);
	// This also destroys a cyclic incoming/outgoing graph under the sanitizers.
	native.cpu.reset();
}

void crossPageLinksRetireTheirTargetsAndKeepBoundedStack() {
	test::Blua32TestImage image; image.text.resize(2 * MAPPED_PAGE_BYTE_SIZE);
	constexpr u32 second = DECODED_PAGE_WORDS;
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::ADD), 8, 8, 1);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 3, 62);
	writeInstruction(image.text, second, static_cast<u8>(OpCode::MUL), 0, 0, 1);
	writeInstruction(image.text, second + 1, static_cast<u8>(OpCode::MOV), 3, 8, 0);
	writeInstruction(image.text, second + 2, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, second + 3, static_cast<u8>(OpCode::ADD), 4, 0, 8);
	writeInstruction(image.text, second + 4, static_cast<u8>(OpCode::JMP), 0, 59, 59, 255);
	image.functions = {{.firstWord = 0, .wordCount = second + 5, .maxStack = 12}};
	CpuMachine native(image, false), scalar(image, true);
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
		auto& frame = *machine->cpu.activeThread()->frames[0];
		frame.registers[0] = valueNumber(2); frame.registers[1] = valueNumber(1); frame.registers[8] = valueNumber(0);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		machine->cpu.runUntilDepth(0, 2048);
	}
	const auto& lookup = *native.cpu.activeThread()->frames[0]->executionImage->nativeCodeLookup;
	auto* firstPage = lookup.find(DYNAMIC_RAM_BASE, 0);
	auto* secondPage = lookup.find(DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE, 0);
	const auto* root = firstPage->nativeBlocks->entries[0].get();
	const auto* target = secondPage->nativeBlocks->entries[0].get();
	require(root && target && root->terminal.link.target == target && target->terminal.link.target == root,
		"both cross-page edges enter the real successor body without the CPU dispatcher");
	for (int grant = 1; grant <= 128; ++grant) {
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
			machine->cpu.runUntilDepth(0, grant);
		}
		requireParity(native, scalar);
	}
	std::array<u8, INSTRUCTION_BYTES> replacement{};
	writeInstruction(replacement, 0, static_cast<u8>(OpCode::SUB), 4, 0, 8);
	for (auto* machine : {&native, &scalar}) machine->memory.writeBytes(
		DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE + 3 * INSTRUCTION_BYTES, replacement.data(), replacement.size());
	require(firstPage->nativeBlocks->entries[0].get() == root && !root->terminal.link.target,
		"retiring a cross-page target disconnects its incoming edge without discarding the independent source");
	for (auto* machine : {&native, &scalar}) {
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		machine->cpu.runUntilDepth(0, 2048);
	}
	requireParity(native, scalar);
	require(root->terminal.link.target == secondPage->nativeBlocks->entries[0].get(), "a rewritten target regenerates and links again");
	for (auto* machine : {&native, &scalar}) machine->cpu.runUntilDepth(0, 600002);
	requireParity(native, scalar);
	native.cpu.reset();
}

void shortGrantsDoNotPromoteSequentialPositions(bool inRam) {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	for (u32 word = 0; word < 12; ++word) writeInstruction(image.text, word, static_cast<u8>(OpCode::ADD), 0, 0, 1);
	writeInstruction(image.text, 12, static_cast<u8>(OpCode::JMP), 0, 63, 51, 255); // -13 words
	writeInstruction(image.text, 32, static_cast<u8>(OpCode::JMP), 0, 63, 35, 255); // enter word 4
	image.functions = {{.firstWord = 0, .wordCount = 33, .maxStack = 12}};
	CpuMachine native(image, false), scalar(image, true);
	const u32 start = inRam ? DYNAMIC_RAM_BASE : native.rom.textAddress;
	for (auto* machine : {&native, &scalar}) {
		if (inRam) machine->memory.writeBytes(start, image.text.data(), image.text.size());
		auto& frame = *machine->cpu.activeThread()->frames[0];
		frame.registers[0] = valueNumber(0); frame.registers[1] = valueNumber(1);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], start);
		machine->cpu.runUntilDepth(0, 4096);
	}
	const auto& lookup = *native.cpu.activeThread()->frames[0]->executionImage->nativeCodeLookup;
	auto& page = *lookup.find(start, 0);
	const auto entry = (start & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	require(page.nativeBlocks && page.nativeBlocks->entries[entry]
		&& page.nativeBlocks->entries[entry]->sourceWords == 13,
		"entry admission preserves successor stability heat and compiles a complete ROM/RAM loop");
	for (int run = 0; run < 512; ++run) {
		for (auto* machine : {&native, &scalar}) machine->cpu.runUntilDepth(0, 1);
		requireParity(native, scalar);
	}
	for (int grant = 2; grant <= 31; ++grant) {
		for (auto* machine : {&native, &scalar}) machine->cpu.runUntilDepth(0, grant);
		requireParity(native, scalar);
	}
	require(page.nativeBlocks->count == 1 && !page.nativeBlocks->entries[entry + 4],
		"arbitrary sequential grant resumptions do not create overlapping suffix translations");
	for (auto* machine : {&native, &scalar}) {
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], start + 32 * INSTRUCTION_BYTES);
		machine->cpu.runUntilDepth(0, 128);
	}
	requireParity(native, scalar);
	require(static_cast<bool>(page.nativeBlocks->entries[entry + 4]),
		"an actual branch into the same interior position remains eligible for native execution");
}
void entriesIntoWideBodiesShareTheirSequentialJoin() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::ADD), 0, 0, 1);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::ADD), 2, 0, 1);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	writeInstruction(image.text, 16, static_cast<u8>(OpCode::JMP), 0, 63, 48, 255);
	image.functions = {{.firstWord = 0, .wordCount = 17, .maxStack = 12}};
	CpuMachine native(image, false), scalar(image, true);
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
		auto& frame = *machine->cpu.activeThread()->frames[0];
		frame.registers[0] = frame.registers[2] = valueNumber(0); frame.registers[1] = valueNumber(1);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		machine->cpu.runUntilDepth(0, 1200);
	}
	for (int visit = 0; visit < 16; ++visit) {
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE + 16u * INSTRUCTION_BYTES);
			machine->cpu.runUntilDepth(0, 128);
		}
		requireParity(native, scalar);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& page = *native.cpu.activeThread()->frames[0]->decodedPage;
	const auto& entries = page.nativeBlocks->entries;
	require(entries[0] && entries[1] && entries[2] && entries[16]
		&& entries[0]->region == entries[1]->region && entries[1]->region == entries[2]->region
		&& entries[0]->sourceWords == 2 && entries[1]->sourceWords == 1 && entries[2]->sourceWords == 2,
		"prefix and raw-body entries converge at one shared segment instead of duplicating their sequential suffix");
#endif
	for (int grant = 1; grant <= 31; ++grant) {
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE + INSTRUCTION_BYTES);
			machine->cpu.runUntilDepth(0, grant);
		}
		requireParity(native, scalar);
	}
}

} // namespace

int main() {
	try {
		grantsAndTargetRetirement(); entriesIntoWideBodiesShareTheirSequentialJoin(); crossPageLinksRetireTheirTargetsAndKeepBoundedStack();
		shortGrantsDoNotPromoteSequentialPositions(false); shortGrantsDoNotPromoteSequentialPositions(true);
		std::cout << "Compiled block link tests passed\n"; return 0;
	}
	catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
