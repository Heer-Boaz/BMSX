#include "support/firmware_heap_layout.h"
#include "support/string_pool_reference.h"
#include "support/lua_heap_reference.h"
#include "support/heap_allocator_reference.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/decoded_instruction.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/cpu/jit/ir/liveness.h"
#include "machine/cpu/jit/ir/region.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "support/gc_heap_reference.h"
#include "support/native_region_fixture.h"
#include "support/managed_fixture.h"
#include "support/thread_allocation_reference.h"
#include "support/table_allocation_reference.h"

#include <algorithm>
#include <array>
#include <iostream>
#include <limits>
#include <numeric>
#include <span>
#include <stdexcept>

namespace {
using namespace bmsx;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

int instructionCharge(std::span<const DecodedInstruction> instructions) {
	return std::accumulate(instructions.begin(), instructions.end(), 0,
		[](int cycles, const DecodedInstruction& inst) { return cycles + inst.baseCycles; });
}

void retainedFieldAddressesKeepIndependentLifetimes(CPU& cpu, Memory& memory) {
	const std::array keys{bmsx::test::StringPoolReference(cpu).intern("left"), bmsx::test::StringPoolReference(cpu).intern("right"), bmsx::test::StringPoolReference(cpu).intern("last")};
	std::array values{valueInteger(19), valueInteger(43), valueInteger(91)};
	ValueSlots constants(keys.size());
	auto table = bmsx::test::allocateTableReference(cpu, 0, 4);
	for (size_t i = 0; i < keys.size(); ++i) {
		constants.set(i, valueString(keys[i]));
		table.setStringKey(keys[i], values[i]);
	}
	std::array<int, keys.size()> predictions;
	predictions.fill(-1);
	for (size_t i = 0; i < keys.size(); ++i)
		require(table.getStringKeyCached(keys[i], predictions[i]) == values[i], "each own key has a live prediction");

	constexpr std::array selectors{0u, 1u, 0u, 1u, 2u, 2u};
	std::array<DecodedInstruction, selectors.size() + 1u> decoded{};
	std::array<NativeBlockInstruction, decoded.size()> source;
	for (size_t row = 0; row < selectors.size(); ++row) {
		const u32 key = selectors[row];
		decoded[row] = {.payload = DecodedInstruction::Payload::tableSlot(predictions[key]),
			.a = static_cast<u16>(row + 1u), .c = static_cast<i16>(key), .op = static_cast<u8>(OpCode::GETFIELD)};
	}
	decoded.back().op = static_cast<u8>(OpCode::JMP);
	decoded.back().setBx(0x2000u);
	for (size_t row = 0; row < decoded.size(); ++row) {
		decoded[row].width = 1;
		decoded[row].baseCycles = BASE_CYCLES[decoded[row].op];
		source[row] = {&decoded[row], 0x1000u + static_cast<u32>(row) * INSTRUCTION_BYTES};
	}
	auto block = test::compileNative(source, memory, cpu.stringPool());
	require(block->terminal.nextPc == 0x2000u && block->sideExits.size() == selectors.size(),
		"the two overlapping and one subsequent address lifetimes share a complete generated segment");
	ValueSlots registers(decoded.size());
	registers.set(0, valueTable(table.address()));
	NativeBlockRunState state{.constants = constants.view(), .memory = &cpu.memory(),
		.globalValues = {}, .systemGlobalValues = {}};
	const auto check = [&] {
		state.remainingCycles = instructionCharge(decoded);
		const auto* exit = block->run(registers.view(), state);
		require(exit == &block->terminal && state.remainingCycles == 0, "all reads and the jump consume the exact grant");
		for (size_t row = 0; row < selectors.size(); ++row)
			require(registers.get(row + 1u) == values[selectors[row]], "each retained address supplies its current value lanes");
	};
	check();
	values[1] = valueBool(false);
	table.setStringKey(keys[1], values[1]);
	check();
}

void numericFieldArithmeticKeepsNativeFrame(CPU& cpu, Memory& memory) {
	const auto x = bmsx::test::StringPoolReference(cpu).intern("x");
	auto particle = bmsx::test::allocateTableReference(cpu, 0, 1);
	ValueSlots constants(1); constants.set(0, valueString(x));
	std::array<DecodedInstruction, 5> ops{};
	std::array<NativeBlockInstruction, 5> instructions{};
	// The star update's register assignments; K1 makes the fallback publish
	// a nonempty prefix inside the segment before rerunning SUB.
	const std::array codes{OpCode::GETFIELD, OpCode::K1, OpCode::SUB, OpCode::SETFIELD, OpCode::JMP};
	for (size_t i = 0; i < ops.size(); ++i) {
		ops[i].op = static_cast<u8>(codes[i]); ops[i].width = 1; ops[i].baseCycles = BASE_CYCLES[ops[i].op];
		instructions[i] = {&ops[i], 0x1000u + static_cast<u32>(i) * INSTRUCTION_BYTES};
	}
	ops[0].a = 9; ops[0].b = 6; ops[0].tableCacheSlot() = 0;
	ops[1].a = 10;
	ops[2].a = 8; ops[2].b = 9; ops[2].c = 1;
	const auto unseenSubtract = ops[2];
	for (unsigned sample = 0; sample < NATIVE_BLOCK_COMPILATION_THRESHOLD; ++sample)
		ops[2].observeNativeNumericTypes(valueInteger(12), valueInteger(1));
	ops[3].a = 6; ops[3].c = 8; ops[3].tableCacheSlot() = 0;
	ops[4].setBx(0x2000u);
	auto block = test::compileNative(instructions, memory, cpu.stringPool());
	ValueSlots registers(11);
	registers.set(6, valueTable(particle.address()));
	registers.set(1, valueInteger(1));
	particle.setStringKey(x, valueInteger(std::numeric_limits<i32>::min()));
	NativeBlockRunState run{.constants = constants.view(), .memory = &cpu.memory(), .remainingCycles = 100};
	const auto* wrapped = block->run(registers.view(), run);
	require(wrapped->exit == NativeBlockExit::Continue && wrapped->nextPc == ops[4].bx()
		&& particle.getStringKey(x) == valueInteger(std::numeric_limits<i32>::max()),
		"the guarded Integer subtract wraps and reaches the field store within one native grant");
	for (const Value right : {valueFloat(0.5f), valueBool(false)}) {
		const auto before = valueInteger(73);
		particle.setStringKey(x, before);
		registers.set(1, right); registers.set(8, valueInteger(59)); registers.set(10, valueNil());
		run.remainingCycles = 100; run.physicalTop = 0;
		const auto* exit = block->run(registers.view(), run);
		require(exit->exit == NativeBlockExit::ScalarBoundary && exit->nextPc == instructions[2].pc
			&& run.remainingCycles == 100 - ops[0].baseCycles - ops[1].baseCycles && run.physicalTop == 11
			&& registers.get(9) == before && registers.get(10) == valueInteger(1)
			&& registers.get(8) == valueInteger(59) && particle.getStringKey(x) == before,
			"a guard miss publishes only the executed prefix and leaves SUB and the store to the VM");
	}

	particle.setStringKey(x, valueFloat(3.25f));
	registers.set(9, valueInteger(42));
	run.remainingCycles = 100;
	const auto* typeMiss = block->run(registers.view(), run);
	require(typeMiss->exit == NativeBlockExit::ReadField && run.remainingCycles == 100 - ops[0].baseCycles
		&& registers.get(9) == valueInteger(42),
		"the tag guard does not execute or publish a speculative field read");

	ops[2] = unseenSubtract;
	for (unsigned sample = 0; sample < NATIVE_BLOCK_COMPILATION_THRESHOLD; ++sample)
		ops[2].observeNativeNumericTypes(valueFloat(12.5f), valueFloat(0.25f));
	auto floats = test::compileNative(instructions, memory, cpu.stringPool());
	particle.setStringKey(x, valueFloat(12.5f));
	registers.set(1, valueFloat(0.25f)); run.remainingCycles = 100;
	const auto* floatHit = floats->run(registers.view(), run);
	require(floatHit->exit == NativeBlockExit::Continue && floatHit->nextPc == ops[4].bx()
		&& particle.getStringKey(x) == valueFloat(12.25f),
		"an observed Float update does not detour through the scalar VM");
}

void inheritedReadFollowsLiveOwners(CPU& cpu, Memory& memory) {
	bmsx::test::StringPoolReference strings(cpu);
	const StringId indexKey = strings.intern("__index");
	auto controls = test::fixtureTableControls(cpu);
	const StringId key = strings.intern("inherited method");
	auto root = bmsx::test::allocateTableReference(cpu, 3, 4), middle = bmsx::test::allocateTableReference(cpu, 0, 1), holder = bmsx::test::allocateTableReference(cpu, 2, 4);
	root.setInteger(1, valueInteger(123));
	auto firstMeta = bmsx::test::allocateTableReference(cpu, 0, 1), secondMeta = bmsx::test::allocateTableReference(cpu, 0, 1);
	firstMeta.setStringKey(indexKey, valueTable(middle.address()));
	secondMeta.setStringKey(indexKey, valueTable(holder.address()));
	root.setMetatableAddress(firstMeta.address());
	middle.setMetatableAddress(secondMeta.address());
	holder.setStringKey(key, valueInteger(41));

	DecodedInstruction decoded{};
	decoded.op = static_cast<u8>(OpCode::GETFIELD); decoded.width = 1; decoded.b = 1;
	decoded.baseCycles = BASE_CYCLES[decoded.op]; decoded.tableCacheSlot() = -1;
	const std::array instructions{NativeBlockInstruction{&decoded, 0x1000u}};
	ValueSlots constants(1), registers(2);
	const Value receiver = valueTable(root.address());
	constants.set(0, valueString(key));
	registers.set(1, receiver);
	auto block = test::compileNative(instructions, memory, cpu.stringPool());
	auto& hint = block->sideExits[0].tableRead;
	NativeBlockRunState grant{.constants = constants.view(), .memory = &cpu.memory(), .cop0Words = controls.data()};
	const auto read = [&](Value want, int hops, TableLookupStatus status = TableLookupStatus::Resolved) {
		grant.remainingCycles = 100;
		registers.set(0, valueInteger(73));
		const auto* exit = block->run(registers.view(), grant);
		if (status == TableLookupStatus::Resolved) {
			require(exit->exit == NativeBlockExit::Continue && registers.get(0) == want && grant.remainingCycles == 100 - decoded.baseCycles - hops * TABLE_INDEX_VISIT_CYCLES,
				"the native read follows the live path and charges each visit");
			return;
		}
		require(exit->exit == NativeBlockExit::ReadField && exit->currentPc == instructions[0].pc
			&& exit->nextPc == instructions[0].pc + INSTRUCTION_BYTES && registers.get(0) == valueInteger(73)
			&& grant.remainingCycles == 100 - decoded.baseCycles,
			"the gate publishes the read boundary before resolving an unproved field");
		TableLookupResult result;
		root.resolveStringIndexCached(key, controls[COP0_TABLE_LOOKUP_KEY], hint.standalone, result);
		require(result.status == status && result.value == want && result.extraVisits == static_cast<u32>(hops),
			"the resolver follows live owners, preserves the raw result and counts each actual hop");
	};
	// Resolve an inherited field on a holder with an array prefix.
	firstMeta.setStringKey(indexKey, valueTable(holder.address()));
	read(valueInteger(41), 1);
	read(valueInteger(41), 1);
	const auto home = root.beginStringProbe(key).node;
	StringId neighbor = 0;
	for (int i = 0; i < 64 && !neighbor; ++i) {
		const auto candidate = bmsx::test::StringPoolReference(cpu).intern("colliding receiver key " + std::to_string(i));
		if (root.beginStringProbe(candidate).node == home) neighbor = candidate;
	}
	require(neighbor != 0u, "the receiver override must be displaced through a real hash link");
	root.setStringKey(neighbor, valueInteger(99));
	const auto ownSlot = root.setStringKey(key, valueBool(false));
	block->sideExits[0].tableRead.standalone = -1;
	require(ownSlot != static_cast<int>(hashCanonicalTableKey(valueString(key)) & 3u),
		"the receiver's method is not in its home slot");
	read(valueBool(false), 0);
	require(hint.standalone == ownSlot, "following the live chain rediscovers the shadow");
	firstMeta.setStringKey(indexKey, valueTable(middle.address()));
	root.setStringKey(key, valueNil());
	read(valueInteger(41), 2);
	require(hint.standalone == ownSlot, "an inherited hit preserves the receiver hint");
	const auto ram = memory.captureSaveState();
	const auto state = cpu.captureRuntimeState();

	// A generated and already-trained GETFIELD consumes the live selector
	// on each actual miss, independently of the stock GC workspace.
	const auto replacement = strings.intern("firmware-authored __index");
	auto alternative = bmsx::test::allocateTableReference(cpu, 0, 2);
	alternative.setStringKey(key, valueInteger(81));
	firstMeta.setStringKey(replacement, valueTable(alternative.address()));
	controls[COP0_TABLE_LOOKUP_KEY] = replacement;
	read(valueInteger(81), 1);
	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	controls[COP0_TABLE_LOOKUP_KEY] = state.tableLookupKeyWord;
	read(valueInteger(41), 2);

	holder.setStringKey(key, valueInteger(42));
	read(valueInteger(42), 2);
	for (int i = 0; i < 32; ++i) {
		holder.setStringKey(bmsx::test::StringPoolReference(cpu).intern("holder rehash " + std::to_string(i)), valueInteger(i));
		secondMeta.setStringKey(bmsx::test::StringPoolReference(cpu).intern("meta rehash " + std::to_string(i)), valueInteger(i));
		root.setStringKey(bmsx::test::StringPoolReference(cpu).intern("receiver rehash " + std::to_string(i)), valueInteger(i));
	}
	read(valueInteger(42), 2);
	// A live value at an intermediate table overrides the cached holder.
	middle.setStringKey(key, valueBool(false));
	read(valueBool(false), 1);
	middle.setStringKey(key, valueNil());
	root.setStringKey(key, valueInteger(43));
	read(valueInteger(43), 0);
	root.setStringKey(key, valueNil());
	holder.setStringKey(key, valueNil());
	read(valueNil(), 2);
	secondMeta.setStringKey(indexKey, valueBool(true));
	read(valueBool(true), 1, TableLookupStatus::Forward);

	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	controls[COP0_TABLE_LOOKUP_KEY] = state.tableLookupKeyWord;
	read(valueInteger(41), 2);
	// Reuse object pages after dropping the holder edge. A recycled record
	// is not a valid holder unless the live __index member leads to it.
	secondMeta.setStringKey(indexKey, valueNil());
	bmsx::test::GcHeap(cpu).collect(receiver, valueString(key));
	require(bmsx::test::GcHeap(cpu).tableRecordAddress(holder.address()) == 0, "the old holder really retired");
	// Request only object headers: backing allocations are a different owner
	// and could occupy the freed address before an object can reuse it.
	u32 reused = bmsx::test::allocateTableReference(cpu).address();
	for (int i = 0; i < 8 && reused != holder.address(); ++i) reused = bmsx::test::allocateTableReference(cpu).address();
	require(reused == holder.address(), "the probe actually reuses the old owner's guest address");
	bmsx::test::NativeTableReference(bmsx::test::GcHeap(cpu), reused).setStringKey(key, valueInteger(44));
	read(valueNil(), 1);
	secondMeta.setStringKey(indexKey, valueTable(reused));
	read(valueInteger(44), 2);
}

void stringReadsFollowLiveTables(CPU& cpu, Memory& memory) {
	const auto key = bmsx::test::StringPoolReference(cpu).intern("native read field");
	const auto indexKey = bmsx::test::StringPoolReference(cpu).intern("__index");
	auto controls = test::fixtureTableControls(cpu);
	const auto other = bmsx::test::StringPoolReference(cpu).intern("other read field");
	ValueSlots constants(1); constants.set(0, valueString(key));
	const std::array values{valueFromTag(ValueTag::False, 37), valueFloat(-0.0f),
		valueFloatBits(0xffa12345u), valueTable(bmsx::test::allocateTableReference(cpu).address()), valueString(other), valueNil()};
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
		decoded[3].tableCacheSlot() = -1;
		decoded[4].a = 9; decoded[4].b = 8;
		decoded[5].a = 10; decoded[5].b = 2;
		decoded[6].setBx(0x2000u);
		const int cycles = instructionCharge(decoded);
		auto block = test::compileNative(source, memory, cpu.stringPool());
		auto table = bmsx::test::allocateTableReference(cpu, 0, 8);
		auto parent = bmsx::test::allocateTableReference(cpu, 0, 1);
		auto meta = bmsx::test::allocateTableReference(cpu, 0, 1);
		meta.setStringKey(indexKey, valueTable(parent.address())); table.setMetatableAddress(meta.address());
		for (const Value value : values) for (const int prediction : {-1, 100000}) {
			parent.setStringKey(key, value);
			block->sideExits[0].tableRead.standalone = prediction;
			ValueSlots registers(11); for (size_t i = 0; i < registers.capacity(); ++i) registers.set(i, valueInteger(73));
			registers.set(0, valueTable(table.address())); registers.set(3, values[3]);
			registers.set(4, values[0]); registers.set(5, valueString(key));
			const auto heap = std::pair{bmsx::LuaHeap(cpu).usedBytes(), bmsx::LuaHeap(cpu).collectionTarget()};
			NativeBlockRunState state{.constants = constants.view(), .memory = &cpu.memory(), .cop0Words = controls.data(), .remainingCycles = 100};
			const auto* exit = block->run(registers.view(), state);
			require(exit->exit == NativeBlockExit::Continue && registers.get(destination) == value
				&& registers.get(9) == values[3] && registers.get(10) == values[0],
				"a missing or inherited field completes before the suffix, including aliased operands");
			if (op == OpCode::SELF) require(registers.get(destination + 1) == valueTable(table.address()), "SELF retains its receiver before the read");
			require(bmsx::LuaHeap(cpu).usedBytes() == heap.first
				&& bmsx::LuaHeap(cpu).collectionTarget() == heap.second,
				"read resolution changes neither tracked allocation nor collection thresholds");
			require(state.remainingCycles == 100 - cycles - TABLE_INDEX_VISIT_CYCLES,
				"the inherited read charges one visit");
		}
		for (int mutation = 0; mutation < 4; ++mutation) {
			if (mutation == 0) block->sideExits[0].tableRead.standalone = table.setStringKey(key, values[0]);
			if (mutation == 1) {
				for (int i = 0; i != 64; ++i) table.setStringKey(bmsx::test::StringPoolReference(cpu).intern("read_rehash_" + std::to_string(i)), valueInteger(i));
			}
			if (mutation == 2) { table.setStringKey(key, valueNil()); parent.setStringKey(key, valueInteger(91)); }
			if (mutation == 3) { meta.setStringKey(indexKey, valueBool(false)); }
			ValueSlots registers(11);
			registers.set(0, valueTable(table.address())); registers.set(5, valueString(key));
			NativeBlockRunState state{.constants = constants.view(), .memory = &cpu.memory(), .cop0Words = controls.data(), .remainingCycles = 100};
			const auto* exit = block->run(registers.view(), state);
			const bool hit = exit->exit == NativeBlockExit::Continue;
			require(hit == (mutation != 3), "only the non-table __index requires a semantic exit");
			if (hit)
				require(exit->nextPc == decoded[6].bx() && registers.get(destination) == (mutation == 2 ? valueInteger(91) : values[0])
					&& state.remainingCycles == 100 - cycles - (mutation == 2 ? TABLE_INDEX_VISIT_CYCLES : 0), "a matching own lookup preserves raw bits and completes the suffix");
			else {
				const auto original = destination == 0 ? valueTable(table.address()) : destination == 1 ? valueString(key) : valueNil();
				require(exit->currentPc == source[3].pc && exit->nextPc == source[4].pc
					&& registers.get(destination) == original, "a moved, deleted, or inherited mapping is not a cached value");
			}
		}
		if (op == OpCode::GETT) {
			const auto objectKey = valueTable(table.address());
			meta.setStringKey(indexKey, valueTable(parent.address()));
			parent.set(valueInteger(-17), values[0]);
			parent.set(objectKey, values[0]);
			ValueSlots stringRegisters(11);
			stringRegisters.set(0, valueTable(table.address()));
			stringRegisters.set(5, valueString(key));
			NativeBlockRunState stringState{.memory = &cpu.memory(), .cop0Words = controls.data(), .remainingCycles = 100};
			const auto* stringExit = block->run(stringRegisters.view(), stringState);
			require(stringExit->exit == NativeBlockExit::Continue && stringRegisters.get(destination) == valueInteger(91),
				"the mixed site resolves its inherited string key");
			const int stringHint = block->sideExits[0].tableRead.standalone;
			require(stringHint >= 0, "the site retains its prior own-slot prediction");
			for (const auto key : {valueInteger(-17), valueFloat(-17.0f), objectKey}) {
				ValueSlots registers(11);
				registers.set(0, valueTable(table.address()));
				registers.set(5, key);
				NativeBlockRunState state{.memory = &cpu.memory(), .cop0Words = controls.data(), .remainingCycles = 100};
				const auto* exit = block->run(registers.view(), state);
				require(exit->exit == NativeBlockExit::ReadIndex && exit->nextPc == source[4].pc
					&& state.remainingCycles == 100 - instructionCharge(std::span(decoded).first<4>()),
					"sparse numeric and object keys use the same precise semantic read boundary");
			}
			require(block->sideExits[0].tableRead.standalone == stringHint, "non-string misses keep the string hint at the mixed site");
			ValueSlots registers(11);
			registers.set(0, valueTable(table.address()));
			registers.set(3, valueInteger(73));
			NativeBlockRunState state{.memory = &cpu.memory(), .cop0Words = controls.data(), .remainingCycles = 100};
			require(block->run(registers.view(), state)->exit == NativeBlockExit::ReadIndex && registers.get(9) == valueNil(),
				"a nil key still takes the precise side exit without executing the suffix");
		}
		// A real bounded-chain error still takes the precise semantic side exit.
		meta.setStringKey(indexKey, valueTable(table.address()));
		ValueSlots registers(11); for (size_t i = 0; i < registers.capacity(); ++i) registers.set(i, valueInteger(73));
		registers.set(0, valueTable(table.address())); registers.set(5, valueString(key));
		NativeBlockRunState state{.constants = constants.view(), .memory = &cpu.memory(), .cop0Words = controls.data(), .remainingCycles = 100};
		const auto* exit = block->run(registers.view(), state);
		require(exit->exit == (op == OpCode::GETT ? NativeBlockExit::ReadIndex : NativeBlockExit::ReadField)
			&& exit->currentPc == 0x100cu && registers.get(destination) == (destination == 0 ? valueTable(table.address()) : destination == 1 ? valueString(key) : valueInteger(73)),
			"chain exhaustion publishes the exact prefix without committing the read destination or suffix");
		if (op == OpCode::SELF) require(registers.get(destination + 1) == valueTable(table.address()), "failed SELF keeps the preceding receiver copy");
		registers.set(0, valueString(key));
		require(block->run(registers.view(), state) == exit, "string receivers retain the existing typed semantic path");
	}

