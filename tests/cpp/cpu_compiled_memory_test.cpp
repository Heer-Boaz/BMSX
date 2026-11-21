#include "common/endian.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/decoded_instruction.h"
#include "machine/cpu/jit/runtime/block.h"
#include "support/native_region_fixture.h"
#include "machine/cpu/table.h"
#include "machine/cpu/thread_record.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

#include <array>
#include <cstring>
#include <iostream>
#include <limits>
#include <stdexcept>

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
	explicit CpuMachine(test::Blua32TestImage image, bool scalar = false)
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image, test::RAM_CODE_FIXTURE_BYTES))
		, memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes)
		, irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		cpu.reset();
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; },
			nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
	}
};

test::Blua32TestImage memoryLoop(OpCode op, MemoryAccessKind kind, u8 displacement = 0) {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 4, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(op), 0, 1, static_cast<u8>(kind), displacement);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::MOV), 6, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 8}, {.firstWord = 5, .wordCount = 1}};
	image.exceptionFunctionIndex = 1;
	return image;
}

void ramScalarDatapathsAndGuards() {
	NativeBlockRunState nativeRunState;
	Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes), reference(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory);
	ExecutionAddressSpace addresses(memory);
	CPU cpu(memory, irq, addresses);
	memory.setRamBusEnd(DYNAMIC_RAM_BASE + test::RAM_CODE_FIXTURE_BYTES);
	const std::array values{valueInteger(0), valueInteger(-1), valueInteger(INT32_MIN), valueInteger(16777217),
		valueFloat(-0.f), valueFloat(0.25f), valueFloat(-1.75f), valueFloat(0x1p32f),
		valueFloatBits(1), valueFloatBits(0x7f7fffffu), valueFloatBits(0x7f800000u),
		valueFloatBits(0xffa12345u), valueNil(), valueBool(false), valueBool(true), valueString(42)};
	for (int format = 0; format <= 5; ++format) for (const bool displaced : {false, true}) {
		const auto kind = static_cast<MemoryAccessKind>(format);
		const u32 width = format == 1 ? 1 : format == 2 ? 2 : format == 5 ? 8 : 4;
		DecodedInstruction store, load;
		store.op = static_cast<u8>(displaced ? OpCode::STORE_MEM_D : OpCode::STORE_MEM);
		store.a = 0; store.b = 1; store.c = format; store.setBx(displaced ? 255 : 0);
		store.width = 2; store.baseCycles = BASE_CYCLES[store.op];
		load = store; load.op = static_cast<u8>(displaced ? OpCode::LOAD_MEM_D : OpCode::LOAD_MEM); load.a = 2;
		load.baseCycles = BASE_CYCLES[load.op];
		const int charge = BASE_CYCLES[store.op] + BASE_CYCLES[load.op] + (kind == MemoryAccessKind::F64LE ? 4 : 0);
		const std::array source{NativeBlockInstruction{&store, 0x1000}, NativeBlockInstruction{&load, 0x1008}};
		auto block = test::compileNative(source, memory, cpu.stringPool());
		for (const u32 target : {DYNAMIC_RAM_BASE + 0x204u, DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE - 4u,
			memory.ramBusEnd() - width}) for (const Value value : values) {
			ValueSlots registers(3); registers.set(0, value); registers.set(1, valueInteger(target - static_cast<u32>(store.bx()) * 4u)); registers.set(2, valueNil());
			const auto offset = target - RAM_BASE;
			std::memset(memory.ramData() + offset, 0xb6, width);
			const auto* exit = block->run(registers.view(), nativeRunState = {.remainingCycles = 20});
			if (!valueIsInteger(value) && !(format >= 4 && valueIsFloat(value))) {
				require(exit->exit == NativeBlockExit::WriteMemory && isNil(registers.get(2))
					&& std::all_of(memory.ramData() + offset, memory.ramData() + offset + width,
						[](u8 v) { return v == 0xb6; }), "non-native conversions leave before any store or subsequent load");
				continue;
			}
			require(exit->exit == NativeBlockExit::Continue && exit->nextPc == 0x1010
				&& nativeRunState.remainingCycles == 20 - charge, "ordinary RAM transfers complete both operations and their full charge");
			Value expected;
			switch (kind) {
				case MemoryAccessKind::Word: reference.writeMappedWord(target, valuePayload(value)); expected = valueInteger(reference.readMappedWord(target)); break;
				case MemoryAccessKind::U8: reference.writeMappedU8(target, static_cast<u8>(valuePayload(value))); expected = valueInteger(reference.readMappedU8(target)); break;
				case MemoryAccessKind::U16LE: reference.writeMappedU16LE(target, valuePayload(value)); expected = valueInteger(reference.readMappedU16LE(target)); break;
				case MemoryAccessKind::U32LE: reference.writeMappedU32LE(target, valuePayload(value)); expected = valueInteger(reference.readMappedU32LE(target)); break;
				case MemoryAccessKind::F32LE: reference.writeMappedU32LE(target, valueIsFloat(value) ? valuePayload(value) : valuePayload(valueFloat(static_cast<float>(asInteger(value))))); expected = valueFloatBits(reference.readMappedU32LE(target)); break;
				case MemoryAccessKind::F64LE: reference.writeMappedF64LE(target, valueIsInteger(value) ? static_cast<double>(asInteger(value)) : static_cast<double>(asFloat(value))); expected = valueFloat(static_cast<float>(reference.readMappedF64LE(target))); break;
			}
			require(registers.get(2) == expected, "loads produce the specified guest tag and payload");
			if (kind == MemoryAccessKind::F64LE && valueIsFloat(value) && (valuePayload(value) & 0x7fffffffu) > 0x7f800000u)
				require((readLE64(memory.ramData() + offset) & 0x7fffffffffffffffULL) > 0x7ff0000000000000ULL,
					"widening a NaN stores a binary64 NaN without prescribing its payload");
			else require(std::memcmp(memory.ramData() + offset, reference.ramData() + offset, width) == 0,
				"all other scalar stores preserve numeric conversion and little-endian bytes");
		}
		for (u32 address : {0u, RAM_BASE, RAM_BASE + IO_SLOT_COUNT * IO_WORD_SIZE - 1u,
			RAM_BASE + PSX_MACHINE_SPEC.ramBytes, 0xffffffffu, DYNAMIC_RAM_BASE + 1u}) {
			ValueSlots registers(3); registers.set(0, valueInteger(7)); registers.set(1, valueInteger(address - static_cast<u32>(store.bx()) * 4u)); registers.set(2, valueInteger(99));
			const bool direct = address >= RAM_BASE + IO_SLOT_COUNT * IO_WORD_SIZE
				&& address <= memory.ramBusEnd() - width
				&& (address & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[format]) == 0u;
			const auto* exit = block->run(registers.view(), nativeRunState = {.remainingCycles = block->terminal.cycles});
			require((exit == &block->terminal) == direct, "IO, faults and alignment leave before accessing raw RAM");
			if (!direct) require(exit->exit == NativeBlockExit::WriteMemory && registers.get(2) == valueInteger(99),
				"a rejected transfer never executes its following load");
		}
		load.a = load.b;
		const std::array aliasSource{NativeBlockInstruction{&load, 0x1000}};
		auto alias = test::compileNative(aliasSource, memory, cpu.stringPool());
		ValueSlots registers(2); registers.set(0, valueNil()); registers.set(1, valueInteger(DYNAMIC_RAM_BASE + 0x204u - store.bx() * 4u));
		require(alias->run(registers.view(), nativeRunState = {.remainingCycles = alias->terminal.cycles}) == &alias->terminal && valueIsNumber(registers.get(1)),
			"a memory load can replace its own address register");
	}
	// A four-byte-aligned double can cross into the next watched page.
	DecodedInstruction store;
	store.op = static_cast<u8>(OpCode::STORE_MEM); store.a = 0; store.b = 1; store.c = 5; store.width = 2; store.baseCycles = BASE_CYCLES[store.op];
	const std::array source{NativeBlockInstruction{&store, 0x1000}};
	auto block = test::compileNative(source, memory, cpu.stringPool());
	const u32 target = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE - 4u;
	MappedPageBinding page;
	memory.bindMappedPage(target + 4u, MAPPED_BUS_MASTER_CPU, page);
	page.writeWatch.armWord(0);
	ValueSlots registers(2); registers.set(0, valueInteger(1)); registers.set(1, valueInteger(target));
	const auto before = readLE64(memory.ramData() + target - RAM_BASE);
	const auto* exit = block->run(registers.view(), nativeRunState = {.remainingCycles = block->terminal.cycles});
	require(exit->exit == NativeBlockExit::WriteMemory && registers.get(1) == valueInteger(target)
		&& readLE64(memory.ramData() + target - RAM_BASE) == before,
		"the high half's code watch exits before either half of a direct F64 store");
	memory.clearMappedPageWriteWatches();
	DecodedInstruction load = store;
	load.op = static_cast<u8>(OpCode::LOAD_MEM); load.a = 2;
	const std::array numericSource{NativeBlockInstruction{&store, 0x1000}, NativeBlockInstruction{&load, 0x1008}};
	auto numeric = test::compileNative(numericSource, memory, cpu.stringPool());
	const u32 publicEnd = memory.ramBusEnd();
	registers.set(1, valueInteger(target));
	memory.setRamBusEnd(target + 4u);
	require(block->run(registers.view(), nativeRunState = {.remainingCycles = block->terminal.cycles})->exit == NativeBlockExit::WriteMemory
		&& readLE64(memory.ramData() + target - RAM_BASE) == before,
		"a published F64 block uses the new live aperture and exits before its bus continuation");
	memory.setRamBusEnd(publicEnd);
	require(block->run(registers.view(), nativeRunState = {.remainingCycles = block->terminal.cycles}) == &block->terminal,
		"the same published block readmits its destination after the aperture grows");

	ValueSlots shortRegisters(3);
	shortRegisters.set(0, valueFloat(4.25f));
	shortRegisters.set(1, valueInteger(target));
	shortRegisters.set(2, valueInteger(73));
	NativeBlockRunState shortGrant{.remainingCycles = BASE_CYCLES[store.op] + 1};
	const auto* deadline = numeric->run(shortRegisters.view(), shortGrant);
	require(deadline->exit == NativeBlockExit::Continue && deadline->currentPc == 0x1000
		&& deadline->lastPc == 0x1004 && deadline->nextPc == 0x1008 && shortGrant.remainingCycles == -1
		&& memory.readMappedF64LE(target) == 4.25 && shortRegisters.get(2) == valueInteger(73),
		"the full F64 store charge exhausts the grant before its following load starts");

	// F64LE is a conversion. F32LE above instead preserves the exact input bits.
	for (u32 high = 0; high <= 0xffffu; ++high) {
		const auto value = valueFloatBits((high << 16) | 0x9abcu);
		ValueSlots registers(3); registers.set(0, value); registers.set(1, valueInteger(target));
		reference.writeMappedF64LE(target, static_cast<double>(asFloat(value)));
		const auto* completed = numeric->run(registers.view(), nativeRunState = {.remainingCycles = 20});
		require(completed->exit == NativeBlockExit::Continue && completed->nextPc == 0x1010
			&& registers.get(2) == valueFloat(static_cast<float>(reference.readMappedF64LE(target))),
			"widening and narrowing follow the Float rules across both signs and every exponent");
		if ((valuePayload(value) & 0x7fffffffu) <= 0x7f800000u)
			require(readLE64(memory.ramData() + target - RAM_BASE) == readLE64(reference.ramData() + target - RAM_BASE),
				"finite values, zero signs and infinities widen exactly");
	}
	load.b = -1;
	const std::array constantSource{NativeBlockInstruction{&load, 0x1000}};
	ValueSlots constants(1); constants.set(0, valueInteger(target));
	auto constant = test::compileNative(constantSource, memory, cpu.stringPool());
	ValueSlots constantRegisters(3); constantRegisters.set(0, valueNil()); constantRegisters.set(1, valueNil()); constantRegisters.set(2, valueNil());
	require(constant->run(constantRegisters.view(), nativeRunState = {.constants = constants.view(), .remainingCycles = constant->terminal.cycles}) == &constant->terminal
		&& constant->sideExits[0].operands.memory.address == -1, "a constant memory address retains its signed RK selector");
}

