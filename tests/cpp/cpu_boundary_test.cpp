#include "common/endian.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/execution_image.h"
#include "machine/devices/irq/controller.h"
#include "machine/devices/dma/controller.h"
#include "machine/scheduler/device.h"
#include "machine/execution_address_space.h"
#include "machine/memory/memory.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/builtin.h"
#include "spec/blua32/opcode.h"
#include "spec/bmsx/model.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/rom_header.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

#include <algorithm>
#include <iostream>
#include <limits>
#include <stdexcept>

namespace {
using namespace bmsx;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

test::Blua32TestImage returnImage(OpCode op = OpCode::RET, u8 a = 0, u8 b = 2, u8 c = 0) {
	test::Blua32TestImage image;
	image.text.resize(INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(op), a, b, c);
	image.functions = {{.firstWord = 0, .wordCount = 1}};
	image.constants = {11.0, 29.0};
	return image;
}

struct CpuMachine {
	test::Blua32TestRom rom;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace executionAddressSpace;
	CPU cpu;

	explicit CpuMachine(test::Blua32TestImage image, u32 ramBytes = PSX_MACHINE_SPEC.ramBytes)
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image))
		, memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, ramBytes)
		, irq(memory), executionAddressSpace(memory), cpu(memory, irq, executionAddressSpace) {
		cpu.reset();
	}
};

void equalityUsesValueKindsInsteadOfUnusedPayloads() {
	test::Blua32TestImage image;
	image.text.resize(3 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::EQ), 0, 0, 1);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::K1), 2, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 3}};
	for (const auto kind : {ValueTag::Nil, ValueTag::False, ValueTag::True}) {
		CpuMachine machine(image);
		auto& frame = *machine.cpu.activeThread()->frameAtDepth(0);
		frame.registers[0] = valueFromTag(kind, 1);
		frame.registers[1] = valueFromTag(kind, 2);
		frame.registers[2] = valueNumber(0);
		require(machine.cpu.runUntilDepth(0, 20) == RunResult::Halted && frame.registers[2] == valueNumber(0),
			"EQ consumes Nil/boolean kinds without treating their unused payload bits as another value");
	}
	CpuMachine machine(image);
	BuiltinFunction left{BuiltinFunctionId::Type}, right{BuiltinFunctionId::Type};
	auto& frame = *machine.cpu.activeThread()->frameAtDepth(0);
	frame.registers[0] = valueBuiltinFunction(&left); frame.registers[1] = valueBuiltinFunction(&right);
	frame.registers[2] = valueNumber(0);
	require(machine.cpu.runUntilDepth(0, 20) == RunResult::Halted && frame.registers[2] == valueNumber(0),
		"EQ compares builtin identifiers instead of the host address of their descriptors");
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
NativeBlockTransition fieldSlowExitMarker(CPU*, CallFrame*, const NativeBlockExitSite*) {
	return NativeBlockTransition::Redispatch;
}

void nativeFieldGuardsAndRawSlotAccess() {
	NativeBlockRunState nativeRunState;
	CpuMachine machine(returnImage());
	const StringId key = machine.cpu.stringPool().intern("native-field");
	const StringId other = machine.cpu.stringPool().intern("other-field");
	Table* table = machine.cpu.createTable(0, 2);
	int slot = table->setStringKey(key, valueNumber(1));
	const int otherSlot = table->setStringKey(other, valueNumber(2));
	table->getStringKeyCached(key, slot);
	const std::array constants{valueNumber(7), valueString(key)};
	size_t bytes = 0;
	for (const bool store : {false, true}) {
		DecodedInstruction field;
		field.op = static_cast<u8>(store ? OpCode::SETFIELD : OpCode::GETFIELD);
		field.a = 0; field.b = 1; field.c = store ? -1 : 1;
		field.width = 2; field.baseCycles = BASE_CYCLES[field.op]; field.tableCacheSlot = slot;
		const std::array source{NativeBlockInstruction{&field, 0x1000u}};
		auto block = NativeBlock::compile(source, constants.data(), bytes, machine.memory, machine.cpu.stringPool(), {nullptr, nullptr, nullptr, nullptr, &fieldSlowExitMarker, &fieldSlowExitMarker});
		std::array registers{valueTable(table), valueTable(table)};
		if (store) {
			require(block->sideExits[0].exitC == -1, "native field exits keep signed RK selectors");
			require(block->run(nativeRunState = {.registers = registers.data(), .constants = constants.data(), .remainingCycles = block->terminal.cycles})->exit == NativeBlockExit::Continue
				&& table->getStringKey(key) == constants[0], "a native field store updates the real hash slot without a helper");
		} else {
			for (Value value : {valueNumber(-0.0), VALUE_QNAN_MASK, Value{0x7ff0000000000001ULL},
				valueBool(false), valueBool(true), valueString(other), valueTable(table)}) {
				table->setStringKey(key, value);
				require(block->run(nativeRunState = {.registers = registers.data(), .constants = constants.data(), .remainingCycles = block->terminal.cycles})->exit == NativeBlockExit::Continue
					&& registers[0] == value, "native cached field loads preserve every raw value and reference bit");
			}
			DecodedInstruction alias = field;
			alias.a = alias.b;
			const std::array aliasSource{NativeBlockInstruction{&alias, 0x1000u}};
			auto aliasBlock = NativeBlock::compile(aliasSource, constants.data(), bytes, machine.memory, machine.cpu.stringPool());
			table->setStringKey(key, valueNumber(-0.0));
			require(aliasBlock->run(nativeRunState = {.registers = registers.data(), .constants = constants.data(), .remainingCycles = aliasBlock->terminal.cycles})->exit == NativeBlockExit::Continue
				&& registers[1] == valueNumber(-0.0), "a cached field result can replace its own table receiver");
			registers[1] = valueTable(table);
		}
		for (int prediction : {-1, otherSlot, 100000}) {
			block->sideExits[0].tableCacheSlot = prediction;
			const auto* exit = block->run(nativeRunState = {.registers = registers.data(), .constants = constants.data(), .remainingCycles = block->terminal.cycles});
			require(store ? exit->exit == NativeBlockExit::Continue && table->getStringKey(key) == constants[0]
				: exit->handler == &fieldSlowExitMarker,
				"stale predictions retain ordinary read resolution and allocation-free store completion");
			if (store) require(block->sideExits[0].tableCacheSlot == slot, "returning store repairs its prediction");
		}
		block->sideExits[0].tableCacheSlot = slot;
		registers[store ? 0 : 1] = valueBool(false);
		require(block->run(nativeRunState = {.registers = registers.data(), .constants = constants.data(), .remainingCycles = block->terminal.cycles})->handler == &fieldSlowExitMarker,
			"a non-table field receiver is rejected before any native pointer access");
		registers[0] = registers[1] = valueTable(table);
		table->setStringKey(key, valueNil());
		const auto* deletedExit = block->run(nativeRunState = {.registers = registers.data(), .constants = constants.data(), .remainingCycles = block->terminal.cycles});
		require(store ? deletedExit->exit == NativeBlockExit::Continue && table->getStringKey(key) == constants[0]
			: deletedExit->handler == &fieldSlowExitMarker,
			"a deleted own slot can be restored without growth, but still misses the read guard");
		slot = table->setStringKey(key, valueNumber(1));
		block->sideExits[0].tableCacheSlot = slot;
		if (!store) {
			table->metatable = machine.cpu.createTable(0, 0);
			require(block->run(nativeRunState = {.registers = registers.data(), .constants = constants.data(), .remainingCycles = block->terminal.cycles})->exit == NativeBlockExit::Continue,
				"a live own field bypasses inheritance even when the table has a metatable");
			table->setStringKey(key, valueNil());
			require(block->run(nativeRunState = {.registers = registers.data(), .constants = constants.data(), .remainingCycles = block->terminal.cycles})->handler == &fieldSlowExitMarker,
				"inherited field resolution leaves the generated direct-storage path");
			table->metatable = nullptr;
			slot = table->setStringKey(key, valueNumber(1));
		}
	}
	require(bytes == 0, "native field blocks release their executable cache bytes");
}

void nativeFieldExitsPublishCyclesAndFaultPc() {
	NativeBlockRunState nativeRunState;
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 3, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::GETFIELD), 4, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::ADD), 4, 4, 1);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::SETFIELD), 0, 0, 4);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::JMP), 0, 63, 58, 255);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 8}, {.firstWord = 6, .wordCount = 1}};
	image.constants = {std::string("field")}; image.exceptionFunctionIndex = 1;
	CpuMachine native(image), scalar(image);
	scalar.cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
	for (auto* machine : {&native, &scalar}) {
		auto& frame = *machine->cpu.activeThread()->frameAtDepth(0);
		Table* table = machine->cpu.createTable(0, 1);
		frame.registers[0] = valueTable(table); frame.registers[1] = valueNumber(1);
		table->setStringKey(machine->cpu.stringPool().intern("field"), valueNumber(0));
		machine->cpu.runUntilDepth(0, 1200);
	}
	bool read = false, write = false;
	for (const auto& [key, page] : native.cpu.activeThread()->frameAtDepth(0)->executionImage->decodedPages) {
		if (!page.nativeBlocks) continue;
		for (const auto& block : page.nativeBlocks->entries) if (block) {
			for (const auto& exit : block->sideExits) { read |= exit.exit == NativeBlockExit::ReadField; write |= exit.exit == NativeBlockExit::WriteField; }
		}
	}
	require(read && write, "the table loop really uses native field read and write entries");
	auto& nativeFrame = *native.cpu.activeThread()->frameAtDepth(0);
	const auto& loop = nativeFrame.decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) >> 2u];
	require(loop && loop->sourceWords == 6,
		"field hits and arithmetic are compiled together through the loop branch");
	require(loop->run(nativeRunState = {.registers = nativeFrame.registers, .constants = nativeFrame.executionImage->constPool.data(), .remainingCycles = 1})->nextPc == native.rom.textAddress,
		"ordinary read and write hits reach the final native branch without a host side exit");
	// The direct datapath probe executes one loop; keep both reference machines aligned.
	scalar.cpu.runUntilDepth(0, 6);
	for (int grant = 1; grant <= 40; ++grant) {
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress);
		}
		require(test::runCpuParity(native.cpu, scalar.cpu, grant) == RunResult::Yielded, "field loops preserve short-grant yields");
		require(native.cpu.readFramePc(0) == scalar.cpu.readFramePc(0)
			&& native.cpu.readCurrentInstructionPc() == scalar.cpu.readCurrentInstructionPc()
			&& native.cpu.lastPc == scalar.cpu.lastPc,
			"native field exits retain exact guest cycle and WIDE prefix/body publication");
		require(native.cpu.readFrameRegister(0, 4) == scalar.cpu.readFrameRegister(0, 4), "native field results agree with scalar dispatch");
	}
	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu; auto& frame = *cpu.activeThread()->frameAtDepth(0);
		frame.registers[0] = valueBool(false); frame.top = 0;
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress);
		require(cpu.runUntilDepth(0, 100) == RunResult::Halted, "a native field miss reaches the normal synchronous fault owner");
		require(cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INDEX_NON_TABLE
			&& cpu.readEpcWord() == machine->rom.textAddress + INSTRUCTION_BYTES && frame.top == 4,
			"a failed field load reports its WIDE prefix and never publishes an unwritten destination top");
	}
}