	auto table = bmsx::test::allocateTableReference(cpu, 0, 1);
	const auto ownSlot = table.setStringKey(key, valueInteger(59));
	constants.resize(2);
	for (const auto receiver : {valueTable(table.address()), valueString(other)}) {
		constants.set(1, receiver);
		for (const auto op : {OpCode::GETFIELD, OpCode::SELF}) {
			std::array<DecodedInstruction, 4> decoded{};
			std::array<NativeBlockInstruction, 4> source{};
			const std::array ops{OpCode::MOV, op, OpCode::K1, OpCode::JMP};
			for (size_t i = 0; i < ops.size(); ++i) {
				decoded[i].op = static_cast<u8>(ops[i]); decoded[i].width = 1;
				decoded[i].baseCycles = BASE_CYCLES[decoded[i].op];
				source[i] = {&decoded[i], 0x1000u + static_cast<u32>(i) * INSTRUCTION_BYTES};
			}
			decoded[0].b = -2; // Live receiver in R0, also the read destination.
			decoded[1].tableCacheSlot() = ownSlot;
			decoded[2].a = 2;
			decoded[3].setBx(0x2000);
			auto block = test::compileNative(source, memory, cpu.stringPool());
			ValueSlots registers(3);
			NativeBlockRunState state{.constants = constants.view(), .memory = &cpu.memory(), .cop0Words = controls.data(), .remainingCycles = 100};
			const auto* exit = block->run(registers.view(), state);
			const bool tableReceiver = valueIsTable(receiver);
			require((tableReceiver ? exit->exit == NativeBlockExit::Continue && exit->nextPc == decoded[3].bx()
				: exit == &block->sideExits.front() && exit->currentPc == source[1].pc)
				&& registers.get(0) == (tableReceiver ? valueInteger(59) : receiver)
				&& registers.get(2) == (tableReceiver ? valueInteger(1) : valueNil()),
				"a live receiver takes only its field path and a cold read keeps its destination and suffix");
			if (op == OpCode::SELF)
				require(registers.get(1) == receiver, "SELF publishes its aliased receiver before either read path");
			const int cycles = instructionCharge(std::span(decoded).first(tableReceiver ? decoded.size() : 2));
			require(state.remainingCycles == 100 - cycles, "the dynamic receiver retains the precise instruction charge");
		}
	}
}