void generatedMemoryBoundaries() {
	NativeBlockRunState nativeRunState;
	for (const auto op : {OpCode::LOAD_MEM, OpCode::LOAD_MEM_D, OpCode::STORE_MEM, OpCode::STORE_MEM_D}) {
		const bool displaced = op == OpCode::LOAD_MEM_D || op == OpCode::STORE_MEM_D;
		const auto image = memoryLoop(op, MemoryAccessKind::F64LE, displaced ? 255 : 0);
		CpuMachine native(image), scalar(image, true);
		for (auto* machine : {&native, &scalar}) {
			auto& frame = *machine->cpu.activeThread()->frameAtDepth(0);
			frame.registers.set(0, valueFloat(3.25f));
			frame.registers.set(1, valueInteger(DYNAMIC_RAM_BASE + 0x404u - (displaced ? 1020u : 0u)));
			machine->memory.writeMappedF64LE(DYNAMIC_RAM_BASE + 0x404u, 3.25);
			machine->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 1200);
		}
		auto& frame = *native.cpu.activeThread()->frameAtDepth(0);
		test::waitForNativeEntry(native.cpu, *frame.decodedPage, (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) >> 2u);
		const auto& block = frame.decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) >> 2u];
		require(block && block->sourceWords == 5 && block->sideExits.size() == 1,
			"RAM accesses compile with their dependent instructions and branch");
		require(block->run(frame.registers, nativeRunState = {.constants = frame.executionImage->constPool, .remainingCycles = BASE_CYCLES[static_cast<u8>(OpCode::K1)] + BASE_CYCLES[static_cast<u8>(op)]
				+ BASE_CYCLES[static_cast<u8>(OpCode::MOV)] + BASE_CYCLES[static_cast<u8>(OpCode::JMP)] + 2})->nextPc == native.rom.textAddress,
			"the complete memory loop reaches its final native exit without a bus-owner side exit");
		for (int grant = 1; grant <= 32; ++grant) {
			for (auto* machine : {&native, &scalar}) {
				machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress);
			}
			test::runCpuParity(native.cpu, scalar.cpu, grant);
			require(native.cpu.readFramePc(0) == scalar.cpu.readFramePc(0) && native.cpu.lastPc == scalar.cpu.lastPc,
				"short grants retain memory and WIDE boundaries");
		}
		for (auto* machine : {&native, &scalar}) {
			auto& current = *machine->cpu.activeThread()->frameAtDepth(0);
			current.writeControl(bmsx::FrameField::Top, 0);
			current.registers.set(1, valueInteger(0xfffffffc - (displaced ? 1020u : 0u)));
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress);
			require(machine->cpu.runUntilDepth(0, 20) == RunResult::Halted, "a generated memory fault reaches the ordinary exception owner");
			require(machine->cpu.readEpcWord() == machine->rom.textAddress + INSTRUCTION_BYTES
				&& static_cast<bmsx::i32>(current.readControl(bmsx::FrameField::Top)) == 5 && machine->memory.readIoU32(IO_SYS_BUS_FAULT_ADDR) == 0xfffffffcu,
				"failed memory instructions retain prefix EPC, committed register top and first fault address");
			require(current.registers.get(0) == valueFloat(3.25f), "a fault does not publish a failed load result");
			require(machine->cpu.readCauseWord() == CPU_CAUSE_CODE_DATA_BUS_ERROR, "memory side exits preserve bus exceptions");
		}
	}

}

