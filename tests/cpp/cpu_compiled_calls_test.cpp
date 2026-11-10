#include "common/endian.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

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
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	}
};

void requireParity(CpuMachine& native, CpuMachine& scalar) {
	const auto& first = *native.cpu.activeThread(); const auto& second = *scalar.cpu.activeThread();
	require(first.frames.size() == second.frames.size() && first.stackTop == second.stackTop
		&& native.cpu.readCurrentInstructionPc() == scalar.cpu.readCurrentInstructionPc()
		&& native.cpu.lastPc == scalar.cpu.lastPc && native.cpu.readLastExecutionDomain() == scalar.cpu.readLastExecutionDomain()
		&& native.cpu.readCauseWord() == scalar.cpu.readCauseWord() && native.cpu.readEpcWord() == scalar.cpu.readEpcWord()
		&& native.cpu.readBadAddressWord() == scalar.cpu.readBadAddressWord(),
		"compiled calls and returns preserve exact frame, PC, execution-domain and cycle boundaries");
	for (size_t index = 0; index < first.frames.size(); ++index) {
		const auto& a = *first.frames[index]; const auto& b = *second.frames[index];
		require(a.pc == b.pc && a.top == b.top && a.functionAddress == b.functionAddress && a.stackCapacity == b.stackCapacity
			&& a.stackBase == b.stackBase && a.varargBase == b.varargBase && a.varargCount == b.varargCount
			&& a.returnBase == b.returnBase && a.returnCount == b.returnCount && a.callSitePc == b.callSitePc,
			"both executions retain the same caller, callee and result ranges after stack growth");
		for (int reg = 0; reg < a.stackCapacity; ++reg) {
			const Value left = a.registers[reg], right = b.registers[reg];
			if (valueIsClosure(left)) require(valueIsClosure(right) && asClosure(left)->functionAddress == asClosure(right)->functionAddress,
				"corresponding closures retain the same raw function address");
			else require(left == right, "every retained numeric/tagged register agrees across call transitions");
		}
	}
}

void crossPageCalls(bool open, u32 recordOffset) {
	const u32 record = DYNAMIC_RAM_BASE + recordOffset;
	test::Blua32TestImage image; image.text.resize(2 * MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 4, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 0, 4, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::LOADK), 1, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::LOADK), 2, 0, 1);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::CALL), 0, open ? 0 : 3, open ? 0 : 2);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::ADD), 3, 0, 1);
	writeInstruction(image.text, 7, static_cast<u8>(OpCode::JMP), 0, 63, 58, 255);
	for (const u32 start : {DECODED_PAGE_WORDS, DECODED_PAGE_WORDS + 32u}) {
		writeInstruction(image.text, start, static_cast<u8>(start == DECODED_PAGE_WORDS ? OpCode::ADD : OpCode::SUB), 2, 0, 1);
		writeInstruction(image.text, start + 1u, static_cast<u8>(OpCode::MOV), 3, start == DECODED_PAGE_WORDS ? 0 : 1, 0);
		writeInstruction(image.text, start + 2u, static_cast<u8>(OpCode::RET), 2, open ? 0 : 2, 0);
	}
	image.functions = {{.firstWord = 0, .wordCount = 8, .maxStack = 8},
		{.firstWord = DECODED_PAGE_WORDS, .wordCount = 3, .numParams = 2, .maxStack = 8},
		{.firstWord = DECODED_PAGE_WORDS + 32u, .wordCount = 3, .numParams = 2, .maxStack = 1024}};
	image.constants = {3.0, 4.0}; image.closureRelocations = {{1, record}};
	CpuMachine native(image, false), scalar(image, true);
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(record, machine->rom.bytes.data() + machine->rom.functionAddresses[1], BLUA32_FUNCTION_RECORD_SIZE);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 20000);
	test::runCpuParity(native.cpu, scalar.cpu, 100, 1);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	bool call = false, ret = false;
	for (const auto& [key, page] : native.cpu.activeThread()->frames[0]->executionImage->decodedPages) if (page.nativeBlocks) {
		for (const auto& block : page.nativeBlocks->entries) if (block) {
			call |= block->terminal.exit == NativeBlockExit::Call; ret |= block->terminal.exit == NativeBlockExit::Return;
		}
	}
	require(call && ret, "both callers and their cross-page callees execute generated blocks");
#endif
	for (int grant = 1; grant <= 128; ++grant) {
		test::runCpuParity(native.cpu, scalar.cpu, grant);
		requireParity(native, scalar);
	}
	for (auto* machine : {&native, &scalar}) {
		machine->cpu.runUntilDepth(1, 100);
		machine->cpu.activeThread()->frames[0]->registers[3] = valueNumber(99);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress + 2u * INSTRUCTION_BYTES);
		require(machine->cpu.runUntilDepth(0, 5) == RunResult::Yielded && machine->cpu.activeThread()->frames.size() == 2,
			"CALL cannot consume a callee instruction without a further cycle grant");
		require(machine->cpu.runUntilDepth(1, 50) == RunResult::Halted && machine->cpu.instructionBudgetRemaining == 46
			&& machine->cpu.readFrameRegister(0, 3) == valueNumber(99),
			"a hot RET respects target depth before a hot caller continuation executes");
	}
	requireParity(native, scalar);
	for (auto* machine : {&native, &scalar}) {
		const auto capacity = machine->cpu.activeThread()->stack.size();
		machine->memory.writeMappedU32LE(record + BLUA32_FUNCTION_MAX_STACK_OFFSET, 1024);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress + 2u * INSTRUCTION_BYTES);
		require(machine->cpu.runUntilDepth(0, 9) == RunResult::Yielded && machine->cpu.activeThread()->frames.size() == 1
			&& machine->cpu.activeThread()->stack.size() > capacity && machine->cpu.readFrameRegister(0, 0) == valueNumber(7),
			"a hot call relocates the stack before a hot callee and return use the new register bases");
	}
	requireParity(native, scalar);
	for (auto* machine : {&native, &scalar}) {
		const u32 entry = machine->rom.textAddress + 2u * INSTRUCTION_BYTES;
		machine->memory.writeBytes(record, machine->rom.bytes.data() + machine->rom.functionAddresses[2], BLUA32_FUNCTION_RECORD_SIZE);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], entry);
		machine->cpu.runUntilDepth(0, 20000); machine->cpu.runUntilDepth(1, 100);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], entry);
		machine->cpu.runUntilDepth(0, 5); machine->cpu.runUntilDepth(1, 100);
		require(machine->cpu.readFrameRegister(0, 0) == valueNumber(-1), "a live closure re-reads its current RAM function record");
		machine->memory.writeMappedU32LE(record + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, machine->rom.textAddress + DECODED_PAGE_WORDS * INSTRUCTION_BYTES + 1u);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], entry);
		require(machine->cpu.runUntilDepth(0, 5) == RunResult::Yielded && machine->cpu.readBadAddressWord() == 0u,
			"an exhausted call grant leaves a raw unaligned callee PC unfetched");
		machine->cpu.runUntilDepth(0, 1);
		require(machine->cpu.readBadAddressWord() == machine->rom.textAddress + DECODED_PAGE_WORDS * INSTRUCTION_BYTES + 1u,
			"a resumed unaligned PC takes the ordinary instruction address exception");
	}
	requireParity(native, scalar);
}
} // namespace

int main() {
	try {
		for (const bool open : {false, true}) for (const u32 offset : {0x1800u, 0x1ff0u}) crossPageCalls(open, offset);
		std::cout << "Compiled call/return tests passed\n"; return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
