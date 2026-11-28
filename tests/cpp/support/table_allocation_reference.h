#pragma once

#include <algorithm>

#include "machine/cpu/cpu.h"
#include "table_reference.h"

namespace bmsx::test {

// The former native constructor, retained as a RAM/allocation oracle.
// Scoped consumers pass their roots explicitly to the collection under test.
inline NativeTableReference allocateTableReference(CPU& cpu, int arraySize = 0, int hashSize = 0) {
	const size_t hash = NativeTableReference::hashCapacity(hashSize);
	const u32 address = cpu.luaHeap().allocateRecord(TableRecord::HEADER_BYTES, true, 5u * arraySize,
		static_cast<u32>(TableHeader::ArrayStorage), valueNil(), valueNil(), valueNil(),
		NativeTableReference::HEADER_CHARGE + NativeTableReference::allocationCharge(arraySize, hash),
		LuaAllocationMode::Direct, TableRecord::hashStorageBytes(hash), static_cast<u32>(TableHeader::HashStorage));
	auto& heap = cpu.gcHeap();
	auto& memory = heap.memory;
	NativeTableReference table(heap, address);
	const u32 kind = static_cast<u32>(ValueTag::Table) | (static_cast<u32>(heap.white()) << 8u)
		| (1u << (8u * TABLE_NEW_INDEX_ABSENT_BYTE));
	memory.writeRamRecordPair(address + static_cast<u32>(TableHeader::Kind), kind, 0u);
	memory.writeRamRecordWord(address + static_cast<u32>(TableHeader::Metatable), 0u);
	memory.writeRamRecordPair(address + static_cast<u32>(TableHeader::Array), arraySize, hash);
	memory.writeRamRecordPair(address + static_cast<u32>(TableHeader::Length), 0u, static_cast<u32>(hash) - 1u);
	if (const u32 array = arraySize) {
		const u32 base = table.arrayAddress() & RAM_RECORD_WORD_MASK;
		auto* ram = memory.ramData();
		std::fill(ram + base, ram + base + array * 4u, u8{0});
		std::fill(ram + base + array * 4u, ram + base + array * 5u, u8{0});
		memory.invalidateRamWrite(base, array * 5u);
	}
	if (hash != 0u) {
		const u32 base = table.hashAddress() & RAM_RECORD_WORD_MASK;
		auto* words = memory.ramData() + base;
		const u32 bytes = TableRecord::hashNodeBytes(hash);
		std::fill(words, words + hash * 10u, u8{0});
		std::fill(words + hash * 10u, words + bytes, u8{0xff});
		u32 total = bytes;
		if (hash > TableRecord::HASH_CENSUS_LIMIT) {
			total = TableRecord::hashStorageBytes(hash);
			std::fill(words + bytes, words + total, u8{0});
		}
		memory.invalidateRamWrite(base, total);
	}
	heap.publishObject(address);
	return table;
}

} // namespace bmsx::test