void wideTransfersRespectThePublicRamBoundary() {
	for (const bool load : {false, true}) {
		const OpCode op = load ? OpCode::LOAD_MEM_D : OpCode::STORE_MEM_WORDS_D;
		auto image = memoryLoop(op, MemoryAccessKind::F64LE);
		if (!load) writeInstruction(image.text, 2, static_cast<u8>(op), 0, 1, 2);
		CpuMachine native(image), scalar(image, true);
		const u32 start = native.rom.textAddress;
		const u32 entry = (start & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		const int memoryCycles = BASE_CYCLES[static_cast<u8>(op)] + (load ? F64_ACCESS_EXTRA_CYCLES : 2);
		const int prefix = BASE_CYCLES[static_cast<u8>(OpCode::K1)];
		const int loopCycles = prefix + memoryCycles + BASE_CYCLES[static_cast<u8>(OpCode::MOV)]
			+ BASE_CYCLES[static_cast<u8>(OpCode::JMP)];
		constexpr u32 publicRam = DYNAMIC_RAM_BASE + 0x1000u;
		for (auto* machine : {&native, &scalar}) {
			auto& cpu = machine->cpu;
			auto& frame = *cpu.activeThread()->frameAtDepth(0);
			frame.registers.set(0, valueInteger(17));
			frame.registers.set(1, valueInteger(publicRam));
			require(cpu.runUntilDepth(0, NATIVE_WARM_SCALE * (NATIVE_BLOCK_COMPILATION_THRESHOLD + 2) * loopCycles) == RunResult::Yielded,
				"ordinary public transfers warm the loop");
			if (machine == &native) test::waitForNativeEntry(cpu, *frame.decodedPage, entry);
			const u32 end = machine->memory.ramBusEnd();
			machine->memory.writeMappedU32LE(end - 4u, 29u);
			frame.registers.set(0, valueInteger(17));
			frame.registers.set(1, valueInteger(end - 4u));
			frame.registers.set(4, valueInteger(97));
			frame.registers.set(6, valueInteger(99));
		}
		const u32 end = native.memory.ramBusEnd();
		const auto privateWord = native.memory.readRamRecordWord(end);
		require(test::runCpuParity(native.cpu, scalar.cpu, prefix + memoryCycles) == RunResult::Yielded,
			"the charged fault does not execute the handler or following instruction");
		require(native.cpu.readCauseWord() == CPU_CAUSE_CODE_DATA_BUS_ERROR && native.cpu.readEpcWord() == start + INSTRUCTION_BYTES
			&& native.memory.readIoU32(IO_SYS_BUS_FAULT_ADDR) == end, "the private word faults at the exact WIDE instruction");
		require(native.cpu.readFrameRegister(0, 0) == valueInteger(17) && native.cpu.readFrameRegister(0, 4) == valueInteger(1)
			&& native.cpu.readFrameRegister(0, 6) == valueInteger(99), "only the completed prefix and transfer are observable");
		require(native.memory.readMappedU32LE(end - 4u) == (load ? 29u : 17u)
			&& native.memory.readRamRecordWord(end) == privateWord, "a counted public store commits only the admitted low word");
	}
}

void coldExitsPreserveAddressOperands() {
	Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory);
	ExecutionAddressSpace addresses(memory);
	CPU cpu(memory, irq, addresses);
	memory.setRamBusEnd(DYNAMIC_RAM_BASE + test::RAM_CODE_FIXTURE_BYTES);
	for (const auto op : {OpCode::LOAD_MEM, OpCode::LOAD_MEM_D, OpCode::STORE_MEM, OpCode::STORE_MEM_D}) {
		const bool displaced = op == OpCode::LOAD_MEM_D || op == OpCode::STORE_MEM_D;
		for (const bool constant : {false, true}) for (const u32 address : {IO_BASE, 0xfffffffcu, 0xfffffffdu}) {
			if (displaced && constant) continue; // Displaced addressing takes a register.
			DecodedInstruction instruction{};
			instruction.op = static_cast<u8>(op); instruction.a = 0; instruction.b = constant ? -1 : 1;
			instruction.c = static_cast<u8>(MemoryAccessKind::F64LE);
			instruction.setBx(displaced ? 255 : 0);
			instruction.width = 1; instruction.baseCycles = BASE_CYCLES[instruction.op];
			const std::array source{NativeBlockInstruction{&instruction, 0x1000u}};
			const Value base = valueInteger(address - static_cast<u32>(instruction.bx()) * 4u);
			ValueSlots constants(1); constants.set(0, constant ? base : valueInteger(DYNAMIC_RAM_BASE));
			auto block = test::compileNative(source, memory, cpu.stringPool());
			ValueSlots registers(2); registers.set(0, valueInteger(17)); registers.set(1, constant ? valueInteger(DYNAMIC_RAM_BASE) : base);
			NativeBlockRunState state{.constants = constants.view(), .remainingCycles = 100};
			const auto* exit = block->run(registers.view(), state);
			require(exit->exit == (op == OpCode::LOAD_MEM || op == OpCode::LOAD_MEM_D
				? NativeBlockExit::ReadMemory : NativeBlockExit::WriteMemory)
				&& exit->operands.memory.address == instruction.b && exit->operands.memory.displacement == static_cast<u32>(instruction.bx()) * 4u && registers.get(0) == valueInteger(17),
				"misaligned, MMIO and unmapped exits preserve the selector and byte displacement before side effects");
		}
	}
	const u32 watched = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE - 4u;
	MappedPageBinding page;
	memory.bindMappedPage(watched + INSTRUCTION_BYTES, MAPPED_BUS_MASTER_CPU, page);
	page.writeWatch.armWord(0);
	for (const auto op : {OpCode::STORE_MEM_WORDS, OpCode::STORE_MEM_WORDS_D}) {
		const bool displaced = op == OpCode::STORE_MEM_WORDS_D;
		for (const bool constant : {false, true}) for (const u32 address : {IO_BASE, 0xfffffffdu, watched}) {
			if (displaced && constant) continue; // Displaced addressing takes a register.
			DecodedInstruction instruction{};
			instruction.op = static_cast<u8>(op); instruction.a = 2; instruction.b = constant ? -1 : 1;
			instruction.c = 2; instruction.setBx(displaced ? 255 : 0);
			instruction.width = 1; instruction.baseCycles = BASE_CYCLES[instruction.op];
			const std::array source{NativeBlockInstruction{&instruction, 0x1000u}};
			const Value base = valueInteger(address - static_cast<u32>(instruction.bx()) * 4u);
			ValueSlots constants(1); constants.set(0, constant ? base : valueInteger(DYNAMIC_RAM_BASE));
			auto block = test::compileNative(source, memory, cpu.stringPool());
			ValueSlots registers(4); registers.set(0, valueNil()); registers.set(1, constant ? valueInteger(DYNAMIC_RAM_BASE) : base); registers.set(2, valueInteger(11)); registers.set(3, valueInteger(12));
			NativeBlockRunState state{.constants = constants.view(), .remainingCycles = 100};
			const auto* exit = block->run(registers.view(), state);
			require(exit->exit == NativeBlockExit::WriteWords && exit->operands.memory.address == instruction.b && exit->operands.memory.displacement == static_cast<u32>(instruction.bx()) * 4u,
				"counted stores preserve address operands across bounds, alignment and watched-page exits");
		}
	}
}

