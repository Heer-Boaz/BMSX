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
		size_t bytes = 0;
		auto block = NativeBlock::compile(source, constants.view(), bytes, memory, cpu.stringPool(), indexKey);
		auto table = cpu.createTable(0, 8);
		auto parent = cpu.createTable(0, 1);
		auto meta = cpu.createTable(0, 1);
		meta.setStringKey(indexKey, valueTable(parent.address())); table.setMetatableAddress(meta.address());
		for (const Value value : values) for (const int prediction : {-1, 100000}) {
			parent.setStringKey(key, value);
			block->sideExits[0].tableCacheSlot = prediction;
			ValueSlots registers(11); for (size_t i = 0; i < registers.capacity(); ++i) registers.set(i, valueInteger(73));
			registers.set(0, valueTable(table.address())); registers.set(3, values[3]);
			registers.set(4, values[0]); registers.set(5, valueString(key));
			const auto heap = std::pair{cpu.luaHeap().usedBytes(), cpu.luaHeap().collectionTarget()};
			NativeBlockRunState state{.registers = registers.view(), .constants = constants.view(), .heap = &cpu.gcHeap(), .remainingCycles = 100};
			const auto* exit = block->run(state);
			require(exit == &block->terminal && exit->exit == NativeBlockExit::Continue,
				"inherited and missing string reads execute their suffix within one stable native gate invocation");
			require(registers.get(destination) == value && registers.get(8) == values[3] && registers.get(9) == values[3]
				&& registers.get(2) == values[0] && registers.get(10) == values[0],
				"aliased destinations and all cached raw Values survive the returning table-read leaf");
			if (op == OpCode::SELF) require(registers.get(destination + 1) == valueTable(table.address()), "SELF retains its receiver before the read");
			require(cpu.luaHeap().usedBytes() == heap.first
				&& cpu.luaHeap().collectionTarget() == heap.second,
				"read resolution changes neither tracked allocation nor collection thresholds");
			require(state.remainingCycles == 100 - block->terminal.cycles - 8, "one additional inherited target Table adds8 cycles independently of slot prediction");
		}
		for (int mutation = 0; mutation < 4; ++mutation) {
			if (mutation == 0) table.setStringKey(key, values[0]);
			if (mutation == 1) {
				for (int i = 0; i != 64; ++i) table.setStringKey(cpu.stringPool().intern("read_rehash_" + std::to_string(i)), valueInteger(i));
			}
			if (mutation == 2) { table.setStringKey(key, valueNil()); parent.setStringKey(key, valueInteger(91)); }
			if (mutation == 3) { meta.setStringKey(indexKey, valueBool(false)); }
			ValueSlots registers(11);
			registers.set(0, valueTable(table.address())); registers.set(5, valueString(key));
			NativeBlockRunState state{.registers = registers.view(), .constants = constants.view(), .heap = &cpu.gcHeap(), .remainingCycles = 100};
			require(block->run(state) == &block->terminal, "rehash, deletion and live metatable changes retain the native continuation");
			const auto expected = mutation < 2 ? values[0] : mutation == 2 ? valueInteger(91) : valueNil();
			require(registers.get(destination) == expected, "predictions validate current raw keys and never retain a stale inherited Value");
		}
		if (op == OpCode::GETT) {
			const auto objectKey = valueTable(table.address());
			meta.setStringKey(indexKey, valueTable(parent.address()));
			parent.set(valueInteger(-17), values[0]);
			parent.set(objectKey, values[0]);
			for (const auto key : {valueInteger(-17), valueFloat(-17.0f), objectKey}) {
				ValueSlots registers(11);
				registers.set(0, valueTable(table.address()));
				registers.set(5, key);
				NativeBlockRunState state{.registers = registers.view(), .heap = &cpu.gcHeap(), .remainingCycles = 100};
				require(block->run(state) == &block->terminal && registers.get(destination) == values[0]
					&& state.remainingCycles == 100 - block->terminal.cycles - TABLE_INDEX_VISIT_CYCLES,
					"sparse numeric and object keys resolve inherited raw values without a dispatch transition");
			}
			ValueSlots registers(11);
			registers.set(0, valueTable(table.address()));
			registers.set(3, valueInteger(73));
			NativeBlockRunState state{.registers = registers.view(), .heap = &cpu.gcHeap(), .remainingCycles = 100};
			require(block->run(state)->exit == NativeBlockExit::ReadIndex && registers.get(9) == valueNil(),
				"a nil key still takes the precise side exit without executing the suffix");
		}
		// A real bounded-chain error still takes the precise semantic side exit.
		meta.setStringKey(indexKey, valueTable(table.address()));
		ValueSlots registers(11); for (size_t i = 0; i < registers.capacity(); ++i) registers.set(i, valueInteger(73));
		registers.set(0, valueTable(table.address())); registers.set(5, valueString(key));
		NativeBlockRunState state{.registers = registers.view(), .constants = constants.view(), .heap = &cpu.gcHeap(), .remainingCycles = 100};
		const auto* exit = block->run(state);
		require(exit->exit == (op == OpCode::GETT ? NativeBlockExit::ReadIndex : NativeBlockExit::ReadField)
			&& exit->currentPc == 0x100cu && registers.get(destination) == (destination == 0 ? valueTable(table.address()) : destination == 1 ? valueString(key) : valueInteger(73)),
			"chain exhaustion publishes the exact prefix without committing the read destination or suffix");
		if (op == OpCode::SELF) require(registers.get(destination + 1) == valueTable(table.address()), "failed SELF keeps the preceding receiver copy");
		registers.set(0, valueString(key));
		require(block->run(state) == exit, "string receivers retain the existing typed semantic path");
	}
}