void oneHopStringReadsProveTheCurrentPath(CPU& cpu, Memory& memory) {
	const auto key = bmsx::test::StringPoolReference(cpu).intern("bounded lookup");
	const auto indexKey = bmsx::test::StringPoolReference(cpu).intern("__index");
	auto controls = test::fixtureTableControls(cpu);
	const u32 home = hashCanonicalTableKey(valueString(key)) & 1u;
	StringId collision = 0;
	for (int i = 0; i < 64 && !collision; ++i) {
		const auto candidate = bmsx::test::StringPoolReference(cpu).intern("bounded collision " + std::to_string(i));
		if ((hashCanonicalTableKey(valueString(candidate)) & 1u) == home) collision = candidate;
	}
	require(collision != 0u, "a real live chain shares the lookup home");
	ValueSlots constants(1);
	constants.set(0, valueString(key));
	const auto firstResult = valueFloatBits(0xffa12345u), secondResult = valueFromTag(ValueTag::False, 73);
	for (const auto op : {OpCode::GETFIELD, OpCode::SELF, OpCode::GETT}) {
		DecodedInstruction lookup{}, suffix{};
		lookup.op = static_cast<u8>(op);
		lookup.a = 2; lookup.b = 0; lookup.c = op == OpCode::GETT ? 1 : 0;
		lookup.tableCacheSlot() = -1;
		lookup.width = suffix.width = 1;
		suffix.op = static_cast<u8>(OpCode::K1); suffix.a = 4;
		lookup.baseCycles = BASE_CYCLES[lookup.op];
		suffix.baseCycles = BASE_CYCLES[suffix.op];
		const std::array source{NativeBlockInstruction{&lookup, 0x1000u}, NativeBlockInstruction{&suffix, 0x1004u}};
		auto block = test::compileNative(source, memory, cpu.stringPool());
		auto table = bmsx::test::allocateTableReference(cpu, 0, 2), meta = bmsx::test::allocateTableReference(cpu, 2, 1);
		auto holder = bmsx::test::allocateTableReference(cpu, 3, 1), nextHolder = bmsx::test::allocateTableReference(cpu, 1, 1);
		holder.setStringKey(key, firstResult);
		nextHolder.setStringKey(key, secondResult);
		meta.setStringKey(indexKey, valueTable(holder.address()));
		table.setMetatableAddress(meta.address());
		const auto slow = op == OpCode::GETT ? NativeBlockExit::ReadIndex : NativeBlockExit::ReadField;
		auto& cache = block->sideExits[0].tableRead;
		const auto run = [&](const TableRecord& base, int grant, Value result, int hops = 1) {
			ValueSlots registers(5);
			registers.set(0, valueTable(base.address()));
			registers.set(1, valueString(key));
			registers.set(2, valueInteger(31));
			registers.set(3, valueInteger(32));
			registers.set(4, valueInteger(33));
			// A trained hit uses only the admitted RAM and native frame,
			// not the C++ heap owner needed by the semantic lookup.
			NativeBlockRunState state{.constants = constants.view(), .cop0Words = controls.data(), .remainingCycles = grant};
			const auto* exit = block->run(registers.view(), state);
			require(registers.get(3) == (op == OpCode::SELF ? registers.get(0) : valueInteger(32)),
				"SELF keeps its original receiver independently of a one-hop hit");
			const int debt = grant - lookup.baseCycles;
			if (hops < 0) {
				require(exit->exit == slow && exit->currentPc == source[0].pc && exit->nextPc == source[1].pc
					&& state.remainingCycles == debt && registers.get(2) == valueInteger(31)
					&& registers.get(4) == valueInteger(33) && state.physicalTop == (op == OpCode::SELF ? 4 : 0),
					"an unproved path performs no inherited work or destination write before the semantic owner");
			} else {
				const bool completedSuffix = debt > hops * TABLE_INDEX_VISIT_CYCLES;
				require(exit->exit == NativeBlockExit::Continue && exit->currentPc == source[completedSuffix].pc
					&& state.remainingCycles == debt - hops * TABLE_INDEX_VISIT_CYCLES - (completedSuffix ? suffix.baseCycles : 0)
					&& registers.get(2) == result && registers.get(4) == valueInteger(completedSuffix ? 1 : 33)
					&& state.physicalTop == (completedSuffix ? 5 : op == OpCode::SELF ? 4 : 3),
					"one native hop preserves exact value bits and charges the extra visit before admitting its successor");
			}
		};
		run(table, 100, firstResult);
		for (const int grant : {1, lookup.baseCycles + TABLE_INDEX_VISIT_CYCLES,
			lookup.baseCycles + TABLE_INDEX_VISIT_CYCLES + 1}) run(table, grant, firstResult);

		table.setStringKey(collision, valueInteger(42));
		require(table.setStringKey(key, secondResult) != static_cast<i32>(home) && cache.standalone == -1,
			"the stale receiver prediction is absent while the live own mapping is in a collision node");
		run(table, 100, secondResult, 0);

		auto other = bmsx::test::allocateTableReference(cpu);
		other.setMetatableAddress(meta.address());
		run(other, 100, firstResult);
		meta.setStringKey(indexKey, valueTable(nextHolder.address()));
		run(other, 100, secondResult);
		nextHolder.setStringKey(key, valueNil());
		auto nextMeta = bmsx::test::allocateTableReference(cpu, 0, 1);
		nextMeta.setStringKey(indexKey, valueTable(holder.address()));
		nextHolder.setMetatableAddress(nextMeta.address());
		run(other, 100, firstResult, 2);
		meta.setStringKey(indexKey, valueTable(holder.address()));
		run(other, 100, firstResult);
		meta.setStringKey(indexKey, valueBool(false));
		run(other, 100, valueNil(), -1);

		auto wide = bmsx::test::allocateTableReference(cpu, 0, 256);
		const int wideHome = wide.beginStringProbe(key).node;
		Value head;
		for (int i = 0;; ++i) {
			head = valueInteger(i);
			if (static_cast<int>(hashCanonicalTableKey(head) & 255u) == wideHome) break;
		}
		wide.set(head, valueInteger(19));
		run(wide, 1, valueNil(), 0); // A terminal home has no unbounded work.
		wide.setStringKey(key, secondResult);
		run(wide, 1, valueNil(), -1);
		run(wide, 512, secondResult, 0);
		auto wideMeta = bmsx::test::allocateTableReference(cpu, 0, 256);
		const int metaHome = wideMeta.beginStringProbe(indexKey).node;
		for (int i = 0;; ++i) {
			head = valueInteger(i);
			if (static_cast<int>(hashCanonicalTableKey(head) & 255u) == metaHome) break;
		}
		wideMeta.set(head, valueInteger(20));
		wideMeta.setStringKey(indexKey, valueTable(holder.address()));
		other.setMetatableAddress(wideMeta.address());
		run(other, 1, valueNil(), -1);
		run(other, 512, firstResult);
	}
}