void resumedStoreRetainsDecodedOperation() {
	for (const bool scalar : {false, true}) {
		const auto image = memoryLoop(OpCode::STORE_MEM, MemoryAccessKind::Word);
		CpuMachine machine(image, scalar);
		auto& cpu = machine.cpu;
		const u32 code = DYNAMIC_RAM_BASE + 0x1000u, port = IO_BASE + 0x5000u;
		machine.memory.writeBytes(code, image.text.data(), image.text.size());
		auto& frame = *cpu.activeThread()->frameAtDepth(0);
		frame.registers.set(0, valueInteger(0x12345678u));
		frame.registers.set(1, valueInteger(code + 0x2000u));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], code);
		cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 2400);
		if (!scalar) test::waitForNativeEntry(cpu, *frame.decodedPage, (code & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
		struct Device { bool ready = false; std::vector<u32> writes; } device;
		machine.memory.mapIoWrite(port, &device, [](void* context, u32, u32 word, MappedBusSignals) {
			static_cast<Device*>(context)->writes.push_back(word);
		});
		machine.memory.mapIoWriteReady(port, [](void* context, u32, MappedBusSignals) { return static_cast<Device*>(context)->ready; });
		frame.registers.set(1, valueInteger(port));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], code);
		require(cpu.runUntilDepth(0, 20) == RunResult::Halted && cpu.isMemoryWriteBlocked(), "store reaches the endpoint wait");
		const auto saved = cpu.captureRuntimeState();
		std::array<u8, INSTRUCTION_BYTES> replacement;
		writeInstruction(replacement, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
		machine.memory.writeMappedU32LE(code + 2u * INSTRUCTION_BYTES, readLE32(replacement.data()));
		cpu.restoreRuntimeState(saved);
		device.ready = true;
		cpu.resumeMemoryWrite(port);
		cpu.runUntilDepth(0, 0);
		require(device.writes.empty(), "zero grant retains the pending operation");
		cpu.requestYield();
		require(cpu.runUntilDepth(0, 1) == RunResult::Yielded && device.writes.empty(), "requested yield precedes the pending side effect");
		cpu.runUntilDepth(0, 1);
		require(device.writes == std::vector<u32>{0x12345678u} && cpu.instructionBudgetRemaining == 1 - BASE_CYCLES[static_cast<size_t>(OpCode::MOV)]
			&& cpu.readFramePc(0) == code + 4u * INSTRUCTION_BYTES,
			"ready resumes the decoded store after restore, not rewritten code or its base charge");
	}
}