void storesRetainNativeFrame(CPU& cpu, Memory& memory) {
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
		size_t bytes = 0;
		auto block = NativeBlock::compile(source, constants.view(), bytes, memory, cpu.stringPool(), cpu.stringPool().intern("__index"));
		std::cout << "string-store-code generic=" << generic << " constant=" << constant << " bytes=" << bytes << '\n';
		auto parent = cpu.createTable(0, 1); parent.setStringKey(key, valueInteger(71));
		auto meta = cpu.createTable(0, 1); meta.setStringKey(cpu.stringPool().intern("__index"), valueTable(parent.address()));
		for (size_t n = 0; n < values.size(); ++n) {
			auto table = cpu.createTable(0, 8); table.setMetatableAddress(meta.address());
			// Different receiver layouts share this one prediction site.
			for (size_t prior = 0; prior < n; ++prior)
				table.setStringKey(cpu.stringPool().intern("prior_" + std::to_string(prior)), valueInteger(prior));
			for (const Value value : {values[n], valueNil(), values[n]}) {
				ValueSlots registers(10); for (size_t i = 0; i < registers.capacity(); ++i) registers.set(i, valueInteger(73));
				registers.set(0, valueTable(table.address())); registers.set(3, values[n]); registers.set(4, value);
				const auto before = table.trackedHeapBytes();
				NativeBlockRunState state{.registers = registers.view(), .constants = constants.view(), .heap = &cpu.gcHeap(), .remainingCycles = 100};
				const auto* exit = block->run(state);
				require(exit == &block->terminal && exit->exit == NativeBlockExit::Continue,
					"first insert, deletion, resurrection and polymorphic updates complete in one native invocation");
				const Value expected = constant ? constants.get(1) : value;
				require(table.getStringKey(key) == expected, "returning stores preserve raw values");
				require(table.trackedHeapBytes() == before, "returning store never grows allocated storage");
				require(registers.get(8) == values[n] && registers.get(9) == values[n] && registers.get(2) == value,
					"unpublished raw references and numeric payloads survive the returning call");
				require(parent.getStringKey(key) == valueInteger(71), "writes do not redirect through inherited fields");
				require(state.remainingCycles == 100 - block->terminal.cycles, "returning stores charge one instruction");
			}
		}
		// Growth is the only table-store case which can allocate. It must still
		// leave generated code before any mutation, publishing all live roots.
		auto empty = cpu.createTable();
		ValueSlots registers(10);
		registers.set(0, valueTable(empty.address())); registers.set(3, values[3]); registers.set(4, values[3]);
		NativeBlockRunState state{.registers = registers.view(), .constants = constants.view(), .heap = &cpu.gcHeap(), .remainingCycles = 100};
		const auto* exit = block->run(state);
		require(exit->exit == (generic ? NativeBlockExit::WriteIndex : NativeBlockExit::WriteField),
			"missing capacity retains the allocating semantic exit");
		require(empty.storedSlotCount() == 0 && isNil(empty.getStringKey(key)), "growth admission does not mutate the table");
		require(registers.get(8) == values[3] && registers.get(2) == values[3] && isNil(registers.get(9)),
			"growth publishes the prefix roots without executing the suffix");
	}
}
void compactArraySlots(CPU& cpu, Memory& memory) {
	const auto key = cpu.stringPool().intern("__index");
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
		auto block = NativeBlock::compile(source, {}, bytes, memory, cpu.stringPool(), key);
		ValueSlots registers(3);
		registers.set(0, ref);
		NativeBlockRunState state{.registers = registers.view(), .heap = &cpu.gcHeap()};
		for (int index : {1, 2, 4, 3, 4, 2, 1}) {
			const int slot = generic ? index : 1;
			for (Value v : {valueFloatBits(0xffa12345), ref, valueNil()}) {
				registers.set(1, valueInteger(slot));
				registers.set(2, v);
				state.remainingCycles = 100;
				model.setInteger(slot, v);
				const auto* exit = block->run(state);
				require(exit == &block->terminal && registers.get(1) == v && table.getInteger(slot) == v,
					"in-capacity array stores and aliased loads transfer both raw planes without a semantic exit");
				u32 probes, expectedProbes;
				require(TableRecord::length(&table, &probes) == TableRecord::length(&model, &expectedProbes) && probes == expectedProbes,
					"native insertion and deletion maintain the same boundary hint and length work");
				require(state.remainingCycles == 100 - block->terminal.cycles, "array hit charges once");
			}
		}
		if (generic) {
			auto child = cpu.createTable();
			auto metatable = cpu.createTable(0, 1);
			metatable.setStringKey(cpu.stringPool().intern("__mode"), valueString(cpu.stringPool().intern("v")));
			table.setMetatableAddress(metatable.address());
			model.setMetatableAddress(metatable.address());
			cpu.gcHeap().step(valueTable(model.address()), ref, valueNil());
			require(memory.readRamRecordByte(table.address() + GC_COLOR_OFFSET) == 3, "array receiver was actually scanned before inserting the new edge");
			registers.set(1, valueInteger(1));
			registers.set(2, valueTable(child.address()));
			const Value previous = table.getInteger(1);
			const u32 header = table.address();
			const u32 head = cpu.gcHeap().changedHeadOffset();
			const u32 weakLink = memory.readRamRecordWord(header + GC_RECORD_LINK) & ~GC_GRAY_INDEX_MASK;
			require(weakLink != 0, "the table is also linked to a second weak table");
			model.setInteger(1, valueInteger(303));
			const u32 previousHead = memory.readRamRecordWord(head);
			require(previousHead == ((model.address() & GC_RECORD_MASK) >> GC_RECORD_SHIFT), "scalar Table write publishes the prior link");
			for (const u32 watched : {header, header + GC_RECORD_LINK, head}) {
				const u32 word = (watched & MAPPED_PAGE_BYTE_MASK) / sizeof(u32);
				MappedPageBinding binding{};
				memory.bindMappedPage(watched | RAM_BASE, MAPPED_BUS_MASTER_CPU, binding);
				binding.writeWatch.armWord(word);
				state.remainingCycles = 100;
				require(block->run(state) == &block->sideExits.front()
					&& table.getInteger(1) == previous && memory.readRamRecordByte(header + GC_COLOR_OFFSET) == 3
					&& memory.readRamRecordWord(head) == previousHead,
					"a watched barrier word stops the store before either the value or the queue changes");
				require(binding.writeWatch.consume(word, word + 1), "the declined operation left the watch armed");
			}
			state.remainingCycles = 100;
			require(block->run(state) == &block->terminal && memory.readRamRecordByte(header + GC_COLOR_OFFSET) == 2
				&& memory.readRamRecordWord(header + GC_RECORD_LINK) == (weakLink | previousHead)
				&& memory.readRamRecordWord(head) == ((header & GC_RECORD_MASK) >> GC_RECORD_SHIFT),
				"a native array hit links the scanned Table onto the physical changed queue");
		}
		if (generic) for (Value k : {valueInteger(0), valueInteger(-1), valueInteger(5), valueFloat(1), valueBool(true)}) {
			registers.set(1, k);
			state.remainingCycles = 100;
			require(block->run(state) == &block->sideExits.front() && registers.get(1) == k,
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
	const u32 mirror = record + MAIN_RAM_SIZE + 1u; // word accesses also discard the low two bits
	require(cpu.gcHeap().tableRecordAddress(record) == 0u, "the raw datapath does not require a collector header");

	DecodedInstruction write{}, read{};
	write.op = static_cast<u8>(OpCode::SETI); read.op = static_cast<u8>(OpCode::GETI);
	write.a = read.b = 0; write.b = read.c = 1; write.c = 2; read.a = 3;
	write.width = read.width = 1;
	write.baseCycles = BASE_CYCLES[write.op]; read.baseCycles = BASE_CYCLES[read.op];
	const std::array source{NativeBlockInstruction{&write, 0x1000}, NativeBlockInstruction{&read, 0x1004}};
	size_t bytes = 0;
	auto block = NativeBlock::compile(source, {}, bytes, memory, cpu.stringPool(), cpu.stringPool().intern("__index"));
	ValueSlots registers(4); registers.set(0, valueTable(mirror)); registers.set(2, valueInteger(83));
	NativeBlockRunState state{.registers = registers.view(), .heap = &cpu.gcHeap(), .remainingCycles = 100};
	require(block->run(state) == &block->terminal && registers.get(3) == valueInteger(83),
		"both array operations execute in native code without a host object");
	require(TableRecord(cpu.gcHeap(), mirror).getInteger(1) == valueInteger(83)
		&& memory.readRamRecordWord(body) == 83 && memory.readRamRecordByte(body + 4) == static_cast<u8>(ValueTag::Integer),
		"scalar and native use the same per-width aliases for header and backing");

	const u32 key = cpu.stringPool().intern("wrapped tag") | 0x80000000u;
	constexpr u32 hash = 2;
	const u32 keySlot = cpu.gcHeap().hash(valueString(key)) & (hash - 1u), valueSlot = keySlot + hash;
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
	auto fieldBlock = NativeBlock::compile(fields, constants.view(), bytes, memory, cpu.stringPool(), cpu.stringPool().intern("__index"));
	registers.set(2, valueFromTag(ValueTag::False, 37));
	auto& watches = memory.ramWriteWatches();
	watches.armHistoryWrites();
	watches.consumeHistoryWrites(hashBody, 1);
	state.remainingCycles = 100;
	const auto* stopped = fieldBlock->run(state);
	require(stopped->exit == NativeBlockExit::WriteField && registers.get(3) == valueInteger(19)
		&& memory.readRamRecordWord(hashBody + valueSlot * sizeof(u32)) == 19,
		"the predicted read matches all 32 key bits across the RAM seam, and a clean tag page stops both store planes");
	watches.disarmHistoryWrites();
	state.remainingCycles = 100;
	require(fieldBlock->run(state) == &fieldBlock->terminal
		&& TableRecord(cpu.gcHeap(), mirror).getStringKey(key) == registers.get(2),
		"the predicted write uses the same mirrored byte as the reader");
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
	auto block = NativeBlock::compile(source, {}, bytes, memory, cpu.stringPool(), cpu.stringPool().intern("__index"));
	ValueSlots registers(3);
	registers.set(0, valueTable(table.address()));
	registers.set(2, valueFloatBits(0x80000000u));
	NativeBlockRunState state{.registers = registers.view(), .heap = &cpu.gcHeap()};
	const u32 hint = table.address() + static_cast<u32>(TableHeader::Length);
	for (const u32 address : {words, tags, hint}) {
		table.setInteger(1, valueInteger(101));
		memory.writeRamRecordWord(hint, 0);
		MappedPageBinding binding;
		memory.bindMappedPage(address, MAPPED_BUS_MASTER_CPU, binding);
		require(binding.readBytes != nullptr && address < memory.ramBusEnd(), "every watched alias is on the public RAM bus");
		const u32 slot = (address & MAPPED_PAGE_BYTE_MASK) >> 2;
		binding.writeWatch.armWord(slot);
		state.remainingCycles = 100;
		require(block->run(state) == &block->sideExits.front() && table.getInteger(1) == valueInteger(101),
			"watching a destination plane or the length hint leaves before either part of the store");
		table.setInteger(1, registers.get(2));
		require(!binding.writeWatch.consume(slot, slot + 1u) && table.getInteger(1) == registers.get(2),
			"the record write invalidates the physical code watch");
	}
	state.remainingCycles = 100;
	require(block->run(state) == &block->terminal, "an unwatched RAM slot still stores in generated code");
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
	auto block = NativeBlock::compile(source, {}, bytes, memory, cpu.stringPool(), cpu.stringPool().intern("__index"));
	auto table = cpu.createTable(0, 128);
	for (int bit = 30; bit >= 0; --bit) table.set(valueInteger(i32{1} << bit), valueBool(false));
	const Value root = valueTable(cpu.createTable().address());
	for (const i32 expected : {1 << 30, INT32_MAX}) {
		if (expected == INT32_MAX) table.set(valueInteger(expected), valueBool(false));
		ValueSlots registers(7);
		registers.set(0, valueTable(table.address())); registers.set(1, root);
		const int probeCycles = 6 * (expected == INT32_MAX ? 32 : 61);
		const int grant = block->terminal.cycles + probeCycles + 1;
		NativeBlockRunState state{.registers = registers.view(), .constants = {}, .heap = &cpu.gcHeap(), .remainingCycles = grant};
		const auto* exit = block->run(state);
		require(exit == &block->terminal, "table LEN and its suffix stay in one native invocation");
		require(registers.get(0) == valueInteger(expected), "native LEN returns a full signed Integer boundary and supports source aliasing");
		require(registers.get(5) == root && registers.get(6) == root, "live raw references survive the nonallocating length call");
		require(state.remainingCycles == 1, "length search charges its literal logical presence work once");
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
		auto block = NativeBlock::compile(source, {}, bytes, memory, cpu.stringPool(), cpu.stringPool().intern("__index"));
		auto table = cpu.createTable(2);
		table.setInteger(1, valueInteger(23));
		for (const Value first : {valueTable(table.address()), valueNil()}) for (const Value next : {valueTable(table.address()), valueNil()}) {
			ValueSlots registers(6);
			registers.set(1, first); registers.set(4, next);
			NativeBlockRunState state{.registers = registers.view(), .heap = &cpu.gcHeap(), .remainingCycles = 100};
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
				require(registers.get(2) == valueInteger(23) && registers.get(3) == valueInteger(23),
					"both preceding accesses retained their values before the later fault");
			} else {
				require(exit == &block->terminal && registers.get(2) == valueInteger(23)
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
	const std::array sources{NativeBlockSource{std::span(instructions.data(), 2), nullptr, true},
		NativeBlockSource{std::span(instructions.data() + 2, 3)}, NativeBlockSource{std::span(instructions.data() + 5, 2)},
		NativeBlockSource{std::span(instructions.data() + 7, 2)}};
	size_t bytes = 0;
	auto blocks = NativeBlock::compileRegion(sources, {}, NativeCodeBindings(memory, cpu.stringPool(), cpu.stringPool().intern("__index")), {});
	blocks.front()->region->publish(bytes);
	auto table = cpu.createTable(2); table.setInteger(1, valueInteger(23));
	for (const size_t entry : {0u, 1u, 2u, 3u}) for (const bool valid : {false, true}) {
		ValueSlots registers(7);
		for (int guest : {0, 1, 4, 6}) registers.set(guest, valid ? valueTable(table.address()) : valueNil());
		NativeBlockRunState state{.registers = registers.view(), .heap = &cpu.gcHeap(), .remainingCycles = 100};
		const auto* exit = blocks[entry]->run(state);
		if (valid) {
			require(exit == &blocks[1]->terminal && registers.get(3) == valueInteger(23) && registers.get(5) == valueInteger(1),
				"successful fallthrough and both independent entries retain their table receiver");
		} else if (entry == 0) {
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
	NativeBlockRunState state{.registers = registers.view(), .heap = &cpu.gcHeap(), .remainingCycles = 100};
	require(blocks[2]->run(state)->exit == NativeBlockExit::ReadInteger && registers.get(0) == valueNil(),
		"the first internal predecessor cannot reuse the second predecessor's table fact");
	state.remainingCycles = 100;
	require(blocks[3]->run(state) == &blocks[1]->terminal && registers.get(3) == valueInteger(23),
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
		auto blocks = NativeBlock::compileRegion(unusedSources, {}, NativeCodeBindings(memory, cpu.stringPool(), cpu.stringPool().intern("__index")), {});
		blocks.front()->region->publish(bytes);
		ValueSlots registers(6);
		NativeBlockRunState state{.registers = registers.view(), .heap = &cpu.gcHeap(), .remainingCycles = 100};
		require(blocks[1]->run(state) == &blocks[1]->terminal && registers.get(5) == valueInteger(1),
			"an inherited but unused table fact does not reject an independent entry");
	}
	{
		const std::array usedSources{NativeBlockSource{std::span(instructions.data(), 2), nullptr, true},
			NativeBlockSource{std::span(instructions.data() + 2, 2), nullptr, true},
			NativeBlockSource{std::span(instructions.data() + 4, 2)}};
		auto blocks = NativeBlock::compileRegion(usedSources, {}, NativeCodeBindings(memory, cpu.stringPool(), cpu.stringPool().intern("__index")), {});
		blocks.front()->region->publish(bytes);
		ValueSlots registers(6);
		NativeBlockRunState state{.registers = registers.view(), .heap = &cpu.gcHeap(), .remainingCycles = 100};
		const auto* exit = blocks[1]->run(state);
		require(exit->exit == NativeBlockExit::ReadInteger && exit->currentPc == 0x5010u
			&& registers.get(5) == valueInteger(1),
			"a copied receiver is checked at the field access after fallthrough");
		auto table = cpu.createTable(2); table.setInteger(1, valueInteger(23));
		registers.set(0, valueTable(table.address())); state.remainingCycles = 100;
		require(blocks[1]->run(state) == &blocks[2]->terminal && registers.get(3) == valueInteger(23),
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
		size_t bytes = 0;
		auto blocks = NativeBlock::compileRegion(sources, {}, NativeCodeBindings(memory, cpu.stringPool(), cpu.stringPool().intern("__index")), {});
		blocks.front()->region->publish(bytes);
		ValueSlots registers(11);
		for (int operand : {4, 5, 6, 7}) registers.set(operand, valueInteger(0));
		NativeBlockRunState state{.registers = registers.view(), .heap = &cpu.gcHeap(), .remainingCycles = 100};
		const auto* exit = blocks[1]->run(state);
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
		readsRetainNativeFrame(cpu, memory);
		storesRetainNativeFrame(cpu, memory);
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
