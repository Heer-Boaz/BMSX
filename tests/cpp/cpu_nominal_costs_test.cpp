#include "machine/cpu/cpu.h"
#include "machine/cpu/decoded_instruction.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/devices/irq/controller.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/closure_fixture.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"
#include "support/managed_fixture.h"

#include <algorithm>
#include <array>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {
using namespace bmsx;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

struct Machine {
	test::Blua32TestRom rom;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;

	Machine(const test::Blua32TestImage& image, bool scalar)
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image)),
		  memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes),
		  irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		test::seedManagedFixture(cpu, addresses);
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0});
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		else cpu.prepareSystemNativeCode();
#endif
	}
};

void exactTable() {
	constexpr std::array<u8, 64> expected{
		0, 2, 2, 2, 3, 2, 2, 2,
		2, 2, 8, 2, 3, 3, 16, 16,
		2, 2, 2, 2, 32, 34, 33, 128,
		2, 2, 2, 2, 2, 2, 3, 2,
		2, 3, 2, 2, 2, 2, 2, 2,
		2, 2, 2, 8, 3, 4, 3, 32,
		16, 3, 3, 3, 2, 2, 3, 4,
		3, 4, 8, 8, 16, 16, 17, 2,
	};
	require(BASE_CYCLES == expected, "all64 literal nominal work-class prices match the adopted table");
}

void expensiveInstructionDebtAndSkip() {
	for (bool wide : {false, true}) for (const auto [op, price] : {
		std::pair{OpCode::POW, 128}, std::pair{OpCode::MOD, 34},
		std::pair{OpCode::DIV, 32}, std::pair{OpCode::FLOORDIV, 33}}) {
		test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
		if (wide) writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(image.text, wide ? 1 : 0, static_cast<u8>(op), 0, 1, 2);
		writeInstruction(image.text, wide ? 2 : 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		image.functions = {{.firstWord=0, .wordCount=wide ? 3u : 2u, .maxStack=3}};
		Machine generated(image, false), scalar(image, true);
		for (auto* m : {&generated, &scalar}) {
			auto& f = *m->cpu.activeThread()->currentFrame;
			f.registers.set(0, valueInteger(17)); f.registers.set(1, valueInteger(2)); f.registers.set(2, valueInteger(3));
		}
		require(test::runCpuParity(generated.cpu, scalar.cpu, 1) == RunResult::Yielded
			&& generated.cpu.instructionBudgetRemaining == 1 - price
			&& generated.cpu.readFramePc(0) == generated.rom.textAddress + (wide ? 8u : 4u)
			&& generated.cpu.readFrameRegister(0, 0) == (op == OpCode::POW ? valueFloat(8) : op == OpCode::DIV ? valueFloat(2.0f / 3.0f) : valueInteger(op == OpCode::MOD ? 2 : 0)),
			"one positive grant executes one complete narrow/WIDE arithmetic instruction and retains literal negative debt");
		const auto pc = generated.cpu.readFramePc(0);
		test::runCpuParity(generated.cpu, scalar.cpu, 0);
		require(generated.cpu.readFramePc(0) == pc, "zero grant cannot execute the successor of an expensive instruction");

		// EQ expects false, so equal operands skip the complete narrow/WIDE body.
		image.text.assign(MAPPED_PAGE_BYTE_SIZE, 0);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::EQ), 0, 1, 1);
		if (wide) writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(image.text, wide ? 2 : 1, static_cast<u8>(op), 0, 1, 2);
		writeInstruction(image.text, wide ? 3 : 2, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		image.functions[0].wordCount = wide ? 4 : 3;
		Machine skipped(image, false), skippedScalar(image, true);
		for (auto* m : {&skipped, &skippedScalar}) m->cpu.activeThread()->currentFrame->registers.set(0, valueInteger(17));
		require(test::runCpuParity(skipped.cpu, skippedScalar.cpu, 3) == RunResult::Halted
			&& skipped.cpu.instructionBudgetRemaining == -1 && skipped.cpu.readFrameRegister(0, 0) == valueInteger(17),
			"skipped expensive bodies add no price, including their WIDE prefix, and never write their destination");
	}
}