void externalTakeoverFlushesOnlyTheUnacceptedStore() {
	for (const bool scalar : {false, true}) for (int takeover = 0; takeover < 4; ++takeover) {
		auto image = memoryLoop(OpCode::STORE_MEM, MemoryAccessKind::Word);
		writeInstruction(image.text, 6, static_cast<u8>(OpCode::K1), 0, 0, 0);
		writeInstruction(image.text, 7, static_cast<u8>(OpCode::RET), 0, 2, 0);
		image.functions.push_back({.firstWord = 6, .wordCount = 2, .maxStack = 1});
		writeInstruction(image.text, 8, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
		writeInstruction(image.text, 9, static_cast<u8>(OpCode::LOADK), 1, 0, 1);
		writeInstruction(image.text, 10, static_cast<u8>(OpCode::STORE_MEM), 0, 1, static_cast<u8>(MemoryAccessKind::Word));
		writeInstruction(image.text, 11, static_cast<u8>(OpCode::RET), 0, 1, 0);
		image.functions.push_back({.firstWord = 8, .wordCount = 4, .maxStack = 2});
		image.constants = {static_cast<i32>(0x87654321u), static_cast<i32>(IO_BASE + 0x5000u)};
		CpuMachine machine(image, scalar);
		auto& cpu = machine.cpu;
		auto& frame = *cpu.activeThread()->frameAtDepth(0);
		const u32 port = IO_BASE + 0x5000u;
		frame.registers.set(0, valueInteger(0x12345678u));
		frame.registers.set(1, valueInteger(DYNAMIC_RAM_BASE + 0x1000u));
		cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 2400);
		if (!scalar) test::waitForNativeEntry(cpu, *frame.decodedPage, (machine.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
		struct Device { bool ready = false; std::vector<u32> writes; } device;
		machine.memory.mapIoWrite(port, &device, [](void* context, u32, u32 value, MappedBusSignals) {
			static_cast<Device*>(context)->writes.push_back(value);
		});
		machine.memory.mapIoWriteReady(port, [](void* context, u32, MappedBusSignals) { return static_cast<Device*>(context)->ready; });
		frame.registers.set(0, valueInteger(0x12345678u)); frame.registers.set(1, valueInteger(port));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.rom.textAddress);
		require(cpu.runUntilDepth(0, 20) == RunResult::Halted && cpu.isMemoryWriteBlocked(), "store is pending before external takeover");
		if (takeover == 1 || takeover == 2) { device.ready = true; cpu.resumeMemoryWrite(port); }
		if (takeover == 2) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.rom.textAddress + 5u * INSTRUCTION_BYTES);
			cpu.runUntilDepth(0, 10);
			require(device.writes.empty(), "active-PC redirect abandons the unaccepted store");
		} else if (takeover == 3) {
			cpu.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[3]);
			cpu.runUntilDepth(1, 20);
			require(cpu.isMemoryWriteBlocked() && device.writes.empty(), "injected completion reaches its own unaccepted store");
			cpu.abortCompletionCall(1);
			device.ready = true;
			cpu.runUntilDepth(0, 6);
			require(device.writes == std::vector<u32>{0x12345678u} && cpu.getFrameDepth() == 1,
				"unwinding drops the callee wait without dropping the caller instruction");
		} else {
			cpu.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[2]);
			require(cpu.runUntilDepth(1, 10) == RunResult::Halted && cpu.getFrameDepth() == 1, "injected completion returns to the suspended frame");
			require(device.writes.empty(), "the suspended store does not execute in the injected frame");
			device.ready = true;
			cpu.runUntilDepth(0, 6);
			require(device.writes == std::vector<u32>{0x12345678u}, "original frame refetches and executes its own store exactly once");
		}
	}
}

void generatedBusOrdering() {
	constexpr u32 port = RAM_BASE + 0x5000u;
	for (const bool scalar : {false, true}) {
		CpuMachine machine(memoryLoop(OpCode::STORE_MEM, MemoryAccessKind::U16LE), scalar);
		auto& cpu = machine.cpu;
		auto& frame = *cpu.activeThread()->frameAtDepth(0);
		frame.registers.set(0, valueInteger(12)); frame.registers.set(1, valueInteger(DYNAMIC_RAM_BASE + 0x1000));
		cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 1200);
		struct Device { bool ready = false; int writes = 0; } device;
		machine.memory.mapIoWrite(port, &device, [](void* context, u32, u32, MappedBusSignals) {
			++static_cast<Device*>(context)->writes;
		});
		machine.memory.mapIoWriteReady(port, [](void* context, u32, MappedBusSignals) { return static_cast<Device*>(context)->ready; });
		frame.writeControl(bmsx::FrameField::Top, 0); frame.registers.set(1, valueInteger(port));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.rom.textAddress);
		require(cpu.runUntilDepth(0, 20) == RunResult::Halted && cpu.captureRuntimeState().memoryWriteBlocked
			&& machine.memory.readBusFaultSequence() == 0u && static_cast<bmsx::i32>(frame.readControl(bmsx::FrameField::Top)) == 5 && device.writes == 0,
			"a not-ready MMIO store blocks before width validation or any write");
		device.ready = true; cpu.resumeMemoryWrite(port);
		require(cpu.runUntilDepth(0, 20) == RunResult::Halted && machine.memory.readBusFaultSequence() == 1u && device.writes == 0,
			"the resumed U16 IO transfer faults through the ordinary owner");
	}
	for (const bool scalar : {false, true}) {
		CpuMachine machine(memoryLoop(OpCode::STORE_MEM, MemoryAccessKind::F64LE), scalar);
		auto& cpu = machine.cpu;
		auto& frame = *cpu.activeThread()->frameAtDepth(0);
		frame.registers.set(0, valueFloat(3.25f)); frame.registers.set(1, valueInteger(DYNAMIC_RAM_BASE + 0x1004));
		cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 1200);
		const u32 target = machine.memory.ramBusEnd() - 4u;
		machine.memory.writeMappedWord(target, 0xaaaaaaaau);
		frame.registers.set(1, valueInteger(target));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.rom.textAddress);
		require(cpu.runUntilDepth(0, 20) == RunResult::Halted && machine.memory.readMappedWord(target) == 0u
			&& machine.memory.readIoU32(IO_SYS_BUS_FAULT_ADDR) == target + 4u,
			"an F64 high-half fault retains its already committed low half");
	}
}

