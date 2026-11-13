#include "common/endian.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/native_block.h"
#include "machine/cpu/table.h"
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
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image))
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
	const std::array values{valueNumber(-0.0), valueNumber(0.25), valueNumber(-1.75),
		valueNumber(4294967295.0), valueNumber(-4294967296.75), valueNumber(4294967296.25),
		valueNumber(1e100), valueNumber(-1e100), valueNumber(std::numeric_limits<double>::denorm_min()),
		valueNumber(std::numeric_limits<double>::infinity()), VALUE_QNAN_MASK,
		Value{0x7ff0000000000001ULL}, valueNil(), valueBool(false), valueBool(true), valueString(42)};
	size_t bytes = 0;
	for (int format = 0; format <= 5; ++format) for (const bool displaced : {false, true}) {
		const auto kind = static_cast<MemoryAccessKind>(format);
		const u32 width = format == 1 ? 1 : format == 2 ? 2 : format == 5 ? 8 : 4;
		DecodedInstruction store, load;
		store.op = static_cast<u8>(displaced ? OpCode::STORE_MEM_D : OpCode::STORE_MEM);
		store.a = 0; store.b = 1; store.c = format; store.disp = displaced ? 255 : 0;
		store.width = 2; store.baseCycles = 2;
		load = store; load.op = static_cast<u8>(displaced ? OpCode::LOAD_MEM_D : OpCode::LOAD_MEM); load.a = 2;
		const std::array source{NativeBlockInstruction{&store, 0x1000}, NativeBlockInstruction{&load, 0x1008}};
		auto block = NativeBlock::compile(source, nullptr, bytes, memory, cpu.stringPool());
		for (const u32 target : {DYNAMIC_RAM_BASE + 0x204u, DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE - 4u,
			RAM_BASE + PSX_MACHINE_SPEC.ramBytes - width}) for (const Value value : values) {
			std::array registers{value, valueNumber(target - static_cast<u32>(store.disp) * 4u), valueNil()};
			require(block->run(nativeRunState = {.registers = registers.data(), .constants = nullptr, .remainingCycles = block->terminal.cycles}) == &block->terminal, "ordinary RAM transfers reach the normal block exit");
			Value expected;
			switch (kind) {
				case MemoryAccessKind::Word: reference.writeMappedWord(target, toU32(value)); expected = valueNumber(reference.readMappedWord(target)); break;
				case MemoryAccessKind::U8: reference.writeMappedU8(target, static_cast<u8>(toU32(value))); expected = valueNumber(reference.readMappedU8(target)); break;
				case MemoryAccessKind::U16LE: reference.writeMappedU16LE(target, toU32(value)); expected = valueNumber(reference.readMappedU16LE(target)); break;
				case MemoryAccessKind::U32LE: reference.writeMappedU32LE(target, toU32(value)); expected = valueNumber(reference.readMappedU32LE(target)); break;
				case MemoryAccessKind::F32LE: reference.writeMappedF32LE(target, static_cast<float>(decodeNumber(value))); expected = valueNumber(reference.readMappedF32LE(target)); break;
				case MemoryAccessKind::F64LE: reference.writeMappedF64LE(target, decodeNumber(value)); expected = valueNumber(reference.readMappedF64LE(target)); break;
			}
			require(registers[2] == expected && std::memcmp(memory.ramData() + target - RAM_BASE,
				reference.ramData() + target - RAM_BASE, width) == 0, "all scalar formats preserve numeric conversion and little-endian bytes");
		}
		for (u32 address : {0u, RAM_BASE, RAM_BASE + IO_SLOT_COUNT * IO_WORD_SIZE - 1u,
			RAM_BASE + PSX_MACHINE_SPEC.ramBytes, 0xffffffffu, DYNAMIC_RAM_BASE + 1u}) {
			std::array registers{valueNumber(7), valueNumber(address - static_cast<u32>(store.disp) * 4u), valueNumber(99)};
			const bool direct = address >= RAM_BASE + IO_SLOT_COUNT * IO_WORD_SIZE
				&& address <= RAM_BASE + PSX_MACHINE_SPEC.ramBytes - width
				&& (address & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[format]) == 0u;
			const auto* exit = block->run(nativeRunState = {.registers = registers.data(), .constants = nullptr, .remainingCycles = block->terminal.cycles});
			require((exit == &block->terminal) == direct, "IO, faults and alignment leave before accessing raw RAM");
			if (!direct) require(exit->exit == NativeBlockExit::WriteMemory && registers[2] == valueNumber(99),
				"a rejected transfer never executes its following load");
		}
		load.a = load.b;
		const std::array aliasSource{NativeBlockInstruction{&load, 0x1000}};
		auto alias = NativeBlock::compile(aliasSource, nullptr, bytes, memory, cpu.stringPool());
		std::array registers{valueNil(), valueNumber(DYNAMIC_RAM_BASE + 0x204u - store.disp * 4u)};
		require(alias->run(nativeRunState = {.registers = registers.data(), .constants = nullptr, .remainingCycles = alias->terminal.cycles}) == &alias->terminal && valueIsNumber(registers[1]),
			"a memory load can replace its own address register");
	}
	// A four-byte-aligned double can cross into the next watched page.
	DecodedInstruction store;
	store.op = static_cast<u8>(OpCode::STORE_MEM); store.a = 0; store.b = 1; store.c = 5; store.width = 2; store.baseCycles = 2;
	const std::array source{NativeBlockInstruction{&store, 0x1000}};
	auto block = NativeBlock::compile(source, nullptr, bytes, memory, cpu.stringPool());
	const u32 target = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE - 4u;
	MappedPageBinding page;
	memory.bindMappedPage(target + 4u, MAPPED_BUS_MASTER_CPU, page);
	page.writeWatch.armWord(0);
	std::array registers{valueNumber(1), valueNumber(target)};
	const auto before = readLE64(memory.ramData() + target - RAM_BASE);
	const auto* exit = block->run(nativeRunState = {.registers = registers.data(), .constants = nullptr, .remainingCycles = block->terminal.cycles});
	require(exit->exit == NativeBlockExit::WriteMemory && nativeRunState.memoryAddress == target
		&& readLE64(memory.ramData() + target - RAM_BASE) == before,
		"the high half's code watch exits before either half of a direct F64 store");
	memory.clearMappedPageWriteWatches();
	DecodedInstruction load = store;
	load.op = static_cast<u8>(OpCode::LOAD_MEM); load.a = 2;
	const std::array numericSource{NativeBlockInstruction{&store, 0x1000}, NativeBlockInstruction{&load, 0x1008}};
	auto numeric = NativeBlock::compile(numericSource, nullptr, bytes, memory, cpu.stringPool());
	for (u64 header = 0; header <= 0xffffu; ++header) {
		const Value value = (header << 48u) | 0x123456789abcu;
		std::array registers{value, valueNumber(target), valueNil()};
		reference.writeMappedF64LE(target, decodeNumber(value));
		require(numeric->run(nativeRunState = {.registers = registers.data(), .constants = nullptr, .remainingCycles = numeric->terminal.cycles}) == &numeric->terminal
			&& readLE64(memory.ramData() + target - RAM_BASE) == readLE64(reference.ramData() + target - RAM_BASE)
			&& registers[2] == valueNumber(reference.readMappedF64LE(target)),
			"every raw Value header follows the central numeric classification, including signalling NaNs");
	}
	load.b = -1;
	const std::array constantSource{NativeBlockInstruction{&load, 0x1000}};
	const std::array constants{valueNumber(target)};
	auto constant = NativeBlock::compile(constantSource, constants.data(), bytes, memory, cpu.stringPool());
	std::array constantRegisters{valueNil(), valueNil(), valueNil()};
	require(constant->run(nativeRunState = {.registers = constantRegisters.data(), .constants = constants.data(), .remainingCycles = constant->terminal.cycles}) == &constant->terminal
		&& constant->sideExits[0].exitB == -1, "a constant memory address retains its signed RK selector");
}

