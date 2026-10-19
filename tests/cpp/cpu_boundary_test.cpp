#include "common/endian.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/execution_image.h"
#include "machine/devices/irq/controller.h"
#include "machine/execution_address_space.h"
#include "machine/memory/memory.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/opcode.h"
#include "spec/bmsx/model.h"
#include "spec/bmsx/rom_header.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"

#include <iostream>
#include <limits>
#include <stdexcept>

namespace {
using namespace bmsx;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

test::Blua32TestImage returnImage(OpCode op = OpCode::RET, u8 a = 0, u8 b = 1, u8 c = 0) {
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

	explicit CpuMachine(test::Blua32TestImage image)
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image))
		, memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes)
		, irq(memory), executionAddressSpace(memory), cpu(memory, irq, executionAddressSpace) {
		cpu.reset();
	}
};

void loadKrIndices() {
	const f64 infinity = std::numeric_limits<f64>::infinity();
	const f64 nan = std::numeric_limits<f64>::quiet_NaN();
	for (const auto [input, expected] : {std::pair{0.0, 11.0}, {1.9, 29.0}, {4294967296.0, 11.0}, {nan, 11.0}, {infinity, 11.0}, {-infinity, 11.0}, {-0.0, 11.0}}) {
		CpuMachine machine(returnImage(OpCode::LOADKR, 0, 0, 0));
		machine.cpu.activeThread()->frames[0]->registers[0] = valueNumber(input);
		machine.cpu.runUntilDepth(0, 1);
		require(asNumber(machine.cpu.readFrameRegister(0, 0)) == expected, "LOADKR word conversion");
	}
	for (const f64 input : {2.0, -1.0, 4294967295.0}) {
		CpuMachine machine(returnImage(OpCode::LOADKR, 0, 0, 0));
		machine.cpu.activeThread()->frames[0]->registers[0] = valueNumber(input);
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
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::CALL), 0, 1, 1);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::RET), 0, 1, 0);
	writeInstruction(image.text, 7, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 8, static_cast<u8>(OpCode::RET), 0, 0, 0);
	writeInstruction(image.text, 9, static_cast<u8>(OpCode::RET), 0, 1, 0);
	image.functions = {{.firstWord = 0, .wordCount = 7}, {.firstWord = 7, .wordCount = 2}, {.firstWord = 9, .wordCount = 1, .maxStack = 0}};
	image.closureRelocations = {{1, 0x180}, {4, 0x1a0}};
	CpuMachine machine(image);
	auto& cpu = machine.cpu;
	require(cpu.runUntilDepth(0, 100) == RunResult::Halted, "zero-stack call finishes");
	require(isNil(cpu.readCompletionValues()[0]), "reused ordinary zero-stack frame clears its spare slot");
	cpu.activeThread()->stack[0] = valueNumber(91.0);
	cpu.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, 0x1a0);
	require(isNil(cpu.readFrameRegister(0, 0)), "completion zero-stack frame clears its spare slot");
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
				auto& frame = *cpu.activeThread()->frames[0];
				DecodedInstructionPage page(true, nullptr);
				page.refreshState.fill(0);
				frame.pc = skip ? 0xfffffff8u : 0xfffffffcu;
				frame.decodedPage = &page;
				frame.decodedPageAddress = 0xfffffc00u;
				page.words[255].width = width;
				page.words[255].op = page.words[255].dispatchOp = static_cast<u8>(OpCode::K1);
				page.words[254].width = 1;
				page.words[254].op = page.words[254].dispatchOp = static_cast<u8>(OpCode::EQ);
				cpu.runUntilDepth(0, 1);
				require(frame.pc == (width - 1u) * INSTRUCTION_BYTES, "sequential/wide/skip PC wraps to a word");
			}
		}
	}
	CpuMachine machine(returnImage());
	auto& cpu = machine.cpu;
	auto& frame = *cpu.activeThread()->frames[0];
	DecodedInstructionPage page(true, nullptr);
	page.refreshState.fill(0);
	frame.pc = 0xfffffff8u;
	frame.decodedPage = &page;
	frame.decodedPageAddress = 0xfffffc00u;
	page.words[254].width = page.words[255].width = 1;
	page.words[254].op = static_cast<u8>(OpCode::SHL);
	page.words[254].dispatchOp = static_cast<u8>(DecodedDispatchOp::FusedShlBxor);
	page.words[255].op = page.words[255].dispatchOp = static_cast<u8>(OpCode::BXOR);
	cpu.runUntilDepth(0, 2);
	require(frame.pc == 0u, "fused successor PC wraps to a word");
}

void imageTextImport() {
	auto image = returnImage(OpCode::LOADK, 0, 0, 0);
	image.text.resize(2 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::RET), 0, 1, 0);
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
	try {
		loadKrIndices(); zeroLoadNil(); reservedMemoryKinds(); zeroStackReuse();
		haltYieldPrecedence(); cachedPcWrapping(); imageTextImport(); bootAddressWrap();
		std::cout << "CPU boundary tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