void generatedMemoryMayRetireExecutingSource() {
	for (const int grant : {5, 9}) for (const bool load : {false, true}) for (const bool scalar : {false, true}) {
		const auto image = memoryLoop(load ? OpCode::LOAD_MEM : OpCode::STORE_MEM, MemoryAccessKind::U32LE);
		CpuMachine machine(image, scalar);
		auto& cpu = machine.cpu;
		auto& frame = *cpu.activeThread()->frameAtDepth(0);
		machine.memory.writeBytes(DYNAMIC_RAM_BASE, machine.rom.bytes.data() + machine.rom.textAddress, image.text.size());
		machine.memory.writeMappedWord(DYNAMIC_RAM_BASE + 0x1000, 7);
		frame.registers.set(0, valueInteger(7)); frame.registers.set(1, valueInteger(DYNAMIC_RAM_BASE + 0x1000));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 1200);
		if (!scalar) test::waitForNativeEntry(cpu, *frame.decodedPage, 0);
		for (int visit = 0; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++visit) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], DYNAMIC_RAM_BASE + 3u * INSTRUCTION_BYTES);
			cpu.runUntilDepth(0, 2);
		}
		auto& page = *frame.decodedPage;
		if (!scalar) test::waitForNativeEntry(cpu, page, 3);
		if (!scalar) require(page.nativeBlocks && page.nativeBlocks->entries[0], "the memory loop really acquired native code");
		struct Source {
			Memory& memory;
			std::vector<u8> replacement;
			int reads = 0;
		} source{machine.memory, std::vector<u8>(INSTRUCTION_BYTES)};
		writeInstruction(source.replacement, 0, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		constexpr u32 port = RAM_BASE + 0x5000;
		if (load) machine.memory.mapIoRead(port, &source, [](void* context, u32, MappedBusSignals) -> u32 {
			auto& source = *static_cast<Source*>(context);
			++source.reads;
			source.memory.writeBytes(DYNAMIC_RAM_BASE + 2u * INSTRUCTION_BYTES, source.replacement.data(), source.replacement.size());
			return 11;
		});
		frame.writeControl(bmsx::FrameField::Top, 0);
		frame.registers.set(0, valueInteger(readLE32(source.replacement.data())));
		frame.registers.set(1, valueInteger(load ? port : DYNAMIC_RAM_BASE + 2u * INSTRUCTION_BYTES));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		require(cpu.runUntilDepth(0, grant) == RunResult::Yielded
			&& frame.readControl(bmsx::FrameField::Pc) == DYNAMIC_RAM_BASE + (grant == 5 ? 3u * INSTRUCTION_BYTES : 0u)
			&& static_cast<bmsx::i32>(frame.readControl(bmsx::FrameField::Top)) == (grant == 5 ? 5 : 7)
			&& frame.registers.get(6) == valueInteger(grant == 5 ? 7 : load ? 11 : readLE32(source.replacement.data())),
			"a retiring transfer can resume its hot continuation without returning through retired source code");
		if (!scalar) require(!page.nativeBlocks || !page.nativeBlocks->entries[0], "the current memory entry was retired");
		if (load) require(source.reads == 1 && frame.registers.get(0) == valueInteger(11), "an MMIO read may retire its source before committing its result");
		require(cpu.runUntilDepth(0, 20) == RunResult::Halted, "the rewritten instruction is fetched without returning through freed code");
	}
}

void dmaMemorySpanRetiresGeneratedCode() {
	const auto image = memoryLoop(OpCode::LOAD_MEM, MemoryAccessKind::U32LE);
	for (const bool scalar : {false, true}) {
		CpuMachine machine(image, scalar);
		auto& cpu = machine.cpu;
		auto& frame = *cpu.activeThread()->frameAtDepth(0);
		machine.memory.writeBytes(DYNAMIC_RAM_BASE, machine.rom.bytes.data() + machine.rom.textAddress, image.text.size());
		frame.registers.set(1, valueInteger(DYNAMIC_RAM_BASE + 0x1000u));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 1200);
		auto& page = *frame.decodedPage;
		if (!scalar) test::waitForNativeEntry(cpu, page, 0);
		if (!scalar) require(page.nativeBlocks && page.nativeBlocks->entries[0], "DMA test starts with a published native RAM entry");
		std::array<u8, 2u * INSTRUCTION_BYTES> replacement{};
		writeInstruction(replacement, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
		writeInstruction(replacement, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		const u32 source = DYNAMIC_RAM_BASE + 0x2000u;
		machine.memory.writeBytes(source, replacement.data(), replacement.size());
		machine.memory.transferDmaBlock(source, DYNAMIC_RAM_BASE, 2u, 4u, 4u, MAPPED_BUS_MASTER_DMA, MAPPED_BUS_MASTER_DMA);
		if (!scalar) require(!page.nativeBlocks || !page.nativeBlocks->entries[0], "DMA retires native code using the overwritten RAM words");
		frame.registers.set(0, valueInteger(0));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		require(cpu.runUntilDepth(0, 100) == RunResult::Halted && frame.registers.get(0) == valueInteger(1),
			"the next execution observes the DMA-written instructions");
	}
}

void fatalHelperErrorsLeaveTheNativeFrameBeforeUnwinding() {
	struct ReadFailure { int code; };
	for (const bool scalar : {false, true}) {
		CpuMachine machine(memoryLoop(OpCode::LOAD_MEM, MemoryAccessKind::U32LE), scalar);
		auto& cpu = machine.cpu;
		auto& frame = *cpu.activeThread()->frameAtDepth(0);
		frame.registers.set(1, valueInteger(DYNAMIC_RAM_BASE + 0x1000));
		machine.memory.writeMappedWord(DYNAMIC_RAM_BASE + 0x1000, 7);
		cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 1200);
		if (!scalar) test::waitForNativeEntry(cpu, *frame.decodedPage, (machine.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
		if (!scalar) require(frame.decodedPage->nativeBlocks->entries[(machine.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES] != nullptr,
			"the failure originates in a warmed native memory body");
		struct Port { bool fail = true; int reads = 0; } port;
		constexpr u32 address = IO_BASE + 0x5000;
		machine.memory.mapIoRead(address, &port, [](void* context, u32, MappedBusSignals) -> u32 {
			auto& port = *static_cast<Port*>(context);
			++port.reads;
			if (port.fail) throw ReadFailure{73};
			return 11;
		});
		frame.writeControl(bmsx::FrameField::Top, 0); frame.registers.set(1, valueInteger(address));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.rom.textAddress);
		bool caught = false;
		try { cpu.runUntilDepth(0, 9); }
		catch (const ReadFailure& error) { caught = error.code == 73; }
		require(caught && port.reads == 1 && frame.readControl(bmsx::FrameField::Pc) == machine.rom.textAddress + 3u * INSTRUCTION_BYTES
			&& static_cast<bmsx::i32>(frame.readControl(bmsx::FrameField::Top)) == 5 && frame.registers.get(0) == valueInteger(7) && frame.registers.get(6) == valueInteger(7)
			&& cpu.instructionBudgetRemaining == 4,
			"the actual host exception reaches a registered caller with the completed prefix, without retrying the IO read");
		port.fail = false;
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.rom.textAddress);
		require(cpu.runUntilDepth(0, 18) == RunResult::Yielded && port.reads == 3
			&& frame.registers.get(0) == valueInteger(11) && frame.registers.get(6) == valueInteger(11),
			"a later native grant uses a fresh error channel and resumes the same instruction stream");
	}
}

void changingSuccessorsDoNotRecompileStablePredecessors() {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::STORE_MEM_D), 0, 1, 3);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::K1), 6, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::BXOR), 0, 0, 4);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::ADD), 7, 6, 2);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
	writeInstruction(image.text, 8, static_cast<u8>(OpCode::K0), 6, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 8}};
	CpuMachine machine(image);
	machine.memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
	auto& frame = *machine.cpu.activeThread()->frameAtDepth(0);
	frame.registers.set(0, valueInteger(readLE32(image.text.data() + INSTRUCTION_BYTES)));
	frame.registers.set(1, valueInteger(DYNAMIC_RAM_BASE + INSTRUCTION_BYTES));
	frame.registers.set(2, valueInteger(1));
	frame.registers.set(4, valueInteger(readLE32(image.text.data() + INSTRUCTION_BYTES) ^ readLE32(image.text.data() + 8u * INSTRUCTION_BYTES)));
	for (int visit = 0; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++visit) {
		machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], DYNAMIC_RAM_BASE + 2u * INSTRUCTION_BYTES);
		machine.cpu.runUntilDepth(0, 1);
	}
	test::waitForNativeEntry(machine.cpu, *frame.decodedPage, 2);
	machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], DYNAMIC_RAM_BASE);
	machine.cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 1200);
	auto& page = *frame.decodedPage;
	require(page.nativeBlocks && !page.nativeBlocks->entries[1] && page.nativeBlocks->entries[2],
		"the continuously rewritten instruction, not its stable store predecessor, remains outside native regions");
	const auto* stable = page.nativeBlocks->entries[2].get();
	machine.cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 1200);
	require(page.nativeBlocks->entries[2].get() == stable && !page.nativeBlocks->entries[1]
		&& machine.cpu.readCauseWord() == 0u, "independent native code survives repeated source rewrites without recompilation");
}