void middlePowAdmission() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::POW), 1, 2, 3);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::POW), 4, 2, 3);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::K1), 5, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord=0, .wordCount=5, .maxStack=6}};
	for (const int grant : {0, 1, 2, 3, 127, 128, 129, 130, 131, 257, 258, 259, 260, 261, 262}) {
		Machine generated(image, false), scalar(image, true);
		for (auto* m : {&generated, &scalar}) {
			auto r = m->cpu.activeThread()->currentFrame->registers; r.set(2, valueInteger(2)); r.set(3, valueInteger(3));
		}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		const auto* frame = generated.cpu.activeThread()->currentFrame;
		const auto* page = frame->executionImage->nativeCodeLookup->find(generated.rom.textAddress, 0);
		const auto entry = (generated.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		require(page && page->nativeBlocks->entries[entry]
			&& page->nativeBlocks->entries[entry]->admissionCycles == 260,
			"the prepared native middle-POW prefix keeps its actual260-cycle aggregate, not a truncated byte");
#endif
		test::runCpuParity(generated.cpu, scalar.cpu, grant);
		const int consumed = grant == 0 ? 0 : grant <= 2 ? 2 : grant <= 130 ? 130 : grant <= 258 ? 258 : grant <= 260 ? 260 : 262;
		require(generated.cpu.instructionBudgetRemaining == grant - consumed
			&& isNil(generated.cpu.readFrameRegister(0, 1)) == (grant <= 2)
			&& isNil(generated.cpu.readFrameRegister(0, 4)) == (grant <= 130)
			&& isNil(generated.cpu.readFrameRegister(0, 5)) == (grant <= 258),
			"partial grants never execute the next middle-POW or suffix before its positive instruction boundary");
	}
}

void reservedOpcode10ChargesBeforeDispatch() {
	for (const bool wide : {false, true}) {
		test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
		const u32 body = wide ? 1u : 0u;
		if (wide) writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(image.text, body, 0x10u, 63, 63, 63, 255);
		writeInstruction(image.text, body + 1, static_cast<u8>(OpCode::K1), 0, 0, 0);
		writeInstruction(image.text, 32, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		image.functions = {{.firstWord=0, .wordCount=body+2, .maxStack=3}, {.firstWord=32, .wordCount=1}};
		image.exceptionFunctionIndex = 1;
		Machine generated(image, false), scalar(image, true);
		for (auto* m : {&generated, &scalar}) {
			m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[1],
				m->rom.textAddress + 32 * INSTRUCTION_BYTES);
			m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
			auto regs = m->cpu.activeThread()->currentFrame->registers;
			regs.set(0, valueInteger(17)); regs.set(1, valueInteger(2)); regs.set(2, valueInteger(3));
			m->cpu.activeThread()->currentFrame->setTop(3);
		}
		const u32 before = generated.cpu.heapAllocator().occupiedBytes();
		require(test::runCpuParity(generated.cpu, scalar.cpu, 1) == RunResult::Yielded
				&& generated.cpu.instructionBudgetRemaining == 1 - 2
				&& generated.cpu.readCauseWord() == CPU_CAUSE_CODE_RESERVED_INSTRUCTION
				&& generated.cpu.readEpcWord() == generated.rom.textAddress && !generated.cpu.heapServiceActive(),
			"reserved 10H charges instruction supply and faults at the narrow or WIDE head without reading operands");
		require(generated.cpu.readFrameRegister(0, 0) == valueInteger(17)
				&& generated.cpu.readFrameRegister(0, 1) == valueInteger(2)
				&& generated.cpu.readFrameRegister(0, 2) == valueInteger(3)
				&& generated.cpu.heapAllocator().occupiedBytes() == before,
			"the reserved gate changes neither the caller window nor the arena");
	}
}