void nativeFieldStoreMissKeepsSignedConstantSelectors() {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::SETFIELD), 0, 0, 62, 7); // RK(C) = K[1].
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
	image.functions = {{.firstWord = 0, .wordCount = 2, .maxStack = 1}};
	image.constants = {std::string("field"), 7.0};
	CpuMachine machine(image);
	Table* table = machine.cpu.createTable(0, 1);
	machine.cpu.activeThread()->frameAtDepth(0)->registers[0] = valueTable(table);
	const StringId key = machine.cpu.stringPool().intern("field");
	table->setStringKey(key, valueNumber(1));
	machine.cpu.runUntilDepth(0, 300);
	const auto& frame = *machine.cpu.activeThread()->frameAtDepth(0);
	const auto& block = frame.decodedPage->nativeBlocks->entries[(machine.rom.textAddress & MAPPED_PAGE_BYTE_MASK) >> 2u];
	require(block && block->sideExits[0].exitC == -2, "compiled field maps retain signed constant selectors");
	table->setStringKey(key, valueNil());
	require(machine.cpu.runUntilDepth(0, 3) == RunResult::Yielded
		&& table->getStringKey(key) == valueNumber(7) && machine.cpu.readLuaFaultReasonWord() == 0,
		"a generated store miss re-creates a deleted field from the correct raw RK constant");
}

#endif

void registerRunsPublishAtBudgetBoundaries() {
	test::Blua32TestImage image;
	image.text.resize(7u * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::MOV), 1, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::ADD), 2, 0, 1);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::UNM), 3, 2, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::BNOT), 4, 3, 0);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::JMP), 0, 63, 57, 255);
	image.functions = {{.firstWord = 0, .wordCount = 7, .maxStack = 8}};
	image.text.resize(2u * MAPPED_PAGE_BYTE_SIZE);
	CpuMachine normal(image), instrumented(image);
	instrumented.cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; },
		nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
	const u32 entry = normal.cpu.readFramePc(0);
	const int throughWide = BASE_CYCLES[static_cast<u8>(OpCode::K1)]
		+ BASE_CYCLES[static_cast<u8>(OpCode::MOV)] + BASE_CYCLES[static_cast<u8>(OpCode::ADD)];
	for (int warmup = 0; warmup < 32; ++warmup)
		require(test::runCpuParity(normal.cpu, instrumented.cpu, 64) == RunResult::Yielded, "warm the register loop without halting");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& page = *normal.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	require(page.nativeBlocks && page.nativeBlocks->entries[(entry & MAPPED_PAGE_BYTE_MASK) >> 2u],
		"budget-boundary comparisons exercise generated machine code, not just cold scalar execution");
#endif
	for (int budget = 1; budget <= 96; ++budget) {
		for (auto* machine : {&normal, &instrumented}) {
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID,
				machine->rom.functionAddresses[0], entry);
		}
		require(test::runCpuParity(normal.cpu, instrumented.cpu, budget) == RunResult::Yielded, "each grant retires an admitted segment");
		require(normal.cpu.readFramePc(0) == instrumented.cpu.readFramePc(0), "cached runs publish the next PC at every grant boundary");
		require(normal.cpu.readCurrentInstructionPc() == instrumented.cpu.readCurrentInstructionPc(), "cached runs publish the last instruction's prefix PC");
		require(normal.cpu.lastPc == instrumented.cpu.lastPc, "cached runs publish the last body PC, including WIDE");
		require(normal.cpu.readLastExecutionDomain() == instrumented.cpu.readLastExecutionDomain(), "cached runs retain the executed domain");
		for (int reg = 0; reg != 5; ++reg) require(normal.cpu.readFrameRegister(0, reg) == instrumented.cpu.readFrameRegister(0, reg),
			"cached and observed instruction prefixes produce identical raw register values");
	}
	instrumented.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, instrumented.rom.functionAddresses[0], entry);
	instrumented.cpu.runUntilDepth(0, throughWide);
	require(instrumented.cpu.readCurrentInstructionPc() == entry + 8u
		&& instrumented.cpu.lastPc == entry + 12u && instrumented.cpu.readFramePc(0) == entry + 16u,
		"the scalar reference still distinguishes the WIDE prefix, body and next instruction");
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
void nativeCodeWarmsWithinOneCpuSlice() {
	for (const bool calls : {false, true}) {
		test::Blua32TestImage image;
		image.text.resize(2u * MAPPED_PAGE_BYTE_SIZE);
		if (calls) {
			writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
			writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 4, 0, 0);
			writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 0, 4, 0);
			writeInstruction(image.text, 3, static_cast<u8>(OpCode::CALL), 0, encodeFixedValueCount(0), 2);
			writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
			writeInstruction(image.text, 5, static_cast<u8>(OpCode::K1), 0, 0, 0);
			writeInstruction(image.text, 6, static_cast<u8>(OpCode::MOV), 1, 0, 0);
			writeInstruction(image.text, 7, static_cast<u8>(OpCode::RET), 0, 2, 0);
			image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 8},
				{.firstWord = 5, .wordCount = 3, .maxStack = 2}};
			image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
		} else {
			writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
			writeInstruction(image.text, 1, static_cast<u8>(OpCode::ADD), 0, 0, 0);
			writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 1, 0, 0);
			writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
			image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 4}};
		}
		CpuMachine machine(image);
		const u32 target = machine.rom.textAddress + (calls ? 5u : 0u) * INSTRUCTION_BYTES;
		require(machine.cpu.runUntilDepth(0, 10000) == RunResult::Yielded, "a long runnable slice completes its grant");
		const auto& pages = machine.cpu.activeThread()->frameAtDepth(0)->executionImage->decodedPages;
		const auto& page = pages.at(target & ~MAPPED_PAGE_BYTE_MASK);
		require(page.nativeBlocks && page.nativeBlocks->entries[(target & MAPPED_PAGE_BYTE_MASK) >> 2u],
			"loop and function hotness must trigger compilation inside one CPU slice");
	}
}

void nativeCodeUsesCachedWordsAtPartialRomTails() {
	test::Blua32TestImage image;
	image.text.resize(4u * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::ADD), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 1, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 4}};
	CpuMachine machine(image);
	auto& cpu = machine.cpu;
	const u32 pc = cpu.readFramePc(0);
	const u32 faultSequence = machine.memory.readBusFaultSequence();
	for (int warmup = 0; warmup < 16; ++warmup) cpu.runUntilDepth(0, 64);
	const auto& page = *cpu.activeThread()->frameAtDepth(0)->decodedPage;
	require(page.nativeBlocks && page.nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) >> 2u],
		"a partial ROM page can compile its already decoded instruction prefix");
	require(cpu.readFramePc(0) == pc && cpu.readFrameRegister(0, 1) == valueNumber(2)
		&& machine.memory.readBusFaultSequence() == faultSequence,
		"cached native admission never probes the unbacked ROM tail");
}

void nativeWarmAdmitsAllocatingBodies() {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CONCAT), 1, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 2}};
	CpuMachine machine(image);
	auto& cpu = machine.cpu;
	require(cpu.runUntilDepth(0, 21) == RunResult::Yielded, "a mixed loop warms without compiling yet");
	const auto& page = *cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const u32 word = (machine.rom.textAddress & MAPPED_PAGE_BYTE_MASK) >> 2u;
	require(!page.nativeBlocks && page.nativeVisits[word] == 7,
		"hotness counting never allocates an executable-entry page before code exists");
	require(cpu.runUntilDepth(0, 279) == RunResult::Yielded, "a mixed loop remains runnable");
	require(page.words[word].dispatchOp == static_cast<u8>(DecodedDispatchOp::NativeBlock)
		&& page.nativeBlocks->entries[word]->terminal.exit == NativeBlockExit::Concat
		&& page.nativeBlocks->entries[word + 2u],
		"an allocating terminal admits its register prefix and the successor jump compiles independently");
}

void nativeCodeRetiresOnWritesAndObservation() {
	test::Blua32TestImage image;
	image.text.resize(2u * MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::ADD), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 1, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 4}};
	CpuMachine machine(image);
	auto& cpu = machine.cpu;
	const u32 pc = DYNAMIC_RAM_BASE + 0x5000u;
	machine.memory.writeBytes(pc, image.text.data(), 4u * INSTRUCTION_BYTES);
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], pc);
	for (int warmup = 0; warmup < 16; ++warmup) cpu.runUntilDepth(0, 64);
	require(cpu.readFramePc(0) == pc, "warm native code from ordinary writable instruction memory");
	auto& page = *cpu.activeThread()->frameAtDepth(0)->decodedPage;
	require(page.nativeBlocks && page.nativeBlocks->entries[0], "writable instructions acquire a native block");
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::SUB), 0, 0, 0);
	machine.memory.writeBytes(pc + INSTRUCTION_BYTES, image.text.data() + INSTRUCTION_BYTES, INSTRUCTION_BYTES);
	require(!page.nativeBlocks, "a source-word write retires native dependencies before their next execution");
	for (int warmup = 0; warmup < 16; ++warmup) cpu.runUntilDepth(0, 64);
	require(cpu.readFrameRegister(0, 1) == valueNumber(0),
		"rewritten source bytes replace the previously generated arithmetic");
	require(page.nativeBlocks && page.nativeBlocks->entries[0], "rewritten code can be compiled again");
	int observations = 0;
	InstructionObserverBinding binding;
	binding.context = &observations;
	binding.points[0].insert(pc + INSTRUCTION_BYTES);
	binding.observe = [](void* context, ExecutionDomainId domain, u32, const Value* registers) {
		require(domain == SYSTEM_EXECUTION_DOMAIN_ID && registers[0] == valueNumber(1),
			"observation sees the exact state before the formerly compiled instruction");
		++*static_cast<int*>(context);
	};
	cpu.setInstructionObserver(std::move(binding));
	require(!page.nativeBlocks, "installing observation retires existing native code");
	require(cpu.runUntilDepth(0, 40) == RunResult::Yielded && observations == 10,
		"native compilation cannot elide or batch through an observed instruction");
	cpu.setInstructionObserver({});
	for (int warmup = 0; warmup < 16; ++warmup) cpu.runUntilDepth(0, 64);
	require(page.nativeBlocks && page.nativeBlocks->entries[0], "removing observation admits native execution again");
}

