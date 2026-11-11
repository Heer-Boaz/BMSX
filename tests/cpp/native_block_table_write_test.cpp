#include "machine/cpu/native_block.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/cpu/execution_image.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"

#include <array>
#include <iostream>
#include <stdexcept>

namespace {
using namespace bmsx;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

void storesRetainNativeFrame(CPU& cpu, Memory& memory) {
	const StringId key = cpu.stringPool().intern("native write field");
	const std::array constants{valueString(key), valueFromTag(ValueTag::False, 37)};
	const std::array values{valueFromTag(ValueTag::False, 37), valueNumber(-0.0),
		VALUE_QNAN_MASK | 0x2au, valueTable(cpu.createTable()), valueString(key), valueNil()};
	for (bool generic : {false, true}) for (bool constant : {false, true}) {
		std::array<DecodedInstruction, 6> decoded{};
		std::array<NativeBlockInstruction, 6> source{};
		const std::array ops{OpCode::MOV, OpCode::MOV, OpCode::MOV,
			generic ? OpCode::SETT : OpCode::SETFIELD, OpCode::MOV, OpCode::JMP};
		for (size_t i = 0; i < ops.size(); ++i) {
			decoded[i].op = static_cast<u8>(ops[i]); decoded[i].width = 1;
			decoded[i].baseCycles = BASE_CYCLES[decoded[i].op];
			source[i] = {&decoded[i], 0x1000u + static_cast<u32>(i) * INSTRUCTION_BYTES};
		}
		decoded[0].a = 8; decoded[0].b = 3;
		decoded[1].a = 2; decoded[1].b = 4;
		decoded[2].a = 1; decoded[2].b = -1;
		decoded[3].a = 0; decoded[3].b = generic ? 1 : 0; decoded[3].c = constant ? -2 : 2;
		decoded[3].tableCacheSlot = -1;
		decoded[4].a = 9; decoded[4].b = 8;
		decoded[5].bx = 0x2000;
		size_t bytes = 0;
		auto block = NativeBlock::compile(source, constants.data(), bytes, memory, cpu.stringPool());
		std::cout << "string-store-code generic=" << generic << " constant=" << constant << " bytes=" << bytes << '\n';
		auto* parent = cpu.createTable(0, 1); parent->setStringKey(key, valueNumber(71));
		auto* meta = cpu.createTable(0, 1); meta->setStringKey(cpu.stringPool().intern("__index"), valueTable(parent));
		for (size_t n = 0; n < values.size(); ++n) {
			auto* table = cpu.createTable(0, 8); table->metatable = meta;
			// Different receiver layouts share this one prediction site.
			for (size_t prior = 0; prior < n; ++prior)
				table->setStringKey(cpu.stringPool().intern("prior_" + std::to_string(prior)), valueNumber(prior));
			for (const Value value : {values[n], valueNil(), values[n]}) {
				std::array<Value, 10> registers; registers.fill(valueNumber(73));
				registers[0] = valueTable(table); registers[3] = values[n]; registers[4] = value;
				const auto before = table->trackedHeapBytes();
				NativeBlockRunState state{.registers = registers.data(), .constants = constants.data(), .remainingCycles = 100};
				const auto* exit = block->run(state);
				require(exit == &block->terminal && exit->exit == NativeBlockExit::Continue,
					"first insert, deletion, resurrection and polymorphic updates complete in one native invocation");
				const Value expected = constant ? constants[1] : value;
				require(table->getStringKey(key) == expected, "returning stores preserve raw values");
				require(table->trackedHeapBytes() == before, "returning store never grows allocated storage");
				require(registers[8] == values[n] && registers[9] == values[n] && registers[2] == value,
					"unpublished raw references and numeric payloads survive the returning call");
				require(parent->getStringKey(key) == valueNumber(71), "writes do not redirect through inherited fields");
				require(state.remainingCycles == 100 - block->terminal.cycles, "returning stores charge one instruction");
			}
		}
		// Growth is the only table-store case which can allocate. It must still
		// leave generated code before any mutation, publishing all live roots.
		auto* empty = cpu.createTable();
		std::array<Value, 10> registers; registers.fill(valueNil());
		registers[0] = valueTable(empty); registers[3] = values[3]; registers[4] = values[3];
		NativeBlockRunState state{.registers = registers.data(), .constants = constants.data(), .remainingCycles = 100};
		const auto* exit = block->run(state);
		require(exit->exit == (generic ? NativeBlockExit::WriteIndex : NativeBlockExit::WriteField),
			"missing capacity retains the allocating semantic exit");
		require(empty->storedSlotCount() == 0 && isNil(empty->getStringKey(key)), "growth admission does not mutate the table");
		require(registers[8] == values[3] && registers[2] == values[3] && isNil(registers[9]),
			"growth publishes the prefix roots without executing the suffix");
	}
}
void boundaryLengthRetainsNativeFrame(CPU& cpu, Memory& memory) {
	std::array<DecodedInstruction, 4> decoded{};
	std::array<NativeBlockInstruction, 4> source{};
	const std::array ops{OpCode::MOV, OpCode::LEN, OpCode::MOV, OpCode::JMP};
	for (size_t i = 0; i < ops.size(); ++i) {
		decoded[i].op = static_cast<u8>(ops[i]); decoded[i].width = 1;
		decoded[i].baseCycles = BASE_CYCLES[decoded[i].op];
		source[i] = {&decoded[i], 0x1000u + static_cast<u32>(i) * INSTRUCTION_BYTES};
	}
	decoded[0].a = 6; decoded[0].b = 1;
	decoded[1].a = 0; decoded[1].b = 0;
	decoded[2].a = 5; decoded[2].b = 6;
	decoded[3].bx = 0x2000;
	size_t bytes = 0;
	auto block = NativeBlock::compile(source, nullptr, bytes, memory, cpu.stringPool());
	auto* table = cpu.createTable(0, 128);
	for (int bit = 52; bit >= 0; --bit) table->set(valueNumber(static_cast<double>(uint64_t{1} << bit)), valueBool(false));
	const Value root = valueTable(cpu.createTable());
	for (const double expected : {4503599627370496.0, 9007199254740991.0}) {
		if (expected == 9007199254740991.0) table->set(valueNumber(expected), valueBool(false));
		std::array<Value, 7> registers; registers.fill(valueNil());
		registers[0] = valueTable(table); registers[1] = root;
		NativeBlockRunState state{.registers = registers.data(), .constants = nullptr, .remainingCycles = 100};
		const auto* exit = block->run(state);
		require(exit == &block->terminal, "table LEN and its suffix stay in one native invocation");
		require(registers[0] == valueNumber(expected), "native LEN returns F64 without narrowing and supports source aliasing");
		require(registers[5] == root && registers[6] == root, "live raw references survive the nonallocating length call");
		require(state.remainingCycles == 100 - block->terminal.cycles, "length search adds no per-probe guest penalty");
	}
}
} // namespace

int main() {
	try {
		Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
		IrqController irq(memory); ExecutionAddressSpace addresses(memory); CPU cpu(memory, irq, addresses);
		storesRetainNativeFrame(cpu, memory);
		boundaryLengthRetainsNativeFrame(cpu, memory);
		std::cout << "Native string table store tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n'; return 1;
	}
}