void generatedMemoryBoundaries() {
	NativeBlockRunState nativeRunState;
	for (const auto op : {OpCode::LOAD_MEM, OpCode::LOAD_MEM_D, OpCode::STORE_MEM, OpCode::STORE_MEM_D}) {
		const bool displaced = op == OpCode::LOAD_MEM_D || op == OpCode::STORE_MEM_D;
		const auto image = memoryLoop(op, MemoryAccessKind::F64LE, displaced ? 255 : 0);
		CpuMachine native(image), scalar(image, true);
		for (auto* machine : {&native, &scalar}) {
			auto& frame = *machine->cpu.activeThread()->frameAtDepth(0);
			frame.registers[0] = valueNumber(3.25);
			frame.registers[1] = valueNumber(DYNAMIC_RAM_BASE + 0x404u - (displaced ? 1020u : 0u));
			machine->memory.writeMappedF64LE(DYNAMIC_RAM_BASE + 0x404u, 3.25);
			machine->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 1200);
		}
		auto& frame = *native.cpu.activeThread()->frameAtDepth(0);
		const auto& block = frame.decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) >> 2u];
		require(block && block->sourceWords == 5 && block->sideExits.size() == 1,
			"RAM accesses compile with their dependent instructions and branch");
		require(block->run(nativeRunState = {.registers = frame.registers, .constants = frame.executionImage->constPool.data(), .remainingCycles = BASE_CYCLES[static_cast<u8>(OpCode::K1)] + BASE_CYCLES[static_cast<u8>(op)]
				+ BASE_CYCLES[static_cast<u8>(OpCode::MOV)] + BASE_CYCLES[static_cast<u8>(OpCode::JMP)]})->nextPc == native.rom.textAddress,
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
			current.top = 0;
			current.registers[1] = valueNumber(0xfffffffc - (displaced ? 1020u : 0u));
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress);
			require(machine->cpu.runUntilDepth(0, 20) == RunResult::Halted, "a generated memory fault reaches the ordinary exception owner");
			require(machine->cpu.readEpcWord() == machine->rom.textAddress + INSTRUCTION_BYTES
				&& current.top == 5 && machine->memory.readIoU32(IO_SYS_BUS_FAULT_ADDR) == 0xfffffffcu,
				"failed memory instructions retain prefix EPC, committed register top and first fault address");
			require(current.registers[0] == valueNumber(3.25), "a fault does not publish a failed load result");
			require(machine->cpu.readCauseWord() == CPU_CAUSE_CODE_DATA_BUS_ERROR, "memory side exits preserve bus exceptions");
		}
	}

}