void nativeHaltCommitsItsThreadAndFrameLatch() {
	for (const bool standalone : {false, true}) {
		test::Blua32TestImage image;
		image.text.resize(MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::NOT), 1, 0, 0);
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(image.text, 3, static_cast<u8>(OpCode::HALT), 63, 63, 63, 255);
		writeInstruction(image.text, 4, static_cast<u8>(OpCode::KSMI), 2, 0, 7);
		writeInstruction(image.text, 5, static_cast<u8>(OpCode::RET), 2, 2, 0);
		writeInstruction(image.text, 6, static_cast<u8>(OpCode::RFE), 0, 0, 0);
		writeInstruction(image.text, 7, static_cast<u8>(OpCode::KSMI), 0, 0, 9);
		writeInstruction(image.text, 8, static_cast<u8>(OpCode::RET), 0, 2, 0);
		image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 3},
			{.firstWord = 6, .wordCount = 1}, {.firstWord = 7, .wordCount = 2}};
		image.irqFunctionIndex = image.exceptionFunctionIndex = 1;
		CpuMachine machine(image);
		auto& cpu = machine.cpu;
		const u32 entry = machine.rom.textAddress;
		const u32 startPc = entry + (standalone ? 2u : 0u) * INSTRUCTION_BYTES;
		for (int warmup = 0; warmup < 20; ++warmup) {
			cpu.clearHaltUntilIrq();
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], startPc);
			require(cpu.runUntilDepth(0, standalone ? 1 : 3) == RunResult::Halted,
				"native HALT wins over an exactly exhausted slice");
			require(cpu.instructionBudgetRemaining == 0 && cpu.isHaltedUntilIrq()
				&& cpu.readFramePc(0) == entry + 4u * INSTRUCTION_BYTES,
				"native WIDE HALT commits the exact charge, thread/depth latch and next PC");
		}
		const auto& page = *cpu.activeThread()->frameAtDepth(0)->decodedPage;
		const auto& block = page.nativeBlocks->entries[(startPc & MAPPED_PAGE_BYTE_MASK) >> 2u];
		require(block && block->terminal.exit == NativeBlockExit::Halt,
			"both a HALT-only block and a numeric prefix use an explicit generated HALT exit");
		cpu.restoreRuntimeState(cpu.captureRuntimeState());
		require(cpu.isHaltedUntilIrq(), "restoring a native HALT retains its owning thread and depth");
		const int depth = cpu.getFrameDepth();
		cpu.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[2]);
		require(cpu.runUntilDepth(depth, 100) == RunResult::Halted && cpu.getFrameDepth() == depth
			&& cpu.isHaltedUntilIrq(), "a deeper completion call does not consume the root HALT latch");
		cpu.requestNonMaskableInterrupt();
		require(cpu.enterPendingInterrupt() && !cpu.isHaltedUntilIrq(), "an accepted NMI releases native HALT");
		require(cpu.runUntilDepth(0, 100) == RunResult::Halted && cpu.getFrameDepth() == 0
			&& cpu.readCompletionValues()[0] == valueNumber(7),
			"RFE resumes at the instruction following native WIDE HALT");
	}
}

void nativeTerminalAtPageBoundaryTracksItsBody() {
	CpuMachine machine(returnImage(OpCode::HALT));
	auto& cpu = machine.cpu;
	const u32 pc = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE - INSTRUCTION_BYTES;
	std::vector<u8> code(2u * INSTRUCTION_BYTES);
	writeInstruction(code, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(code, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	machine.memory.writeBytes(pc, code.data(), code.size());
	for (int warmup = 0; warmup < 20; ++warmup) {
		cpu.clearHaltUntilIrq();
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], pc);
		require(cpu.runUntilDepth(0, 1) == RunResult::Halted && cpu.readFramePc(0) == pc + 2u * INSTRUCTION_BYTES,
			"a terminal WIDE instruction at the page boundary retains its full extent");
	}
	auto& head = cpu.activeThread()->frameAtDepth(0)->executionImage->decodedPages.at(pc & ~MAPPED_PAGE_BYTE_MASK);
	require(head.nativeBlocks && head.nativeBlocks->entries[255]
		&& head.nativeBlocks->entries[255]->terminal.exit == NativeBlockExit::Halt,
		"an already decoded cross-page WIDE terminal can execute as generated code");
	writeInstruction(code, 1, static_cast<u8>(OpCode::KM1), 0, 0, 0);
	machine.memory.writeBytes(pc + INSTRUCTION_BYTES, code.data() + INSTRUCTION_BYTES, INSTRUCTION_BYTES);
	require(!head.nativeBlocks, "changing a generated terminal body retires the preceding page's native entry");
	cpu.clearHaltUntilIrq();
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], pc);
	require(cpu.runUntilDepth(0, 1) == RunResult::Yielded && cpu.readFrameRegister(0, 0) == valueNumber(-1),
		"the rewritten WIDE body replaces the generated HALT semantics");
}

void nativeWritesPreserveIndependentBlocks() {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	for (const u32 start : {0u, 8u}) {
		writeInstruction(image.text, start, static_cast<u8>(OpCode::K1), 0, 0, 0);
		writeInstruction(image.text, start + 1u, static_cast<u8>(OpCode::ADD), 1, 0, 0);
		writeInstruction(image.text, start + 2u, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	}
	image.functions = {{.firstWord = 0, .wordCount = 11, .maxStack = 2}};
	CpuMachine machine(image);
	auto& cpu = machine.cpu;
	machine.memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
	for (const u32 start : {0u, 8u}) {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], DYNAMIC_RAM_BASE + start * INSTRUCTION_BYTES);
		require(cpu.runUntilDepth(0, 300) == RunResult::Yielded, "independent blocks warm on a shared source page");
	}
	auto& page = *cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const auto* preserved = page.nativeBlocks->entries[0].get();
	require(preserved && page.nativeBlocks->entries[8], "both source regions contain real generated code");
	writeInstruction(image.text, 9, static_cast<u8>(OpCode::SUB), 1, 0, 0);
	machine.memory.writeBytes(DYNAMIC_RAM_BASE + 9u * INSTRUCTION_BYTES,
		image.text.data() + 9u * INSTRUCTION_BYTES, INSTRUCTION_BYTES);
	require(page.nativeBlocks->entries[0].get() == preserved && !page.nativeBlocks->entries[8],
		"a source write retires exactly the overlapping generated dependencies");
	require(cpu.runUntilDepth(0, 3) == RunResult::Yielded && cpu.readFrameRegister(0, 1) == valueNumber(0),
		"the changed region executes its new source without invalidating independent code");
}

void nativeCallsAndReturnsPublishFaultBoundaries() {
	for (const bool wide : {false, true}) {
		const u32 callBody = wide ? 4u : 3u;
		const u32 calleeStart = callBody + 3u;
		test::Blua32TestImage image;
		image.text.resize(MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 4, 0, 0);
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 0, 4, 0);
		if (wide) writeInstruction(image.text, 3, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(image.text, callBody, static_cast<u8>(OpCode::CALL), 0, 1, 2);
		writeInstruction(image.text, callBody + 1u, static_cast<u8>(OpCode::MOV), 6, 0, 0);
		writeInstruction(image.text, callBody + 2u, static_cast<u8>(OpCode::JMP), 0, 63, wide ? 59 : 60, 255);
		writeInstruction(image.text, calleeStart, static_cast<u8>(OpCode::K1), 0, 0, 0);
		writeInstruction(image.text, calleeStart + 1u, static_cast<u8>(OpCode::RET), 0, 2, 0);
		writeInstruction(image.text, calleeStart + 2u, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		image.functions = {{.firstWord = 0, .wordCount = calleeStart, .maxStack = 8},
			{.firstWord = calleeStart, .wordCount = 2}, {.firstWord = calleeStart + 2u, .wordCount = 1}};
		image.exceptionFunctionIndex = 2;
		image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
		CpuMachine native(image), scalar(image);
		scalar.cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; },
			nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
		for (auto* machine : {&native, &scalar}) {
			require(machine->cpu.runUntilDepth(0, 10001) == RunResult::Yielded && machine->cpu.getFrameDepth() == 1,
				"the repeated-call workload warms both sides of the frame boundary");
		}
		bool compiledCall = false, compiledReturn = false;
		for (const auto& [key, page] : native.cpu.activeThread()->frameAtDepth(0)->executionImage->decodedPages) {
			if (!page.nativeBlocks) continue;
			for (const auto& block : page.nativeBlocks->entries) {
				if (!block) continue;
				compiledCall |= block->terminal.exit == NativeBlockExit::Call;
				compiledReturn |= block->terminal.exit == NativeBlockExit::Return;
			}
		}
		require(compiledCall && compiledReturn, "CALL and RET execute through real generated tail exits");
		for (auto* machine : {&native, &scalar}) {
			auto& cpu = machine->cpu;
			require(cpu.runUntilDepth(0, 3) == RunResult::Yielded && cpu.getFrameDepth() == 2
				&& cpu.activeThread()->frameAtDepth(1)->callSitePc == machine->rom.textAddress + callBody * INSTRUCTION_BYTES,
				"generated CALL saves the physical body PC, including WIDE");
			require(cpu.runUntilDepth(0, 5) == RunResult::Yielded && cpu.getFrameDepth() == 1,
				"a generated return resumes and completes the caller loop exactly");
			cpu.activeThread()->frameAtDepth(0)->registers[4] = valueNumber(77);
			require(cpu.runUntilDepth(0, 100) == RunResult::Halted,
				"a failing native call unwinds through the normal Lua-fault owner");
			require(cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_CALL_NON_FUNCTION
				&& cpu.readEpcWord() == machine->rom.textAddress + 3u * INSTRUCTION_BYTES
				&& cpu.readFrameRegister(0, 6) == valueNumber(1),
				"native call failure commits its exact faulting PC and preserves the caller continuation");
		}
		require(native.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining
			&& native.cpu.readCurrentInstructionPc() == scalar.cpu.readCurrentInstructionPc()
			&& native.cpu.lastPc == scalar.cpu.lastPc,
			"native and scalar fault paths retain identical cycle and PC publication");
	}
}

void nativeCallCanRetireItsSourceDuringFunctionRecordRead() {
	constexpr u32 recordAddress = 0x08005000u;
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 4, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 0, 4, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::CALL), 0, 1, 2);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::MOV), 6, 0, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 7, static_cast<u8>(OpCode::RET), 0, 2, 0);
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 8}, {.firstWord = 6, .wordCount = 2}};
	image.closureRelocations = {{1, recordAddress}};
	for (const bool instrumented : {false, true}) {
		CpuMachine machine(image);
		auto& cpu = machine.cpu;
		machine.memory.writeBytes(DYNAMIC_RAM_BASE,
			machine.rom.bytes.data() + machine.rom.textAddress - SYSTEM_ROM_BASE, image.text.size());
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		struct RecordSource {
			Memory& memory;
			const u8* record;
			std::vector<u8> replacement;
			bool armed = false;
			int writes = 0;
		} source{machine.memory, machine.rom.bytes.data() + machine.rom.functionAddresses[1] - SYSTEM_ROM_BASE,
			std::vector<u8>(INSTRUCTION_BYTES)};
		writeInstruction(source.replacement, 0, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		for (u32 offset = 0; offset <= BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET; offset += 4u) {
			machine.memory.mapIoRead(recordAddress + offset, &source, [](void* context, u32 address, MappedBusSignals) {
				auto& source = *static_cast<RecordSource*>(context);
				const u32 offset = address - recordAddress;
				if (source.armed && offset == BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET) {
					source.armed = false;
					++source.writes;
					source.memory.writeBytes(DYNAMIC_RAM_BASE + 3u * INSTRUCTION_BYTES,
						source.replacement.data(), source.replacement.size());
				}
				return readLE32(source.record + offset);
			});
		}
		if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; },
			nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
		require(cpu.runUntilDepth(0, 10001) == RunResult::Yielded && cpu.getFrameDepth() == 1,
			"a mapped function record warms a real native call boundary");
		auto& page = *cpu.activeThread()->frameAtDepth(0)->decodedPage;
		if (!instrumented) require(page.nativeBlocks && page.nativeBlocks->entries[2]
			&& page.nativeBlocks->entries[2]->terminal.exit == NativeBlockExit::Call,
			"the source mutation test executes generated CALL code");
		source.armed = true;
		require(cpu.runUntilDepth(0, 100) == RunResult::Halted && source.writes == 1
			&& cpu.getFrameDepth() == 1 && cpu.readFrameRegister(0, 6) == valueNumber(1)
			&& cpu.readFramePc(0) == DYNAMIC_RAM_BASE + 4u * INSTRUCTION_BYTES
			&& cpu.instructionBudgetRemaining == 90,
			"retiring the active call code completes that call before observing the replacement HALT");
		if (!instrumented) require(!page.nativeBlocks || !page.nativeBlocks->entries[2],
			"the tail helper does not retain a dangling executable entry");
	}
}
#endif

