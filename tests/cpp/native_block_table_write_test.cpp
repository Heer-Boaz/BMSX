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

void readsRetainNativeFrame(CPU& cpu, Memory& memory) {
	const auto key = cpu.stringPool().intern("native read field");
	const auto indexKey = cpu.stringPool().intern("__index");
	const auto other = cpu.stringPool().intern("other read field");
	const std::array constants{valueString(key)};
	const std::array values{valueFromTag(ValueTag::False, 37), valueNumber(-0.0),
		VALUE_QNAN_MASK | 0x2au, valueTable(cpu.createTable()), valueString(other), valueNil()};
	for (const auto op : {OpCode::GETFIELD, OpCode::SELF, OpCode::GETT}) for (bool alias : {false, true}) {
		std::array<DecodedInstruction, 7> decoded{};
		std::array<NativeBlockInstruction, 7> source{};
		const std::array ops{OpCode::MOV, OpCode::MOV, OpCode::MOV, op, OpCode::MOV, OpCode::MOV, OpCode::JMP};
		for (size_t i = 0; i < ops.size(); ++i) {
			decoded[i].op = static_cast<u8>(ops[i]); decoded[i].width = 1;
			decoded[i].baseCycles = BASE_CYCLES[decoded[i].op];
			source[i] = {&decoded[i], 0x1000u + static_cast<u32>(i) * INSTRUCTION_BYTES};
		}
		decoded[0].a = 8; decoded[0].b = 3;
		decoded[1].a = 2; decoded[1].b = 4;
		decoded[2].a = 1; decoded[2].b = 5;
		const int destination = alias ? (op == OpCode::GETT ? 1 : 0) : 6;
		decoded[3].a = destination; decoded[3].b = 0; decoded[3].c = op == OpCode::GETT ? 1 : 0;
		decoded[3].tableCacheSlot = -1;
		decoded[4].a = 9; decoded[4].b = 8;
		decoded[5].a = 10; decoded[5].b = 2;
		decoded[6].bx = 0x2000u;
		size_t bytes = 0;
		auto block = NativeBlock::compile(source, constants.data(), bytes, memory, cpu.stringPool(), indexKey);
		auto* table = cpu.createTable(0, 8);
		auto* parent = cpu.createTable(0, 1);
		auto* meta = cpu.createTable(0, 1);
		meta->setStringKey(indexKey, valueTable(parent)); table->metatable = meta;
		for (const Value value : values) for (const int prediction : {-1, 100000}) {
			parent->setStringKey(key, value);
			block->sideExits[0].tableCacheSlot = prediction;
			std::array<Value, 11> registers; registers.fill(valueNumber(73));
			registers[0] = valueTable(table); registers[3] = values[3];
			registers[4] = values[0]; registers[5] = valueString(key);
			const auto heap = cpu.luaHeap().captureState();
			NativeBlockRunState state{.registers = registers.data(), .constants = constants.data(), .remainingCycles = 100};
			const auto* exit = block->run(state);
			require(exit == &block->terminal && exit->exit == NativeBlockExit::Continue,
				"inherited and missing string reads execute their suffix within one stable native gate invocation");
			require(registers[destination] == value && registers[8] == values[3] && registers[9] == values[3]
				&& registers[2] == values[0] && registers[10] == values[0],
				"aliased destinations and all cached raw Values survive the returning table-read leaf");
			if (op == OpCode::SELF) require(registers[destination + 1] == valueTable(table), "SELF retains its receiver before the read");
			require(cpu.luaHeap().usedBytes() == heap.trackedBytes
				&& cpu.luaHeap().captureState().nextCollectionBytes == heap.nextCollectionBytes,
				"read resolution changes neither tracked allocation nor collection thresholds");
			require(state.remainingCycles == 100 - block->terminal.cycles - 4, "one additional inherited target Table adds4 cycles independently of slot prediction");
		}
		for (int mutation = 0; mutation < 4; ++mutation) {
			if (mutation == 0) table->setStringKey(key, values[0]);
			if (mutation == 1) {
				for (int i = 0; i != 64; ++i) table->setStringKey(cpu.stringPool().intern("read_rehash_" + std::to_string(i)), valueNumber(i));
			}
			if (mutation == 2) { table->setStringKey(key, valueNil()); parent->setStringKey(key, valueNumber(91)); }
			if (mutation == 3) { meta->setStringKey(indexKey, valueBool(false)); }
			std::array<Value, 11> registers; registers.fill(valueNil());
			registers[0] = valueTable(table); registers[5] = valueString(key);
			NativeBlockRunState state{.registers = registers.data(), .constants = constants.data(), .remainingCycles = 100};
			require(block->run(state) == &block->terminal, "rehash, deletion and live metatable changes retain the native continuation");
			const auto expected = mutation < 2 ? values[0] : mutation == 2 ? valueNumber(91) : valueNil();
			require(registers[destination] == expected, "predictions validate current raw keys and never retain a stale inherited Value");
		}
		// A real bounded-chain error still takes the precise semantic side exit.
		meta->setStringKey(indexKey, valueTable(table));
		std::array<Value, 11> registers; registers.fill(valueNumber(73));
		registers[0] = valueTable(table); registers[5] = valueString(key);
		NativeBlockRunState state{.registers = registers.data(), .constants = constants.data(), .remainingCycles = 100};
		const auto* exit = block->run(state);
		require(exit->exit == (op == OpCode::GETT ? NativeBlockExit::ReadIndex : NativeBlockExit::ReadField)
			&& exit->currentPc == 0x100cu && registers[destination] == (destination == 0 ? valueTable(table) : destination == 1 ? valueString(key) : valueNumber(73)),
			"chain exhaustion publishes the exact prefix without committing the read destination or suffix");
		if (op == OpCode::SELF) require(registers[destination + 1] == valueTable(table), "failed SELF keeps the preceding receiver copy");
		registers[0] = valueString(key);
		require(block->run(state) == exit, "string receivers retain the existing typed semantic path");
	}
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
		auto block = NativeBlock::compile(source, constants.data(), bytes, memory, cpu.stringPool(), cpu.stringPool().intern("__index"));
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
	auto block = NativeBlock::compile(source, nullptr, bytes, memory, cpu.stringPool(), cpu.stringPool().intern("__index"));
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

void guardedTableFactsFollowRegisterDefinitions(CPU& cpu, Memory& memory) {
	for (const bool alias : {false, true}) {
		std::array<DecodedInstruction, 6> decoded{};
		std::array<NativeBlockInstruction, 6> source{};
		const std::array ops{OpCode::MOV, OpCode::GETI, OpCode::GETI, OpCode::MOV, OpCode::GETI, OpCode::JMP};
		for (size_t i = 0; i < ops.size(); ++i) {
			decoded[i].op = static_cast<u8>(ops[i]);
			decoded[i].width = 1;
			decoded[i].baseCycles = BASE_CYCLES[decoded[i].op];
			source[i] = {&decoded[i], 0x3000u + static_cast<u32>(i) * INSTRUCTION_BYTES};
		}
		decoded[0].a = 0; decoded[0].b = 1;
		decoded[1].a = alias ? 0 : 2; decoded[1].b = 0; decoded[1].c = 1;
		decoded[2].a = 3; decoded[2].b = 0; decoded[2].c = 1;
		decoded[3].a = 0; decoded[3].b = 4;
		decoded[4].a = 5; decoded[4].b = 0; decoded[4].c = 1;
		decoded[5].bx = 0x4000u;
		size_t bytes = 0;
		auto block = NativeBlock::compile(source, nullptr, bytes, memory, cpu.stringPool(), cpu.stringPool().intern("__index"));
		auto* table = cpu.createTable(2);
		table->setInteger(1, valueNumber(23));
		for (const Value first : {valueTable(table), valueNil()}) for (const Value next : {valueTable(table), valueNil()}) {
			std::array<Value, 6> registers; registers.fill(valueNil());
			registers[1] = first; registers[4] = next;
			NativeBlockRunState state{.registers = registers.data(), .remainingCycles = 100};
			const auto* exit = block->run(state);
			if (isNil(first)) {
				require(exit->exit == NativeBlockExit::ReadInteger && exit->currentPc == 0x3004u,
					"the first access still guards a dynamic receiver");
			} else if (alias) {
				require(exit->exit == NativeBlockExit::ReadInteger && exit->currentPc == 0x3008u,
					"an aliased destination invalidates the table fact before the next access");
			} else if (isNil(next)) {
				require(exit->exit == NativeBlockExit::ReadInteger && exit->currentPc == 0x3010u,
					"overwriting a guarded receiver requires a new guard");
				require(registers[2] == valueNumber(23) && registers[3] == valueNumber(23),
					"both preceding accesses retained their values before the later fault");
			} else {
				require(exit == &block->terminal && registers[2] == valueNumber(23)
					&& registers[3] == valueNumber(23) && registers[5] == valueNumber(23),
					"repeated guarded accesses preserve values without leaving the native body");
			}
		}
	}
}

void tableFactsAreValidatedAtIndependentRegionEntries(CPU& cpu, Memory& memory) {
	std::array<DecodedInstruction, 9> decoded{};
	std::array<NativeBlockInstruction, 9> instructions{};
	const std::array ops{OpCode::MOV, OpCode::GETI, OpCode::K1, OpCode::GETI, OpCode::JMP,
		OpCode::MOV, OpCode::JMP, OpCode::MOV, OpCode::JMP};
	for (size_t i = 0; i < ops.size(); ++i) {
		decoded[i].op = static_cast<u8>(ops[i]); decoded[i].width = 1;
		decoded[i].baseCycles = BASE_CYCLES[decoded[i].op];
		instructions[i] = {&decoded[i], 0x3000u + static_cast<u32>(i < 5 ? i : i + 11) * INSTRUCTION_BYTES};
	}
	decoded[0].a = 0; decoded[0].b = 1;
	decoded[1].a = 2; decoded[1].b = 0; decoded[1].c = 1;
	decoded[2].a = 5;
	decoded[3].a = 3; decoded[3].b = 0; decoded[3].c = 1;
	decoded[4].bx = 0x4000u;
	decoded[5].a = 0; decoded[5].b = 4;
	decoded[6].bx = 0x3008u;
	decoded[7].a = 0; decoded[7].b = 6;
	decoded[8].bx = 0x3008u;
	const std::array sources{NativeBlockSource{std::span(instructions.data(), 2), nullptr, true},
		NativeBlockSource{std::span(instructions.data() + 2, 3)}, NativeBlockSource{std::span(instructions.data() + 5, 2)},
		NativeBlockSource{std::span(instructions.data() + 7, 2)}};
	auto blocks = NativeBlock::compileRegion(sources, nullptr, NativeCodeBindings(memory, cpu.stringPool(), cpu.stringPool().intern("__index")), {});
	size_t bytes = 0; blocks.front()->region->publish(bytes);
	auto* table = cpu.createTable(2); table->setInteger(1, valueNumber(23));
	for (const size_t entry : {0u, 1u, 2u, 3u}) for (const bool valid : {false, true}) {
		std::array<Value, 7> registers; registers.fill(valueNil());
		registers[0] = registers[1] = registers[4] = registers[6] = valid ? valueTable(table) : valueNil();
		NativeBlockRunState state{.registers = registers.data(), .remainingCycles = 100};
		const auto* exit = blocks[entry]->run(state);
		if (valid) {
			require(exit == &blocks[1]->terminal && registers[3] == valueNumber(23) && registers[5] == valueNumber(1),
				"successful fallthrough and both independent entries retain their table receiver");
		} else if (entry == 0) {
			require(exit->exit == NativeBlockExit::ReadInteger && exit->currentPc == 0x3004u,
				"the first receiver guard still takes its semantic exit");
		} else {
			require(exit->exit == NativeBlockExit::ScalarBoundary && state.scalarPc == 0x3008u
				&& registers[0] == valueNil() && registers[5] == valueNil(),
				"external and internal entries validate inherited table facts before any side effect");
		}
	}
	std::array<Value, 7> registers; registers.fill(valueNil());
	registers[6] = valueTable(table);
	NativeBlockRunState state{.registers = registers.data(), .remainingCycles = 100};
	require(blocks[2]->run(state)->exit == NativeBlockExit::ScalarBoundary && registers[0] == valueNil(),
		"the first internal predecessor cannot reuse the second predecessor's table fact");
	state.remainingCycles = 100;
	require(blocks[3]->run(state) == &blocks[1]->terminal && registers[3] == valueNumber(23),
		"another internal predecessor transfers its own table receiver");
}

void entryGuardsFollowConsumedTableFacts(CPU& cpu, Memory& memory) {
	std::array<DecodedInstruction, 7> decoded{};
	std::array<NativeBlockInstruction, 7> instructions{};
	const std::array ops{OpCode::MOV, OpCode::GETI, OpCode::MOV, OpCode::K1, OpCode::GETI, OpCode::JMP, OpCode::JMP};
	for (size_t i = 0; i < ops.size(); ++i) {
		decoded[i].op = static_cast<u8>(ops[i]); decoded[i].width = 1;
		decoded[i].baseCycles = BASE_CYCLES[decoded[i].op];
		instructions[i] = {&decoded[i], 0x5000u + static_cast<u32>(i) * INSTRUCTION_BYTES};
	}
	decoded[0].a = 0; decoded[0].b = 1;
	decoded[1].a = 2; decoded[1].b = 0; decoded[1].c = 1;
	decoded[2].a = 4; decoded[2].b = 0;
	decoded[3].a = 5;
	decoded[4].a = 3; decoded[4].b = 4; decoded[4].c = 1;
	decoded[5].bx = decoded[6].bx = 0x6000u;
	size_t bytes = 0;
	{
		auto unusedDecoded = decoded;
		unusedDecoded[4] = decoded[5];
		auto unusedInstructions = instructions;
		unusedInstructions[4].decoded = &unusedDecoded[4];
		const std::array unusedSources{NativeBlockSource{std::span(instructions.data(), 2), nullptr, true},
			NativeBlockSource{std::span(unusedInstructions.data() + 2, 3)}};
		auto blocks = NativeBlock::compileRegion(unusedSources, nullptr, NativeCodeBindings(memory, cpu.stringPool(), cpu.stringPool().intern("__index")), {});
		blocks.front()->region->publish(bytes);
		std::array<Value, 6> registers; registers.fill(valueNil());
		NativeBlockRunState state{.registers = registers.data(), .remainingCycles = 100};
		require(blocks[1]->run(state) == &blocks[1]->terminal && registers[5] == valueNumber(1),
			"an inherited but unused table fact does not reject an independent entry");
	}
	{
		const std::array usedSources{NativeBlockSource{std::span(instructions.data(), 2), nullptr, true},
			NativeBlockSource{std::span(instructions.data() + 2, 2), nullptr, true},
			NativeBlockSource{std::span(instructions.data() + 4, 2)}};
		auto blocks = NativeBlock::compileRegion(usedSources, nullptr, NativeCodeBindings(memory, cpu.stringPool(), cpu.stringPool().intern("__index")), {});
		blocks.front()->region->publish(bytes);
		std::array<Value, 6> registers; registers.fill(valueNil());
		NativeBlockRunState state{.registers = registers.data(), .remainingCycles = 100};
		const auto* exit = blocks[1]->run(state);
		require(exit->exit == NativeBlockExit::ScalarBoundary && state.scalarPc == 0x5008u
			&& registers[5] == valueNil(),
			"a copied fact used after another fallthrough guards the preceding external entry");
		auto* table = cpu.createTable(2); table->setInteger(1, valueNumber(23));
		registers[0] = valueTable(table); state.remainingCycles = 100;
		require(blocks[1]->run(state) == &blocks[2]->terminal && registers[3] == valueNumber(23),
			"the guarded copied fact reaches its later use when the receiver is a table");
	}
}

void overwrittenAndEvictedFactsDoNotGuardEntries(CPU& cpu, Memory& memory) {
	for (const bool evict : {false, true}) {
		std::array<DecodedInstruction, 12> decoded{};
		std::array<NativeBlockInstruction, 12> instructions{};
		const std::array ops{OpCode::MOV, OpCode::GETI, OpCode::K1, OpCode::K1, OpCode::K1, OpCode::K1,
			OpCode::ADD, OpCode::ADD, OpCode::ADD, OpCode::GETI, OpCode::JMP, OpCode::JMP};
		for (size_t i = 0; i < ops.size(); ++i) {
			decoded[i].op = static_cast<u8>(ops[i]); decoded[i].width = 1;
			decoded[i].baseCycles = BASE_CYCLES[decoded[i].op];
			instructions[i] = {&decoded[i], 0x7000u + static_cast<u32>(i) * INSTRUCTION_BYTES};
		}
		decoded[0].a = 0; decoded[0].b = 1;
		decoded[1].a = 2; decoded[1].b = 0; decoded[1].c = 1;
		for (int i = 0; i < 4; ++i) decoded[2 + i].a = evict ? 4 + i : (i == 0 ? 0 : 3 + i);
		decoded[6].a = 8; decoded[6].b = 4; decoded[6].c = 5;
		decoded[7].a = 9; decoded[7].b = 6; decoded[7].c = 7;
		decoded[8].a = 10; decoded[8].b = 8; decoded[8].c = 9;
		decoded[9].a = 3; decoded[9].b = 0; decoded[9].c = 1;
		decoded[10].bx = decoded[11].bx = 0x8000u;
		const std::array sources{NativeBlockSource{std::span(instructions.data(), 2), nullptr, true},
			NativeBlockSource{std::span(instructions.data() + 2, 9)}};
		auto blocks = NativeBlock::compileRegion(sources, nullptr, NativeCodeBindings(memory, cpu.stringPool(), cpu.stringPool().intern("__index")), {});
		size_t bytes = 0; blocks.front()->region->publish(bytes);
		std::array<Value, 11> registers; registers.fill(valueNil());
		NativeBlockRunState state{.registers = registers.data(), .remainingCycles = 100};
		const auto* exit = blocks[1]->run(state);
		require(exit->exit == NativeBlockExit::ReadInteger && exit->currentPc == 0x7024u,
			"an overwritten or evicted table fact does not guard an earlier independent entry");
		require(registers[4] == valueNumber(1), "ordinary prefix definitions execute before the later table fault");
	}
}
} // namespace

int main() {
	try {
		Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
		IrqController irq(memory); ExecutionAddressSpace addresses(memory); CPU cpu(memory, irq, addresses);
		readsRetainNativeFrame(cpu, memory);
		storesRetainNativeFrame(cpu, memory);
		boundaryLengthRetainsNativeFrame(cpu, memory);
		guardedTableFactsFollowRegisterDefinitions(cpu, memory);
		tableFactsAreValidatedAtIndependentRegionEntries(cpu, memory);
		entryGuardsFollowConsumedTableFacts(cpu, memory);
		overwrittenAndEvictedFactsDoNotGuardEntries(cpu, memory);
		std::cout << "Native string table store tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n'; return 1;
	}
}