void storesRequireAPredictedOverwrite(CPU& cpu, Memory& memory) {
	const StringId key = bmsx::test::StringPoolReference(cpu).intern("native write field");
	ValueSlots constants(2); constants.set(0, valueString(key)); constants.set(1, valueFromTag(ValueTag::False, 37));
	const std::array values{valueFromTag(ValueTag::False, 37), valueFloat(-0.0f),
		valueFloatBits(0xffa12345u), valueTable(bmsx::test::allocateTableReference(cpu).address()), valueString(key), valueNil()};
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
		decoded[3].tableCacheSlot() = -1;
		decoded[4].a = 9; decoded[4].b = 8;
		decoded[5].setBx(0x2000);
		const int cycles = instructionCharge(decoded);
		auto block = test::compileNative(source, memory, cpu.stringPool());
		auto parent = bmsx::test::allocateTableReference(cpu, 0, 1); parent.setStringKey(key, valueInteger(71));
		auto meta = bmsx::test::allocateTableReference(cpu, 0, 1); meta.setStringKey(bmsx::test::StringPoolReference(cpu).intern("__index"), valueTable(parent.address()));
		for (size_t n = 0; n < values.size(); ++n) {
			auto table = bmsx::test::allocateTableReference(cpu, 0, 8); table.setMetatableAddress(meta.address());
			// Different receiver layouts share this one prediction site.
			for (size_t prior = 0; prior < n; ++prior)
				table.setStringKey(bmsx::test::StringPoolReference(cpu).intern("prior_" + std::to_string(prior)), valueInteger(prior));
			const auto previous = valueInteger(91);
			for (const bool own : {false, true}) for (const Value value : {values[n], valueNil()}) {
				block->sideExits[0].tableStore.standalone = table.setStringKey(key, own ? previous : valueNil());
				ValueSlots registers(10); for (size_t i = 0; i < registers.capacity(); ++i) registers.set(i, valueInteger(73));
				registers.set(0, valueTable(table.address())); registers.set(3, values[n]); registers.set(4, value);
				const auto before = table.trackedHeapBytes();
				NativeBlockRunState state{.constants = constants.view(), .memory = &cpu.memory(), .remainingCycles = 100};
				const auto* exit = block->run(registers.view(), state);
				const Value expected = constant ? constants.get(1) : value;
				const bool hit = own && !isNil(expected) && !valueIsTable(expected) && !valueIsString(expected);
				require(hit ? exit->exit == NativeBlockExit::Continue && exit->currentPc == source[5].pc && exit->nextPc == decoded[5].bx()
					: exit->exit == (generic ? NativeBlockExit::WriteIndex : NativeBlockExit::WriteField)
						&& exit->currentPc == source[3].pc && exit->nextPc == source[4].pc,
					"only a predicted primitive overwrite runs directly; references and shape changes enter the semantic owner");
				require(table.getStringKey(key) == (hit ? expected : own ? previous : valueNil())
					&& table.trackedHeapBytes() == before, "direct overwrites preserve raw values and a miss leaves the table untouched");
				require(registers.get(8) == values[n] && registers.get(9) == (hit ? values[n] : valueInteger(73)) && registers.get(2) == value,
					"the checked exit publishes the prefix but not its suffix");
				require(parent.getStringKey(key) == valueInteger(71), "writes do not redirect through inherited fields");
				require(state.remainingCycles == 100 - (hit ? cycles : instructionCharge(std::span(decoded).first<4>())),
					"the raw gate charges only the steps it reached");
			}
		}
		// Growth is the only table-store case which can allocate. It must still
		// leave generated code before any mutation, publishing all live roots.
		auto empty = bmsx::test::allocateTableReference(cpu);
		ValueSlots registers(10);
		registers.set(0, valueTable(empty.address())); registers.set(3, values[3]); registers.set(4, values[3]);
		NativeBlockRunState state{.constants = constants.view(), .memory = &cpu.memory(), .remainingCycles = 100};
		const auto* exit = block->run(registers.view(), state);
		require(exit->exit == (generic ? NativeBlockExit::WriteIndex : NativeBlockExit::WriteField),
			"missing capacity retains the allocating semantic exit");
		require(empty.storedSlotCount() == 0 && isNil(empty.getStringKey(key)), "growth admission does not mutate the table");
		require(registers.get(8) == values[3] && registers.get(2) == values[3] && isNil(registers.get(9)),
			"growth publishes the prefix roots without executing the suffix");

		auto full = bmsx::test::allocateTableReference(cpu, 0, 1);
		const auto resident = bmsx::test::StringPoolReference(cpu).intern("resident field");
		full.setStringKey(resident, valueInteger(71));
		require(full.hashSlots() == 1 && full.hashFree() == 0, "the full hash still has a live free cursor");
		const size_t header = full.address() & RAM_RECORD_WORD_MASK;
		const size_t backing = full.hashAddress() & RAM_RECORD_WORD_MASK;
		std::array<u8, TableRecord::HEADER_BYTES> oldHeader;
		std::array<u8, 14> oldBacking;
		std::copy_n(memory.ramData() + header, oldHeader.size(), oldHeader.begin());
		std::copy_n(memory.ramData() + backing, oldBacking.size(), oldBacking.begin());
		registers.set(0, valueTable(full.address()));
		block->sideExits[0].tableStore.standalone = 0;
		auto& watches = memory.ramWriteWatches();
		require(!watches.anyWatched(), "exercise the miss without any code watches");
		for (const bool history : {false, true}) {
			if (history) watches.armHistoryWrites();
			state.remainingCycles = 100;
			const auto* miss = block->run(registers.view(), state);
			require(miss->exit == (generic ? NativeBlockExit::WriteIndex : NativeBlockExit::WriteField)
				&& miss->currentPc == source[3].pc && miss->nextPc == source[4].pc
				&& state.remainingCycles == 100 - instructionCharge(std::span(decoded).first<4>())
				&& isNil(registers.get(9)), "the full hash leaves at the started store before the suffix");
			require(std::equal(oldHeader.begin(), oldHeader.end(), memory.ramData() + header)
				&& std::equal(oldBacking.begin(), oldBacking.end(), memory.ramData() + backing),
				"a full-hash miss neither exhausts its free cursor nor changes its backing");
			if (history) {
				const size_t headerPage = header >> MAPPED_PAGE_BYTE_SHIFT;
				const size_t backingPage = backing >> MAPPED_PAGE_BYTE_SHIFT;
				require(!watches.historyPageDirty(headerPage, headerPage + 1)
					&& !watches.historyPageDirty(backingPage, backingPage + 1),
					"a declined raw store does not dirty history even without code watches");
				watches.disarmHistoryWrites();
			}
		}
	}
}
void compactArraySlots(CPU& cpu, Memory& memory) {
	auto table = bmsx::test::allocateTableReference(cpu, 4, 2);
	auto model = bmsx::test::allocateTableReference(cpu, 4, 2);
	const Value ref = valueTable(table.address());
	for (const bool generic : {false, true}) {
		DecodedInstruction write{}, read{};
		write.op = static_cast<u8>(generic ? OpCode::SETT : OpCode::SETI);
		read.op = static_cast<u8>(generic ? OpCode::GETT : OpCode::GETI);
		write.a = read.b = 0;
		write.b = read.c = 1;
		write.c = 2;
		read.a = 1; // commit only after consuming the aliased key
		write.width = read.width = 1;
		write.baseCycles = BASE_CYCLES[write.op];
		read.baseCycles = BASE_CYCLES[read.op];
		const std::array source{NativeBlockInstruction{&write, 0x1000}, NativeBlockInstruction{&read, 0x1004}};
		auto block = test::compileNative(source, memory, cpu.stringPool());
		ValueSlots registers(3);
		registers.set(0, ref);
		NativeBlockRunState state{.memory = &cpu.memory()};
		for (int index : {1, 2, 4, 3, 4, 2, 1}) {
			const int slot = generic ? index : 1;
			for (Value v : {valueFloatBits(0xffa12345), valueNil()}) {
				registers.set(1, valueInteger(slot));
				registers.set(2, v);
				state.remainingCycles = 100;
				model.setInteger(slot, v);
				const auto* exit = block->run(registers.view(), state);
				require(exit->exit == NativeBlockExit::Continue && exit->currentPc == source[1].pc
					&& exit->nextPc == source[1].pc + INSTRUCTION_BYTES && registers.get(1) == v && table.getInteger(slot) == v,
					"array writes and aliased loads transfer both raw planes without a table exit");
				require(table.lengthHint() == model.lengthHint() && TableRecord::length(&table) == TableRecord::length(&model),
					"native append and deletion apply the same length effect as the scalar owner");
				require(state.remainingCycles == 100 - write.baseCycles - read.baseCycles,
					"array hint effects add no guest charge");
			}
		}
		if (generic) {
			auto child = bmsx::test::allocateTableReference(cpu);
			auto metatable = bmsx::test::allocateTableReference(cpu, 0, 1);
			metatable.setStringKey(bmsx::test::StringPoolReference(cpu).intern("__mode"), valueString(bmsx::test::StringPoolReference(cpu).intern("v")));
			table.setMetatableAddress(metatable.address());
			model.setMetatableAddress(metatable.address());
			table.setInteger(1, valueInteger(71));
			model.setInteger(1, valueInteger(71));
			require(table.lengthHint() != 0u, "the barrier case does not also change the length hint");
			bmsx::test::GcHeap(cpu).step(valueTable(model.address()), ref, valueNil());
			require(memory.readRamRecordByte(table.address() + bmsx::test::GC_COLOR_OFFSET) == 3, "array receiver was actually scanned before inserting the new edge");
			registers.set(1, valueInteger(1));
			registers.set(2, valueTable(child.address()));
			const u32 header = table.address();
			const u32 head = bmsx::test::GcHeap(cpu).changedHeadOffset();
			const u32 previousLink = memory.readRamRecordWord(header + bmsx::test::GC_RECORD_LINK);
			const u32 weakLink = previousLink & ~bmsx::test::GC_GRAY_INDEX_MASK;
			require(weakLink != 0, "the table is also linked to a second weak table");
			model.setInteger(1, valueTable(bmsx::test::allocateTableReference(cpu).address()));
			const u32 previousHead = memory.readRamRecordWord(head);
			require(previousHead == ((model.address() & bmsx::test::GC_RECORD_MASK) >> bmsx::test::GC_RECORD_SHIFT), "scalar Table write publishes the prior link");
			state.remainingCycles = 100;
			const auto* exit = block->run(registers.view(), state);
			require(exit->exit == NativeBlockExit::WriteIndex && exit->currentPc == source[0].pc
				&& exit->nextPc == source[1].pc && state.remainingCycles == 100 - write.baseCycles,
				"the started reference store leaves before the following native instruction");
			require(table.getInteger(1) == valueInteger(71) && registers.get(1) == valueInteger(1)
				&& memory.readRamRecordByte(header + bmsx::test::GC_COLOR_OFFSET) == 3
				&& memory.readRamRecordWord(header + bmsx::test::GC_RECORD_LINK) == previousLink
				&& memory.readRamRecordWord(head) == previousHead,
				"the generated reference exit does not mutate the Table or either collector link");
		}
		if (generic) for (Value k : {valueInteger(0), valueInteger(-1), valueInteger(5), valueFloat(1), valueBool(true)}) {
			registers.set(1, k);
			state.remainingCycles = 100;
			require(block->run(registers.view(), state) == &block->sideExits.front() && registers.get(1) == k,
				"non-array key leaves at its precise store for full table semantics");
		}
	}
}