void compactAndPaddedRomFunctionRecordsAgree() {
	for (const bool instrumented : {false, true}) for (const bool padded : {false, true}) {
		test::Blua32TestImage image;
		image.text.resize(6u * INSTRUCTION_BYTES);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::CALL), 0, encodeFixedValueCount(0), 2);
		writeInstruction(image.text, 3, static_cast<u8>(OpCode::RET), 0, 2, 0);
		writeInstruction(image.text, 4, static_cast<u8>(OpCode::K1), 0, 0, 0);
		writeInstruction(image.text, 5, static_cast<u8>(OpCode::RET), 0, 2, 0);
		image.functions = {{.firstWord = 0, .wordCount = 4}, {.firstWord = 4, .wordCount = 2}};
		image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
		auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
		if (padded) rom.bytes.resize((rom.bytes.size() + MAPPED_PAGE_BYTE_MASK) & ~static_cast<size_t>(MAPPED_PAGE_BYTE_MASK));
		Memory memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
		IrqController irq(memory);
		ExecutionAddressSpace addresses(memory);
		CPU cpu(memory, irq, addresses);
		cpu.reset();
		if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
		const u32 record = rom.functionAddresses[1];
		Span<const u8> recordView;
		require(memory.bindMappedReadView(record, BLUA32_FUNCTION_RECORD_SIZE, MAPPED_BUS_MASTER_CPU, recordView), "compact and padded ROM both admit the complete function record");
		const int cycles = BASE_CYCLES[static_cast<size_t>(OpCode::CLOSURE)] + BASE_CYCLES[static_cast<size_t>(OpCode::CALL)]
			+ 2 * BASE_CYCLES[static_cast<size_t>(OpCode::RET)] + BASE_CYCLES[static_cast<size_t>(OpCode::K1)];
		require(cpu.runUntilDepth(0, cycles) == RunResult::Halted, "compact and padded calls complete");
		require(cpu.readCompletionValues().size() == 1u && cpu.readCompletionValues()[0] == valueNumber(1), "compact and padded ROM calls return the same guest value");
		require(cpu.instructionBudgetRemaining == 0, "direct record reads preserve exact call and return charges");
		require(memory.readBusFaultSequence() == 0u, "backed record reads do not invent a bus transaction fault");
	}
}

void stringBytePositions() {
	struct Case { std::string source; Value position; u8 arguments; Value expected; };
	const std::string unicode("Aé雪\0😀Z", 12);
	for (const bool instrumented : {false, true}) {
		for (const Case& testCase : {
			Case{unicode, valueNil(), 1, valueNumber(65)},
			Case{unicode, valueNil(), 2, valueNumber(65)},
			Case{unicode, valueNumber(2), 2, valueNumber(233)},
			Case{unicode, valueNumber(3), 2, valueNumber(0x96ea)},
			Case{unicode, valueNumber(4), 2, valueNumber(0)},
			Case{unicode, valueNumber(5), 2, valueNumber(0x1f600)},
			Case{unicode, valueNumber(6), 2, valueNumber(90)},
			Case{unicode, valueNumber(7), 2, valueNil()},
			Case{"", valueNil(), 1, valueNil()},
			Case{"abc", valueNumber(0), 2, valueNil()},
			Case{"abc", valueNumber(-1), 2, valueNil()},
			Case{"abc", valueNumber(2.9), 2, valueNumber(98)},
			Case{"abc", valueNumber(4294967298.0), 2, valueNumber(98)},
			Case{"abc", valueNumber(std::numeric_limits<f64>::quiet_NaN()), 2, valueNil()},
			Case{"abc", valueNumber(std::numeric_limits<f64>::infinity()), 2, valueNil()},
			Case{std::string(4096, 'a'), valueNumber(4096), 2, valueNumber(97)},
		}) {
			auto image = returnImage(OpCode::CALL, 0, encodeFixedValueCount(testCase.arguments), 2);
			image.text.resize(2 * INSTRUCTION_BYTES);
			writeInstruction(image.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
			image.functions[0].wordCount = 2;
			image.functions[0].maxStack = 3;
			CpuMachine machine(image);
			auto& cpu = machine.cpu;
			if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
			Value* registers = cpu.activeThread()->frameAtDepth(0)->registers;
			registers[0] = cpu.createBuiltinFunction(BuiltinFunctionId::StringByte);
			registers[1] = valueString(cpu.stringPool().intern(testCase.source));
			registers[2] = testCase.position;
			require(cpu.runUntilDepth(0, 100) == RunResult::Halted, "string.byte executes in both dispatch modes");
			require(cpu.readFrameRegister(0, 0) == testCase.expected, "string.byte preserves scalar, default and signed-word position semantics");
		}
	}
}

void loadKrIndices() {
	const f64 infinity = std::numeric_limits<f64>::infinity();
	const f64 nan = std::numeric_limits<f64>::quiet_NaN();
	for (const auto [input, expected] : {std::pair{0.0, 11.0}, {1.9, 29.0}, {4294967296.0, 11.0}, {nan, 11.0}, {infinity, 11.0}, {-infinity, 11.0}, {-0.0, 11.0}}) {
		CpuMachine machine(returnImage(OpCode::LOADKR, 0, 0, 0));
		machine.cpu.activeThread()->frameAtDepth(0)->registers[0] = valueNumber(input);
		machine.cpu.runUntilDepth(0, 1);
		require(asNumber(machine.cpu.readFrameRegister(0, 0)) == expected, "LOADKR word conversion");
	}
	for (const f64 input : {2.0, -1.0, 4294967295.0}) {
		CpuMachine machine(returnImage(OpCode::LOADKR, 0, 0, 0));
		machine.cpu.activeThread()->frameAtDepth(0)->registers[0] = valueNumber(input);
		const u32 pc = machine.cpu.readFramePc(0);
		machine.cpu.runUntilDepth(0, 1);
		require(machine.cpu.readCauseWord() == CPU_CAUSE_CODE_TRAP, "LOADKR range fault");
		require(machine.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INVALID_ARGUMENT, "LOADKR argument reason");
		require(machine.cpu.readEpcWord() == pc, "LOADKR fault EPC");
	}
}

void zeroLoadNil() {
	CpuMachine machine(returnImage(OpCode::LOADNIL, 6, 0, 0));
	machine.cpu.runUntilDepth(0, 1);
	require(machine.cpu.getFrameRegisterCount(0) == 0, "zero LOADNIL does not extend top");
}

void wideSignedImmediatesKeepTheirRange() {
	for (const bool instrumented : {false, true}) for (const int immediate : {MIN_SIGNED_BX, MIN_SIGNED_BX + 1, -524288, -1, 0, 524287, 524288, MAX_SIGNED_BX}) {
		auto image = returnImage();
		image.text.resize(3 * INSTRUCTION_BYTES);
		const u32 raw = static_cast<u32>(immediate) & MAX_EXT_BX;
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, static_cast<u8>(raw >> BASE_BX_BITS), 0);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::KSMI), 0,
			static_cast<u8>((raw >> MAX_OPERAND_BITS) & MAX_LOW_OPERAND), static_cast<u8>(raw & MAX_LOW_OPERAND), static_cast<u8>(raw >> MAX_BX_BITS));
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::RET), 0, 2, 0);
		image.functions[0].wordCount = 3;
		CpuMachine machine(image);
		auto& cpu = machine.cpu;
		if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
		const u32 pc = cpu.readFramePc(0);
		require(cpu.runUntilDepth(0, 1) == RunResult::Yielded, "WIDE KSMI consumes one physical instruction charge");
		require(cpu.readFrameRegister(0, 0) == valueNumber(immediate), "all signed immediate bits survive decoded storage");
		require(cpu.readFramePc(0) == pc + 2 * INSTRUCTION_BYTES && cpu.lastPc == pc + INSTRUCTION_BYTES, "instruction length remains independent of the immediate bits");
		require(cpu.runUntilDepth(0, 2) == RunResult::Halted && cpu.readCompletionValues()[0] == valueNumber(immediate), "the immediate survives ordinary completion");
	}
}

void returnRangesSurviveCallerStackGrowth() {
	for (const bool instrumented : {false, true}) for (const bool openReturn : {false, true}) {
		for (const u8 produced : {0, 1, 3, 61}) for (const u8 requested : {0, 1, 4, 48}) {
			test::Blua32TestImage image;
			image.text.resize(5 * INSTRUCTION_BYTES);
			writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
			writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 2, 0, 0);
			writeInstruction(image.text, 2, static_cast<u8>(OpCode::CALL), 2, encodeFixedValueCount(0), requested == 0 ? 0 : requested + 1);
			writeInstruction(image.text, 3, static_cast<u8>(OpCode::HALT), 0, 0, 0);
			writeInstruction(image.text, 4, static_cast<u8>(OpCode::RET), 5, openReturn ? 0 : produced + 1, 0);
			image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 3},
				{.firstWord = 4, .wordCount = 1, .maxStack = static_cast<u32>(5 + std::max<int>(produced, 1))}};
			image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
			CpuMachine machine(image);
			auto& cpu = machine.cpu;
			if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
			Table* table = cpu.createTable(0, 0);
			cpu.activeThread()->frameAtDepth(0)->registers[0] = valueNumber(91);
			cpu.activeThread()->frameAtDepth(0)->registers[1] = valueTable(table);
			require(cpu.runUntilDepth(0, 3) == RunResult::Yielded && cpu.getFrameDepth() == 2, "prepare a real nested return");
			CallFrame& callee = *cpu.activeThread()->frameAtDepth(1);
			const Value samples[] = {valueNumber(-0.0), valueNil(), valueBool(false), valueString(cpu.stringPool().intern("result")), valueTable(table)};
			for (int i = 0; i < produced; ++i) callee.registers[5 + i] = samples[i % 5];
			callee.top = 5 + produced;
			require(cpu.runUntilDepth(1, 2) == RunResult::Halted && cpu.getFrameDepth() == 1, "RET stops before the caller continuation");
			const int targetCount = requested == 0 ? produced : requested;
			require(cpu.getFrameRegisterCount(0) == 2 + targetCount, "result placement sets the exact top, including an empty open range");
			require(cpu.readFrameRegister(0, 0) == valueNumber(91) && cpu.readFrameRegister(0, 1) == valueTable(table), "return preserves slots before its destination");
			for (int i = 0; i < targetCount; ++i) {
				require(cpu.readFrameRegister(0, 2 + i) == (i < produced ? samples[i % 5] : valueNil()), "shifted source slots retain values and fixed results truncate or nil-pad");
			}
			const CallFrame& caller = *cpu.activeThread()->frameAtDepth(0);
			require(cpu.activeThread()->stackTop == caller.stackBase + caller.stackCapacity, "retiring a shifted callee leaves the grown caller stack extent");
		}
	}
}

