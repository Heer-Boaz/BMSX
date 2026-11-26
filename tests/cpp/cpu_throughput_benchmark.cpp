#include <unordered_set>
#include "machine/cpu/jit/runtime/block.h"
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

enum class Workload { Registers, Tables, FieldMiss, FieldHitInheritedHome, FieldHitStableSlot, FieldHitAlternatingSlot, Builtin, Ram, Calls, CallsBacked, CallsArithmetic, CallsRamRecord, CodeWrites, Fractions, Comparisons, TableChurn, TableChurnLive, Globals, Upvalues, Varargs };
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
	case Workload::FieldMiss:
		image.text.resize(4 * INSTRUCTION_BYTES);
		image.functions[0].wordCount = 4;
		image.constants = {std::string("field")};
		writeInstruction(text, 0, static_cast<u8>(OpCode::MOV), 6, 0, 0);
		writeInstruction(text, 1, static_cast<u8>(OpCode::GETFIELD), 6, 6, 0);
		writeInstruction(text, 2, static_cast<u8>(OpCode::MOV), 7, 6, 0);
		writeInstruction(text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
		break;
	case Workload::FieldHitInheritedHome:
	case Workload::FieldHitStableSlot:
	case Workload::FieldHitAlternatingSlot:
		image.text.resize(6 * INSTRUCTION_BYTES);
		image.functions[0].wordCount = 6;
		image.constants = {std::string("field")};
		writeInstruction(text, 0, static_cast<u8>(OpCode::GETFIELD), 6, 0, 0);
		writeInstruction(text, 1, static_cast<u8>(OpCode::BOR), 7, 7, 6);
		writeInstruction(text, 2, static_cast<u8>(OpCode::MOV), 2, 0, 0);
		writeInstruction(text, 3, static_cast<u8>(OpCode::MOV), 0, 1, 0);
		writeInstruction(text, 4, static_cast<u8>(OpCode::MOV), 1, 2, 0);
		writeInstruction(text, 5, static_cast<u8>(OpCode::JMP), 0, 63, 58, 255);
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
	case Workload::TableChurn:
	case Workload::TableChurnLive:
		image.constants = {std::string("field")};
		writeInstruction(text, 0, static_cast<u8>(OpCode::NEWT), 0, 1, 1);
		writeInstruction(text, 1, static_cast<u8>(OpCode::SETFIELD), 0, 0, 1);
		writeInstruction(text, 2, static_cast<u8>(OpCode::GETFIELD), 5, 0, 0);
		writeInstruction(text, 3, static_cast<u8>(OpCode::ADD), 5, 5, 2);
		writeInstruction(text, 4, static_cast<u8>(OpCode::SETI), 0, 1, 5);
		writeInstruction(text, 5, static_cast<u8>(OpCode::GETI), 6, 0, 1);
		writeInstruction(text, 6, static_cast<u8>(OpCode::JMP), 0, 63, 57, 255);
		break;
	case Workload::Builtin:
		writeInstruction(text, 0, static_cast<u8>(OpCode::MOV), 4, 0, 0);
		writeInstruction(text, 1, static_cast<u8>(OpCode::MOV), 5, 1, 0);
		writeInstruction(text, 2, static_cast<u8>(OpCode::MOV), 6, 2, 0);
		writeInstruction(text, 3, static_cast<u8>(OpCode::CALL), 4, encodeFixedValueCount(2), 2);
		writeInstruction(text, 4, static_cast<u8>(OpCode::MOV), 7, 4, 0);
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
	case Workload::CallsArithmetic:
	case Workload::CallsRamRecord: {
		const bool arithmetic = workload == Workload::CallsArithmetic;
		if (arithmetic) text.resize(41u * INSTRUCTION_BYTES);
		writeInstruction(text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
		writeInstruction(text, 2, static_cast<u8>(OpCode::MOV), 4, 0, 0);
		writeInstruction(text, 3, static_cast<u8>(OpCode::MOV), 4, 0, 0);
		writeInstruction(text, 4, static_cast<u8>(OpCode::CALL), 4, encodeFixedValueCount(0), 2);
		writeInstruction(text, 5, static_cast<u8>(OpCode::MOV), 6, 4, 0);
		writeInstruction(text, 6, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
		writeInstruction(text, 7, static_cast<u8>(OpCode::K1), 0, 0, 0);
		if (arithmetic) {
			for (u32 word = 8; word < 40; ++word) writeInstruction(text, word, static_cast<u8>(OpCode::ADD), 0, 0, 0);
		}
		writeInstruction(text, arithmetic ? 40 : 8, static_cast<u8>(OpCode::RET), 0, 2, 0);
		image.functions = {{.firstWord = 0, .wordCount = 7, .maxStack = 8}, {.firstWord = 7, .wordCount = arithmetic ? 34u : 2u}};
		image.closureRelocations = {{1, workload == Workload::CallsRamRecord
			? RAM_RECORD_ADDRESS : test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
		break;
	}
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
	case Workload::Globals:
		image.globalNames = {"value"}; image.systemGlobalNames = {"value"}; image.constants = {11};
		writeInstruction(text, 0, static_cast<u8>(OpCode::GETGL), 0, 0, 0);
		writeInstruction(text, 1, static_cast<u8>(OpCode::ADD), 0, 0, 1);
		writeInstruction(text, 2, static_cast<u8>(OpCode::SETGL), 0, 0, 0);
		writeInstruction(text, 3, static_cast<u8>(OpCode::GETSYS), 2, 0, 0);
		writeInstruction(text, 4, static_cast<u8>(OpCode::ADD), 2, 2, 3);
		writeInstruction(text, 5, static_cast<u8>(OpCode::SETSYS), 2, 0, 0);
		writeInstruction(text, 6, static_cast<u8>(OpCode::LOADKR), 4, 5, 0);
		writeInstruction(text, 7, static_cast<u8>(OpCode::LOADNIL), 6, 2, 0);
		writeInstruction(text, 8, static_cast<u8>(OpCode::JMP), 0, 63, 55, 255);
		break;
	case Workload::Upvalues:
	case Workload::Varargs: {
		const bool captures = workload == Workload::Upvalues;
		text.resize(12u * INSTRUCTION_BYTES);
		writeInstruction(text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
		writeInstruction(text, 2, static_cast<u8>(OpCode::MOV), 4, 0, 0);
		const u32 call = captures ? 3u : 6u;
		if (!captures) {
			for (u32 argument = 1; argument <= 3; ++argument) {
				writeInstruction(text, 2 + argument, static_cast<u8>(OpCode::MOV), 4 + argument, argument, 0);
			}
		}
		writeInstruction(text, call, static_cast<u8>(OpCode::CALL), 4, encodeFixedValueCount(captures ? 0 : 3), 2);
		writeInstruction(text, call + 1, static_cast<u8>(OpCode::JMP), 0, 63, captures ? 61 : 58, 255);
		const u32 callee = call + 2;
		if (captures) {
			writeInstruction(text, callee, static_cast<u8>(OpCode::K1), 1, 0, 0);
			writeInstruction(text, callee + 1, static_cast<u8>(OpCode::GETUP), 0, 0, 0);
			writeInstruction(text, callee + 2, static_cast<u8>(OpCode::ADD), 0, 0, 1);
			writeInstruction(text, callee + 3, static_cast<u8>(OpCode::SETUP), 0, 0, 0);
			writeInstruction(text, callee + 4, static_cast<u8>(OpCode::GETUP), 2, 0, 0);
			writeInstruction(text, callee + 5, static_cast<u8>(OpCode::RET), 2, 2, 0);
		} else {
			writeInstruction(text, callee, static_cast<u8>(OpCode::VARARG), 0, 6, 0);
			writeInstruction(text, callee + 1, static_cast<u8>(OpCode::VARARG), 0, 0, 0);
			writeInstruction(text, callee + 2, static_cast<u8>(OpCode::ADD), 0, 0, 1);
			writeInstruction(text, callee + 3, static_cast<u8>(OpCode::RET), 0, 2, 0);
		}
		image.functions = {{.firstWord = 0, .wordCount = call + 2, .maxStack = 8},
			{.firstWord = callee, .wordCount = captures ? 6u : 4u, .maxStack = 5, .isVararg = !captures, .staticClosure = !captures,
				.upvalues = captures ? std::vector<Blua32UpvalueRecord>{{true, 1}} : std::vector<Blua32UpvalueRecord>{}}};
		image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
		break;
	}
	}
	return image;
}

void measure(Workload workload, const char* name, int grant, int round, bool fullyBacked, int fieldNodes = 0) {
	const auto image = program(workload);
	auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
	if (fullyBacked || workload == Workload::CallsBacked || workload == Workload::CallsRamRecord) {
		// The same program with a fully backed final page complements the ROM-tail case.
		rom.bytes.resize((rom.bytes.size() + MAPPED_PAGE_BYTE_MASK) & ~static_cast<size_t>(MAPPED_PAGE_BYTE_MASK));
	}
	Memory memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory);
	ExecutionAddressSpace addresses(memory);
	CPU cpu(memory, irq, addresses);
	cpu.reset();
	ValueSpan registers = cpu.activeThread()->frameAtDepth(0)->registers;
	registers.set(0, valueInteger(1)); registers.set(1, valueInteger(3));
	registers.set(2, valueInteger(7)); registers.set(3, valueInteger(65535));
	std::optional<TableRecord> retained;
	if (workload == Workload::Globals) {
		cpu.setGlobalByKey(cpu.stringPool().intern("value"), valueInteger(1));
		cpu.setSystemGlobalByKey(cpu.stringPool().intern("value"), valueInteger(1)); registers.set(5, valueInteger(0));
	}
	if (workload == Workload::TableChurnLive) {
		retained = cpu.createTable(4096, 0);
		cpu.setGlobalByKey(cpu.stringPool().intern("retained"), valueTable(retained->address()));
		const auto field = cpu.stringPool().intern("field");
		for (int index = 1; index <= 4096; ++index) {
			auto child = cpu.createTable(1, 1);
			child.setInteger(1, valueInteger(index));
			child.setStringKey(field, valueInteger(index));
			retained->setInteger(index, valueTable(child.address()));
		}
	}
	if (workload == Workload::FieldMiss) {
		auto table = cpu.createTable(0, 64);
		registers.set(0, valueTable(table.address()));
		cpu.activeThread()->currentFrame->setTop(1);
		const auto field = cpu.stringPool().intern("field");
		const int home = table.beginStringProbe(field).node;
		for (int n = 0, added = 0; added < fieldNodes; ++n) {
			const auto key = cpu.stringPool().intern("field_" + std::to_string(n));
			if (table.beginStringProbe(key).node != home) continue;
			table.setStringKey(key, valueInteger(++added));
		}
		auto probe = table.beginStringProbe(field);
		if (table.advanceStringProbe(field, probe, 64) != static_cast<size_t>(fieldNodes) || !isNil(probe.value))
			throw std::runtime_error("Field miss must traverse the specified chain.");
		registers.set(7, valueBool(false));
	}
	const bool inherited = workload == Workload::FieldHitInheritedHome;
	const bool fieldHit = inherited || workload == Workload::FieldHitStableSlot || workload == Workload::FieldHitAlternatingSlot;
	if (fieldHit) {
		const auto field = cpu.stringPool().intern("field");
		int slots[2];
		for (int i = 0; i < 2; ++i) {
			const int capacity = inherited ? 0 : std::max(64, fieldNodes) * (i == 1 && workload == Workload::FieldHitAlternatingSlot ? 2 : 1);
			auto table = cpu.createTable(0, capacity);
			registers.set(i, valueTable(table.address()));
			cpu.activeThread()->currentFrame->setTop(i + 1);
			if (inherited) {
				auto meta = cpu.createTable(0, 1);
				table.setMetatableAddress(meta.address());
				auto parent = cpu.createTable(0, 1);
				meta.setStringKey(cpu.stringPool().intern("__index"), valueTable(parent.address()));
				parent.setStringKey(field, valueInteger(i + 1));
				continue;
			}
			const auto home = table.beginStringProbe(field).node;
			// Insert the field as the first displaced node. Each subsequent
			// collision is inserted after home, leaving the field at the tail.
			for (int n = 0, added = 0; added < fieldNodes;) {
				if (added == 1) {
					slots[i] = table.setStringKey(field, valueInteger(i + 1));
				} else if (fieldNodes > 64) {
					// Arbitrary Integer and String keys share the hash. Construct
					// deep mixed-key chains without interning a large scratch pool.
					const auto key = valueInteger(n++);
					if ((hashCanonicalTableKey(key) & (capacity - 1u)) != static_cast<u32>(home)) continue;
					table.set(key, valueBool(false));
				} else {
					const auto key = cpu.stringPool().intern("field_" + std::to_string(n++));
					if (table.beginStringProbe(key).node != home) continue;
					table.setStringKey(key, valueBool(false));
				}
				++added;
			}
			auto probe = table.beginStringProbe(field);
			if (table.advanceStringProbe(field, probe, table.hashSlots()) != static_cast<size_t>(fieldNodes)
				|| probe.value != valueInteger(i + 1)) throw std::runtime_error("Expected the field at the specified depth.");
		}
		if (!inherited && ((slots[0] == slots[1]) != (workload == Workload::FieldHitStableSlot)))
			throw std::runtime_error("Unexpected aliasing of predicted field slots.");
		registers.set(7, valueInteger(0));
		cpu.activeThread()->currentFrame->setTop(8);
	}
	if (workload == Workload::Tables) {
		TableRecord table = cpu.createTable(8, 1);
		registers.set(0, valueTable(table.address()));
		for (int index = 1; index <= 8; ++index) table.setInteger(index, valueInteger(index));
		table.setStringKey(cpu.stringPool().intern("field"), valueInteger(1));
	} else if (workload == Workload::Builtin) {
		registers.set(0, cpu.createBuiltinFunction(BuiltinFunctionId::StringByte));
		registers.set(1, valueString(cpu.stringPool().intern(std::string(1024, 'x'))));
		registers.set(2, valueInteger(1024));
	} else if (workload == Workload::Ram) {
		registers.set(1, valueInteger(DYNAMIC_RAM_BASE + 0x100));
		registers.set(2, valueInteger(1));
		memory.writeMappedU32LE(DYNAMIC_RAM_BASE + 0x100, 1);
	} else if (workload == Workload::CallsRamRecord) {
		memory.writeBytes(RAM_RECORD_ADDRESS, rom.bytes.data() + rom.functionAddresses[1] - SYSTEM_ROM_BASE,
			BLUA32_FUNCTION_RECORD_SIZE);
	} else if (workload == Workload::CodeWrites) {
		const u32 codeAddress = DYNAMIC_RAM_BASE + 0x1000;
		for (u32 offset = 0; offset < image.text.size(); offset += INSTRUCTION_BYTES) {
			memory.writeMappedU32LE(codeAddress + offset, readLE32(image.text.data() + offset));
		}
		registers.set(0, valueInteger(readLE32(image.text.data() + INSTRUCTION_BYTES)));
		registers.set(1, valueInteger(codeAddress + INSTRUCTION_BYTES));
		registers.set(4, valueInteger(readLE32(image.text.data() + INSTRUCTION_BYTES)
			^ readLE32(image.text.data() + 8 * INSTRUCTION_BYTES)));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], codeAddress);
	} else if (workload == Workload::Fractions) {
		registers.set(0, valueFloat(0.125));
		registers.set(1, valueFloat(0.125));
		registers.set(2, valueFloat(0.5));
		registers.set(3, valueFloat(0.25));
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
			const Value value = cpu.readFrameRegister(0, 6);
			codeOutcomes |= value == valueInteger(0) ? 1u : 0u;
			codeOutcomes |= value == valueInteger(1) ? 2u : 0u;
		}
	}
	if (fieldHit && cpu.readFrameRegister(0, 7) != valueInteger(3))
		throw std::runtime_error("The same field read must have observed both receiver values.");
	if (workload == Workload::FieldMiss && !isNil(cpu.readFrameRegister(0, 7)))
		throw std::runtime_error("The field miss loop must have published its nil result.");
	if (workload == Workload::CodeWrites && codeOutcomes != 3u) {
		throw std::runtime_error("Executable RAM writes must change both the instruction and its observed result.");
	}
	if (workload == Workload::CallsRamRecord && cpu.readFrameRegister(0, 6) != valueInteger(1)) {
		throw std::runtime_error("RAM record calls must execute the callee and return its result.");
	}
	if (workload == Workload::CallsArithmetic && cpu.readFrameRegister(0, 6) != valueInteger(0)) {
		throw std::runtime_error("Arithmetic calls must execute the complete callee body and return its result.");
	}
	if (workload == Workload::Globals && (cpu.readFrameRegister(0, 4) != valueInteger(11)
		|| cpu.readFrameRegister(0, 6) != valueNil() || cpu.readFrameRegister(0, 7) != valueNil())) {
		throw std::runtime_error("Context workloads must perform dynamic constant reads and range fills.");
	}
	if ((workload == Workload::TableChurn || workload == Workload::TableChurnLive)
		&& cpu.readFrameRegister(0, 6) != valueInteger(10)) {
		throw std::runtime_error("Allocation workload must populate and read its new tables.");
	}
	i64 cycles = 0;
	const auto start = std::chrono::steady_clock::now();
	while (cycles < measuredCycles) {
		const int budget = static_cast<int>(std::min<i64>(cycleGrant, measuredCycles - cycles));
		if (cpu.runUntilDepth(0, budget) != RunResult::Yielded) throw std::runtime_error("Runnable CPU benchmark stopped.");
		cycles += budget - cpu.instructionBudgetRemaining;
	}
	const auto nanoseconds = std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - start).count();
	if (retained) {
		for (int index = 1; index <= 4096; ++index) {
			if (asTable(retained->getInteger(index), cpu.gcHeap()).getInteger(1) != valueInteger(index)) {
				throw std::runtime_error("Collection must preserve the entire retained graph.");
			}
		}
	}
	const double mhz = static_cast<double>(cycles) * 1000.0 / static_cast<double>(nanoseconds);
	size_t nativeBlocks = 0;
	size_t nativeCodeBytes = 0;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	bool arithmeticReturn = false;
	for (const auto& decodedEntry : cpu.activeThread()->frameAtDepth(0)->executionImage->decodedPages.entries()) {
		auto& page = decodedEntry->page;
		if (!page.nativeBlocks) continue;
		std::unordered_set<const NativeCodeRegion*> codeRegions;
		for (const auto& block : page.nativeBlocks->entries) {
			if (!block) continue;
			++nativeBlocks;
			if (codeRegions.insert(block->region.get()).second) nativeCodeBytes += block->region->codeBytes;
			arithmeticReturn |= block->terminal.exit == NativeBlockExit::Return && block->sourceWords == 34u;
		}
	}
	if (fullyBacked && (workload == Workload::Registers || workload == Workload::Fractions)
		&& nativeBlocks == 0) throw std::runtime_error("Backed arithmetic benchmarks must exercise native code.");
	if (fullyBacked && workload == Workload::CallsArithmetic && !arithmeticReturn) {
		throw std::runtime_error("Arithmetic calls must compile the full callee, not only the caller.");
	}
