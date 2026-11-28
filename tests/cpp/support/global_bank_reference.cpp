#include "global_bank_reference.h"
#include "gc_heap_reference.h"
#include "machine/cpu/cpu.h"

#include <cstring>

namespace bmsx::test {

namespace {
constexpr u32 GLOBAL_NAME_BUDGET_BYTES = 9u;
constexpr u32 NAME_AND_BUCKET_BYTES_PER_SLOT = 12u;
using Bank = GlobalBankField;
}

Value NativeGlobalBankReference::getSystemGlobalByKey(const CPU& cpu, StringId key) {
	return cpu.m_systemGlobalBank.values().get(*find(cpu.m_systemGlobalBank, key));
}

Value NativeGlobalBankReference::getGlobalByKey(const CPU& cpu, StringId key) {
	const auto slot = find(cpu.m_globalBank, key);
	return slot ? cpu.m_globalBank.values().get(*slot) : valueNil();
}

void NativeGlobalBankReference::setGlobalByKey(CPU& cpu, StringId key, const Value& value) {
	GcHeap heap(cpu);
	NativeGlobalBankReference bank(cpu.m_globalBank);
	const u32 slot = bank.registerName(heap, key, value);
	bank.writeSlot(heap, slot, value);
}

void NativeGlobalBankReference::setSystemGlobalByKey(CPU& cpu, StringId key, const Value& value) {
	const auto slot = find(cpu.m_systemGlobalBank, key);
	if (!slot) {
		throw BMSX_RUNTIME_ERROR("System global '" + cpu.m_stringPool.toString(key) + "' has no register slot.");
	}
	GcHeap heap(cpu);
	NativeGlobalBankReference(cpu.m_systemGlobalBank).writeSlot(heap, *slot, value);
}

u32 NativeGlobalBankReference::bucketFor(const Memory& memory, u32 base, u32 capacity, StringId key) {
	const u32 slots = base + 4u * capacity;
	const u32 mask = 2u * capacity - 1u;
	const u32 start = hashCanonicalTableKey(valueInteger(static_cast<i32>(key))) & mask;
	u32 bucket = start;
	do {
		const u32 slot = memory.readRamRecordWord(slots + 4u * bucket);
		if (slot == 0u || memory.readRamRecordWord(base + 4u * ((slot - 1u) & (capacity - 1u))) == key) return bucket;
		bucket = (bucket + 1u) & mask;
	} while (bucket != start);
	// The address counter makes one complete pass through overwritten buckets.
	return start;
}

std::optional<u32> NativeGlobalBankReference::findSlot(const Memory& memory, u32 base, u32 capacity, StringId key) {
	if (capacity == 0u) return std::nullopt;
	const u32 stored = memory.readRamRecordWord(base + 4u * (capacity + bucketFor(memory, base, capacity, key)));
	const u32 slot = (stored - 1u) & (capacity - 1u);
	return stored != 0u && memory.readRamRecordWord(base + 4u * slot) == key ? std::optional<u32>(slot) : std::nullopt;
}

std::optional<u32> NativeGlobalBankReference::find(const GlobalBank& bank, StringId key) {
	const auto& memory = bank.m_memory;
	const u32 payloads = memory.readRamRecordWord(bank.m_descriptor + static_cast<u32>(Bank::Values));
	const u32 capacity = memory.readRamRecordWord(bank.m_descriptor + static_cast<u32>(Bank::Capacity));
	return findSlot(memory, payloads - NAME_AND_BUCKET_BYTES_PER_SLOT * capacity, capacity, key);
}

StringId NativeGlobalBankReference::name(const GlobalBank& bank, u32 slot) {
	const auto& memory = bank.m_memory;
	const u32 payloads = memory.readRamRecordWord(bank.m_descriptor + static_cast<u32>(Bank::Values));
	const u32 capacity = memory.readRamRecordWord(bank.m_descriptor + static_cast<u32>(Bank::Capacity));
	return memory.readRamRecordWord(payloads - NAME_AND_BUCKET_BYTES_PER_SLOT * capacity + 4u * slot);
}

void NativeGlobalBankReference::writeSlot(GcHeap heap, u32 slot, Value value) {
	m_bank.m_values.set(slot, value);
	if (valueTagIsStorageReference(valueTag(value))) heap.markGlobalWrite(value);
}

void NativeGlobalBankReference::clear(GcHeap heap) {
	auto& memory = m_bank.m_memory;
	const u32 descriptor = m_bank.m_descriptor;
	if (const u32 payloads = memory.readRamRecordWord(descriptor + static_cast<u32>(Bank::Values))) {
		const u32 capacity = memory.readRamRecordWord(descriptor + static_cast<u32>(Bank::Capacity));
		heap.budget.releaseRecord(payloads - NAME_AND_BUCKET_BYTES_PER_SLOT * capacity, GLOBAL_NAME_BUDGET_BYTES * m_bank.count());
	}
	memory.writeRamRecordWord(descriptor + static_cast<u32>(Bank::Values), 0u);
	memory.writeRamRecordWord(descriptor + static_cast<u32>(Bank::Capacity), 0u);
	memory.writeRamRecordWord(descriptor + static_cast<u32>(Bank::Count), 0u);
	m_bank.detach();
}

void NativeGlobalBankReference::grow(u32 oldBase, u32 base, u32 capacity, u32 count) {
	auto& memory = m_bank.m_memory;
	auto& values = m_bank.m_values;
	const u32 descriptor = m_bank.m_descriptor;
	const ConstValueSpan prior = values;
	const u32 offset = base & RAM_RECORD_WORD_MASK;
	std::memset(memory.ramData() + offset, 0, NAME_AND_BUCKET_BYTES_PER_SLOT * capacity);
	if (count != 0u)
		std::memcpy(memory.ramData() + offset, memory.ramData() + (oldBase & RAM_RECORD_WORD_MASK), 4u * count);
	memory.invalidateRamWrite(offset, NAME_AND_BUCKET_BYTES_PER_SLOT * capacity);
	const u32 payloads = base + NAME_AND_BUCKET_BYTES_PER_SLOT * capacity;
	memory.writeRamRecordWord(descriptor + static_cast<u32>(Bank::Values), payloads);
	memory.writeRamRecordWord(descriptor + static_cast<u32>(Bank::Capacity), capacity);
	values = ValueSpan(memory, payloads, payloads + 4u * capacity, capacity);
	values.copyFrom(prior, 0, 0, count);
	values.clear(count, capacity - count);
	for (u32 slot = 0; slot < count; ++slot) {
		const auto key = memory.readRamRecordWord(base + 4u * slot);
		memory.writeRamRecordWord(base + 4u * (capacity + bucketFor(memory, base, capacity, key)), slot + 1u);
	}
}

u32 NativeGlobalBankReference::registerName(GcHeap heap, StringId key, Value pending) {
	auto& memory = m_bank.m_memory;
	const u32 descriptor = m_bank.m_descriptor;
	const u32 payloads = memory.readRamRecordWord(descriptor + static_cast<u32>(Bank::Values));
	u32 capacity = memory.readRamRecordWord(descriptor + static_cast<u32>(Bank::Capacity));
	u32 base = payloads - NAME_AND_BUCKET_BYTES_PER_SLOT * capacity;
	if (const auto slot = findSlot(memory, base, capacity, key)) return *slot;
	const u32 slot = m_bank.count();
	u32 oldBase = 0u;
	if (slot == capacity) {
		capacity = capacity == 0u ? 8u : 2u * capacity;
		const u32 backing = heap.budget.reserveBacking(17u * capacity, GLOBAL_NAME_BUDGET_BYTES, valueString(key), pending);
		oldBase = base;
		grow(oldBase, backing, capacity, slot);
		base = backing;
	} else {
		heap.budget.admit(GLOBAL_NAME_BUDGET_BYTES, valueString(key), pending);
	}
	const u32 bucket = bucketFor(memory, base, capacity, key);
	memory.writeRamRecordWord(base + 4u * slot, key);
	m_bank.m_values.set(slot, valueNil());
	memory.writeRamRecordWord(base + 4u * (capacity + bucket), slot + 1u);
	memory.writeRamRecordWord(descriptor + static_cast<u32>(Bank::Count), slot + 1u);
	heap.markGlobalWrite(valueString(key));
	heap.budget.replaceRecord(oldBase, 0u, GLOBAL_NAME_BUDGET_BYTES);
	return slot;
}

} // namespace bmsx::test