void builtinReturnRangesSurviveDestinationGrowth() {
	for (const bool instrumented : {false, true}) for (const u8 requested : {0, 1, 4, 48}) for (int kind = 0; kind < 3; ++kind) {
		auto image = returnImage(OpCode::CALL, 2, encodeFixedValueCount(kind == 0 ? 1 : 2), requested == 0 ? 0 : requested + 1);
		image.text.resize(2 * INSTRUCTION_BYTES);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		image.functions[0].wordCount = 2;
		image.functions[0].maxStack = 5;
		CpuMachine machine(image);
		auto& cpu = machine.cpu;
		if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
		Table* table = cpu.createTable(1, 0);
		const Value text = valueString(cpu.stringPool().intern("result"));
		if (kind == 2) table->setInteger(1, text);
		Value* registers = cpu.activeThread()->frameAtDepth(0)->registers;
		registers[0] = valueNumber(91); registers[1] = valueBool(true);
		registers[2] = cpu.createBuiltinFunction(kind == 0 ? BuiltinFunctionId::Select : BuiltinFunctionId::Next);
		registers[3] = kind == 0 ? valueNumber(1) : valueTable(table);
		registers[4] = valueNil();
		require(cpu.runUntilDepth(0, 100) == RunResult::Halted && cpu.readCauseWord() == 0u, "builtin result transfer finishes without a machine fault");
		const int targetCount = requested == 0 ? kind : requested;
		require(cpu.getFrameRegisterCount(0) == 2 + targetCount, "builtin results set exact top after open and fixed calls");
		require(cpu.readFrameRegister(0, 0) == valueNumber(91) && cpu.readFrameRegister(0, 1) == valueBool(true), "builtin result growth preserves preceding slots");
		for (int i = 0; i < targetCount; ++i) {
			const Value expected = kind == 2 && i < 2 ? (i == 0 ? valueNumber(1) : text) : valueNil();
			require(cpu.readFrameRegister(0, 2 + i) == expected, "builtin-owned results survive growth, truncate and nil-pad");
		}
	}
}

void instructionBoundaryResynchronizesAfterFetchOrObservation() {
	for (const bool instrumented : {false, true}) for (const bool mappedFetch : {false, true}) {
		auto image = returnImage(OpCode::MOV, 6, 7, 0);
		image.text.resize(4 * INSTRUCTION_BYTES);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::K0), 6, 0, 0);
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::K1), 0, 0, 0);
		writeInstruction(image.text, 3, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		image.functions = {{.firstWord = 0, .wordCount = 2, .maxStack = 8}, {.firstWord = 2, .wordCount = 2}};
		image.irqFunctionIndex = 1;
		image.exceptionFunctionIndex = 1;
		CpuMachine machine(image);
		auto& cpu = machine.cpu;
		Value* interruptedRegisters = cpu.activeThread()->frameAtDepth(0)->registers;
		interruptedRegisters[6] = valueNumber(0);
		interruptedRegisters[7] = valueNumber(99);
		struct Edge { IrqController& irq; u32 instruction; int count = 0; } edge{machine.irq, readLE32(image.text.data())};
		u32 pc = cpu.readFramePc(0);
		if (mappedFetch) {
			pc = IO_GX_GPU_GP0;
			machine.memory.mapIoRead(pc, &edge, [](void* context, u32, MappedBusSignals) {
				auto& event = *static_cast<Edge*>(context);
				++event.count;
				event.irq.raise(IRQ_GPU);
				return event.instruction;
			});
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], pc);
		} else {
			InstructionObserverBinding observer;
			observer.points[0].insert(pc);
			observer.context = &edge;
			observer.observe = [](void* context, ExecutionDomainId, u32, const Value*) {
				auto& event = *static_cast<Edge*>(context);
				++event.count;
				event.irq.raise(IRQ_GPU);
			};
			cpu.setInstructionObserver(std::move(observer));
		}
		machine.memory.writeMappedU32LE(IO_IRQ_MASK, IRQ_GPU);
		if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
		require(cpu.runUntilDepth(0, 2) == RunResult::Yielded, "fetch/observer edge preserves instruction grant");
		require(edge.count == 1 && cpu.activeThread()->frameDepth == 2, "device edge enters the IRQ frame before the next instruction");
		require(cpu.readCauseWord() == CPU_CAUSE_IRQ && cpu.readEpcWord() == pc + INSTRUCTION_BYTES, "interrupt saves the next physical PC");
		require(cpu.activeThread()->frameAtDepth(0)->registers[6] == valueNumber(99), "the fetched or observed instruction completes before accepting the edge");
		require(cpu.activeThread()->currentFrame->registers[0] == valueNumber(1), "IRQ execution uses its own frame register base");
	}
}

void cachedFetchCrossesWidePagesAndObservesCodeWrites() {
	for (const bool instrumented : {false, true}) {
		auto image = returnImage();
		image.functions[0].maxStack = 3;
		CpuMachine machine(image);
		auto& cpu = machine.cpu;
		if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
		std::vector<u8> code(5 * INSTRUCTION_BYTES);
		writeInstruction(code, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
		writeInstruction(code, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(code, 2, static_cast<u8>(OpCode::KSMI), 1, 1, 2);
		writeInstruction(code, 3, static_cast<u8>(OpCode::K1), 2, 0, 0);
		writeInstruction(code, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
		const u32 pc = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE - 2 * INSTRUCTION_BYTES;
		machine.memory.writeBytes(pc, code.data(), code.size());
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], pc);
		for (const int phase : {0, 1, 2}) {
			if (phase == 1) {
				writeInstruction(code, 2, static_cast<u8>(OpCode::KSMI), 1, 1, 15);
				machine.memory.writeBytes(pc + 2 * INSTRUCTION_BYTES, code.data() + 2 * INSTRUCTION_BYTES, INSTRUCTION_BYTES);
			} else if (phase == 2) {
				writeInstruction(code, 0, static_cast<u8>(OpCode::KM1), 0, 0, 0);
				machine.memory.writeBytes(pc, code.data(), INSTRUCTION_BYTES);
			}
			require(cpu.runUntilDepth(0, 8) == RunResult::Yielded, "two cross-page loops exhaust exactly eight guest cycles");
			require(cpu.instructionBudgetRemaining == 0 && cpu.readCauseWord() == 0u, "cached WIDE fetch preserves cycle charge without an exception");
			require(cpu.readFramePc(0) == pc && cpu.lastPc == pc + 4 * INSTRUCTION_BYTES, "backward branches preserve physical next/last PC");
			require(cpu.readFrameRegister(0, 0) == valueNumber(phase == 2 ? -1 : 1), "code writes invalidate a cached prefix page");
			require(cpu.readFrameRegister(0, 1) == valueNumber(phase == 0 ? 66 : 79), "a body-only write invalidates a WIDE prefix in the preceding page");
			require(cpu.readFrameRegister(0, 2) == valueNumber(1), "execution continues after the cross-page WIDE");
		}
	}
}

void rewrittenInstructionRetainsItsOwnCycleCharge() {
	for (const bool instrumented : {false, true}) for (const bool observed : {false, true}) {
		auto image = returnImage();
		image.functions[0].maxStack = 2;
		CpuMachine machine(image);
		auto& cpu = machine.cpu;
		if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
		const u32 pc = DYNAMIC_RAM_BASE + 0x4000u;
		const u32 destination = pc + 0x100u;
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], pc);
		cpu.activeThread()->frameAtDepth(0)->registers[1] = valueNumber(destination);
		int observations = 0;
		if (observed) {
			InstructionObserverBinding observer;
			observer.points[0].insert(pc);
			observer.context = &observations;
			observer.observe = [](void* context, ExecutionDomainId, u32, const Value*) {
				++*static_cast<int*>(context);
			};
			cpu.setInstructionObserver(std::move(observer));
		}
		std::vector<u8> code(INSTRUCTION_BYTES);
		for (const OpCode op : {OpCode::K1, OpCode::STORE_MEM_D, OpCode::K1}) {
			writeInstruction(code, 0, static_cast<u8>(op), 0, 1, static_cast<u8>(MemoryAccessKind::U32LE));
			machine.memory.writeBytes(pc, code.data(), code.size());
			cpu.activeThread()->frameAtDepth(0)->pc = pc;
			require(cpu.runUntilDepth(0, 1) == RunResult::Yielded, "rewritten instruction completes its grant");
			require(cpu.instructionBudgetRemaining == 1 - BASE_CYCLES[static_cast<u8>(op)], "rewritten opcode replaces the old cached cycle charge");
			require(cpu.readFramePc(0) == pc + INSTRUCTION_BYTES && cpu.lastPc == pc, "cycle charge preserves physical PC boundaries");
		}
		require(machine.memory.readMappedU32LE(destination) == 1u, "two-cycle rewritten store executes exactly once");
		require(observations == (observed ? 3 : 0), "observation adds no execution or cycle charge");
	}
}

void partialCodeWritesRetainOtherDecodedStarts() {
	for (const bool instrumented : {false, true}) {
		auto image = returnImage();
		image.functions[0].maxStack = 2;
		CpuMachine machine(image);
		auto& cpu = machine.cpu;
		if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
		std::vector<u8> code(10 * INSTRUCTION_BYTES);
		for (u32 word = 0; word < 10u; ++word) writeInstruction(code, word, static_cast<u8>(OpCode::MOV), 0, 0, 0);
		writeInstruction(code, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
		writeInstruction(code, 8, static_cast<u8>(OpCode::K1), 1, 0, 0);
		writeInstruction(code, 9, static_cast<u8>(OpCode::JMP), 0, 63, 54, 255);
		const u32 pc = DYNAMIC_RAM_BASE + 0x5000u;
		machine.memory.writeBytes(pc, code.data(), code.size());
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], pc);
		require(cpu.runUntilDepth(0, 10) == RunResult::Yielded && cpu.readFramePc(0) == pc, "warm all ten decoded starts in one page");
		auto& page = *cpu.activeThread()->frameAtDepth(0)->decodedPage;
		require(page.refreshState[0] == 0u && page.refreshState[8] == 0u, "both independently writable instructions are cached");
		writeInstruction(code, 0, static_cast<u8>(OpCode::K0), 0, 0, 0);
		machine.memory.writeMappedU8(pc + 1u, code[1]);
		require(page.refreshState[0] == DECODED_REFRESH_DECODE && page.refreshState[8] == 0u, "a byte write retires only its decoded dependencies");
		writeInstruction(code, 8, static_cast<u8>(OpCode::KM1), 1, 0, 0);
		machine.memory.writeMappedU16LE(pc + 8u * INSTRUCTION_BYTES, readLE16(code.data() + 8u * INSTRUCTION_BYTES));
		require(page.refreshState[8] == DECODED_REFRESH_DECODE && page.refreshState[4] == 0u, "a second write before re-decode still invalidates its independent cached instruction");
		require(page.refreshState[5] == 0u && page.refreshState[6] == 0u && page.refreshState[7] == 0u, "ordinary predecessors do not consume the rewritten instruction's source words");
		require(cpu.runUntilDepth(0, 10) == RunResult::Yielded && cpu.instructionBudgetRemaining == 0, "partial code writes preserve exact guest charges");
		require(cpu.readFrameRegister(0, 0) == valueNumber(0) && cpu.readFrameRegister(0, 1) == valueNumber(-1), "both changed instructions execute, without losing the retained watch");
	}
}

