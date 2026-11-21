#include "machine/cpu/cpu.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/native_block.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "support/native_region_fixture.h"

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

void numericFieldArithmeticKeepsNativeFrame(CPU& cpu, Memory& memory) {
	const auto x = cpu.stringPool().intern("x");
	auto particle = cpu.createTable(0, 1);
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
	ops[0].a = 9; ops[0].b = 6; ops[0].tableCacheSlot = 0;
	ops[1].a = 10;
	ops[2].a = 8; ops[2].b = 9; ops[2].c = 1;
	for (unsigned sample = 0; sample < NATIVE_BLOCK_COMPILATION_THRESHOLD; ++sample)
		ops[2].observeNativeNumericTypes(valueInteger(12), valueInteger(1));
	ops[3].a = 6; ops[3].c = 8; ops[3].tableCacheSlot = 0;
	ops[4].bx = 0x2000u;
	size_t bytes = 0;
	auto block = test::compileNative(instructions, bytes, memory, cpu.stringPool());
	ValueSlots registers(11);
	registers.set(6, valueTable(particle.address()));
	registers.set(1, valueInteger(1));
	particle.setStringKey(x, valueInteger(std::numeric_limits<i32>::min()));
	NativeBlockRunState run{.constants = constants.view(), .heap = &cpu.gcHeap(), .remainingCycles = 100};
	const auto* wrapped = block->run(registers.view(), run);
	require(wrapped->exit == NativeBlockExit::Continue && wrapped->nextPc == ops[4].bx
		&& particle.getStringKey(x) == valueInteger(std::numeric_limits<i32>::max()),
		"the guarded Integer subtract wraps and reaches the field store within one native grant");
	for (const Value right : {valueFloat(0.5f), valueBool(false)}) {
		const auto before = valueInteger(73);
		particle.setStringKey(x, before);
		registers.set(1, right); registers.set(8, valueInteger(59)); registers.set(10, valueNil());
		run.remainingCycles = 100; run.registerTop = 0;
		const auto* exit = block->run(registers.view(), run);
		require(exit->exit == NativeBlockExit::ScalarBoundary && exit->nextPc == instructions[2].pc
			&& run.remainingCycles == 100 - ops[0].baseCycles - ops[1].baseCycles && run.registerTop == 11
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

	ops[2].bx = 0;
	for (unsigned sample = 0; sample < NATIVE_BLOCK_COMPILATION_THRESHOLD; ++sample)
		ops[2].observeNativeNumericTypes(valueFloat(12.5f), valueFloat(0.25f));
	auto floats = test::compileNative(instructions, bytes, memory, cpu.stringPool());
	particle.setStringKey(x, valueFloat(12.5f));
	registers.set(1, valueFloat(0.25f)); run.remainingCycles = 100;
	const auto* floatHit = floats->run(registers.view(), run);
	require(floatHit->exit == NativeBlockExit::Continue && floatHit->nextPc == ops[4].bx
		&& particle.getStringKey(x) == valueFloat(12.25f),
		"an observed Float update does not detour through the scalar VM");
}

void inheritedReadFollowsLiveOwners(CPU& cpu, Memory& memory) {
	const StringId indexKey = cpu.stringPool().intern("__index");
	const StringId key = cpu.stringPool().intern("inherited method");
	auto root = cpu.createTable(3, 4), middle = cpu.createTable(0, 1), holder = cpu.createTable(2, 4);
	root.setInteger(1, valueInteger(123));
	auto firstMeta = cpu.createTable(0, 1), secondMeta = cpu.createTable(0, 1);
	const auto first = firstMeta.setStringKey(indexKey, valueTable(middle.address()));
	const auto second = secondMeta.setStringKey(indexKey, valueTable(holder.address()));
	root.setMetatableAddress(firstMeta.address());
	middle.setMetatableAddress(secondMeta.address());
	const auto holderSlot = holder.setStringKey(key, valueInteger(41));

	DecodedInstruction decoded{};
	decoded.op = static_cast<u8>(OpCode::GETFIELD); decoded.width = 1; decoded.b = 1;
	decoded.baseCycles = BASE_CYCLES[decoded.op]; decoded.tableCacheSlot = -1;
	const std::array instructions{NativeBlockInstruction{&decoded, 0x1000u}};
	ValueSlots constants(1), registers(2);
	const Value receiver = valueTable(root.address());
	constants.set(0, valueString(key));
	registers.set(1, receiver);
	size_t bytes = 0;
	auto block = test::compileNative(instructions, bytes, memory, cpu.stringPool());
	auto& hint = block->sideExits[0].tableReadCache;
	NativeBlockRunState grant{.constants = constants.view(), .heap = &cpu.gcHeap()};
	const auto read = [&](Value want, int hops, TableLookupStatus status = TableLookupStatus::Resolved) {
		grant.remainingCycles = 100;
		registers.set(0, valueInteger(73));
		const auto* exit = block->run(registers.view(), grant);
		if (exit->exit == NativeBlockExit::Continue) {
			require(hops == 0 && registers.get(0) == want && grant.remainingCycles == 100 - decoded.baseCycles,
				"only an own-slot match completes directly");
			return;
		}
		require(exit->exit == NativeBlockExit::ReadField && exit->currentPc == instructions[0].pc
			&& exit->nextPc == instructions[0].pc + INSTRUCTION_BYTES && registers.get(0) == valueInteger(73)
			&& grant.remainingCycles == 100 - decoded.baseCycles,
			"the gate publishes the read boundary before resolving an unproved field");
		TableLookupResult result;
		root.resolveStringIndexPath(indexKey, key, hint.receiverSlot, result, hint);
		require(result.status == status && result.value == want && result.extraVisits == static_cast<u32>(hops),
			"the resolver follows live owners, preserves the raw result and counts each actual hop");
	};
	// Train the one-hop recipe against a holder with an array prefix.
	firstMeta.setStringKey(indexKey, valueTable(holder.address()));
	read(valueInteger(41), 1);
	read(valueInteger(41), 1);
	const auto neighbor = cpu.stringPool().intern("colliding receiver key");
	require((hashCanonicalTableKey(valueString(neighbor)) & 3u) == (hashCanonicalTableKey(valueString(key)) & 3u),
		"the receiver override must be displaced through a real hash link");
	root.setStringKey(neighbor, valueInteger(99));
	const auto ownSlot = root.setStringKey(key, valueBool(false));
	block->sideExits[0].tableReadCache.receiverSlot = -1;
	require(ownSlot != static_cast<int>(hashCanonicalTableKey(valueString(key)) & 3u),
		"the receiver's method is not in its home slot");
	read(valueBool(false), 0);
	require(hint.receiverSlot == ownSlot, "following the live chain rediscovers the shadow");
	firstMeta.setStringKey(indexKey, valueTable(middle.address()));
	root.setStringKey(key, valueNil());
	read(valueInteger(41), 2);
	require(hint.receiverSlot == ownSlot && hint.holderDepth == 2 && hint.holderSlot == holderSlot
		&& hint.indexSlots[0] == first && hint.indexSlots[1] == second,
		"the receiver guess survives an inherited hit and the cache learns the holder and actual path");
	const auto ram = memory.captureSaveState();
	const auto state = cpu.captureRuntimeState();

	holder.setStringKey(key, valueInteger(42));
	read(valueInteger(42), 2);
	for (int i = 0; i < 32; ++i) {
		holder.setStringKey(cpu.stringPool().intern("holder rehash " + std::to_string(i)), valueInteger(i));
		secondMeta.setStringKey(cpu.stringPool().intern("meta rehash " + std::to_string(i)), valueInteger(i));
		root.setStringKey(cpu.stringPool().intern("receiver rehash " + std::to_string(i)), valueInteger(i));
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
	read(valueInteger(41), 2);
	// Reuse object pages after dropping the holder edge. A recycled record
	// is not a valid holder unless the live __index member leads to it.
	secondMeta.setStringKey(indexKey, valueNil());
	cpu.collectHeap(receiver, valueString(key));
	require(cpu.gcHeap().tableRecordAddress(holder.address()) == 0, "the old holder really retired");
	auto reused = cpu.createTable(2, 4);
	require(reused.address() == holder.address(), "the probe actually reuses the old owner's guest address");
	reused.setStringKey(key, valueInteger(44));
	read(valueNil(), 1);
	secondMeta.setStringKey(indexKey, valueTable(reused.address()));
	read(valueInteger(44), 2);
}

void readsWithoutAProvedPathUseTheSemanticOwner(CPU& cpu, Memory& memory) {
	const auto key = cpu.stringPool().intern("native read field");
	const auto indexKey = cpu.stringPool().intern("__index");
	const auto other = cpu.stringPool().intern("other read field");
	ValueSlots constants(1); constants.set(0, valueString(key));
	const std::array values{valueFromTag(ValueTag::False, 37), valueFloat(-0.0f),
		valueFloatBits(0xffa12345u), valueTable(cpu.createTable().address()), valueString(other), valueNil()};
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
		const int cycles = instructionCharge(decoded);
		size_t bytes = 0;
		auto block = test::compileNative(source, bytes, memory, cpu.stringPool());
		auto table = cpu.createTable(0, 8);
		auto parent = cpu.createTable(0, 1);
		auto meta = cpu.createTable(0, 1);
		meta.setStringKey(indexKey, valueTable(parent.address())); table.setMetatableAddress(meta.address());
		for (const Value value : values) for (const int prediction : {-1, 100000}) {
			parent.setStringKey(key, value);
			block->sideExits[0].tableReadCache.receiverSlot = prediction;
			ValueSlots registers(11); for (size_t i = 0; i < registers.capacity(); ++i) registers.set(i, valueInteger(73));
			registers.set(0, valueTable(table.address())); registers.set(3, values[3]);
			registers.set(4, values[0]); registers.set(5, valueString(key));
			const auto heap = std::pair{cpu.luaHeap().usedBytes(), cpu.luaHeap().collectionTarget()};
			NativeBlockRunState state{.constants = constants.view(), .heap = &cpu.gcHeap(), .remainingCycles = 100};
			const auto* exit = block->run(registers.view(), state);
			const auto original = destination == 0 ? valueTable(table.address()) : destination == 1 ? valueString(key) : valueInteger(73);
			require(exit->exit == (op == OpCode::GETT ? NativeBlockExit::ReadIndex : NativeBlockExit::ReadField)
				&& exit->currentPc == source[3].pc && exit->nextPc == source[4].pc,
				"inherited and missing string reads leave for one semantic lookup");
			require(registers.get(destination) == original && registers.get(8) == values[3] && registers.get(9) == valueInteger(73)
				&& registers.get(2) == values[0] && registers.get(10) == valueInteger(73),
				"the gate publishes live prefix values without committing the destination or suffix");
			if (op == OpCode::SELF) require(registers.get(destination + 1) == valueTable(table.address()), "SELF retains its receiver before the read");
			require(cpu.luaHeap().usedBytes() == heap.first
				&& cpu.luaHeap().collectionTarget() == heap.second,
				"read resolution changes neither tracked allocation nor collection thresholds");
			require(state.remainingCycles == 100 - instructionCharge(std::span(decoded).first<4>()),
				"the native miss charges the started instruction, not unresolved visits or the suffix");
		}
		for (int mutation = 0; mutation < 4; ++mutation) {
			if (mutation == 0) block->sideExits[0].tableReadCache.receiverSlot = table.setStringKey(key, values[0]);
			if (mutation == 1) {
				for (int i = 0; i != 64; ++i) table.setStringKey(cpu.stringPool().intern("read_rehash_" + std::to_string(i)), valueInteger(i));
			}
			if (mutation == 2) { table.setStringKey(key, valueNil()); parent.setStringKey(key, valueInteger(91)); }
			if (mutation == 3) { meta.setStringKey(indexKey, valueBool(false)); }
			ValueSlots registers(11);
			registers.set(0, valueTable(table.address())); registers.set(5, valueString(key));
			NativeBlockRunState state{.constants = constants.view(), .heap = &cpu.gcHeap(), .remainingCycles = 100};
			const auto* exit = block->run(registers.view(), state);
			const bool hit = exit->exit == NativeBlockExit::Continue;
			require((mutation != 0 || hit)
				&& (mutation < 2 || !hit), "only a matching live own-slot prediction can complete the read");
			if (hit)
				require(exit->nextPc == decoded[6].bx && registers.get(destination) == values[0]
					&& state.remainingCycles == 100 - cycles, "a matching own lookup preserves raw bits and completes the suffix");
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
			NativeBlockRunState stringState{.heap = &cpu.gcHeap(), .remainingCycles = 100};
			const auto* stringExit = block->run(stringRegisters.view(), stringState);
			require(stringExit->exit == NativeBlockExit::ReadIndex && stringExit->nextPc == source[4].pc,
				"the mixed site leaves for its inherited string key");
			const int stringHint = block->sideExits[0].tableReadCache.receiverSlot;
			require(stringHint >= 0, "the site retains its prior own-slot prediction");
			for (const auto key : {valueInteger(-17), valueFloat(-17.0f), objectKey}) {
				ValueSlots registers(11);
				registers.set(0, valueTable(table.address()));
				registers.set(5, key);
				NativeBlockRunState state{.heap = &cpu.gcHeap(), .remainingCycles = 100};
				const auto* exit = block->run(registers.view(), state);
				require(exit->exit == NativeBlockExit::ReadIndex && exit->nextPc == source[4].pc
					&& state.remainingCycles == 100 - instructionCharge(std::span(decoded).first<4>()),
					"sparse numeric and object keys use the same precise semantic read boundary");
			}
			require(block->sideExits[0].tableReadCache.receiverSlot == stringHint, "non-string misses keep the string hint at the mixed site");
			ValueSlots registers(11);
			registers.set(0, valueTable(table.address()));
			registers.set(3, valueInteger(73));
			NativeBlockRunState state{.heap = &cpu.gcHeap(), .remainingCycles = 100};
			require(block->run(registers.view(), state)->exit == NativeBlockExit::ReadIndex && registers.get(9) == valueNil(),
				"a nil key still takes the precise side exit without executing the suffix");
		}
		// A real bounded-chain error still takes the precise semantic side exit.
		meta.setStringKey(indexKey, valueTable(table.address()));
		ValueSlots registers(11); for (size_t i = 0; i < registers.capacity(); ++i) registers.set(i, valueInteger(73));
		registers.set(0, valueTable(table.address())); registers.set(5, valueString(key));
		NativeBlockRunState state{.constants = constants.view(), .heap = &cpu.gcHeap(), .remainingCycles = 100};
		const auto* exit = block->run(registers.view(), state);
		require(exit->exit == (op == OpCode::GETT ? NativeBlockExit::ReadIndex : NativeBlockExit::ReadField)
			&& exit->currentPc == 0x100cu && registers.get(destination) == (destination == 0 ? valueTable(table.address()) : destination == 1 ? valueString(key) : valueInteger(73)),
			"chain exhaustion publishes the exact prefix without committing the read destination or suffix");
		if (op == OpCode::SELF) require(registers.get(destination + 1) == valueTable(table.address()), "failed SELF keeps the preceding receiver copy");
		registers.set(0, valueString(key));
		require(block->run(registers.view(), state) == exit, "string receivers retain the existing typed semantic path");
	}

	auto table = cpu.createTable(0, 1);
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
			decoded[1].tableCacheSlot = ownSlot;
			decoded[2].a = 2;
			decoded[3].bx = 0x2000;
			size_t bytes = 0;
			auto block = test::compileNative(source, bytes, memory, cpu.stringPool());
			ValueSlots registers(3);
			NativeBlockRunState state{.constants = constants.view(), .heap = &cpu.gcHeap(), .remainingCycles = 100};
			const auto* exit = block->run(registers.view(), state);
			const bool tableReceiver = valueIsTable(receiver);
			require((tableReceiver ? exit->exit == NativeBlockExit::Continue && exit->nextPc == decoded[3].bx
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
	const auto key = cpu.stringPool().intern("bounded lookup");
	const auto indexKey = cpu.stringPool().intern("__index");
	const u32 home = hashCanonicalTableKey(valueString(key)) & 1u;
	auto collision = cpu.stringPool().intern("bounded collision a");
	if ((hashCanonicalTableKey(valueString(collision)) & 1u) != home)
		collision = cpu.stringPool().intern("bounded collision b");
	ValueSlots constants(1);
	constants.set(0, valueString(key));
	const auto firstResult = valueFloatBits(0xffa12345u), secondResult = valueFromTag(ValueTag::False, 73);
	for (const auto op : {OpCode::GETFIELD, OpCode::SELF, OpCode::GETT}) {
		DecodedInstruction lookup{}, suffix{};
		lookup.op = static_cast<u8>(op);
		lookup.a = 2; lookup.b = 0; lookup.c = op == OpCode::GETT ? 1 : 0;
		lookup.tableCacheSlot = -1;
		lookup.width = suffix.width = 1;
		suffix.op = static_cast<u8>(OpCode::K1); suffix.a = 4;
		lookup.baseCycles = BASE_CYCLES[lookup.op];
		suffix.baseCycles = BASE_CYCLES[suffix.op];
		const std::array source{NativeBlockInstruction{&lookup, 0x1000u}, NativeBlockInstruction{&suffix, 0x1004u}};
		size_t bytes = 0;
		auto block = test::compileNative(source, bytes, memory, cpu.stringPool());
		auto table = cpu.createTable(0, 2), meta = cpu.createTable(0, 1);
		auto holder = cpu.createTable(0, 1), nextHolder = cpu.createTable(0, 1);
		holder.setStringKey(key, firstResult);
		nextHolder.setStringKey(key, secondResult);
		meta.setStringKey(indexKey, valueTable(holder.address()));
		table.setMetatableAddress(meta.address());
		const auto slow = op == OpCode::GETT ? NativeBlockExit::ReadIndex : NativeBlockExit::ReadField;
		auto& cache = block->sideExits[0].tableReadCache;
		const auto run = [&](const TableRecord& base, int grant, Value result) {
			ValueSlots registers(5);
			registers.set(0, valueTable(base.address()));
			registers.set(1, valueString(key));
			registers.set(2, valueInteger(31));
			registers.set(3, valueInteger(32));
			registers.set(4, valueInteger(33));
			NativeBlockRunState state{.constants = constants.view(), .heap = &cpu.gcHeap(),
				.tableIndexKey = indexKey, .remainingCycles = grant};
			const auto* exit = block->run(registers.view(), state);
			require(registers.get(3) == (op == OpCode::SELF ? registers.get(0) : valueInteger(32)),
				"SELF keeps its original receiver independently of a one-hop hit");
			const int debt = grant - lookup.baseCycles;
			if (isNil(result)) {
				require(exit->exit == slow && exit->currentPc == source[0].pc && exit->nextPc == source[1].pc
					&& state.remainingCycles == debt && registers.get(2) == valueInteger(31)
					&& registers.get(4) == valueInteger(33) && state.registerTop == (op == OpCode::SELF ? 4 : 0),
					"an unproved path performs no inherited work or destination write before the semantic owner");
			} else {
				const bool completedSuffix = debt > TABLE_INDEX_VISIT_CYCLES;
				require(exit->exit == NativeBlockExit::Continue && exit->currentPc == source[completedSuffix].pc
					&& state.remainingCycles == debt - TABLE_INDEX_VISIT_CYCLES - (completedSuffix ? suffix.baseCycles : 0)
					&& registers.get(2) == result && registers.get(4) == valueInteger(completedSuffix ? 1 : 33)
					&& state.registerTop == (completedSuffix ? 5 : op == OpCode::SELF ? 4 : 3),
					"one native hop preserves exact value bits and charges the extra visit before admitting its successor");
			}
		};
		run(table, 100, valueNil());
		TableLookupResult result;
		table.resolveStringIndexPath(indexKey, key, cache.receiverSlot, result, cache);
		require(result.value == firstResult && result.extraVisits == 1 && cache.holderDepth == 1,
			"the semantic lookup trains exactly one hop");
		for (const int grant : {1, lookup.baseCycles + TABLE_INDEX_VISIT_CYCLES,
			lookup.baseCycles + TABLE_INDEX_VISIT_CYCLES + 1}) run(table, grant, firstResult);

		table.setStringKey(collision, valueInteger(42));
		require(table.setStringKey(key, secondResult) != static_cast<i32>(home) && cache.receiverSlot == -1,
			"the stale receiver prediction is absent while the live own mapping is in a collision node");
		run(table, 100, valueNil());

		auto other = cpu.createTable();
		other.setMetatableAddress(meta.address());
		run(other, 100, firstResult);
		meta.setStringKey(indexKey, valueTable(nextHolder.address()));
		run(other, 100, secondResult);
		nextHolder.setStringKey(key, valueNil());
		run(other, 100, valueNil());
		meta.setStringKey(indexKey, valueBool(false));
		run(other, 100, valueNil());
	}
}

void storesRequireAPredictedOverwrite(CPU& cpu, Memory& memory) {
	const StringId key = cpu.stringPool().intern("native write field");
	ValueSlots constants(2); constants.set(0, valueString(key)); constants.set(1, valueFromTag(ValueTag::False, 37));
	const std::array values{valueFromTag(ValueTag::False, 37), valueFloat(-0.0f),
		valueFloatBits(0xffa12345u), valueTable(cpu.createTable().address()), valueString(key), valueNil()};
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
		const int cycles = instructionCharge(decoded);
		size_t bytes = 0;
		auto block = test::compileNative(source, bytes, memory, cpu.stringPool());
		auto parent = cpu.createTable(0, 1); parent.setStringKey(key, valueInteger(71));
		auto meta = cpu.createTable(0, 1); meta.setStringKey(cpu.stringPool().intern("__index"), valueTable(parent.address()));
		for (size_t n = 0; n < values.size(); ++n) {
			auto table = cpu.createTable(0, 8); table.setMetatableAddress(meta.address());
			// Different receiver layouts share this one prediction site.
			for (size_t prior = 0; prior < n; ++prior)
				table.setStringKey(cpu.stringPool().intern("prior_" + std::to_string(prior)), valueInteger(prior));
			const auto previous = valueInteger(91);
			for (const bool own : {false, true}) for (const Value value : {values[n], valueNil()}) {
				block->sideExits[0].tableStore.slot = table.setStringKey(key, own ? previous : valueNil());
				ValueSlots registers(10); for (size_t i = 0; i < registers.capacity(); ++i) registers.set(i, valueInteger(73));
				registers.set(0, valueTable(table.address())); registers.set(3, values[n]); registers.set(4, value);
				const auto before = table.trackedHeapBytes();
				NativeBlockRunState state{.constants = constants.view(), .heap = &cpu.gcHeap(), .remainingCycles = 100};
				const auto* exit = block->run(registers.view(), state);
				const Value expected = constant ? constants.get(1) : value;
				const bool hit = own && !isNil(expected);
				require(hit ? exit->exit == NativeBlockExit::Continue && exit->currentPc == source[5].pc && exit->nextPc == decoded[5].bx
					: exit->exit == (generic ? NativeBlockExit::WriteIndex : NativeBlockExit::WriteField)
						&& exit->currentPc == source[3].pc && exit->nextPc == source[4].pc,
					"only a predicted non-nil overwrite runs directly; shape changes enter the semantic owner");
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
		auto empty = cpu.createTable();
		ValueSlots registers(10);
		registers.set(0, valueTable(empty.address())); registers.set(3, values[3]); registers.set(4, values[3]);
		NativeBlockRunState state{.constants = constants.view(), .heap = &cpu.gcHeap(), .remainingCycles = 100};
		const auto* exit = block->run(registers.view(), state);
		require(exit->exit == (generic ? NativeBlockExit::WriteIndex : NativeBlockExit::WriteField),
			"missing capacity retains the allocating semantic exit");
		require(empty.storedSlotCount() == 0 && isNil(empty.getStringKey(key)), "growth admission does not mutate the table");
		require(registers.get(8) == values[3] && registers.get(2) == values[3] && isNil(registers.get(9)),
			"growth publishes the prefix roots without executing the suffix");

		auto full = cpu.createTable(0, 1);
		const auto resident = cpu.stringPool().intern("resident field");
		full.setStringKey(resident, valueInteger(71));
		require(full.hashSlots() == 1 && full.hashFree() == 0, "the full hash still has a live free cursor");
		const size_t header = full.address() & RAM_RECORD_WORD_MASK;
		const size_t backing = full.storageAddress() & RAM_RECORD_WORD_MASK;
		std::array<u8, TableRecord::HEADER_BYTES> oldHeader;
		std::array<u8, 14> oldBacking;
		std::copy_n(memory.ramData() + header, oldHeader.size(), oldHeader.begin());
		std::copy_n(memory.ramData() + backing, oldBacking.size(), oldBacking.begin());
		registers.set(0, valueTable(full.address()));
		block->sideExits[0].tableStore.slot = 0;
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
	auto table = cpu.createTable(4, 2);
	auto model = cpu.createTable(4, 2);
	const Value ref = valueTable(table.address());
	const u32 storage = table.storageAddress();
	const u32 backing = table.address() + static_cast<u32>(TableHeader::Storage);
	memory.writeRamRecordWord(backing, storage + MAIN_RAM_SIZE);
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
		size_t bytes = 0;
		auto block = test::compileNative(source, bytes, memory, cpu.stringPool());
		ValueSlots registers(3);
		registers.set(0, ref);
		NativeBlockRunState state{.heap = &cpu.gcHeap()};
		for (int index : {1, 2, 4, 3, 4, 2, 1}) {
			const int slot = generic ? index : 1;
			for (Value v : {valueFloatBits(0xffa12345), ref, valueNil()}) {
				registers.set(1, valueInteger(slot));
				registers.set(2, v);
				state.remainingCycles = 100;
				const u32 hint = table.lengthHint();
				const Value previous = table.getInteger(slot);
				const bool changesHint = static_cast<u32>(slot - !isNil(v)) == hint;
				model.setInteger(slot, v);
				const auto* exit = block->run(registers.view(), state);
				if (changesHint) {
					require(exit->exit == (generic ? NativeBlockExit::WriteIndex : NativeBlockExit::WriteInteger)
						&& exit->currentPc == source[0].pc && exit->nextPc == source[1].pc
						&& registers.get(1) == valueInteger(slot) && table.getInteger(slot) == previous && table.lengthHint() == hint,
						"an array write that changes the hint leaves both planes and the length word untouched");
					table.setInteger(slot, v);
				} else {
					require(exit->exit == NativeBlockExit::Continue && exit->currentPc == source[1].pc
						&& exit->nextPc == source[1].pc + INSTRUCTION_BYTES && registers.get(1) == v && table.getInteger(slot) == v,
						"no-hint array writes and aliased loads transfer both raw planes");
				}
				u32 probes, expectedProbes;
				require(TableRecord::length(&table, &probes) == TableRecord::length(&model, &expectedProbes) && probes == expectedProbes,
					"the owner settles hint changes before later length probes");
				require(state.remainingCycles == 100 - write.baseCycles - (changesHint ? 0 : read.baseCycles),
					"only the direct path completes the following read");
			}
		}
		if (generic) {
			auto child = cpu.createTable();
			auto metatable = cpu.createTable(0, 1);
			metatable.setStringKey(cpu.stringPool().intern("__mode"), valueString(cpu.stringPool().intern("v")));
			table.setMetatableAddress(metatable.address());
			model.setMetatableAddress(metatable.address());
			table.setInteger(1, valueInteger(71));
			model.setInteger(1, valueInteger(71));
			require(table.lengthHint() != 0u, "the barrier case does not also change the length hint");
			cpu.gcHeap().step(valueTable(model.address()), ref, valueNil());
			require(memory.readRamRecordByte(table.address() + GC_COLOR_OFFSET) == 3, "array receiver was actually scanned before inserting the new edge");
			registers.set(1, valueInteger(1));
			registers.set(2, valueTable(child.address()));
			const Value previous = table.getInteger(1);
			const u32 header = table.address();
			const u32 head = cpu.gcHeap().changedHeadOffset();
			const u32 previousLink = memory.readRamRecordWord(header + GC_RECORD_LINK);
			const u32 weakLink = previousLink & ~GC_GRAY_INDEX_MASK;
			require(weakLink != 0, "the table is also linked to a second weak table");
			model.setInteger(1, valueTable(cpu.createTable().address()));
			const u32 previousHead = memory.readRamRecordWord(head);
			require(previousHead == ((model.address() & GC_RECORD_MASK) >> GC_RECORD_SHIFT), "scalar Table write publishes the prior link");
			for (const u32 watched : {header, header + GC_RECORD_LINK, head}) {
				const u32 word = (watched & MAPPED_PAGE_BYTE_MASK) / sizeof(u32);
				MappedPageBinding binding{};
				memory.bindMappedPage(watched | RAM_BASE, MAPPED_BUS_MASTER_CPU, binding);
				binding.writeWatch.armWord(word);
				state.remainingCycles = 100;
				const auto* miss = block->run(registers.view(), state);
				require(miss->exit == NativeBlockExit::WriteIndex && miss->nextPc == source[1].pc
					&& table.getInteger(1) == previous && memory.readRamRecordByte(header + GC_COLOR_OFFSET) == 3
					&& memory.readRamRecordWord(header + GC_RECORD_LINK) == previousLink
					&& memory.readRamRecordWord(head) == previousHead,
					"a watched barrier word stops the store before either the value or the queue changes");
				require(binding.writeWatch.consume(word, word + 1), "the declined operation left the watch armed");
			}
			state.remainingCycles = 100;
			const auto* exit = block->run(registers.view(), state);
			require(exit->exit == NativeBlockExit::WriteIndex && exit->currentPc == source[0].pc && exit->nextPc == source[1].pc
				&& table.getInteger(1) == previous && memory.readRamRecordByte(header + GC_COLOR_OFFSET) == 3
				&& memory.readRamRecordWord(header + GC_RECORD_LINK) == previousLink
				&& memory.readRamRecordWord(head) == previousHead, "barrier work leaves through the same untouched gate even without watches");
			table.setInteger(1, valueTable(child.address()));
			require(table.getInteger(1) == valueTable(child.address()) && memory.readRamRecordByte(header + GC_COLOR_OFFSET) == 2
				&& memory.readRamRecordWord(header + GC_RECORD_LINK) == (weakLink | previousHead)
				&& memory.readRamRecordWord(head) == ((header & GC_RECORD_MASK) >> GC_RECORD_SHIFT),
				"the owner writes the edge and links the scanned Table onto the physical changed queue");
		}
		if (generic) for (Value k : {valueInteger(0), valueInteger(-1), valueInteger(5), valueFloat(1), valueBool(true)}) {
			registers.set(1, k);
			state.remainingCycles = 100;
			require(block->run(registers.view(), state) == &block->sideExits.front() && registers.get(1) == k,
				"non-array key leaves at its precise store for full table semantics");
		}
	}
	memory.writeRamRecordWord(backing, storage);
}

void rawTablePayloadUsesRamWithoutAnObject(CPU& cpu, Memory& memory) {
	const u32 record = RAM_BASE + 0x20000u;
	const u32 body = record + TableRecord::HEADER_BYTES;
	// Supply a header and backing through RAM, without constructing a Table.
	memory.writeRamRecordByte(record, static_cast<u8>(ValueTag::Table));
	memory.writeRamRecordWord(record + static_cast<u32>(TableHeader::Storage), body + MAIN_RAM_SIZE);
	memory.writeRamRecordWord(record + static_cast<u32>(TableHeader::Array), 1);
	memory.writeRamRecordWord(record + static_cast<u32>(TableHeader::Length), 1);
	const u32 mirror = record + MAIN_RAM_SIZE + 1u; // word accesses also discard the low two bits
	require(cpu.gcHeap().tableRecordAddress(record) == 0u, "the raw datapath does not require a collector header");

	DecodedInstruction write{}, read{};
	write.op = static_cast<u8>(OpCode::SETI); read.op = static_cast<u8>(OpCode::GETI);
	write.a = read.b = 0; write.b = read.c = 1; write.c = 2; read.a = 3;
	write.width = read.width = 1;
	write.baseCycles = BASE_CYCLES[write.op]; read.baseCycles = BASE_CYCLES[read.op];
	const std::array source{NativeBlockInstruction{&write, 0x1000}, NativeBlockInstruction{&read, 0x1004}};
	size_t bytes = 0;
	auto block = test::compileNative(source, bytes, memory, cpu.stringPool());
	ValueSlots registers(4); registers.set(0, valueTable(mirror)); registers.set(2, valueInteger(83));
	NativeBlockRunState state{.heap = &cpu.gcHeap(), .remainingCycles = 100};
	const auto* arrayHit = block->run(registers.view(), state);
	require(arrayHit->exit == NativeBlockExit::Continue && arrayHit->currentPc == source[1].pc && registers.get(3) == valueInteger(83),
		"both array operations execute in native code without a host object");
	require(TableRecord(cpu.gcHeap(), mirror).getInteger(1) == valueInteger(83)
		&& memory.readRamRecordWord(body) == 83 && memory.readRamRecordByte(body + 4) == static_cast<u8>(ValueTag::Integer),
		"scalar and native use the same per-width aliases for header and backing");

	auto& watches = memory.ramWriteWatches();
	// Give the raw byte port a black mark without changing the aligned header's
	// mark lane. A write watch on that word must precede the slot mutation.
	memory.writeRamRecordByte(mirror + GC_COLOR_OFFSET, 3u);
	const u32 markWord = (mirror + GC_COLOR_OFFSET) & RAM_RECORD_WORD_MASK;
	watches.armCodeRange(markWord, sizeof(u32));
	registers.set(2, valueInteger(46)); state.remainingCycles = 100;
	const auto* scalarStore = block->run(registers.view(), state);
	require(scalarStore->exit == NativeBlockExit::Continue && scalarStore->currentPc == source[1].pc
		&& memory.readRamRecordWord(body) == 46
		&& memory.readRamRecordByte(mirror + GC_COLOR_OFFSET) == 3u, "a scalar store does not touch the mirrored mark");
	registers.set(2, valueTable(cpu.createTable().address())); state.remainingCycles = 100;
	require(block->run(registers.view(), state)->exit == NativeBlockExit::WriteInteger
		&& memory.readRamRecordWord(body) == 46
		&& memory.readRamRecordByte(mirror + GC_COLOR_OFFSET) == 3u,
		"the collector tests the raw mirrored mark byte, not the rounded table-header word address");
	watches.clearCodeRange(markWord, sizeof(u32));
	memory.writeRamRecordByte(mirror + GC_COLOR_OFFSET, 0u);

	const u32 key = cpu.stringPool().intern("wrapped tag") | 0x80000000u;
	constexpr u32 hash = 2;
	const u32 keySlot = hashCanonicalTableKey(valueString(key)) & (hash - 1u), valueSlot = keySlot + hash;
	const u32 tags = MAIN_RAM_SIZE - 1u - keySlot, hashBody = tags - 3u * hash * sizeof(u32);
	memory.writeRamRecordWord(record + static_cast<u32>(TableHeader::Storage), hashBody);
	memory.writeRamRecordWord(record + static_cast<u32>(TableHeader::Array), 0);
	memory.writeRamRecordWord(record + static_cast<u32>(TableHeader::Hash), hash);
	memory.writeRamRecordWord(hashBody + keySlot * sizeof(u32), key);
	memory.writeRamRecordByte(tags + keySlot, static_cast<u8>(ValueTag::String));
	memory.writeRamRecordWord(hashBody + valueSlot * sizeof(u32), 19);
	memory.writeRamRecordByte(tags + valueSlot, static_cast<u8>(ValueTag::Integer));
	read.op = static_cast<u8>(OpCode::GETFIELD); read.c = 0; read.baseCycles = BASE_CYCLES[read.op];
	write.op = static_cast<u8>(OpCode::SETFIELD); write.b = 0; write.baseCycles = BASE_CYCLES[write.op];
	read.tableCacheSlot = write.tableCacheSlot = static_cast<int>(keySlot);
	const std::array fields{NativeBlockInstruction{&read, 0x1000}, NativeBlockInstruction{&write, 0x1004}};
	ValueSlots constants(1); constants.set(0, valueString(key));
	auto fieldBlock = test::compileNative(fields, bytes, memory, cpu.stringPool());
	state.constants = constants.view();
	registers.set(2, valueFromTag(ValueTag::False, 37));
	watches.armHistoryWrites();
	watches.consumeHistoryWrites(hashBody, 1);
	state.remainingCycles = 100;
	const auto* stopped = fieldBlock->run(registers.view(), state);
	require(stopped->exit == NativeBlockExit::WriteField && registers.get(3) == valueInteger(19)
		&& memory.readRamRecordWord(hashBody + valueSlot * sizeof(u32)) == 19,
		"the predicted read matches all 32 key bits across the RAM seam, and a clean tag page stops both store planes");
	watches.disarmHistoryWrites();
	state.remainingCycles = 100;
	const auto* fieldHit = fieldBlock->run(registers.view(), state);
	require(fieldHit->exit == NativeBlockExit::Continue && fieldHit->currentPc == fields[1].pc
		&& TableRecord(cpu.gcHeap(), mirror).getStringKey(key) == registers.get(2),
		"the predicted write uses the same mirrored byte as the reader");

	// Move the word plane itself across the seam. A nonzero low address
	// offset still belongs to the tags, not the aligned payload words.
	const u32 wrappedWords = MAIN_RAM_SIZE - (keySlot + 1u) * sizeof(u32) + 1u;
	const u32 wrappedTags = wrappedWords + 3u * hash * sizeof(u32);
	memory.writeRamRecordWord(record + static_cast<u32>(TableHeader::Storage), wrappedWords);
	memory.writeRamRecordWord(wrappedWords + keySlot * sizeof(u32), key);
	memory.writeRamRecordByte(wrappedTags + keySlot, static_cast<u8>(ValueTag::String));
	memory.writeRamRecordWord(wrappedWords + valueSlot * sizeof(u32), 0xffa12345u);
	memory.writeRamRecordByte(wrappedTags + valueSlot, static_cast<u8>(ValueTag::Float));
	registers.set(2, valueFromTag(ValueTag::True, 33));
	state.remainingCycles = 100;
	const auto* wrappedHit = fieldBlock->run(registers.view(), state);
	require(wrappedHit->exit == NativeBlockExit::Continue && wrappedHit->currentPc == fields[1].pc
		&& registers.get(3) == valueFloatBits(0xffa12345u)
		&& memory.readRamRecordWord(MAIN_RAM_SIZE + sizeof(u32)) == 33u
		&& memory.readRamRecordWord(MAIN_RAM_SIZE - sizeof(u32)) == key
		&& TableRecord(cpu.gcHeap(), mirror).getStringKey(key) == registers.get(2),
		"native field hits advance and mirror both physical offsets independently");
}

void watchedTableWordOrTagLeavesBeforeWriting(CPU& cpu, Memory& memory) {
	// Instruction watches belong to public RAM. Keep the forensic raw Table
	// alias and its backing in reserved static workspace, not in the private heap.
	require(cpu.heapAllocator().setFloor(DYNAMIC_RAM_BASE + 0x10000u), "reserve the public static alias workspace before watching it");
	const auto sourceHeader = cpu.createTable(4096, 0);
	const u32 record = DYNAMIC_RAM_BASE + 0x6000u, words = DYNAMIC_RAM_BASE;
	for (u32 offset = 0; offset < TableRecord::HEADER_BYTES; offset += sizeof(u32))
		memory.writeRamRecordWord(record + offset, memory.readRamRecordWord(sourceHeader.address() + offset));
	memory.writeRamRecordWord(record + static_cast<u32>(TableHeader::Storage), words);
	TableRecord table(cpu.gcHeap(), record);
	const u32 tags = words + 4096u * 4u;
	DecodedInstruction store{};
	store.op = static_cast<u8>(OpCode::SETI);
	store.a = 0; store.b = 1; store.c = 2; store.width = 1;
	store.baseCycles = BASE_CYCLES[store.op];
	const std::array source{NativeBlockInstruction{&store, 0x1000u}};
	size_t bytes = 0;
	auto block = test::compileNative(source, bytes, memory, cpu.stringPool());
	ValueSlots registers(3);
	registers.set(0, valueTable(table.address()));
	registers.set(2, valueFloatBits(0x80000000u));
	NativeBlockRunState state{.heap = &cpu.gcHeap()};
	const u32 hint = table.address() + static_cast<u32>(TableHeader::Length);
	for (const u32 address : {words, tags}) {
		table.setInteger(1, valueInteger(101));
		require(table.lengthHint() == 1u, "the watched overwrite cannot change the hint");
		MappedPageBinding binding;
		memory.bindMappedPage(address, MAPPED_BUS_MASTER_CPU, binding);
		require(binding.readBytes != nullptr && address < memory.ramBusEnd(), "every watched alias is on the public RAM bus");
		const u32 slot = (address & MAPPED_PAGE_BYTE_MASK) >> 2;
		binding.writeWatch.armWord(slot);
		state.remainingCycles = 100;
		require(block->run(registers.view(), state)->exit == NativeBlockExit::WriteInteger && table.getInteger(1) == valueInteger(101),
			"watching either destination plane leaves both lanes untouched");
		table.setInteger(1, registers.get(2));
		require(!binding.writeWatch.consume(slot, slot + 1u) && table.getInteger(1) == registers.get(2),
			"the record write invalidates the physical code watch");
	}
	const auto unrelated = (words + sizeof(u32)) & RAM_RECORD_WORD_MASK;
	auto& watches = memory.ramWriteWatches();
	watches.armCodeRange(unrelated, sizeof(u32));
	state.remainingCycles = 100;
	require(block->run(registers.view(), state)->exit == NativeBlockExit::Continue && watches.anyWatched(unrelated, sizeof(u32)),
		"an unrelated watch on the destination page does not route an overwrite through the gate");
	watches.clearCodeRange(unrelated, sizeof(u32));

	memory.writeRamRecordWord(hint, 0u);
	const auto hintOffset = hint & RAM_RECORD_WORD_MASK;
	watches.armCodeRange(hintOffset, sizeof(u32));
	state.remainingCycles = 100;
	require(block->run(registers.view(), state)->exit == NativeBlockExit::WriteInteger && table.lengthHint() == 0u
		&& watches.anyWatched(hintOffset, sizeof(u32)), "an effectful hint update belongs to the semantic owner");
	table.setInteger(1, registers.get(2));
	require(table.lengthHint() == 1u && !watches.anyWatched(hintOffset, sizeof(u32)), "only the owner consumes the hint watch");

	// The raw payload aliases the hint. The owner sees a zero after writing
	// the input word, then advances it to one despite the pre-write hint.
	memory.writeRamRecordWord(record + static_cast<u32>(TableHeader::Storage), hint);
	memory.writeRamRecordWord(record + static_cast<u32>(TableHeader::Array), 1u);
	registers.set(2, valueInteger(0));
	const auto freeWord = memory.readRamRecordWord(record + static_cast<u32>(TableHeader::Free));
	state.remainingCycles = 100;
	require(block->run(registers.view(), state)->exit == NativeBlockExit::WriteInteger && table.lengthHint() == 1u
		&& memory.readRamRecordWord(record + static_cast<u32>(TableHeader::Free)) == freeWord,
		"a physical lane alias cannot invalidate a pre-write hint proof");
	table.setInteger(1, registers.get(2));
	require(table.lengthHint() == 1u && table.getInteger(1) == valueInteger(1),
		"the owner updates the post-write aliased hint using the ordinary record order");
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
	auto block = test::compileNative(source, bytes, memory, cpu.stringPool());
	auto table = cpu.createTable(0, 128);
	for (int bit = 30; bit >= 0; --bit) table.set(valueInteger(i32{1} << bit), valueBool(false));
	const Value root = valueTable(cpu.createTable().address());
	const int cycles = instructionCharge(decoded);
	const int prefixCycles = instructionCharge(std::span(decoded).first<2>());
	for (const i32 expected : {1 << 30, INT32_MAX}) {
		if (expected == INT32_MAX) table.set(valueInteger(expected), valueBool(false));
		ValueSlots registers(7);
		registers.set(0, valueTable(table.address())); registers.set(1, root);
		const int probeCycles = TABLE_LENGTH_PROBE_CYCLES * (expected == INT32_MAX ? 32 : 61);
		const int grant = cycles + probeCycles + 1;
		NativeBlockRunState state{.constants = {}, .heap = &cpu.gcHeap(), .remainingCycles = grant};
		const auto* exit = block->run(registers.view(), state);
		require(exit->exit == NativeBlockExit::Continue && exit->currentPc == source[3].pc && exit->nextPc == decoded[3].bx,
			"table LEN and its suffix stay in one native invocation");
		require(registers.get(0) == valueInteger(expected), "native LEN returns a full signed Integer boundary and supports source aliasing");
		require(registers.get(5) == root && registers.get(6) == root, "live raw references survive the nonallocating length call");
		require(state.remainingCycles == 1, "length search charges its literal logical presence work once");

		for (const int shortGrant : {static_cast<int>(decoded[0].baseCycles) + 1, prefixCycles + probeCycles}) {
			registers.set(0, valueTable(table.address()));
			registers.set(5, valueNil());
			registers.set(6, valueNil());
			state.remainingCycles = shortGrant;
			state.registerTop = 0;
			const auto* boundary = block->run(registers.view(), state);
			require(boundary->exit == NativeBlockExit::Continue && boundary->currentPc == source[1].pc
				&& boundary->nextPc == source[2].pc && state.remainingCycles == shortGrant - prefixCycles - probeCycles,
				"LEN may exhaust its grant, but its continuation cannot begin");
			require(registers.get(0) == valueInteger(expected) && registers.get(6) == root && isNil(registers.get(5))
				&& state.registerTop == 7, "an exhausted LEN publishes its result and prefix, not the following MOV");
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
		decoded[5].bx = 0x4000u;
		size_t bytes = 0;
		auto block = test::compileNative(source, bytes, memory, cpu.stringPool());
		auto table = cpu.createTable(2);
		table.setInteger(1, valueInteger(23));
		for (const Value first : {valueTable(table.address()), valueNil()}) for (const Value next : {valueTable(table.address()), valueNil()}) {
			ValueSlots registers(6);
			registers.set(1, first); registers.set(4, next);
			NativeBlockRunState state{.heap = &cpu.gcHeap(), .remainingCycles = 100};
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
				require(exit->exit == NativeBlockExit::Continue && exit->nextPc == decoded[5].bx && registers.get(2) == valueInteger(23)
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
	decoded[4].bx = 0x4000u;
	decoded[5].a = 0; decoded[5].b = 4;
	decoded[6].bx = 0x3008u;
	decoded[7].a = 0; decoded[7].b = 6;
	decoded[8].bx = 0x3008u;
	const std::array sources{NativeBlockSource{std::span(instructions).first<5>()}, NativeBlockSource{std::span(instructions.data() + 5, 2)},
		NativeBlockSource{std::span(instructions.data() + 7, 2)}};
	size_t bytes = 0;
	auto blocks = NativeCompiler::compile(sources, NativeCodeBindings(memory, cpu.stringPool()));
	blocks.front()->region->publish(bytes);
	constexpr std::array entryIndices{0u, 2u, 5u, 7u};
	std::array<const NativeBlock*, entryIndices.size()> entries;
	for (size_t i = 0; i < entries.size(); ++i) {
		const auto block = std::find_if(blocks.begin(), blocks.end(), [&](const auto& block) {
			return block->firstPc == instructions[entryIndices[i]].pc;
		});
		require(block != blocks.end(), "each independent entry is published at its guest PC");
		entries[i] = block->get();
	}
	auto table = cpu.createTable(2); table.setInteger(1, valueInteger(23));
	for (const auto* entry : entries) for (const bool valid : {false, true}) {
		ValueSlots registers(7);
		for (int guest : {0, 1, 4, 6}) registers.set(guest, valid ? valueTable(table.address()) : valueNil());
		NativeBlockRunState state{.heap = &cpu.gcHeap(), .remainingCycles = 100};
		const auto* exit = entry->run(registers.view(), state);
		if (valid) {
			require(exit->exit == NativeBlockExit::Continue && exit->nextPc == decoded[4].bx
				&& registers.get(3) == valueInteger(23) && registers.get(5) == valueInteger(1),
				"successful fallthrough and both independent entries retain their table receiver");
		} else if (entry == entries.front()) {
			require(exit->exit == NativeBlockExit::ReadInteger && exit->currentPc == 0x3004u,
				"the first receiver guard still takes its semantic exit");
		} else {
			require(exit->exit == NativeBlockExit::ReadInteger && exit->currentPc == 0x300cu
				&& registers.get(0) == valueNil() && registers.get(5) == valueInteger(1),
				"external and internal entries check their actual receiver at the access");
		}
	}
	ValueSlots registers(7);
	registers.set(6, valueTable(table.address()));
	NativeBlockRunState state{.heap = &cpu.gcHeap(), .remainingCycles = 100};
	require(entries[2]->run(registers.view(), state)->exit == NativeBlockExit::ReadInteger && registers.get(0) == valueNil(),
		"the first internal predecessor cannot reuse the second predecessor's table fact");
	state.remainingCycles = 100;
	const auto* exit = entries[3]->run(registers.view(), state);
	require(exit->exit == NativeBlockExit::Continue && exit->nextPc == decoded[4].bx && registers.get(3) == valueInteger(23),
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
		const std::array unusedSources{NativeBlockSource{std::span(unusedInstructions).first<5>()}};
		auto blocks = NativeCompiler::compile(unusedSources, NativeCodeBindings(memory, cpu.stringPool()));
		blocks.front()->region->publish(bytes);
		ValueSlots registers(6);
		NativeBlockRunState state{.heap = &cpu.gcHeap(), .remainingCycles = 100};
		const auto* exit = blocks[1]->run(registers.view(), state);
		require(exit->exit == NativeBlockExit::Continue && exit->nextPc == unusedDecoded[4].bx && registers.get(5) == valueInteger(1),
			"an inherited but unused table fact does not reject an independent entry");
	}
	{
		const std::array usedSources{NativeBlockSource{std::span(instructions.data(), 2)},
			NativeBlockSource{std::span(instructions.data() + 2, 2)},
			NativeBlockSource{std::span(instructions.data() + 4, 2)}};
		auto blocks = NativeCompiler::compile(usedSources, NativeCodeBindings(memory, cpu.stringPool()));
		blocks.front()->region->publish(bytes);
		ValueSlots registers(6);
		NativeBlockRunState state{.heap = &cpu.gcHeap(), .remainingCycles = 100};
		const auto* exit = blocks[1]->run(registers.view(), state);
		require(exit->exit == NativeBlockExit::ReadInteger && exit->currentPc == 0x5010u
			&& registers.get(5) == valueInteger(1),
			"a copied receiver is checked at the field access after fallthrough");
		auto table = cpu.createTable(2); table.setInteger(1, valueInteger(23));
		registers.set(0, valueTable(table.address())); state.remainingCycles = 100;
		const auto* hit = blocks[1]->run(registers.view(), state);
		require(hit->exit == NativeBlockExit::Continue && hit->nextPc == decoded[5].bx && registers.get(3) == valueInteger(23),
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
		const std::array sources{NativeBlockSource{std::span(instructions).first<11>()}};
		size_t bytes = 0;
		auto blocks = NativeCompiler::compile(sources, NativeCodeBindings(memory, cpu.stringPool()));
		blocks.front()->region->publish(bytes);
		ValueSlots registers(11);
		for (int operand : {4, 5, 6, 7}) registers.set(operand, valueInteger(0));
		NativeBlockRunState state{.heap = &cpu.gcHeap(), .remainingCycles = 100};
		const auto* exit = blocks[1]->run(registers.view(), state);
		require(exit->exit == NativeBlockExit::ReadInteger && exit->currentPc == 0x7024u,
			"an overwritten or evicted table fact does not guard an earlier independent entry");
		require(registers.get(4) == valueInteger(1), "ordinary prefix definitions execute before the later table fault");
	}
}
} // namespace

int main() {
	try {
		Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
		IrqController irq(memory); ExecutionAddressSpace addresses(memory); CPU cpu(memory, irq, addresses);
		inheritedReadFollowsLiveOwners(cpu, memory);
		readsWithoutAProvedPathUseTheSemanticOwner(cpu, memory);
		oneHopStringReadsProveTheCurrentPath(cpu, memory);
		numericFieldArithmeticKeepsNativeFrame(cpu, memory);
		storesRequireAPredictedOverwrite(cpu, memory);
		compactArraySlots(cpu, memory);
		rawTablePayloadUsesRamWithoutAnObject(cpu, memory);
		watchedTableWordOrTagLeavesBeforeWriting(cpu, memory);
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