void coldScalarExitsCarryTheirComputedGuestAddress() {
	Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory);
	ExecutionAddressSpace addresses(memory);
	CPU cpu(memory, irq, addresses);
	for (const auto op : {OpCode::LOAD_MEM, OpCode::LOAD_MEM_D, OpCode::STORE_MEM, OpCode::STORE_MEM_D}) {
		const bool displaced = op == OpCode::LOAD_MEM_D || op == OpCode::STORE_MEM_D;
		for (const bool constant : {false, true}) for (const u32 address : {IO_BASE, 0xfffffffcu, 0xfffffffdu}) {
			DecodedInstruction instruction{};
			instruction.op = static_cast<u8>(op); instruction.a = 0; instruction.b = constant ? -1 : 1;
			instruction.c = static_cast<u8>(MemoryAccessKind::F64LE);
			instruction.disp = displaced ? 255 : 0;
			instruction.width = 1; instruction.baseCycles = BASE_CYCLES[instruction.op];
			const std::array source{NativeBlockInstruction{&instruction, 0x1000u}};
			const std::array constants{valueNumber(address - static_cast<u32>(instruction.disp) * 4u)};
			size_t bytes = 0;
			auto block = NativeBlock::compile(source, constants.data(), bytes, memory, cpu.stringPool());
			std::array registers{valueNumber(17), constants[0]};
			NativeBlockRunState state{.registers = registers.data(), .constants = constants.data(), .remainingCycles = 100};
			const auto* exit = block->run(state);
			require(exit->exit == (op == OpCode::LOAD_MEM || op == OpCode::LOAD_MEM_D
				? NativeBlockExit::ReadMemory : NativeBlockExit::WriteMemory)
				&& state.memoryAddress == address && registers[0] == valueNumber(17),
				"misaligned, MMIO and unmapped exits retain the computed raw address before side effects");
		}
	}
	const u32 watched = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE - 4u;
	MappedPageBinding page;
	memory.bindMappedPage(watched + INSTRUCTION_BYTES, MAPPED_BUS_MASTER_CPU, page);
	page.writeWatch.armWord(0);
	for (const auto op : {OpCode::STORE_MEM_WORDS, OpCode::STORE_MEM_WORDS_D}) {
		const bool displaced = op == OpCode::STORE_MEM_WORDS_D;
		for (const bool constant : {false, true}) for (const u32 address : {IO_BASE, 0xfffffffdu, watched}) {
			DecodedInstruction instruction{};
			instruction.op = static_cast<u8>(op); instruction.a = 2; instruction.b = constant ? -1 : 1;
			instruction.c = 2; instruction.disp = displaced ? 255 : 0;
			instruction.width = 1; instruction.baseCycles = BASE_CYCLES[instruction.op];
			const std::array source{NativeBlockInstruction{&instruction, 0x1000u}};
			const std::array constants{valueNumber(address - static_cast<u32>(instruction.disp) * 4u)};
			size_t bytes = 0;
			auto block = NativeBlock::compile(source, constants.data(), bytes, memory, cpu.stringPool());
			std::array registers{valueNil(), constants[0], valueNumber(11), valueNumber(12)};
			NativeBlockRunState state{.registers = registers.data(), .constants = constants.data(), .remainingCycles = 100};
			const auto* exit = block->run(state);
			require(exit->exit == NativeBlockExit::WriteWords && state.memoryAddress == address,
				"counted stores retain the raw address across bounds, alignment and watched-page exits");
		}
	}
}