// These fixtures assert the decoded interpreter's fused instructions. Native
// builds admit the same page tails to generated regions instead.
#if !defined(BMSX_ENABLE_NATIVE_BLOCKS)
void sourceAndFusionDependenciesRemainSeparate() {
	for (u32 first = 0; first < DECODED_DISPATCH_OP_COUNT; ++first) {
		bool canFuse = false;
		for (u32 second = 0; second < OPCODE_COUNT; ++second) {
			canFuse |= decodedDispatchOp(static_cast<u8>(first), static_cast<u8>(second)) != first;
		}
		require(decodedDispatchCanFuse(static_cast<u8>(first)) == canFuse, "fusion eligibility matches the actual pair producer");
	}
	for (const bool instrumented : {false, true}) for (const bool wideHead : {false, true}) for (const bool wideSuccessor : {false, true}) {
		auto image = returnImage();
		image.functions[0].maxStack = 5;
		CpuMachine machine(image);
		auto& cpu = machine.cpu;
		if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
		const u32 headWords = wideHead ? 2u : 1u;
		const u32 bodyWord = headWords + (wideSuccessor ? 1u : 0u);
		const u32 wordCount = bodyWord + 2u;
		std::vector<u8> code(wordCount * INSTRUCTION_BYTES);
		if (wideHead) writeInstruction(code, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(code, headWords - 1u, static_cast<u8>(OpCode::ADD), 3, 0, 1);
		if (wideSuccessor) writeInstruction(code, headWords, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(code, wordCount - 1u, static_cast<u8>(OpCode::JMP), 0, 63, 64u - wordCount, 255);
		const u32 pc = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE - headWords * INSTRUCTION_BYTES;
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], pc);
		cpu.activeThread()->frameAtDepth(0)->registers[0] = valueNumber(2);
		cpu.activeThread()->frameAtDepth(0)->registers[1] = valueNumber(3);
		cpu.activeThread()->frameAtDepth(0)->registers[2] = valueNumber(1);
		const std::array<OpCode, 3> successors{OpCode::MOV, OpCode::SHL, OpCode::BXOR};
		const std::array<int, 3> results{5, 10, 4};
		for (size_t phase = 0; phase < successors.size(); ++phase) {
			writeInstruction(code, bodyWord, static_cast<u8>(successors[phase]), 4, 3, 2);
			if (phase == 0) {
				machine.memory.writeBytes(pc, code.data(), code.size());
			} else {
				machine.memory.writeMappedU8(pc + bodyWord * INSTRUCTION_BYTES + 1u, code[bodyWord * INSTRUCTION_BYTES + 1u]);
				const auto& page = cpu.activeThread()->frameAtDepth(0)->executionImage->decodedPages.at(pc & ~MAPPED_PAGE_BYTE_MASK);
				require(page.refreshState[DECODED_PAGE_WORDS - headWords] == DECODED_REFRESH_FUSION, "successor writes dirty fusion eligibility, not the unchanged head's source decode");
			}
			require(cpu.runUntilDepth(0, 6) == RunResult::Yielded && cpu.instructionBudgetRemaining == 0, "WIDE and narrow pairs retain their three-cycle loop budget");
			require(cpu.readFramePc(0) == pc && cpu.readFrameRegister(0, 4) == valueNumber(results[phase]), "negative and positive fusion decisions observe the rewritten successor");
			if (!instrumented) {
				const auto& page = cpu.activeThread()->frameAtDepth(0)->executionImage->decodedPages.at(pc & ~MAPPED_PAGE_BYTE_MASK);
				const u8 expected = phase == 1 ? static_cast<u8>(DecodedDispatchOp::FusedAddShl) : static_cast<u8>(OpCode::ADD);
				require(page.words[DECODED_PAGE_WORDS - headWords].dispatchOp == expected, "source writes create and retire the cached fusion across pages");
			}
		}
	}
}