void cachedValuesReachFieldMemoryAndFaultOwners() {
	NativeBlockRunState nativeRunState;
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::MOV), 0, 1, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::GETFIELD), 2, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::K0), 3, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::DIV), 4, 12, 13);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::SETFIELD), 0, 1, 4);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::STORE_MEM), 4, 5, static_cast<u8>(MemoryAccessKind::F64LE));
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::K1), 6, 0, 0);
	writeInstruction(image.text, 7, static_cast<u8>(OpCode::ADD), 7, 6, 2);
	writeInstruction(image.text, 8, static_cast<u8>(OpCode::MOV), 8, 0, 0);
	writeInstruction(image.text, 9, static_cast<u8>(OpCode::MOV), 9, 7, 0);
	writeInstruction(image.text, 10, static_cast<u8>(OpCode::GETFIELD), 10, 8, 1);
	writeInstruction(image.text, 11, static_cast<u8>(OpCode::MOV), 11, 10, 0);
	writeInstruction(image.text, 12, static_cast<u8>(OpCode::JMP), 0, 63, 51, 255);
	writeInstruction(image.text, 13, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 13, .maxStack = 14}, {.firstWord = 13, .wordCount = 1}};
	image.constants = {std::string("stable"), std::string("result")}; image.exceptionFunctionIndex = 1;
	constexpr u32 address = DYNAMIC_RAM_BASE + 0x1000;
	CpuMachine native(image), scalar(image, true);
	for (auto* machine : {&native, &scalar}) {
		auto table = machine->cpu.createTable(0, 2);
		table.setStringKey(machine->cpu.stringPool().intern("stable"), valueInteger(22));
		table.setStringKey(machine->cpu.stringPool().intern("result"), valueInteger(0));
		auto& frame = *machine->cpu.activeThread()->frameAtDepth(0);
		frame.registers.set(1, valueTable(table.address())); frame.registers.set(5, valueInteger(address));
		frame.registers.set(12, valueFloatBits(0x7f800000)); frame.registers.set(13, valueFloatBits(0x7f800000));
		machine->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 1200);
	}
	auto& frame = *native.cpu.activeThread()->frameAtDepth(0);
	test::waitForNativeEntry(native.cpu, *frame.decodedPage, (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) >> 2u);
	const auto& block = frame.decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) >> 2u];
	int loopCycles = 2; // Second F64LE transfer.
	for (const auto op : {OpCode::MOV, OpCode::GETFIELD, OpCode::K0, OpCode::DIV, OpCode::SETFIELD,
		OpCode::STORE_MEM, OpCode::K1, OpCode::ADD, OpCode::MOV, OpCode::MOV, OpCode::GETFIELD, OpCode::MOV, OpCode::JMP})
		loopCycles += BASE_CYCLES[static_cast<u8>(op)];
	require(block && block->sourceWords == 13, "cached values occupy one native block");
	const auto* outcome = block->run(frame.registers, nativeRunState = {.constants = frame.executionImage->constPool, .frame = &frame, .heap = &native.cpu.gcHeap(), .remainingCycles = loopCycles});
	require(outcome->nextPc == native.rom.textAddress,
		"cached table references, numbers and memory writes all reach the final native exit");
	scalar.cpu.runUntilDepth(0, loopCycles);
	require(native.memory.readMappedWord(address) == 0u && native.memory.readMappedWord(address + 4u) == 0x7ff80000u,
		"a cached arithmetic result reaches float memory in the canonical guest representation");
	for (auto* machine : {&native, &scalar}) {
		auto& current = *machine->cpu.activeThread()->frameAtDepth(0);
		require(current.registers.get(2) == valueInteger(22) && current.registers.get(7) == valueInteger(23)
			&& current.registers.get(9) == valueInteger(23) && current.registers.get(11) == valueFloatBits(0x7fc00000)
			&& current.registers.get(0) == current.registers.get(1) && current.registers.get(8) == current.registers.get(1),
			"register pressure and pure conversion calls preserve raw references, dependent values and aliases");
		current.registers.set(1, valueInteger(5)); current.writeControl(bmsx::FrameField::Top, 0);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress);
		require(machine->cpu.runUntilDepth(0, 100) == RunResult::Halted
			&& current.registers.get(0) == valueInteger(5) && current.registers.get(2) == valueInteger(22)
			&& static_cast<bmsx::i32>(current.readControl(bmsx::FrameField::Top)) == 1 && machine->cpu.readEpcWord() == machine->rom.textAddress + INSTRUCTION_BYTES,
			"a field side exit publishes the current cached tag and prefix without committing the failed destination");
	}
}