void generatedBusOrdering() {
	constexpr u32 port = RAM_BASE + 0x5000u;
	for (const bool scalar : {false, true}) {
		CpuMachine machine(memoryLoop(OpCode::STORE_MEM, MemoryAccessKind::U16LE), scalar);
		auto& cpu = machine.cpu;
		auto& frame = *cpu.activeThread()->frameAtDepth(0);
		frame.registers[0] = valueNumber(12); frame.registers[1] = valueNumber(DYNAMIC_RAM_BASE + 0x1000);
		cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 1200);
		struct Device { bool ready = false; int writes = 0; } device;
		machine.memory.mapIoWrite(port, &device, [](void* context, u32, u32, MappedBusSignals) {
			++static_cast<Device*>(context)->writes;
		});
		machine.memory.mapIoWriteReady(port, [](void* context, u32, MappedBusSignals) { return static_cast<Device*>(context)->ready; });
		frame.top = 0; frame.registers[1] = valueNumber(port);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.rom.textAddress);
		require(cpu.runUntilDepth(0, 20) == RunResult::Halted && cpu.captureRuntimeState().memoryWriteBlocked
			&& machine.memory.readBusFaultSequence() == 0u && frame.top == 5 && device.writes == 0,
			"a not-ready MMIO store blocks before width validation or any write");
		device.ready = true; cpu.resumeMemoryWrite(port);
		require(cpu.runUntilDepth(0, 20) == RunResult::Halted && machine.memory.readBusFaultSequence() == 1u && device.writes == 0,
			"the resumed U16 IO transfer faults through the ordinary owner");
	}
	for (const bool scalar : {false, true}) {
		CpuMachine machine(memoryLoop(OpCode::STORE_MEM, MemoryAccessKind::F64LE), scalar);
		auto& cpu = machine.cpu;
		auto& frame = *cpu.activeThread()->frameAtDepth(0);
		frame.registers[0] = valueNumber(3.25); frame.registers[1] = valueNumber(DYNAMIC_RAM_BASE + 0x1004);
		cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 1200);
		const u32 target = RAM_BASE + PSX_MACHINE_SPEC.ramBytes - 4u;
		machine.memory.writeMappedWord(target, 0xaaaaaaaau);
		frame.registers[1] = valueNumber(target);
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
		frame.registers[0] = valueNumber(7); frame.registers[1] = valueNumber(DYNAMIC_RAM_BASE + 0x1000);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 1200);
		for (int visit = 0; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++visit) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], DYNAMIC_RAM_BASE + 3u * INSTRUCTION_BYTES);
			cpu.runUntilDepth(0, 2);
		}
		auto& page = *frame.decodedPage;
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
		frame.top = 0;
		frame.registers[0] = valueNumber(readLE32(source.replacement.data()));
		frame.registers[1] = valueNumber(load ? port : DYNAMIC_RAM_BASE + 2u * INSTRUCTION_BYTES);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		require(cpu.runUntilDepth(0, grant) == RunResult::Yielded
			&& frame.pc == DYNAMIC_RAM_BASE + (grant == 5 ? 3u * INSTRUCTION_BYTES : 0u)
			&& frame.top == (grant == 5 ? 5 : 7)
			&& frame.registers[6] == valueNumber(grant == 5 ? 7 : load ? 11 : readLE32(source.replacement.data())),
			"a retiring transfer can resume its hot continuation without returning through retired source code");
		if (!scalar) require(!page.nativeBlocks || !page.nativeBlocks->entries[0], "the current memory entry was retired");
		if (load) require(source.reads == 1 && frame.registers[0] == valueNumber(11), "an MMIO read may retire its source before committing its result");
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
		frame.registers[1] = valueNumber(DYNAMIC_RAM_BASE + 0x1000u);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 1200);
		auto& page = *frame.decodedPage;
		if (!scalar) require(page.nativeBlocks && page.nativeBlocks->entries[0], "DMA test starts with a published native RAM entry");
		std::array<u8, 2u * INSTRUCTION_BYTES> replacement{};
		writeInstruction(replacement, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
		writeInstruction(replacement, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		const u32 source = DYNAMIC_RAM_BASE + 0x2000u;
		machine.memory.writeBytes(source, replacement.data(), replacement.size());
		machine.memory.transferDmaBlock(source, DYNAMIC_RAM_BASE, 2u, 4u, 4u, MAPPED_BUS_MASTER_DMA, MAPPED_BUS_MASTER_DMA);
		if (!scalar) require(!page.nativeBlocks || !page.nativeBlocks->entries[0], "DMA retires native code using the overwritten RAM words");
		frame.registers[0] = valueNumber(0);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		require(cpu.runUntilDepth(0, 100) == RunResult::Halted && frame.registers[0] == valueNumber(1),
			"the next execution observes the DMA-written instructions");
	}
}