void changedWideFusionBodyInvalidatesItsCrossPageHead() {
	for (const bool instrumented : {false, true}) {
		auto image = returnImage();
		image.functions[0].maxStack = 5;
		CpuMachine machine(image);
		auto& cpu = machine.cpu;
		if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
		std::vector<u8> code(5 * INSTRUCTION_BYTES);
		writeInstruction(code, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(code, 1, static_cast<u8>(OpCode::ADD), 3, 0, 1);
		writeInstruction(code, 2, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(code, 3, static_cast<u8>(OpCode::SHL), 4, 3, 2);
		writeInstruction(code, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
		const u32 pc = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE - 2u * INSTRUCTION_BYTES;
		machine.memory.writeBytes(pc, code.data(), code.size());
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], pc);
		cpu.activeThread()->frameAtDepth(0)->registers[0] = valueNumber(2);
		cpu.activeThread()->frameAtDepth(0)->registers[1] = valueNumber(3);
		cpu.activeThread()->frameAtDepth(0)->registers[2] = valueNumber(1);
		require(cpu.runUntilDepth(0, 6) == RunResult::Yielded && cpu.readFrameRegister(0, 4) == valueNumber(10), "two WIDE instructions execute across a page boundary");
		if (!instrumented) {
			const auto& page = cpu.activeThread()->frameAtDepth(0)->executionImage->decodedPages.at(pc & ~MAPPED_PAGE_BYTE_MASK);
			require(page.words[DECODED_PAGE_WORDS - 2u].dispatchOp == static_cast<u8>(DecodedDispatchOp::FusedAddShl), "normal execution actually cached the four-word fusion");
		}
		writeInstruction(code, 3, static_cast<u8>(OpCode::BXOR), 4, 3, 2);
		machine.memory.writeMappedU8(pc + 3u * INSTRUCTION_BYTES + 1u, code[3u * INSTRUCTION_BYTES + 1u]);
		require(cpu.runUntilDepth(0, 3) == RunResult::Yielded && cpu.instructionBudgetRemaining == 0, "a changed last fusion word preserves the exact charge");
		require(cpu.readFrameRegister(0, 4) == valueNumber(4), "the fourth word invalidates its fused start three words earlier in the preceding page");
	}
}
#endif

void writableCodeWatchesBelongToTheirPhysicalSocket() {
	for (const bool instrumented : {false, true}) {
		auto image = returnImage();
		const auto system = test::encodeBlua32TestRom(RomImageDomain::System, image);
		CartridgeSocketMediaPair media{};
		for (auto& slot : media) slot = CartridgeCardMedia{std::nullopt, 2u * MAPPED_PAGE_BYTE_SIZE, false};
		Memory memory(MemoryInit{system.bytes, media}, PSX_MACHINE_SPEC.ramBytes);
		IrqController irq(memory);
		ExecutionAddressSpace addresses(memory);
		CPU cpu(memory, irq, addresses);
		DeviceScheduler scheduler(cpu);
		DmaController dma(memory, cpu, irq, scheduler);
		memory.cartridgeController().connect(memory, irq, dma);
		cpu.reset();
		if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
		std::vector<u8> code(2 * INSTRUCTION_BYTES);
		writeInstruction(code, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
		writeInstruction(code, 1, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
		std::array<DecodedInstructionPage*, CARTRIDGE_SLOT_COUNT> pages{};
		for (u32 slot = 0; slot < CARTRIDGE_SLOT_COUNT; ++slot) {
			for (u32 word = 0; word < 2u; ++word) memory.cartridgeController().writeU32(
				CART_RAM_BASE + word * INSTRUCTION_BYTES,
				readLE32(code.data() + word * INSTRUCTION_BYTES), mappedBusSignalsForCartridgeSlot(slot)
			);
			memory.writeMappedU32LE(IO_CART_SELECT, slot);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, system.functionAddresses[0], CART_RAM_BASE);
			require(cpu.runUntilDepth(0, 2) == RunResult::Yielded && cpu.readFrameRegister(0, 0) == valueNumber(1), "each physical socket admits its own writable code");
			pages[slot] = cpu.activeThread()->frameAtDepth(0)->decodedPage;
		}
		writeInstruction(code, 0, static_cast<u8>(OpCode::K0), 0, 0, 0);
		memory.cartridgeController().writeU8(CART_RAM_BASE + 1u, code[1], mappedBusSignalsForCartridgeSlot(1u));
		require(pages[0]->refreshState[0] == 0u && pages[1]->refreshState[0] == DECODED_REFRESH_DECODE, "socket-local word invalidation does not retire the other socket's decode");
		writeInstruction(code, 0, static_cast<u8>(OpCode::KM1), 0, 0, 0);
		memory.cartridgeController().writeU16(CART_RAM_BASE, readLE16(code.data()), mappedBusSignalsForCartridgeSlot(0u));
		for (u32 slot = 0; slot < CARTRIDGE_SLOT_COUNT; ++slot) {
			memory.writeMappedU32LE(IO_CART_SELECT, slot);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, system.functionAddresses[0], CART_RAM_BASE);
			require(cpu.runUntilDepth(0, 2) == RunResult::Yielded && cpu.readFrameRegister(0, 0) == valueNumber(slot == 0u ? -1 : 0), "both physical sockets execute their changed instructions");
		}
	}
}

void cachedInstructionBindingsFollowThePhysicalSelector() {
	for (const bool instrumented : {false, true}) {
		auto image = returnImage(OpCode::HALT); image.functions[0].maxStack = 2;
		const auto system = test::encodeBlua32TestRom(RomImageDomain::System, image);
		std::array<std::vector<u8>, 2> cards;
		for (u32 slot = 0; slot < 2; ++slot) {
			cards[slot].resize(MAPPED_PAGE_BYTE_SIZE);
			writeInstruction(cards[slot], 0, static_cast<u8>(slot == 0 ? OpCode::K1 : OpCode::K0), 0, 0, 0);
			writeInstruction(cards[slot], 1, static_cast<u8>(OpCode::MOV), 1, 0, 0);
			writeInstruction(cards[slot], 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
		}
		Memory memory(MemoryInit{system.bytes, test::cartridgeSlots(cards[0], cards[1])}, PSX_MACHINE_SPEC.ramBytes);
		IrqController irq(memory); ExecutionAddressSpace addresses(memory); CPU cpu(memory, irq, addresses);
		DeviceScheduler scheduler(cpu); DmaController dma(memory, cpu, irq, scheduler);
		memory.cartridgeController().connect(memory, irq, dma); cpu.reset();
		if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, system.functionAddresses[0], CART_ROM_BASE);
		require(cpu.runUntilDepth(0, 768) == RunResult::Yielded && cpu.readFramePc(0) == CART_ROM_BASE,
			"warm a selected cartridge page while the instruction bus remains in the system context");
		const auto* firstPage = cpu.activeThread()->frameAtDepth(0)->decodedPage;
		for (const u32 select : {1u, 0xfffffffeu, 0xffffffffu, 0u}) {
			memory.writeMappedWord(IO_CART_SELECT, select);
			require(cpu.runUntilDepth(0, 768) == RunResult::Yielded && cpu.readFrameRegister(0, 1) == valueNumber((select & 1u) == 0u ? 1 : 0),
				"without EXEC override, changing SELECT changes the physical code at the unchanged cached PC");
			if ((select & 1u) == 0u) require(cpu.activeThread()->frameAtDepth(0)->decodedPage == firstPage,
				"switching sockets retains each socket's independent decoded/native code");
		}
	}
}

void closureCallAndReturnRespectFrameBoundaries() {
	for (const bool instrumented : {false, true}) for (int edgeKind = 0; edgeKind < 6; ++edgeKind) {
		constexpr u32 mappedRecord = IO_GX_GPU_GP0 & ~(BLUA32_FUNCTION_ALIGNMENT - 1u);
		test::Blua32TestImage image;
		image.text.resize(MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 3, 0, 0);
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::CALL), 3, encodeFixedValueCount(0), 2);
		writeInstruction(image.text, 3, static_cast<u8>(OpCode::K1), 2, 0, 0);
		writeInstruction(image.text, 4, static_cast<u8>(OpCode::RET), 3, 2, 0);
		writeInstruction(image.text, 5, static_cast<u8>(OpCode::K1), 0, 0, 0);
		writeInstruction(image.text, 6, static_cast<u8>(OpCode::RET), 0, 2, 0);
		writeInstruction(image.text, 7, static_cast<u8>(OpCode::K1), 0, 0, 0);
		writeInstruction(image.text, 8, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 4},
			{.firstWord = 5, .wordCount = 2}, {.firstWord = 7, .wordCount = 2}};
		image.irqFunctionIndex = image.exceptionFunctionIndex = 2;
		image.closureRelocations = {{1, edgeKind == 1 ? mappedRecord : test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
		CpuMachine machine(image);
		auto& cpu = machine.cpu;
		const u32 calleePc = machine.rom.textAddress + 5 * INSTRUCTION_BYTES;
		struct Edge { IrqController& irq; const u8* record; bool armed = false; int count = 0; }
			edge{machine.irq, machine.rom.bytes.data() + machine.rom.functionAddresses[1]};
		if (edgeKind == 1) {
			for (u32 offset = 0; offset <= BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET; offset += 4) {
				machine.memory.mapIoRead(mappedRecord + offset, &edge, [](void* context, u32 address, MappedBusSignals) {
					auto& event = *static_cast<Edge*>(context);
					const u32 offset = address - mappedRecord;
					if (event.armed && offset == BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET) {
						++event.count;
						event.irq.raise(IRQ_GPU);
					}
					return readLE32(event.record + offset);
				});
			}
		}
		if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
		cpu.activeThread()->frameAtDepth(0)->registers[2] = valueNumber(99);
		require(cpu.runUntilDepth(0, 1) == RunResult::Yielded, "closure setup consumes its own physical instruction");
		const u32 callPc = cpu.readFramePc(0);
		if (edgeKind == 3) {
			asClosure(cpu.activeThread()->frameAtDepth(0)->registers[3])->functionAddress = CART_ROM_BASE;
			require(cpu.runUntilDepth(0, 3) == RunResult::Halted, "a failed call cannot reuse provenance from the previous function read");
			require(cpu.activeThread()->frameDepth == 1 && cpu.readFrameRegister(0, 2) == valueNumber(99), "failed call does not execute its continuation");
			continue;
		}
		if (edgeKind == 4 || edgeKind == 5) {
			if (edgeKind == 5) require(cpu.runUntilDepth(0, 3) == RunResult::Yielded, "prepare RET at callee depth");
			auto state = cpu.captureRuntimeState();
			state.haltedUntilIrqFrameDepth = edgeKind == 4 ? 2 : 1;
			state.haltedUntilIrqThreadRef = state.activeThreadRef;
			cpu.restoreRuntimeState(state);
			require(cpu.runUntilDepth(0, 3) == RunResult::Halted && cpu.instructionBudgetRemaining == 1, "frame transition activates the retained depth-sensitive HALT latch before another instruction");
			require(cpu.readFrameRegister(0, 2) == valueNumber(99), "HALT retains the caller continuation");
			if (edgeKind == 4) require(isNil(cpu.activeThread()->frameAtDepth(1)->registers[0]), "HALT at new callee depth precedes callee execution");
			continue;
		}
		if (edgeKind == 2) {
			InstructionObserverBinding observer;
			observer.points[0].insert(callPc);
			observer.context = &edge;
			observer.observe = [](void* context, ExecutionDomainId, u32, const Value*) {
				auto& event = *static_cast<Edge*>(context);
				++event.count;
				event.irq.raise(IRQ_GPU);
			};
			cpu.setInstructionObserver(std::move(observer));
		}
		edge.armed = true;
		machine.memory.writeMappedU32LE(IO_IRQ_MASK, IRQ_GPU);
		require(cpu.runUntilDepth(0, 3) == RunResult::Yielded, "CALL and the next physical instruction exhaust their grant");
		if (edgeKind != 0) {
			require(edge.count == 1 && cpu.activeThread()->frameDepth == 3, "call-side device/observer edge enters IRQ before callee execution");
			require(cpu.readCauseWord() == CPU_CAUSE_IRQ && cpu.readEpcWord() == calleePc, "CALL completes before IRQ saves the callee entry PC");
			require(isNil(cpu.activeThread()->frameAtDepth(1)->registers[0]) && cpu.activeThread()->frameAtDepth(2)->registers[0] == valueNumber(1), "IRQ, callee and caller retain separate register bases");
			continue;
		}
		require(cpu.activeThread()->frameDepth == 2 && cpu.readFramePc(1) == calleePc + INSTRUCTION_BYTES, "direct call rebinds the callee and stops before RET");
		require(cpu.runUntilDepth(1, 20) == RunResult::Halted && cpu.instructionBudgetRemaining == 18, "return stops at the requested depth with unused cycles retained");
		require(cpu.readFrameRegister(0, 3) == valueNumber(1) && cpu.readFrameRegister(0, 2) == valueNumber(99), "return publishes results without executing the caller continuation");
		require(cpu.runUntilDepth(0, 1) == RunResult::Yielded && cpu.readFrameRegister(0, 2) == valueNumber(1), "resuming after return binds the caller registers");
	}
}

void successorFetchOrdering() {
	auto image = returnImage(OpCode::K1, 0, 0, 0);
	image.text.resize(2 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions[0].maxStack = 3;
	image.functions.push_back({.firstWord = 1, .wordCount = 1});
	image.exceptionFunctionIndex = 1;
	// A partial backing page proves cacheability is not a readable-successor capability.
	for (const u32 ramBytes : {PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.ramBytes - 16u}) {
		for (const auto [op, expected] : {std::pair{OpCode::ADD, 4.0}, {OpCode::SHL, 6.0}, {OpCode::SHR, 1.0}}) {
			for (const bool wideSuccessor : {false, true}) {
				for (int dispatch = 0; dispatch < 4; ++dispatch) {
					for (const bool warm : {false, true}) {
						CpuMachine machine(image, ramBytes);
						auto& cpu = machine.cpu;
						const u32 faultAddress = RAM_BASE + ramBytes;
						const u32 currentPc = faultAddress - (wideSuccessor ? 2u : 1u) * INSTRUCTION_BYTES;
						const u32 successorPc = currentPc + INSTRUCTION_BYTES;
						std::vector<u8> instructions((wideSuccessor ? 2u : 1u) * INSTRUCTION_BYTES);
						writeInstruction(instructions, 0, static_cast<u8>(op), 2, 0, 1);
						if (wideSuccessor) writeInstruction(instructions, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
						machine.memory.writeBytes(currentPc, instructions.data(), instructions.size());
						const u32 functionAddress = machine.rom.functionAddresses[0];
						cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, functionAddress, currentPc);
						Value* registers = cpu.activeThread()->frameAtDepth(0)->registers;
						registers[0] = valueNumber(3.0);
						registers[1] = valueNumber(1.0);
						int observations = 0;
						if (dispatch == 1 || dispatch == 2) {
							InstructionObserverBinding observer;
							observer.points[0].insert(dispatch == 1 ? currentPc : successorPc);
							observer.observe = [](void* state, ExecutionDomainId, u32, const Value*) { ++*static_cast<int*>(state); };
							observer.context = &observations;
							cpu.setInstructionObserver(std::move(observer));
						}
						if (warm) {
							cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
							require(cpu.runUntilDepth(0, 1) == RunResult::Yielded, "warm current instruction consumes its grant");
							cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, functionAddress, currentPc);
							observations = 0;
						}
						if (dispatch == 3) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
						else cpu.setExecutionHook({});
						registers[2] = valueNumber(-1.0);
						const u32 faultSequence = machine.memory.readBusFaultSequence();
						require(cpu.runUntilDepth(0, 1) == RunResult::Yielded, "current instruction consumes its own grant");
						require(asNumber(cpu.readFrameRegister(0, 2)) == expected, "current numeric result precedes successor fault");
						require(cpu.readFramePc(0) == successorPc, "current instruction advances to successor");
						require(cpu.lastPc == currentPc, "last PC identifies current instruction");
						require(cpu.instructionBudgetRemaining == 0, "current instruction retains its base charge");
						require(cpu.getFrameDepth() == 1, "successor exception does not enter before current instruction");
						require(machine.memory.readBusFaultSequence() == faultSequence, "speculative lookahead issues no faulting bus read");
						require(observations == (dispatch == 1 ? 1 : 0), "only fetched current instruction is observed");
						require(cpu.runUntilDepth(0, 1) == RunResult::Yielded, "successor fetch consumes its own grant");
						require(asNumber(cpu.readFrameRegister(0, 2)) == expected, "successor fault retains current result");
						require(cpu.readCauseWord() == CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, "successor fetch records IBE");
						require(cpu.readEpcWord() == successorPc, "successor fetch records instruction-start EPC");
						require(cpu.readBadAddressWord() == 0u, "IBE retains BadAddress");
						require(cpu.instructionBudgetRemaining == 0, "fetch fault has one-cycle charge");
						require(cpu.getFrameDepth() == 2, "successor fetch enters exception frame");
						require(machine.memory.readBusFaultSequence() == faultSequence + 1u, "architectural successor fetch issues its bus read");
						require(machine.memory.readIoU32(IO_SYS_BUS_FAULT_CODE) == BUS_FAULT_UNMAPPED, "successor bus fault retains code");
						require(machine.memory.readIoU32(IO_SYS_BUS_FAULT_ADDR) == faultAddress, "successor bus fault retains physical address");
						require(machine.memory.readIoU32(IO_SYS_BUS_FAULT_ACCESS) == (BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32), "successor bus fault retains access width");
						require(observations == (dispatch == 1 ? 1 : 0), "unfetched successor is never observed");
					}
				}
			}
		}
	}
}

