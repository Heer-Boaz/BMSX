#include "machine/cpu/string_pool.h"

#include "common/endian.h"
#include "common/hash_fnv.h"
#include "machine/cpu/heap_allocator.h"
#include "machine/cpu/lua_heap.h"
#include "machine/memory/memory.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/memory_map.h"

#include <algorithm>
#include <bit>
#include <cstring>
#include <utility>

namespace bmsx {
namespace {
constexpr u32 BUCKETS = 0x00, CAPACITY = 0x04, USED = 0x08, EPOCH = 0x0c, SWEEP = 0x10;
constexpr u32 FIRST_CART = 0x14, ROM_TABLES = 0x18;
constexpr u32 INITIAL_BUCKETS = 16;
constexpr u32 SLOT_BIT = 0x80000000u;
constexpr bool ramAddress(u32 address) { return address >= RAM_BASE && address < CART_ROM_BASE; }
constexpr u32 romOffset(u32 address) {
	return address < RAM_BASE ? address & (SYSTEM_ROM_SIZE - 1u)
		: (address & (SLOT_BIT - 1u)) - CART_ROM_BASE;
}
constexpr u32 slotWord(ExecutionDomainId domain) { return domain == 1 ? SLOT_BIT : 0u; }
}

StringPool::StringPool(LuaHeap& heap, Memory& memory, HeapAllocator& arena)
	: m_heap(heap), m_memory(memory), m_arena(arena), m_metadata(arena.managementOffset() + HEAP_STRING_METADATA_OFFSET) {}

u32 StringPool::metadata(u32 field) const { return m_memory.readRamRecordWord(m_metadata + field); }
void StringPool::writeMetadata(u32 field, u32 word) { m_memory.writeRamRecordWord(m_metadata + field, word); }

Span<const u8> StringPool::romStorage(u32 address) const {
	if (address < RAM_BASE) return m_memory.systemRomStorage();
	const auto* rom = m_memory.cartridgeController().romStorage(address >> 31);
	return rom ? *rom : Span<const u8>{};
}

u32 StringPool::readWord(u32 address) const {
	if (ramAddress(address)) return m_memory.readRamRecordWord(address);
	const auto rom = romStorage(address);
	const u32 offset = romOffset(address);
	if (offset + 4u <= rom.size()) return readLE32(rom.data() + offset);
	u32 word = 0;
	for (u32 i = 0; i != 4u && offset + i < rom.size(); ++i) word |= u32(rom[offset + i]) << (i * 8u);
	return word;
}

int StringPool::byteLength(StringId id) const { return static_cast<int>(readWord(id + BLUA32_STRING_LENGTH_OFFSET)); }

u32 StringPool::byteAt(StringId id, size_t index) const {
	const u32 address = id + BLUA32_STRING_RECORD_HEADER_SIZE + static_cast<u32>(index);
	if (ramAddress(id)) return m_memory.readRamRecordByte(address);
	const auto rom = romStorage(id);
	const size_t offset = romOffset(id) + BLUA32_STRING_RECORD_HEADER_SIZE + index;
	return offset < rom.size() ? rom[offset] : 0u;
}

StringPool::ByteSpan StringPool::readBytes(StringId id) const {
	const size_t length = readWord(id + BLUA32_STRING_LENGTH_OFFSET);
	if (ramAddress(id)) {
		const u32 offset = (id + BLUA32_STRING_RECORD_HEADER_SIZE) & (MAIN_RAM_SIZE - 1u);
		return {{reinterpret_cast<const char*>(m_memory.ramData() + offset), length}, length};
	}
	const auto rom = romStorage(id);
	const size_t offset = romOffset(id) + BLUA32_STRING_RECORD_HEADER_SIZE;
	if (offset >= rom.size()) return {{}, length};
	const size_t backed = std::min(length, rom.size() - offset);
	return {{reinterpret_cast<const char*>(rom.data() + offset), backed}, length};
}

void StringPool::appendBytes(std::string& target, StringId id) const {
	const auto bytes = readBytes(id);
	target.append(bytes.backed);
	target.append(bytes.length - bytes.backed.size(), '\0');
}

std::string StringPool::toString(StringId id) const {
	std::string text;
	appendBytes(text, id);
	return text;
}

int StringPool::compare(StringId left, StringId right) const {
	if (left == right) return 0;
	const auto a = readBytes(left), b = readBytes(right);
	const size_t limit = std::min(a.length, b.length);
	const size_t shared = std::min({limit, a.backed.size(), b.backed.size()});
	if (shared != 0) {
		const int order = std::memcmp(a.backed.data(), b.backed.data(), shared);
		if (order != 0) return order;
	}
	const size_t remaining = std::min(limit, std::max(a.backed.size(), b.backed.size()));
	for (size_t i = shared; i < remaining; ++i) {
		const int l = i < a.backed.size() ? static_cast<u8>(a.backed[i]) : 0;
		const int r = i < b.backed.size() ? static_cast<u8>(b.backed[i]) : 0;
		if (l != r) return l - r;
	}
	return (a.length > b.length) - (a.length < b.length);
}

int compareStringIds(const StringPool* pool, StringId left, StringId right, int* remainingCycles) {
	*remainingCycles -= std::min(pool->byteLength(left), pool->byteLength(right));
	return pool->compare(left, right);
}

void StringPool::clearRomTables() {
	writeMetadata(FIRST_CART, 0);
	for (u32 field = ROM_TABLES; field < ROM_TABLES + 24; field += 4) writeMetadata(field, 0);
}

void StringPool::activateRomTable(ExecutionDomainId domain, u32 address, u32 count) {
	// External image section, not allocator-owned RAM.
	const auto rom = romStorage(address | slotWord(domain));
	const size_t offset = romOffset(address);
	if ((address & 3u) != 0u || !std::has_single_bit(count)
		|| offset > rom.size() || 4ull * count > rom.size() - offset) {
		throw BMSX_RUNTIME_ERROR("BLua32 String bucket table is invalid.");
	}
	const u32 table = static_cast<u32>(domain + 1);
	writeMetadata(ROM_TABLES + 8 * table, address | slotWord(domain));
	writeMetadata(ROM_TABLES + 8 * table + 4, count);
	if (table != 0 && metadata(FIRST_CART) == 0) writeMetadata(FIRST_CART, table);
}

u32 StringPool::lookup(u32 buckets, u32 count, u32 hash, std::string_view bytes) const {
	if (count == 0) return 0;
	const u32 slot = buckets & SLOT_BIT;
	u32 record = readWord(buckets + 4u * (hash & (count - 1u)));
	while (record != 0) {
		record |= slot;
		if (readWord(record + BLUA32_STRING_HASH_OFFSET) == hash
			&& readWord(record + BLUA32_STRING_LENGTH_OFFSET) == bytes.size()) {
			const auto candidate = readBytes(record);
			if (candidate.backed == bytes) return record;
		}
		record = readWord(record + BLUA32_STRING_NEXT_OFFSET);
	}
	return 0;
}

u32 StringPool::lookup(u32 hash, std::string_view bytes) const {
	if (const u32 match = lookup(metadata(BUCKETS), metadata(CAPACITY), hash, bytes)) return match;
	if (const u32 match = lookup(metadata(ROM_TABLES), metadata(ROM_TABLES + 4), hash, bytes)) return match;
	const u32 first = metadata(FIRST_CART);
	if (first == 0) return 0;
	for (u32 index : {first, 3u - first}) {
		const u32 slot = ROM_TABLES + 8u * index;
		if (const u32 match = lookup(metadata(slot), metadata(slot + 4), hash, bytes)) return match;
	}
	return 0;
}

StringId StringPool::resolveImageRecord(ExecutionDomainId domain, u32 address) {
	const u32 id = address | slotWord(domain);
	if ((address & (BLUA32_STRING_RECORD_ALIGNMENT - 1u)) != 0u
		|| readWord(id) != (BLUA32_STRING_RECORD_KIND | BLUA32_STRING_RECORD_ROM_FLAG)) {
		throw BMSX_RUNTIME_ERROR("BLua32 ROM String header is invalid.");
	}
	const ByteSpan data = readBytes(id);
	if (data.backed.size() != data.length) throw BMSX_RUNTIME_ERROR("BLua32 ROM String is truncated.");
	if (const u32 match = lookup(readWord(id + BLUA32_STRING_HASH_OFFSET), data.backed)) return retain(match);
	throw BMSX_RUNTIME_ERROR("BLua32 ROM String is missing from its bucket.");
}

std::optional<StringId> StringPool::find(std::string_view value) const {
	const u32 id = lookup(fnv1a32(value), value);
	return id == 0 ? std::nullopt : std::optional<StringId>(id);
}

void StringPool::grow(u32 count) {
	const u32 newBase = m_heap.allocateRecord(4u * count, true, 0, 0);
	// Admission can enter the string sweep. Finish it before changing the
	// bucket addresses that its cursor refers to; the new block is owned.
	while (sweeping()) m_heap.stepRuntime();
	const u32 oldBase = metadata(BUCKETS), oldCount = metadata(CAPACITY);
	const u32 offset = newBase & (MAIN_RAM_SIZE - 1u);
	std::memset(m_memory.ramData() + offset, 0, 4u * count);
	m_memory.invalidateRamWrite(offset, 4u * count);
	for (u32 i = 0; i < oldCount; ++i) {
		u32 record = m_memory.readRamRecordWord(oldBase + 4u * i);
		while (record != 0) {
			const u32 link = record + BLUA32_STRING_NEXT_OFFSET;
			const u32 next = m_memory.readRamRecordWord(link);
			const u32 hash = m_memory.readRamRecordWord(record + BLUA32_STRING_HASH_OFFSET);
			const u32 bucket = newBase + 4u * (hash & (count - 1u));
			m_memory.writeRamRecordWord(link, m_memory.readRamRecordWord(bucket));
			m_memory.writeRamRecordWord(bucket, record);
			record = next;
		}
	}
	writeMetadata(BUCKETS, newBase);
	writeMetadata(CAPACITY, count);
	if (oldCount != 0) {
		m_arena.free(oldBase);

	}
}

StringId StringPool::intern(std::string_view value) {
	const u32 hash = fnv1a32(value);
	if (const u32 id = lookup(hash, value)) return retain(id);
	const u32 count = metadata(CAPACITY);
	if (count == 0) grow(INITIAL_BUCKETS);
	else if (metadata(USED) >= count && !sweeping()) grow(count * 2u);
	const u32 size = static_cast<u32>(value.size());
	const u32 id = m_heap.allocateRecord(BLUA32_STRING_RECORD_HEADER_SIZE + size, false, 0, 0);
	const u32 bucket = metadata(BUCKETS) + 4u * (hash & (metadata(CAPACITY) - 1u));
	m_memory.writeRamRecordWord(id, BLUA32_STRING_RECORD_KIND | (metadata(EPOCH) << 8));
	m_memory.writeRamRecordWord(id + BLUA32_STRING_HASH_OFFSET, hash);
	m_memory.writeRamRecordWord(id + BLUA32_STRING_LENGTH_OFFSET, size);
	m_memory.writeRamRecordWord(id + BLUA32_STRING_NEXT_OFFSET, m_memory.readRamRecordWord(bucket));
	if (size != 0) {
		const u32 offset = (id + BLUA32_STRING_RECORD_HEADER_SIZE) & (MAIN_RAM_SIZE - 1u);
		std::memcpy(m_memory.ramData() + offset, value.data(), size);
		m_memory.invalidateRamWrite(offset, size);
	}
	m_memory.writeRamRecordWord(bucket, id);
	writeMetadata(USED, metadata(USED) + 1u);
	return retain(id);
}

bool StringPool::mark(StringId id) {
	if (!ramAddress(id)) return false;
	const u32 markByte = id + 1u;
	const u8 epoch = static_cast<u8>(metadata(EPOCH));
	if (m_memory.readRamRecordByte(markByte) == epoch) return false;
	m_memory.writeRamRecordByte(markByte, epoch);
	return true;
}
StringId StringPool::retain(StringId id) {
	mark(id);
	if (!m_localRootBases.empty()) m_localRoots.push_back(id);
	return id;
}
void StringPool::beginLocalRoots() { m_localRootBases.push_back(m_localRoots.size()); }
void StringPool::endLocalRoots() {
	m_localRoots.resize(m_localRootBases.back());
	m_localRootBases.pop_back();
}
void StringPool::beginReachabilityEpoch() { writeMetadata(EPOCH, metadata(EPOCH) ^ 1u); }
void StringPool::markReachable(StringId id) { m_markWork += mark(id); }
void StringPool::markLocalRoots() { for (StringId id : m_localRoots) markReachable(id); }
size_t StringPool::takeMarkWork() { return std::exchange(m_markWork, size_t{0}); }

void StringPool::beginSweep() { writeMetadata(SWEEP, 1); }
bool StringPool::sweeping() const { return metadata(SWEEP) != 0; }

size_t StringPool::sweepStep(size_t allowance) {
	const u32 base = metadata(BUCKETS), count = metadata(CAPACITY), epoch = metadata(EPOCH);
	u32 index = metadata(SWEEP) - 1u, used = metadata(USED);
	size_t work = 0;
	while (index < count && work < allowance) {
		u32 link = base + 4u * index++;
		u32 record = m_memory.readRamRecordWord(link);
		++work;
		while (record != 0) {
			const u32 next = m_memory.readRamRecordWord(record + BLUA32_STRING_NEXT_OFFSET);
			if (m_memory.readRamRecordByte(record + 1u) != epoch) {
				m_memory.writeRamRecordWord(link, next);
				m_arena.free(record);
				--used;
			} else link = record + BLUA32_STRING_NEXT_OFFSET;
			record = next;
		}
	}
	writeMetadata(SWEEP, index == count ? 0 : index + 1u);
	writeMetadata(USED, used);

	return work;
}

} // namespace bmsx