void remarkTableStoresLeaveTheValueUncommitted() {
	for (const bool field : {false, true}) {
		Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
		IrqController irq(memory); ExecutionAddressSpace addresses(memory); CPU cpu(memory, irq, addresses);
		test::seedManagedHeapFixture(cpu);
		auto owner = field ? bmsx::test::allocateTableReference(cpu, 0, 1) : bmsx::test::allocateTableReference(cpu, 2, 0);
		const Value child = field ? valueThread(bmsx::test::allocateThreadRecordReference(cpu, 0u)) : valueTable(bmsx::test::allocateTableReference(cpu).address());
		const auto name = bmsx::test::StringPoolReference(cpu).intern("remark field");
		const int prediction = field ? owner.setStringKey(name, valueInteger(17)) : -1;
		const auto control = bmsx::HeapAllocator(cpu.memory()).managementOffset() + bmsx::test::HEAP_GC_CONTROL_OFFSET;
		memory.writeRamRecordByte(control, static_cast<u8>(bmsx::test::GcPhase::MarkAgain));
		memory.writeRamRecordByte(owner.address() + bmsx::test::GC_COLOR_OFFSET, 3u);
		auto heap = bmsx::test::GcHeap(cpu);
		const auto changed = memory.readRamRecordWord(heap.changedHeadOffset());
		const auto trace = memory.readRamRecordWord(control + bmsx::test::GC_TRACE_HEAD);
		const u32 record = valuePayload(child);
		const u8 color = memory.readRamRecordByte(record + bmsx::test::GC_COLOR_OFFSET);

		// Exercise a register-source Table append and a trained field
		// overwrite with a Thread loaded directly from the constant bank.
		ValueSlots constants(2);
		constants.set(0, valueString(name)); constants.set(1, child);
		std::array<DecodedInstruction, 4> decoded{{
			{.a = 2, .op = static_cast<u8>(OpCode::K1)},
			{.payload = DecodedInstruction::Payload::tableSlot(prediction), .b = static_cast<i16>(field ? 0 : 1),
				.c = static_cast<i16>(field ? -2 : 1), .op = static_cast<u8>(field ? OpCode::SETFIELD : OpCode::SETI)},
			{.a = 3, .b = 2, .op = static_cast<u8>(OpCode::MOV)},
			{.payload = DecodedInstruction::Payload::bx(0x2000u), .op = static_cast<u8>(OpCode::JMP)},
		}};
		std::array<NativeBlockInstruction, decoded.size()> source;
		for (u32 row = 0; row < decoded.size(); ++row) {
			decoded[row].width = 1;
			decoded[row].baseCycles = BASE_CYCLES[decoded[row].op];
			source[row] = {&decoded[row], 0x1000u + row * INSTRUCTION_BYTES};
		}
		const auto block = test::compileNative(source, memory, cpu.stringPool());
		ValueSlots registers(4);
		registers.set(0, valueTable(owner.address()));
		registers.set(1, field ? valueInteger(-19) : child);
		NativeBlockRunState state{};
		state.constants = constants.view(); state.memory = &memory;
		state.remainingCycles = instructionCharge(decoded);
		const auto* exit = block->run(registers.view(), state);
		require(exit->exit == (field ? NativeBlockExit::WriteField : NativeBlockExit::WriteInteger)
			&& exit->currentPc == source[1].pc && exit->nextPc == source[2].pc
			&& state.remainingCycles == decoded[2].baseCycles + decoded[3].baseCycles
			&& registers.get(2) == valueInteger(1) && isNil(registers.get(3)),
			"the generated exit publishes only the prefix and charges the started store");
		require((field ? owner.getStringKey(name) : owner.getInteger(1)) == (field ? valueInteger(17) : valueNil())
			&& owner.lengthHint() == 0u, "the exit has changed neither the value lanes nor the array boundary");
		require(memory.readRamRecordByte(owner.address() + bmsx::test::GC_COLOR_OFFSET) == 3u
			&& memory.readRamRecordWord(heap.changedHeadOffset()) == changed
			&& memory.readRamRecordByte(record + bmsx::test::GC_COLOR_OFFSET) == color
			&& memory.readRamRecordWord(control + bmsx::test::GC_TRACE_HEAD) == trace,
			"generated code does no collector work even during remark");
	}
}