void wordProducerBoundariesMatchCompleteScalarState() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	struct Instruction { OpCode op; u8 a, b, c, ext = 0; };
	const std::array<Instruction, 19> code{{
		Instruction{OpCode::LOADK, 0, 0, 4}, {OpCode::MOV, 1, 0, 0}, {OpCode::BAND, 2, 1, 62, 7},
		{OpCode::MOV, 3, 2, 0}, {OpCode::BNOT, 4, 3, 0}, {OpCode::ADD, 2, 2, 60, 7},
		{OpCode::BXOR, 5, 2, 61, 7}, {OpCode::MOV, 2, 12, 0}, {OpCode::BAND, 6, 2, 62, 7},
		{OpCode::LOADNIL, 0, 2, 0}, {OpCode::BNOT, 7, 3, 0},
		{OpCode::LOAD_MEM, 8, 13, static_cast<u8>(MemoryAccessKind::U32LE)}, {OpCode::BNOT, 9, 8, 0},
		{OpCode::STORE_MEM, 9, 14, static_cast<u8>(MemoryAccessKind::U32LE)}, {OpCode::MOV, 10, 9, 0},
		{OpCode::JMPIF, 15, 0, 1}, {OpCode::MOV, 10, 12, 0}, {OpCode::BAND, 11, 10, 62, 7},
		{OpCode::JMP, 0, 63, 45, 255},
	}};
	for (size_t i = 0; i < code.size(); ++i) {
		const auto& op = code[i]; writeInstruction(image.text, i, static_cast<u8>(op.op), op.a, op.b, op.c, op.ext);
	}
	writeInstruction(image.text, code.size(), static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = static_cast<u32>(code.size()), .maxStack = 16},
		{.firstWord = static_cast<u32>(code.size()), .wordCount = 1}};
	image.exceptionFunctionIndex = 1;
	for (const auto& constant : {Blua32EncodedConstant{i32{-1}}, Blua32EncodedConstant{Blua32FloatConstant{0x40400000u}}}) {
		image.constants = {INT32_MIN, i32{-1}, i32{0}, i32{7}, constant};
		CpuMachine native(image), scalar(image, true);
		constexpr u32 inputAddress = DYNAMIC_RAM_BASE + 0x1000, outputAddress = inputAddress + 4;
		for (auto* machine : {&native, &scalar}) {
			auto& frame = *machine->cpu.activeThread()->currentFrame;
			frame.registers.set(12, valueInteger(5)); frame.registers.set(13, valueInteger(inputAddress));
			frame.registers.set(14, valueInteger(outputAddress)); frame.registers.set(15, valueBool(true));
			machine->memory.writeMappedWord(inputAddress, 0x80000000u);
		}
		test::runCpuParity(native.cpu, scalar.cpu, NATIVE_WARM_SCALE * 2048);
		auto* page = native.cpu.activeThread()->currentFrame->decodedPage;
		test::waitForNativeEntry(native.cpu, *page, (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
		require(page->nativeBlocks && page->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES],
			"the word producer/consumer loop is genuinely compiled before boundary mutations");
		for (const auto incoming : {valueInteger(5), valueInteger(INT32_MAX),
			valueInteger(INT32_MIN), valueInteger(-1), valueFloat(-1.f), valueFloat(0.f), valueFloat(16777216.f)})
		for (const u32 entry : {0u, 3u, 8u, 12u, 14u, 17u}) for (const int grant : {1, 2, 19, 67}) {
			for (auto* machine : {&native, &scalar}) {
				machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0],
					machine->rom.textAddress + entry * INSTRUCTION_BYTES);
				auto& frame = *machine->cpu.activeThread()->currentFrame;
				for (int i = 0; i < 13; ++i) frame.registers.set(i, incoming);
				frame.registers.set(15, valueBool((grant & 1) != 0)); frame.writeControl(bmsx::FrameField::Top, 0);
				machine->memory.writeMappedWord(inputAddress, (entry & 1) == 0 ? 0xffffffffu : 0x80000000u);
			}
			test::runCpuParity(native.cpu, scalar.cpu, grant);
			const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
			require((a == b && bmsx::test::sameLanguageRam(native.cpu, scalar.cpu)) && native.cpu.lastPc == scalar.cpu.lastPc
				&& std::memcmp(native.memory.ramData(), scalar.memory.ramData(), native.memory.ramByteCount()) == 0,
				"constants, signed chains, full U32 loads, overwrites, diamond/backedges and arbitrary continuation entries match complete scalar state");
		}
		// Enter with a previously valid integer chain, then overwrite its producer
		// with a nonintegral Float before BAND. No stale word fact may survive MOV.
		for (auto* machine : {&native, &scalar}) {
			auto& cpu = machine->cpu;
			auto& frame = *cpu.activeThread()->currentFrame;
			frame.registers.set(2, valueInteger(5)); frame.registers.set(6, valueInteger(99));
			frame.registers.set(12, valueFloat(-1.75f));
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0],
				machine->rom.textAddress + 7 * INSTRUCTION_BYTES);
		}
		test::runCpuParity(native.cpu, scalar.cpu, BASE_CYCLES[static_cast<u8>(OpCode::MOV)] + 1);
		for (auto* machine : {&native, &scalar}) {
			const auto& r = machine->cpu.activeThread()->frameAtDepth(0)->registers;
			require(machine->cpu.readEpcWord() == machine->rom.textAddress + 8 * INSTRUCTION_BYTES
				&& machine->cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INVALID_ARGUMENT
				&& r.get(2) == valueFloat(-1.75f) && r.get(6) == valueInteger(99),
				"a faulting word operation keeps its old destination after the preceding MOV commits");
		}
	}
}

} // namespace

int main() {
	try {
		ramScalarDatapathsAndGuards();
		coldExitsPreserveAddressOperands();
		generatedMemoryBoundaries();
		wideTransfersRespectThePublicRamBoundary();
		generatedBusOrdering();
		resumedStoreRetainsDecodedOperation();
		externalTakeoverFlushesOnlyTheUnacceptedStore();
		generatedMemoryMayRetireExecutingSource();
		dmaMemorySpanRetiresGeneratedCode();
		fatalHelperErrorsLeaveTheNativeFrameBeforeUnwinding();
		changingSuccessorsDoNotRecompileStablePredecessors();
		cachedValuesReachFieldMemoryAndFaultOwners();
		wordProducerBoundariesMatchCompleteScalarState();
		std::cout << "Compiled CPU memory tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
