#include "common/endian.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/execution_address_space.h"
#include "machine/memory/memory.h"
#include "spec/blua32/builtin.h"
#include "spec/blua32/image_format.h"
#include "spec/blua32/memory_access_kind.h"
#include "spec/blua32/opcode.h"
#include "spec/bmsx/model.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/memory_map.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"

#include <algorithm>
#include <chrono>
#include <iomanip>
#include <iostream>
#include <stdexcept>
#include <string_view>

namespace {
using namespace bmsx;

enum class Workload { Registers, Tables, Builtin, Ram, Calls, CallsBacked, CallsRamRecord, CodeWrites, Fractions, Comparisons };
constexpr u32 RAM_RECORD_ADDRESS = DYNAMIC_RAM_BASE + 0x18000;

test::Blua32TestImage program(Workload workload) {
	test::Blua32TestImage image;
	image.text.resize(9u * INSTRUCTION_BYTES);
	image.functions = {{.firstWord = 0, .wordCount = 9, .maxStack = 8}};
	auto& text = image.text;
	switch (workload) {
	case Workload::Registers:
		writeInstruction(text, 0, static_cast<u8>(OpCode::MOV), 4, 0, 0);
		writeInstruction(text, 1, static_cast<u8>(OpCode::ADD), 0, 0, 1);
		writeInstruction(text, 2, static_cast<u8>(OpCode::BXOR), 5, 4, 2);
		writeInstruction(text, 3, static_cast<u8>(OpCode::BAND), 0, 0, 3);
		writeInstruction(text, 4, static_cast<u8>(OpCode::SUB), 6, 5, 1);
		writeInstruction(text, 5, static_cast<u8>(OpCode::NOT), 7, 6, 0);
		writeInstruction(text, 6, static_cast<u8>(OpCode::JMPIFNOT), 7, 63, 57, 255);
		break;
	case Workload::Tables:
		image.constants = {std::string("field")};
		writeInstruction(text, 0, static_cast<u8>(OpCode::GETFIELD), 5, 0, 0);
		writeInstruction(text, 1, static_cast<u8>(OpCode::ADD), 5, 5, 1);
		writeInstruction(text, 2, static_cast<u8>(OpCode::SETFIELD), 0, 0, 5);
		writeInstruction(text, 3, static_cast<u8>(OpCode::GETT), 6, 0, 2);
		writeInstruction(text, 4, static_cast<u8>(OpCode::SETI), 0, 1, 5);
		writeInstruction(text, 5, static_cast<u8>(OpCode::LEN), 7, 0, 0);
		writeInstruction(text, 6, static_cast<u8>(OpCode::JMP), 0, 63, 57, 255);
		break;
	case Workload::Builtin:
		writeInstruction(text, 0, static_cast<u8>(OpCode::MOV), 0, 4, 0);
		writeInstruction(text, 1, static_cast<u8>(OpCode::MOV), 1, 5, 0);
		writeInstruction(text, 2, static_cast<u8>(OpCode::MOV), 2, 6, 0);
		writeInstruction(text, 3, static_cast<u8>(OpCode::CALL), 0, encodeFixedCallArgCount(2), 1);
		writeInstruction(text, 4, static_cast<u8>(OpCode::MOV), 7, 0, 0);
		writeInstruction(text, 5, static_cast<u8>(OpCode::JMP), 0, 63, 58, 255);
		break;
	case Workload::Ram:
		writeInstruction(text, 0, static_cast<u8>(OpCode::LOAD_MEM_D), 0, 1, static_cast<u8>(MemoryAccessKind::U32LE));
		writeInstruction(text, 1, static_cast<u8>(OpCode::ADD), 0, 0, 2);
		writeInstruction(text, 2, static_cast<u8>(OpCode::STORE_MEM_D), 0, 1, static_cast<u8>(MemoryAccessKind::U32LE));
		writeInstruction(text, 3, static_cast<u8>(OpCode::BAND), 0, 0, 3);
		writeInstruction(text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
		break;
	case Workload::Calls:
	case Workload::CallsBacked:
	case Workload::CallsRamRecord:
		writeInstruction(text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
		writeInstruction(text, 2, static_cast<u8>(OpCode::MOV), 4, 0, 0);
		writeInstruction(text, 3, static_cast<u8>(OpCode::MOV), 0, 4, 0);
		writeInstruction(text, 4, static_cast<u8>(OpCode::CALL), 0, encodeFixedCallArgCount(0), 1);
		writeInstruction(text, 5, static_cast<u8>(OpCode::MOV), 6, 0, 0);
		writeInstruction(text, 6, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
		writeInstruction(text, 7, static_cast<u8>(OpCode::K1), 0, 0, 0);
		writeInstruction(text, 8, static_cast<u8>(OpCode::RET), 0, 1, 0);
		image.functions = {{.firstWord = 0, .wordCount = 7, .maxStack = 8}, {.firstWord = 7, .wordCount = 2}};
		image.closureRelocations = {{1, workload == Workload::CallsRamRecord
			? RAM_RECORD_ADDRESS : test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
		break;
	case Workload::CodeWrites:
		writeInstruction(text, 0, static_cast<u8>(OpCode::STORE_MEM_D), 0, 1, static_cast<u8>(MemoryAccessKind::U32LE));
		writeInstruction(text, 1, static_cast<u8>(OpCode::K1), 6, 0, 0);
		writeInstruction(text, 2, static_cast<u8>(OpCode::BXOR), 0, 0, 4);
		writeInstruction(text, 3, static_cast<u8>(OpCode::ADD), 7, 6, 2);
		writeInstruction(text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
		writeInstruction(text, 8, static_cast<u8>(OpCode::K0), 6, 0, 0);
		break;
	case Workload::Fractions:
		writeInstruction(text, 0, static_cast<u8>(OpCode::MOV), 4, 0, 0);
		writeInstruction(text, 1, static_cast<u8>(OpCode::ADD), 0, 0, 1);
		writeInstruction(text, 2, static_cast<u8>(OpCode::MUL), 0, 0, 2);
		writeInstruction(text, 3, static_cast<u8>(OpCode::SUB), 5, 4, 3);
		writeInstruction(text, 4, static_cast<u8>(OpCode::DIV), 6, 5, 2);
		writeInstruction(text, 5, static_cast<u8>(OpCode::JMP), 0, 63, 58, 255);
		break;
	case Workload::Comparisons:
		text.resize(12u * INSTRUCTION_BYTES);
		image.functions[0].wordCount = 12;
		writeInstruction(text, 0, static_cast<u8>(OpCode::ADD), 0, 0, 1);
		writeInstruction(text, 1, static_cast<u8>(OpCode::BAND), 0, 0, 3);
		writeInstruction(text, 2, static_cast<u8>(OpCode::LT), 0, 0, 2);
		writeInstruction(text, 3, static_cast<u8>(OpCode::JMP), 0, 0, 1);
		writeInstruction(text, 4, static_cast<u8>(OpCode::MOV), 5, 0, 0);
		writeInstruction(text, 5, static_cast<u8>(OpCode::LE), 1, 0, 2);
		writeInstruction(text, 6, static_cast<u8>(OpCode::JMP), 0, 0, 1);
		writeInstruction(text, 7, static_cast<u8>(OpCode::MOV), 6, 0, 0);
		writeInstruction(text, 8, static_cast<u8>(OpCode::EQ), 0, 0, 2);
		writeInstruction(text, 9, static_cast<u8>(OpCode::JMP), 0, 0, 1);
		writeInstruction(text, 10, static_cast<u8>(OpCode::MOV), 7, 0, 0);
		writeInstruction(text, 11, static_cast<u8>(OpCode::JMP), 0, 63, 52, 255);
		break;
	}
	return image;
}

void measure(Workload workload, const char* name, int grant, int round) {
	const auto image = program(workload);
	auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
	if (workload == Workload::CallsBacked || workload == Workload::CallsRamRecord) {
		// The same program with a fully backed final page complements the ROM-tail case.
		rom.bytes.resize((rom.bytes.size() + MAPPED_PAGE_BYTE_MASK) & ~static_cast<size_t>(MAPPED_PAGE_BYTE_MASK));
	}
	Memory memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory);
	ExecutionAddressSpace addresses(memory);
	CPU cpu(memory, irq, addresses);
	cpu.reset();
	Value* registers = cpu.activeThread()->frames[0]->registers;
	registers[0] = valueNumber(1); registers[1] = valueNumber(3);
	registers[2] = valueNumber(7); registers[3] = valueNumber(65535);
	if (workload == Workload::Tables) {
		Table* table = cpu.createTable(8, 1);
		registers[0] = valueTable(table);
		for (int index = 1; index <= 8; ++index) table->setInteger(index, valueNumber(index));
		table->setStringKey(cpu.stringPool().intern("field"), valueNumber(1));
	} else if (workload == Workload::Builtin) {
		registers[4] = cpu.createBuiltinFunction(BuiltinFunctionId::StringByte);
		registers[5] = valueString(cpu.stringPool().intern(std::string(1024, 'x')));
		registers[6] = valueNumber(1024);
	} else if (workload == Workload::Ram) {
		registers[1] = valueNumber(DYNAMIC_RAM_BASE + 0x100);
		registers[2] = valueNumber(1);
		memory.writeMappedU32LE(DYNAMIC_RAM_BASE + 0x100, 1);
	} else if (workload == Workload::CallsRamRecord) {
		memory.writeBytes(RAM_RECORD_ADDRESS, rom.bytes.data() + rom.functionAddresses[1] - SYSTEM_ROM_BASE,
			BLUA32_FUNCTION_RECORD_SIZE);
	} else if (workload == Workload::CodeWrites) {
		const u32 codeAddress = DYNAMIC_RAM_BASE + 0x1000;
		for (u32 offset = 0; offset < image.text.size(); offset += INSTRUCTION_BYTES) {
			memory.writeMappedU32LE(codeAddress + offset, readLE32(image.text.data() + offset));
		}
		registers[0] = valueNumber(readLE32(image.text.data() + INSTRUCTION_BYTES));
		registers[1] = valueNumber(codeAddress + INSTRUCTION_BYTES);
		registers[4] = valueNumber(readLE32(image.text.data() + INSTRUCTION_BYTES)
			^ readLE32(image.text.data() + 8 * INSTRUCTION_BYTES));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], codeAddress);
	} else if (workload == Workload::Fractions) {
		registers[0] = valueNumber(0.125);
		registers[1] = valueNumber(0.125);
		registers[2] = valueNumber(0.5);
		registers[3] = valueNumber(0.25);
	}
	// Keep the amount of baseline-weighted work constant when evaluating a uniform
	// instruction timing calibration. These work units are not retired instructions.
	const int cyclesPerWorkUnit = BASE_CYCLES[static_cast<size_t>(OpCode::MOV)];
	const int cycleGrant = grant * cyclesPerWorkUnit;
	const i64 measuredCycles = 2000000 * static_cast<i64>(cyclesPerWorkUnit);
	u32 codeOutcomes = 0;
	for (int warmup = 0; warmup < 64; ++warmup) {
		const auto result = cpu.runUntilDepth(0, cycleGrant);
		if (result != RunResult::Yielded || cpu.readCauseWord() != 0u) {
			std::cerr << "Invalid benchmark workload " << name << " cause=" << cpu.readCauseWord()
				<< " epc=" << cpu.readEpcWord() << " bus_address=" << memory.readIoU32(IO_SYS_BUS_FAULT_ADDR) << '\n';
			throw std::runtime_error("Benchmark must execute its workload, not an exception handler.");
		}
		if (workload == Workload::CodeWrites) {
			const double value = asNumber(cpu.readFrameRegister(0, 6));
			codeOutcomes |= value == 0 ? 1u : 0u;
			codeOutcomes |= value == 1 ? 2u : 0u;
		}
	}
	if (workload == Workload::CodeWrites && codeOutcomes != 3u) {
		throw std::runtime_error("Executable RAM writes must change both the instruction and its observed result.");
	}
	if (workload == Workload::CallsRamRecord && cpu.readFrameRegister(0, 6) != valueNumber(1)) {
		throw std::runtime_error("RAM record calls must execute the callee and return its result.");
	}
	i64 cycles = 0;
	const auto start = std::chrono::steady_clock::now();
	while (cycles < measuredCycles) {
		const int budget = static_cast<int>(std::min<i64>(cycleGrant, measuredCycles - cycles));
		if (cpu.runUntilDepth(0, budget) != RunResult::Yielded) throw std::runtime_error("Runnable CPU benchmark stopped.");
		cycles += budget - cpu.instructionBudgetRemaining;
	}
	const auto nanoseconds = std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - start).count();
	const double mhz = static_cast<double>(cycles) * 1000.0 / static_cast<double>(nanoseconds);
	std::cout << "[cpu-throughput] workload=" << name << " grant=" << cycleGrant
		<< " grant_work_units=" << grant << " round=" << round
		<< " active_cycles=" << cycles << " idle_cycles=0 wall_ms=" << static_cast<double>(nanoseconds) / 1000000.0
		<< " cycles_per_work_unit=" << cyclesPerWorkUnit
		<< " normalized_work_units=" << static_cast<double>(cycles) / cyclesPerWorkUnit
		<< " normalized_work_mhz=" << mhz / cyclesPerWorkUnit
		<< " rom_bytes=" << rom.bytes.size()
		<< " guest_mhz=" << mhz << " target_mhz=" << static_cast<double>(PSX_MACHINE_SPEC.cpuFreqHz) / 1000000.0
		<< " realtime=" << mhz * 1000000.0 / static_cast<double>(PSX_MACHINE_SPEC.cpuFreqHz)
		<< " last_pc=" << cpu.lastPc << std::endl;
}
}

int main(int argc, char** argv) {
	const bool ramRecords = argc == 2 && std::string_view(argv[1]) == "--ram-records";
	const bool comparisons = argc == 2 && std::string_view(argv[1]) == "--comparisons";
	if (argc != 1 && !ramRecords && !comparisons) throw std::runtime_error("Expected no arguments, --ram-records or --comparisons.");
	std::cout << std::fixed << std::setprecision(3);
	for (const int grant : {256, 4096}) for (int round = 0; round < 3; ++round) {
		if (ramRecords) {
			measure(Workload::CallsRamRecord, "calls-ram-record", grant, round);
			continue;
		}
		if (comparisons) {
			measure(Workload::Comparisons, "comparisons", grant, round);
			continue;
		}
		measure(Workload::Registers, "registers", grant, round);
		measure(Workload::Tables, "tables", grant, round);
		measure(Workload::Builtin, "builtin-byte", grant, round);
		measure(Workload::Ram, "ram-words", grant, round);
		measure(Workload::Calls, "calls", grant, round);
		measure(Workload::CallsBacked, "calls-backed", grant, round);
		measure(Workload::CodeWrites, "code-writes", grant, round);
		measure(Workload::Fractions, "fractions", grant, round);
	}
}