void creationAndCallWorkOnce() {
	test::Blua32TestImage image;
	image.text.assign(2 * MAPPED_PAGE_BYTE_SIZE, 0);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::KSMI), 1, 0, 7);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::CALL), 0, 2, 2);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(image.text, DECODED_PAGE_WORDS, static_cast<u8>(OpCode::RET), 0, 2, 0);
	image.functions = {{.firstWord=0, .wordCount=5, .maxStack=3}, {.firstWord=DECODED_PAGE_WORDS, .wordCount=1, .numParams=1}};
	image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	Machine call(image, false), callScalar(image, true);
	for (auto* machine : {&call, &callScalar}) {
		test::seedTestRomClosure(machine->cpu, machine->rom.functionAddresses[1]);
	}
	test::runCpuParity(call.cpu, callScalar.cpu, 1);
	require(call.cpu.instructionBudgetRemaining == -7, "a cache-hit CLOSURE pays literal8 once without another record charge");
	test::runCpuParity(call.cpu, callScalar.cpu, 2);
	test::runCpuParity(call.cpu, callScalar.cpu, 1);
	require(call.cpu.instructionBudgetRemaining == -31 && call.cpu.getFrameDepth() == 2,
		"CALL pays literal32 and no placement charge for its supplied aliased fixed argument");
	test::runCpuParity(call.cpu, callScalar.cpu, 1);
	require(call.cpu.instructionBudgetRemaining == -16 && call.cpu.getFrameDepth() == 1 && call.cpu.readFrameRegister(0, 0) == valueInteger(7),
		"RET pays literal16 plus one actual receiving slot, with no duplicate CALL or function-record charge");
}
void countedStoreReadinessAndPartialFault() {
	for (const bool displaced : {false, true}) for (const bool fault : {false, true}) {
		test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(image.text, 0, static_cast<u8>(displaced ? OpCode::STORE_MEM_WORDS_D : OpCode::STORE_MEM_WORDS), 1, 0, 5, displaced ? 1 : 0);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::K1), 7, 0, 0);
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		writeInstruction(image.text, 32, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		image.functions = {{.firstWord=0, .wordCount=3, .maxStack=8}, {.firstWord=32, .wordCount=1}};
		image.exceptionFunctionIndex = 1;
		Machine generated(image, false), scalar(image, true);
		constexpr u32 port = IO_BASE + 0x5000u;
		struct Device { Memory* memory; bool ready; bool fault; std::vector<u32> words; };
		std::array<Device, 2> devices{{{&generated.memory, fault, fault, {}}, {&scalar.memory, fault, fault, {}}}};
		size_t index = 0;
		for (auto* m : {&generated, &scalar}) {
			auto& device = devices[index++];
			for (u32 word = 0; word < 5; ++word) {
				m->memory.mapIoWrite(port + 4u * word, &device, [](void* context, u32 address, u32 value, MappedBusSignals) {
					auto& d = *static_cast<Device*>(context); d.words.push_back(value);
					if (d.fault && address == port + 8u) d.memory->writeMappedU32LE(0xdead0000u, value);
				});
				m->memory.mapIoWriteReady(port + 4u * word, [](void* context, u32, MappedBusSignals) { return static_cast<Device*>(context)->ready; });
			}
			auto registers = m->cpu.activeThread()->currentFrame->registers;
			registers.set(0, valueInteger(port - (displaced ? 4u : 0u)));
			for (int word = 0; word < 5; ++word) registers.set(1 + word, valueInteger(73 + word));
		}
		if (fault) {
			test::runCpuParity(generated.cpu, scalar.cpu, 1);
			for (const auto* m : {&generated, &scalar}) require(m->cpu.instructionBudgetRemaining == -7
				&& m->cpu.readCauseWord() == CPU_CAUSE_CODE_DATA_BUS_ERROR && m->cpu.readEpcWord() == m->rom.textAddress,
				"a partial fault retains literal3+C=8 in full before the first word, not only the three completed writes");
			for (const auto& d : devices) require(d.words == std::vector<u32>{73, 74, 75}, "partial failure preserves only the ordered completed prefix");
		} else {
			require(test::runCpuParity(generated.cpu, scalar.cpu, 1) == RunResult::Halted,
				"a not-ready counted instruction physically stalls");
			for (size_t n = 0; auto* m : {&generated, &scalar}) {
				require(m->cpu.instructionBudgetRemaining == -2 && m->cpu.readFramePc(0) == m->rom.textAddress && devices[n].words.empty(),
					"failed preflight pays only literal3 base and leaves every word uncommitted");
				devices[n++].ready = true; m->cpu.resumeMemoryWrite(port);
			}
			test::runCpuParity(generated.cpu, scalar.cpu, 1);
			for (const auto* m : {&generated, &scalar}) require(m->cpu.instructionBudgetRemaining == -4
				&& m->cpu.readFramePc(0) == m->rom.textAddress + INSTRUCTION_BYTES && isNil(m->cpu.readFrameRegister(0, 7)),
				"retained retry pays five words once, not another base or the unexecuted successor");
			for (const auto& d : devices) require(d.words == std::vector<u32>{73, 74, 75, 76, 77}, "successful retry commits every admitted word exactly once");
		}
	}
}

} // namespace

int main() {
	try {
		exactTable(); expensiveInstructionDebtAndSkip(); middlePowAdmission(); reservedOpcode10ChargesBeforeDispatch(); creationAndCallWorkOnce(); countedStoreReadinessAndPartialFault();
		std::cout << "Nominal work-class cycle tests passed\n";
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