#endif
	std::cout << "[cpu-throughput] workload=" << name << " grant=" << cycleGrant
		<< " grant_work_units=" << grant << " round=" << round
		<< " active_cycles=" << cycles << " idle_cycles=0 wall_ms=" << static_cast<double>(nanoseconds) / 1000000.0
		<< " cycles_per_work_unit=" << cyclesPerWorkUnit
		<< " normalized_work_units=" << static_cast<double>(cycles) / cyclesPerWorkUnit
		<< " normalized_work_mhz=" << mhz / cyclesPerWorkUnit
		<< " rom_bytes=" << rom.bytes.size()
		<< " guest_mhz=" << mhz << " target_mhz=" << static_cast<double>(PSX_MACHINE_SPEC.cpuFreqHz) / 1000000.0
		<< " realtime=" << mhz * 1000000.0 / static_cast<double>(PSX_MACHINE_SPEC.cpuFreqHz)
		<< " last_pc=" << cpu.lastPc << " fully_backed=" << fullyBacked
		<< " native_blocks=" << nativeBlocks << " native_code_bytes=" << nativeCodeBytes << std::endl;
}
}

int main(int argc, char** argv) {
	bool fieldMisses = false, fieldHits = false, ramRecords = false, comparisons = false, allocations = false, fullyBacked = false, context = false;
	for (int argument = 1; argument < argc; ++argument) {
		const std::string_view option(argv[argument]);
		if (option == "--field-misses") fieldMisses = true;
		else if (option == "--field-hits") fieldHits = true;
		else if (option == "--ram-records") ramRecords = true;
		else if (option == "--comparisons") comparisons = true;
		else if (option == "--allocations") allocations = true;
		else if (option == "--fully-backed") fullyBacked = true;
		else if (option == "--context") context = true;
		else throw std::runtime_error("Expected --field-hits, --field-misses, --ram-records, --comparisons, --allocations, --context or --fully-backed.");
	}
	std::cout << std::fixed << std::setprecision(3);
	for (const int grant : {256, 4096}) for (int round = 0; round < 3; ++round) {
		if (fieldHits) {
			measure(Workload::FieldHitInheritedHome, "field-hit-inherited-home", grant, round, fullyBacked);
			measure(Workload::FieldHitStableSlot, "field-hit-stable-64", grant, round, fullyBacked, 64);
			measure(Workload::FieldHitAlternatingSlot, "field-hit-alternating-16", grant, round, fullyBacked, 16);
			measure(Workload::FieldHitAlternatingSlot, "field-hit-alternating-64", grant, round, fullyBacked, 64);
			measure(Workload::FieldHitAlternatingSlot, "field-hit-alternating-256", grant, round, fullyBacked, 256);
			continue;
		}
		if (fieldMisses) {
			measure(Workload::FieldMiss, "field-miss-1", grant, round, fullyBacked, 1);
			measure(Workload::FieldMiss, "field-miss-16", grant, round, fullyBacked, 16);
			measure(Workload::FieldMiss, "field-miss-64", grant, round, fullyBacked, 64);
			continue;
		}
		if (context) {
			measure(Workload::Globals, "globals", grant, round, fullyBacked);
			measure(Workload::Upvalues, "upvalues", grant, round, fullyBacked);
			measure(Workload::Varargs, "varargs", grant, round, fullyBacked);
			continue;
		}
		if (ramRecords) {
			measure(Workload::CallsRamRecord, "calls-ram-record", grant, round, fullyBacked);
			continue;
		}
		if (comparisons) {
			measure(Workload::Comparisons, "comparisons", grant, round, fullyBacked);
			continue;
		}
		if (allocations) {
			measure(Workload::TableChurn, "table-churn", grant, round, fullyBacked);
			measure(Workload::TableChurnLive, "table-churn-live", grant, round, fullyBacked);
			continue;
		}
		measure(Workload::Registers, "registers", grant, round, fullyBacked);
		measure(Workload::Tables, "tables", grant, round, fullyBacked);
		measure(Workload::Builtin, "builtin-byte", grant, round, fullyBacked);
		measure(Workload::Ram, "ram-words", grant, round, fullyBacked);
		measure(Workload::Calls, "calls", grant, round, fullyBacked);
		measure(Workload::CallsBacked, "calls-backed", grant, round, fullyBacked);
		measure(Workload::CallsArithmetic, "calls-arithmetic", grant, round, fullyBacked);
		measure(Workload::CodeWrites, "code-writes", grant, round, fullyBacked);
		measure(Workload::Fractions, "fractions", grant, round, fullyBacked);
	}
}