void firstPrivateArrayWriteMarksAllHistoryPages(CPU& cpu, Memory& memory) {
	auto table = bmsx::test::allocateTableReference(cpu, 4096, 0);
	const u32 words = table.arrayAddress(), tags = words + table.arrayCapacity() * sizeof(u32);
	const u32 hint = table.address() + static_cast<u32>(TableHeader::Length);
	const std::array pages{(words & RAM_RECORD_WORD_MASK) >> MAPPED_PAGE_BYTE_SHIFT,
		(tags & RAM_RECORD_WORD_MASK) >> MAPPED_PAGE_BYTE_SHIFT, (hint & RAM_RECORD_WORD_MASK) >> MAPPED_PAGE_BYTE_SHIFT};
	require(pages[0] != pages[1] && pages[0] != pages[2] && pages[1] != pages[2],
		"payload, tag and descriptor are in distinct tracked pages");
	DecodedInstruction store{};
	store.op = static_cast<u8>(OpCode::SETI);
	store.a = 0; store.b = 1; store.c = 2; store.width = 1;
	store.baseCycles = BASE_CYCLES[store.op];
	const std::array source{NativeBlockInstruction{&store, 0x1000u}};
	auto block = test::compileNative(source, memory, cpu.stringPool());
	ValueSlots registers(3);
	registers.set(0, valueTable(table.address()));
	registers.set(2, valueInteger(101));
	NativeBlockRunState state{.memory = &cpu.memory(), .remainingCycles = 100};
	auto& watches = memory.ramWriteWatches();
	watches.armHistoryWrites();
	require(block->run(registers.view(), state)->exit == NativeBlockExit::WriteInteger
		&& isNil(table.getInteger(1)) && table.lengthHint() == 0,
		"the first watched array write leaves the complete operation to the history-aware record port");
	for (const u32 page : pages)
		require(!watches.historyPageDirty(page, page + 1), "the declined write did not touch any lane");
	table.setInteger(1, registers.get(2));
	for (const u32 page : pages)
		require(watches.historyPageDirty(page, page + 1), "the record port accounts for all three pages, including the hint");
	registers.set(2, valueInteger(102));
	state.remainingCycles = 100;
	require(block->run(registers.view(), state)->exit == NativeBlockExit::Continue && table.getInteger(1) == valueInteger(102),
		"an already tracked overwrite can complete directly");
	watches.disarmHistoryWrites();
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
	decoded[3].setBx(0x2000);
	auto block = test::compileNative(source, memory, cpu.stringPool());
	const Value root = valueTable(bmsx::test::allocateTableReference(cpu).address());
	const int cycles = instructionCharge(decoded);
	const int prefixCycles = instructionCharge(std::span(decoded).first<2>());
	for (const i32 expected : {1 << 30, INT32_MAX}) {
		auto table = bmsx::test::allocateTableReference(cpu, 0, 128);
		for (int bit = 30; bit >= 0; --bit) table.set(valueInteger(i32{1} << bit), valueBool(false));
		if (expected == INT32_MAX) table.set(valueInteger(expected), valueBool(false));
		ValueSlots registers(7);
		registers.set(0, valueTable(table.address())); registers.set(1, root);
		const int grant = cycles + 1;
		NativeBlockRunState state{.constants = {}, .memory = &cpu.memory(), .remainingCycles = grant};
		const auto* exit = block->run(registers.view(), state);
		require(exit->exit == NativeBlockExit::Continue && exit->currentPc == source[3].pc && exit->nextPc == decoded[3].bx(),
			"table LEN and its suffix stay in one native invocation");
		require(registers.get(0) == valueInteger(expected), "native LEN returns a full signed Integer boundary and supports source aliasing");
		require(registers.get(5) == root && registers.get(6) == root, "live raw references survive the nonallocating length call");
		require(state.remainingCycles == 1, "length charges only its fixed instruction cost");

		for (const int shortGrant : {static_cast<int>(decoded[0].baseCycles) + 1, prefixCycles}) {
			registers.set(0, valueTable(table.address()));
			registers.set(5, valueNil());
			registers.set(6, valueNil());
			state.remainingCycles = shortGrant;
			state.physicalTop = 0;
			const auto* boundary = block->run(registers.view(), state);
			require(boundary->exit == NativeBlockExit::Continue && boundary->currentPc == source[1].pc
				&& boundary->nextPc == source[2].pc && state.remainingCycles == shortGrant - prefixCycles,
				"LEN may exhaust its grant, but its continuation cannot begin");
			require(registers.get(0) == valueInteger(expected) && registers.get(6) == root && isNil(registers.get(5))
				&& state.physicalTop == 7, "an exhausted LEN publishes its result and prefix, not the following MOV");
		}
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
		decoded[5].setBx(0x4000u);
		auto block = test::compileNative(source, memory, cpu.stringPool());
		auto table = bmsx::test::allocateTableReference(cpu, 2);
		table.setInteger(1, valueInteger(23));
		for (const Value first : {valueTable(table.address()), valueNil()}) for (const Value next : {valueTable(table.address()), valueNil()}) {
			ValueSlots registers(6);
			registers.set(1, first); registers.set(4, next);
			NativeBlockRunState state{.memory = &cpu.memory(), .remainingCycles = 100};
			const auto* exit = block->run(registers.view(), state);
			if (isNil(first)) {
				require(exit->exit == NativeBlockExit::ReadInteger && exit->currentPc == 0x3004u,
					"the first access still guards a dynamic receiver");
			} else if (alias) {
				require(exit->exit == NativeBlockExit::ReadInteger && exit->currentPc == 0x3008u,
					"an aliased destination invalidates the table fact before the next access");
			} else if (isNil(next)) {
				require(exit->exit == NativeBlockExit::ReadInteger && exit->currentPc == 0x3010u,
					"overwriting a guarded receiver requires a new guard");
				require(registers.get(2) == valueInteger(23) && registers.get(3) == valueInteger(23),
					"both preceding accesses retained their values before the later fault");
			} else {
				require(exit->exit == NativeBlockExit::Continue && exit->nextPc == decoded[5].bx() && registers.get(2) == valueInteger(23)
					&& registers.get(3) == valueInteger(23) && registers.get(5) == valueInteger(23),
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
	decoded[4].setBx(0x4000u);
	decoded[5].a = 0; decoded[5].b = 4;
	decoded[6].setBx(0x3008u);
	decoded[7].a = 0; decoded[7].b = 6;
	decoded[8].setBx(0x3008u);
	const std::array sources{NativeBlockSource{std::span(instructions).first<5>()}, NativeBlockSource{std::span(instructions.data() + 5, 2)},
		NativeBlockSource{std::span(instructions.data() + 7, 2)}};
	auto blocks = NativeCompiler{}.compile(sources, NativeCodeBindings(memory, cpu.stringPool()));
	constexpr std::array entryIndices{0u, 2u, 5u, 7u};
	std::array<const NativeBlock*, entryIndices.size()> entries;
	for (size_t i = 0; i < entries.size(); ++i) {
		const auto block = std::find_if(blocks.begin(), blocks.end(), [&](const auto& block) {
			return block->firstPc == instructions[entryIndices[i]].pc;
		});
		require(block != blocks.end(), "each independent entry is published at its guest PC");
		entries[i] = block->get();
	}
	auto table = bmsx::test::allocateTableReference(cpu, 2); table.setInteger(1, valueInteger(23));
	for (const auto* entry : entries) for (const bool valid : {false, true}) {
		ValueSlots registers(7);
		for (int guest : {0, 1, 4, 6}) registers.set(guest, valid ? valueTable(table.address()) : valueNil());
		NativeBlockRunState state{.memory = &cpu.memory(), .remainingCycles = 100};
		const auto* exit = entry->run(registers.view(), state);
		if (valid) {
			require(exit->exit == NativeBlockExit::Continue && exit->nextPc == decoded[4].bx()
				&& registers.get(3) == valueInteger(23) && registers.get(5) == valueInteger(1),
				"successful fallthrough and both independent entries retain their table receiver");
		} else if (entry == entries.front()) {
			require(exit->exit == NativeBlockExit::ReadInteger && exit->currentPc == 0x3004u,
				"the first receiver guard still takes its semantic exit");
		} else {
			const bool completedEdge = entry != entries[1];
			const int prefix = completedEdge ? BASE_CYCLES[static_cast<u8>(OpCode::MOV)]
				+ BASE_CYCLES[static_cast<u8>(OpCode::JMP)] : 0;
			require(exit->exit == NativeBlockExit::ScalarBoundary && exit->nextPc == 0x3008u
				&& exit->operands.replay.hasCompletedInstruction == completedEdge
				&& state.remainingCycles == 100 - prefix
				&& registers.get(0) == valueNil() && registers.get(5) == valueNil(),
				"unproved entries resume at the segment start with only the completed edge charged");
		}
	}
	ValueSlots registers(7);
	registers.set(6, valueTable(table.address()));
	NativeBlockRunState state{.memory = &cpu.memory(), .remainingCycles = 100};
	require(entries[2]->run(registers.view(), state)->exit == NativeBlockExit::ScalarBoundary && registers.get(0) == valueNil(),
		"the first internal predecessor cannot reuse the second predecessor's table fact");
	state.remainingCycles = 100;
	const auto* exit = entries[3]->run(registers.view(), state);
	require(exit->exit == NativeBlockExit::Continue && exit->nextPc == decoded[4].bx() && registers.get(3) == valueInteger(23),
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
	decoded[5].setBx(0x6000u); decoded[6].setBx(0x6000u);
	{
		auto unusedDecoded = decoded;
		unusedDecoded[4] = decoded[5];
		auto unusedInstructions = instructions;
		unusedInstructions[4].decoded = &unusedDecoded[4];
		const std::array unusedSources{NativeBlockSource{std::span(unusedInstructions).first<5>()}};
		auto blocks = NativeCompiler{}.compile(unusedSources, NativeCodeBindings(memory, cpu.stringPool()));
		ValueSlots registers(6);
		NativeBlockRunState state{.memory = &cpu.memory(), .remainingCycles = 100};
		const auto* exit = blocks[1]->run(registers.view(), state);
		require(exit->exit == NativeBlockExit::Continue && exit->nextPc == unusedDecoded[4].bx() && registers.get(5) == valueInteger(1),
			"an inherited but unused table fact does not reject an independent entry");
	}
	{
		const std::array usedSources{NativeBlockSource{std::span(instructions.data(), 2)},
			NativeBlockSource{std::span(instructions.data() + 2, 2)},
			NativeBlockSource{std::span(instructions.data() + 4, 2)}};
		auto blocks = NativeCompiler{}.compile(usedSources, NativeCodeBindings(memory, cpu.stringPool()));
		ValueSlots registers(6);
		NativeBlockRunState state{.memory = &cpu.memory(), .remainingCycles = 100};
		const auto* exit = blocks[1]->run(registers.view(), state);
		require(exit->exit == NativeBlockExit::ScalarBoundary && exit->nextPc == 0x5008u
			&& !exit->operands.replay.hasCompletedInstruction && registers.get(5) == valueNil(),
			"a copied receiver requires admission before its first downstream use");
		auto table = bmsx::test::allocateTableReference(cpu, 2); table.setInteger(1, valueInteger(23));
		registers.set(0, valueTable(table.address())); state.remainingCycles = 100;
		const auto* hit = blocks[1]->run(registers.view(), state);
		require(hit->exit == NativeBlockExit::Continue && hit->nextPc == decoded[5].bx() && registers.get(3) == valueInteger(23),
			"the guarded copied fact reaches its later use when the receiver is a table");
	}
}

void logicalFactsDoNotDependOnPhysicalEviction(CPU& cpu, Memory& memory) {
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
		decoded[10].setBx(0x8000u); decoded[11].setBx(0x8000u);
		const std::array sources{NativeBlockSource{std::span(instructions).first<11>()}};
		auto blocks = NativeCompiler{}.compile(sources, NativeCodeBindings(memory, cpu.stringPool()));
		ValueSlots registers(11);
		for (int operand : {4, 5, 6, 7}) registers.set(operand, valueInteger(0));
		NativeBlockRunState state{.memory = &cpu.memory(), .remainingCycles = 100};
		const auto* exit = blocks[1]->run(registers.view(), state);
		if (evict)
			require(exit->exit == NativeBlockExit::ScalarBoundary && exit->nextPc == 0x7008u
				&& registers.get(4) == valueInteger(0), "host eviction cannot discard a live logical admission proof");
		else
			require(exit->exit == NativeBlockExit::ReadInteger && exit->currentPc == 0x7024u
				&& registers.get(4) == valueInteger(1), "overwriting the receiver removes the earlier proof");
	}
}
} // namespace

int main() {
	try {
		Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
		IrqController irq(memory); ExecutionAddressSpace addresses(memory); CPU cpu(memory, irq, addresses);
		test::seedManagedHeapFixture(cpu);
		inheritedReadFollowsLiveOwners(cpu, memory);
		stringReadsFollowLiveTables(cpu, memory);
		oneHopStringReadsProveTheCurrentPath(cpu, memory);
		retainedFieldAddressesKeepIndependentLifetimes(cpu, memory);
		numericFieldArithmeticKeepsNativeFrame(cpu, memory);
		storesRequireAPredictedOverwrite(cpu, memory);
		compactArraySlots(cpu, memory);
		remarkTableStoresLeaveTheValueUncommitted();

		firstPrivateArrayWriteMarksAllHistoryPages(cpu, memory);
		boundaryLengthRetainsNativeFrame(cpu, memory);
		guardedTableFactsFollowRegisterDefinitions(cpu, memory);
		tableFactsAreValidatedAtIndependentRegionEntries(cpu, memory);
		entryGuardsFollowConsumedTableFacts(cpu, memory);
		logicalFactsDoNotDependOnPhysicalEviction(cpu, memory);
		std::cout << "Native string table store tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n'; return 1;
	}
}