void fatalHelperErrorsLeaveTheNativeFrameBeforeUnwinding() {
	struct ReadFailure { int code; };
	for (const bool scalar : {false, true}) {
		CpuMachine machine(memoryLoop(OpCode::LOAD_MEM, MemoryAccessKind::U32LE), scalar);
		auto& cpu = machine.cpu;
		auto& frame = *cpu.activeThread()->frameAtDepth(0);
		frame.registers[1] = valueNumber(DYNAMIC_RAM_BASE + 0x1000);
		machine.memory.writeMappedWord(DYNAMIC_RAM_BASE + 0x1000, 7);
		cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 1200);
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
		frame.top = 0; frame.registers[1] = valueNumber(address);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.rom.textAddress);
		bool caught = false;
		try { cpu.runUntilDepth(0, 9); }
		catch (const ReadFailure& error) { caught = error.code == 73; }
		require(caught && port.reads == 1 && frame.pc == machine.rom.textAddress + 3u * INSTRUCTION_BYTES
			&& frame.top == 5 && frame.registers[0] == valueNumber(7) && frame.registers[6] == valueNumber(7)
			&& cpu.instructionBudgetRemaining == 4,
			"the actual host exception reaches a registered caller with the completed prefix, without retrying the IO read");
		port.fail = false;
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.rom.textAddress);
		require(cpu.runUntilDepth(0, 18) == RunResult::Yielded && port.reads == 3
			&& frame.registers[0] == valueNumber(11) && frame.registers[6] == valueNumber(11),
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
	frame.registers[0] = valueNumber(readLE32(image.text.data() + INSTRUCTION_BYTES));
	frame.registers[1] = valueNumber(DYNAMIC_RAM_BASE + INSTRUCTION_BYTES);
	frame.registers[2] = valueNumber(1);
	frame.registers[4] = valueNumber(readLE32(image.text.data() + INSTRUCTION_BYTES) ^ readLE32(image.text.data() + 8u * INSTRUCTION_BYTES));
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
		auto* table = machine->cpu.createTable(0, 2);
		table->setStringKey(machine->cpu.stringPool().intern("stable"), valueNumber(22));
		table->setStringKey(machine->cpu.stringPool().intern("result"), valueNumber(0));
		auto& frame = *machine->cpu.activeThread()->frameAtDepth(0);
		frame.registers[1] = valueTable(table); frame.registers[5] = valueNumber(address);
		frame.registers[12] = frame.registers[13] = valueNumber(std::numeric_limits<double>::infinity());
		machine->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 1200);
	}
	auto& frame = *native.cpu.activeThread()->frameAtDepth(0);
	const auto& block = frame.decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) >> 2u];
	int loopCycles = 0;
	for (const auto op : {OpCode::MOV, OpCode::GETFIELD, OpCode::K0, OpCode::DIV, OpCode::SETFIELD,
		OpCode::STORE_MEM, OpCode::K1, OpCode::ADD, OpCode::MOV, OpCode::MOV, OpCode::GETFIELD, OpCode::MOV, OpCode::JMP})
		loopCycles += BASE_CYCLES[static_cast<u8>(op)];
	require(block && block->sourceWords == 13 && block->run(nativeRunState = {.registers = frame.registers, .constants = frame.executionImage->constPool.data(), .remainingCycles = loopCycles})->nextPc == native.rom.textAddress,
		"cached table references, numbers and memory writes all reach the final native exit");
	scalar.cpu.runUntilDepth(0, loopCycles);
	require(native.memory.readMappedWord(address) == 0u && native.memory.readMappedWord(address + 4u) == 0x7ff80000u,
		"a cached arithmetic result reaches float memory in the canonical guest representation");
	for (auto* machine : {&native, &scalar}) {
		auto& current = *machine->cpu.activeThread()->frameAtDepth(0);
		require(current.registers[2] == valueNumber(22) && current.registers[7] == valueNumber(23)
			&& current.registers[9] == valueNumber(23) && current.registers[11] == VALUE_QNAN_MASK
			&& current.registers[0] == current.registers[1] && current.registers[8] == current.registers[1],
			"register pressure and pure conversion calls preserve raw references, dependent values and aliases");
		current.registers[1] = valueNumber(5); current.top = 0;
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress);
		require(machine->cpu.runUntilDepth(0, 100) == RunResult::Halted
			&& current.registers[0] == valueNumber(5) && current.registers[2] == valueNumber(22)
			&& current.top == 1 && machine->cpu.readEpcWord() == machine->rom.textAddress + INSTRUCTION_BYTES,
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
		{OpCode::LOADNIL, 0, 2, 0}, {OpCode::BNOT, 7, 1, 0},
		{OpCode::LOAD_MEM, 8, 13, static_cast<u8>(MemoryAccessKind::U32LE)}, {OpCode::BNOT, 9, 8, 0},
		{OpCode::STORE_MEM, 9, 14, static_cast<u8>(MemoryAccessKind::U32LE)}, {OpCode::MOV, 10, 9, 0},
		{OpCode::JMPIF, 15, 0, 1}, {OpCode::MOV, 10, 12, 0}, {OpCode::BAND, 11, 10, 62, 7},
		{OpCode::JMP, 0, 63, 45, 255},
	}};
	for (size_t i = 0; i < code.size(); ++i) {
		const auto& op = code[i]; writeInstruction(image.text, i, static_cast<u8>(op.op), op.a, op.b, op.c, op.ext);
	}
	image.functions = {{.firstWord = 0, .wordCount = static_cast<u32>(code.size()), .maxStack = 16}};
	for (const auto& constant : {Blua32EncodedConstant{4294967295.0}, Blua32EncodedConstant{std::string("word")}}) {
		image.constants = {2147483648.0, 4294967295.0, 0.0, 4294967296.75, constant};
		CpuMachine native(image), scalar(image, true);
		constexpr u32 inputAddress = DYNAMIC_RAM_BASE + 0x1000, outputAddress = inputAddress + 4;
		for (auto* machine : {&native, &scalar}) {
			auto& frame = *machine->cpu.activeThread()->currentFrame;
			frame.registers[12] = valueNumber(4294967301.0); frame.registers[13] = valueNumber(inputAddress);
			frame.registers[14] = valueNumber(outputAddress); frame.registers[15] = valueBool(true);
			machine->memory.writeMappedWord(inputAddress, 0x80000000u);
		}
		test::runCpuParity(native.cpu, scalar.cpu, NATIVE_WARM_SCALE * 2048);
		auto* page = native.cpu.activeThread()->currentFrame->decodedPage;
		require(page->nativeBlocks && page->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES],
			"the word producer/consumer loop is genuinely compiled before boundary mutations");
		for (const auto incoming : {valueNumber(4294967301.0), valueNumber(-2147483649.0),
			valueNumber(2147483648.0), valueNumber(4294967295.0), valueNumber(-1.75), VALUE_QNAN_MASK, valueNil()})
		for (const u32 entry : {0u, 3u, 8u, 12u, 14u, 17u}) for (const int grant : {1, 2, 19, 67}) {
			for (auto* machine : {&native, &scalar}) {
				machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0],
					machine->rom.textAddress + entry * INSTRUCTION_BYTES);
				auto& frame = *machine->cpu.activeThread()->currentFrame;
				for (int i = 0; i < 13; ++i) frame.registers[i] = incoming;
				frame.registers[15] = valueBool((grant & 1) != 0); frame.top = 0;
				machine->memory.writeMappedWord(inputAddress, (entry & 1) == 0 ? 0xffffffffu : 0x80000000u);
			}
			test::runCpuParity(native.cpu, scalar.cpu, grant);
			const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
			require(std::ranges::equal(a.snapshot.words(), b.snapshot.words()) && native.cpu.lastPc == scalar.cpu.lastPc
				&& std::memcmp(native.memory.ramData(), scalar.memory.ramData(), native.memory.ramByteCount()) == 0,
				"constants, signed chains, full U32 loads, overwrites, diamond/backedges and arbitrary continuation entries match complete scalar state");
		}
	}
}

} // namespace

int main() {
	try {
		ramScalarDatapathsAndGuards();
		coldScalarExitsCarryTheirComputedGuestAddress();
		generatedMemoryBoundaries();
		generatedBusOrdering();
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
