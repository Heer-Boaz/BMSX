#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
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
	require(root->terminal.link.target && root->terminal.link.target == page.nativeBlocks->entries[2].get()
		&& taken.link.target && taken.link.target == page.nativeBlocks->entries[4].get(),
		"the CPU resolves both actual branch exits to existing compiled targets in their physical page");
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
	require(page.nativeBlocks->entries[0].get() == root && !page.nativeBlocks->entries[4] && !taken.link.code && !taken.link.target,
		"a target write unlinks its live predecessor before retiring the target executable");
	require(root->terminal.link.target == page.nativeBlocks->entries[2].get(), "an unaffected outgoing edge stays live");
#endif
	for (auto* machine : {&native, &scalar}) {
		machine->cpu.activeThread()->frames[0]->registers[2] = valueBool(true);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		machine->cpu.runUntilDepth(0, 2048);
	}
	requireParity(native, scalar);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	require(taken.link.target && taken.link.target == page.nativeBlocks->entries[4].get(), "the updated target warms and relinks normally");
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
} // namespace

int main() {
	try { grantsAndTargetRetirement(); crossPageLinksRetireTheirTargetsAndKeepBoundedStack(); std::cout << "Compiled block link tests passed\n"; return 0; }
	catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