void reservedMemoryKinds() {
	for (const auto op : {OpCode::LOAD_MEM, OpCode::STORE_MEM, OpCode::LOAD_MEM_D, OpCode::STORE_MEM_D}) {
		for (const u8 kind : {6, 63}) {
			for (const bool instrumented : {false, true}) {
				auto image = returnImage(op, 0, 0, kind);
				image.text.resize(2 * INSTRUCTION_BYTES);
				writeInstruction(image.text, 1, static_cast<u8>(OpCode::RET), 0, 0, 0);
				image.functions.push_back({.firstWord = 1, .wordCount = 1});
				image.exceptionFunctionIndex = 1;
				CpuMachine machine(image);
				auto& cpu = machine.cpu;
				const u32 pc = cpu.readFramePc(0);
				int observations = 0;
				InstructionObserverBinding observer;
				observer.points[0].insert(pc);
				observer.observe = [](void* state, ExecutionDomainId, u32, const Value*) { ++*static_cast<int*>(state); };
				observer.context = &observations;
				cpu.setInstructionObserver(std::move(observer));
				if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
				const u32 faultSequence = machine.memory.readBusFaultSequence();
				require(cpu.runUntilDepth(0, 1) == RunResult::Yielded, "reserved memory instruction exhausts grant");
				require(cpu.readCauseWord() == CPU_CAUSE_CODE_RESERVED_INSTRUCTION, "reserved scalar kind takes instruction exception");
				require(cpu.readEpcWord() == pc, "reserved scalar instruction EPC");
				require(cpu.instructionBudgetRemaining == -1, "reserved scalar instruction keeps base charge");
				require(machine.memory.readBusFaultSequence() == faultSequence, "reserved instruction does not issue a memory request");
				require(observations == 1, "observer sees reserved instruction exactly once");
			}
		}
	}
}

void zeroStackReuse() {
	test::Blua32TestImage image;
	image.text.resize(10 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::CALL), 0, 1, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::CALL), 0, 1, 2);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::RET), 0, 2, 0);
	writeInstruction(image.text, 7, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 8, static_cast<u8>(OpCode::RET), 0, 0, 0);
	writeInstruction(image.text, 9, static_cast<u8>(OpCode::RET), 0, 1, 0);
	image.functions = {{.firstWord = 0, .wordCount = 7}, {.firstWord = 7, .wordCount = 2}, {.firstWord = 9, .wordCount = 1, .maxStack = 0}};
	image.closureRelocations = {{1, 0x180}, {4, 0x1a0}};
	CpuMachine machine(image);
	auto& cpu = machine.cpu;
	require(cpu.runUntilDepth(0, 100) == RunResult::Halted, "zero-stack call finishes");
	require(isNil(cpu.readCompletionValues()[0]), "zero results nil-pad only the requested caller slot");
	cpu.activeThread()->stack[0] = valueNumber(91.0);
	cpu.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, 0x1a0);
	require(cpu.readFrameRegister(0, 0) == valueNumber(91), "activation does not initialize scratch storage");
	require(cpu.runUntilDepth(0, 100) == RunResult::Halted && cpu.readCompletionValues().empty(), "completion preserves true zero results");
}

void haltYieldPrecedence() {
	for (const bool instrumented : {false, true}) {
		for (int latch = 0; latch < 3; ++latch) {
			CpuMachine machine(returnImage());
			auto& cpu = machine.cpu;
			if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
			if (latch == 0) cpu.haltUntilIrq();
			else {
				auto state = cpu.captureRuntimeState();
				if (latch == 1) state.hardHalted = true;
				else state.memoryWriteBlocked = true;
				cpu.restoreRuntimeState(state);
			}
			cpu.requestYield();
			require(cpu.runUntilDepth(0, 1) == RunResult::Halted, "halted state wins over simultaneous yield");
			require(cpu.captureRuntimeState().yieldRequested, "halted state retains pending yield");
		}
	}
}

void cachedPcWrapping() {
	for (const bool instrumented : {false, true}) {
		for (const u8 width : {1, 2}) {
			for (const bool skip : {false, true}) {
				CpuMachine machine(returnImage());
				auto& cpu = machine.cpu;
				if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
				auto& frame = *cpu.activeThread()->frameAtDepth(0);
				DecodedInstructionPage page(true, {});
				page.refreshState.fill(0);
				frame.pc = skip ? 0xfffffff8u : 0xfffffffcu;
				frame.decodedPage = &page;
				frame.decodedPageAddress = 0xfffffc00u;
				frame.decodedPageBusSignals = mappedBusSignalsForCartridgeSlot(0);
				page.words[255].width = width;
				page.words[255].op = page.words[255].dispatchOp = static_cast<u8>(OpCode::K1);
				page.words[255].baseCycles = page.words[255].dispatchCycles = BASE_CYCLES[static_cast<u8>(OpCode::K1)];
				page.words[254].width = 1;
				page.words[254].op = page.words[254].dispatchOp = static_cast<u8>(OpCode::EQ);
				page.words[254].baseCycles = page.words[254].dispatchCycles = BASE_CYCLES[static_cast<u8>(OpCode::EQ)];
				cpu.runUntilDepth(0, 1);
				require(frame.pc == (width - 1u) * INSTRUCTION_BYTES, "sequential/wide/skip PC wraps to a word");
			}
		}
	}
	CpuMachine machine(returnImage());
	auto& cpu = machine.cpu;
	auto& frame = *cpu.activeThread()->frameAtDepth(0);
	DecodedInstructionPage page(true, {});
	page.refreshState.fill(0);
	frame.pc = 0xfffffff8u;
	frame.decodedPage = &page;
	frame.decodedPageAddress = 0xfffffc00u;
	frame.decodedPageBusSignals = mappedBusSignalsForCartridgeSlot(0);
	page.words[254].width = page.words[255].width = 1;
	page.words[254].op = static_cast<u8>(OpCode::SHL);
	page.words[254].dispatchOp = static_cast<u8>(DecodedDispatchOp::FusedShlBxor);
	page.words[254].baseCycles = page.words[254].dispatchCycles = BASE_CYCLES[static_cast<u8>(OpCode::SHL)];
	page.words[255].op = page.words[255].dispatchOp = static_cast<u8>(OpCode::BXOR);
	page.words[255].baseCycles = page.words[255].dispatchCycles = BASE_CYCLES[static_cast<u8>(OpCode::BXOR)];
	cpu.runUntilDepth(0, 2);
	require(frame.pc == 0u, "fused successor PC wraps to a word");
}

void imageTextImport() {
	auto image = returnImage(OpCode::LOADK, 0, 0, 0);
	image.text.resize(2 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::RET), 0, 2, 0);
	image.functions[0].wordCount = 2;
	image.constants = {std::string("\xef\xbb\xbf" "A")};
	CpuMachine machine(image);
	machine.cpu.runUntilDepth(0, 100);
	require(machine.cpu.stringPool().toString(asStringId(machine.cpu.readCompletionValues()[0])) == "\xef\xbb\xbf" "A", "initial U+FEFF is preserved");
	for (const std::vector<u8>& bytes : {std::vector<u8>{0xc0, 0x80}, {0xed, 0xa0, 0x80}, {0xf4, 0x90, 0x80, 0x80}, {0xe2, 0x82}, {0x80}, {0xe2, 0x28, 0xa1}}) {
		auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
		const u32 table = readLE32(rom.bytes.data() + test::BLUA32_TEST_IMAGE_OFFSET + BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET);
		const u32 address = readLE32(rom.bytes.data() + table + BLUA32_CONSTANT_PAYLOAD_OFFSET);
		std::copy(bytes.begin(), bytes.end(), rom.bytes.begin() + address);
		writeLE32(rom.bytes.data() + table + BLUA32_CONSTANT_STRING_BYTE_COUNT_OFFSET, static_cast<u32>(bytes.size()));
		Memory memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
		IrqController irq(memory);
		ExecutionAddressSpace addressSpace(memory);
		CPU cpu(memory, irq, addressSpace);
		bool rejected = false;
		try { cpu.reset(); } catch (const std::runtime_error&) { rejected = true; }
		require(rejected, "external malformed UTF8 image text is rejected");
	}
}

void bootAddressWrap() {
	auto system = test::encodeBlua32TestRom(RomImageDomain::System, returnImage());
	auto cart = test::encodeBlua32TestRom(RomImageDomain::Cartridge, returnImage());
	writeLE32(cart.bytes.data() + BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET, 0xfffffff0u);
	Memory memory(MemoryInit{system.bytes, test::cartridgeSlots(cart.bytes)}, PSX_MACHINE_SPEC.ramBytes);
	ExecutionAddressSpace addressSpace(memory);
	require(addressSpace.resolveDomain(0)->imageAddress == 0x0ffffff0u, "boot image address wraps as a raw word");
}
} // namespace

int main() {
	compactAndPaddedRomFunctionRecordsAgree();
	try {
		equalityUsesValueKindsInsteadOfUnusedPayloads();
		registerRunsPublishAtBudgetBoundaries();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		nativeFieldGuardsAndRawSlotAccess();
		nativeFieldExitsPublishCyclesAndFaultPc();
		nativeFieldStoreMissKeepsSignedConstantSelectors();
		nativeCodeWarmsWithinOneCpuSlice();
		nativeCodeUsesCachedWordsAtPartialRomTails();
		nativeWarmAdmitsAllocatingBodies();
		nativeCodeRetiresOnWritesAndObservation();
		nativeHaltCommitsItsThreadAndFrameLatch();
		nativeTerminalAtPageBoundaryTracksItsBody();
		nativeWritesPreserveIndependentBlocks();
		nativeCallsAndReturnsPublishFaultBoundaries();
		nativeCallCanRetireItsSourceDuringFunctionRecordRead();
#endif
		stringBytePositions(); loadKrIndices(); zeroLoadNil(); successorFetchOrdering(); reservedMemoryKinds(); zeroStackReuse();
		returnRangesSurviveCallerStackGrowth(); builtinReturnRangesSurviveDestinationGrowth();
		wideSignedImmediatesKeepTheirRange();
		instructionBoundaryResynchronizesAfterFetchOrObservation();
		cachedFetchCrossesWidePagesAndObservesCodeWrites();
		rewrittenInstructionRetainsItsOwnCycleCharge();
		partialCodeWritesRetainOtherDecodedStarts();
#if !defined(BMSX_ENABLE_NATIVE_BLOCKS)
		sourceAndFusionDependenciesRemainSeparate(); changedWideFusionBodyInvalidatesItsCrossPageHead();
#endif
		writableCodeWatchesBelongToTheirPhysicalSocket();
		cachedInstructionBindingsFollowThePhysicalSelector();
		closureCallAndReturnRespectFrameBoundaries();
		haltYieldPrecedence(); cachedPcWrapping(); imageTextImport(); bootAddressWrap();
		std::cout << "CPU boundary tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
