#include "machine/cpu/string_pool.h"

#include "common/endian.h"
#include "common/hash_fnv.h"
#include "machine/cpu/heap_allocator.h"
#include "machine/cpu/lua_heap.h"
#include "machine/cpu/value.h"
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
constexpr u32 SWEEP_LINK = 0x30, SWEEP_LEFT = 0x34, REHASH_BASE = 0x38, REHASH_READY = 0x3c;
constexpr u32 SWEEP_REHASH = 0x80000000u;
constexpr u32 SWEEP_SHRINK = 0xc0000000u;
constexpr u32 INITIAL_BUCKETS = 16;
constexpr u32 MIN_SHRINK_BUCKETS = 2u * HEAP_PAGE_SIZE / sizeof(u32);
constexpr size_t INTERN_REHASH_WORK = 64;
constexpr u32 MAX_RAM_RECORDS = MAIN_RAM_SIZE / BLUA32_STRING_RECORD_HEADER_SIZE;
// The bucket extent field includes the bit for the maximum RAM string count.
constexpr u32 RAM_BUCKET_EXTENT_MASK = 2u * MAX_RAM_RECORDS - 1u;
constexpr u32 RAM_BUCKET_REHASH = 0x80000000u;
constexpr u32 RAM_BUCKET_SHRINK = 0x40000000u;
constexpr u32 SLOT_BIT = 0x80000000u;
constexpr u32 romOffset(u32 address) {
	return address < RAM_BASE ? address & (SYSTEM_ROM_SIZE - 1u)
		: (address & (SLOT_BIT - 1u)) - CART_ROM_BASE;
}
constexpr u32 romStringId(u32 address, u32 cartridgeSlot) {
	return address >= CART_ROM_BASE ? address | (cartridgeSlot << 31u) : address;
}
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

u32 StringPool::readWord(u32 base, u32 displacement) const {
	if (isRamStringId(base)) return m_memory.readRamRecordWord(base + displacement);
	const auto rom = romStorage(base);
	const u32 offset = romOffset(base) + displacement;
	if (offset >= rom.size()) return 0u;
	if (rom.size() - offset >= 4u) return readLE32(rom.data() + offset);
	u32 word = 0;
	for (u32 i = 0; i < rom.size() - offset; ++i) word |= u32(rom[offset + i]) << (i * 8u);
	return word;
}

int StringPool::byteLength(StringId id) const {
	const u32 count = readWord(id, BLUA32_STRING_LENGTH_OFFSET);
	return static_cast<int>(isRamStringId(id) ? count & (MAIN_RAM_SIZE - 1u) : count);
}

u32 StringPool::byteAt(StringId id, size_t index) const {
	const u32 address = id + BLUA32_STRING_RECORD_HEADER_SIZE + static_cast<u32>(index);
	if (isRamStringId(id)) return m_memory.readRamRecordByte(address);
	const auto rom = romStorage(id);
	const size_t offset = romOffset(id) + BLUA32_STRING_RECORD_HEADER_SIZE + index;
	return offset < rom.size() ? rom[offset] : 0u;
}

StringPool::ByteSpan StringPool::readBytes(StringId id) const {
	return readBytes(id, 0, static_cast<u32>(byteLength(id)));
}

StringPool::ByteSpan StringPool::readBytes(StringId id, size_t start, size_t length) const {
	if (isRamStringId(id)) {
		const size_t offset = (id + BLUA32_STRING_RECORD_HEADER_SIZE + start) & (MAIN_RAM_SIZE - 1u);
		const auto* ram = reinterpret_cast<const char*>(m_memory.ramData());
		const size_t first = std::min(length, size_t(MAIN_RAM_SIZE - offset));
		return {{ram + offset, first}, {ram, length - first}, length};
	}
	const auto rom = romStorage(id);
	const size_t offset = romOffset(id) + BLUA32_STRING_RECORD_HEADER_SIZE + start;
	if (offset >= rom.size()) return {{}, {}, length};
	const size_t backed = std::min(length, rom.size() - offset);
	return {{reinterpret_cast<const char*>(rom.data() + offset), backed}, {}, length};
}

bool StringPool::ByteSpan::equalBytes(const ByteSpan& other) const {
	const size_t shared = std::min(first.size(), other.first.size());
	if (shared != 0 && std::memcmp(first.data(), other.first.data(), shared) != 0) return false;
	for (size_t i = shared, end = std::max(backedLength(), other.backedLength()); i < end; ++i)
		if (byteAt(i) != other.byteAt(i)) return false;
	return true;
}

void StringPool::appendBytes(std::string& target, StringId id) const {
	const auto bytes = readBytes(id);
	target.append(bytes.first);
	target.append(bytes.wrapped);
	target.append(bytes.length - bytes.backedLength(), '\0');
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
	const size_t shared = std::min({limit, a.first.size(), b.first.size()});
	if (shared != 0) {
		const int order = std::memcmp(a.first.data(), b.first.data(), shared);
		if (order != 0) return order;
	}
	const size_t remaining = std::min(limit, std::max(a.backedLength(), b.backedLength()));
	for (size_t i = shared; i < remaining; ++i) {
		const int delta = static_cast<int>(a.byteAt(i)) - static_cast<int>(b.byteAt(i));
		if (delta != 0) return delta;
	}
	return (a.length > b.length) - (a.length < b.length);
}

void StringPool::clearRomTables() {
	writeMetadata(FIRST_CART, 0);
	for (u32 field = ROM_TABLES; field < ROM_TABLES + 24; field += 4) writeMetadata(field, 0);
}

void StringPool::activateRomTable(ExecutionDomainId domain, u32 address, u32 count) {
	// External image section, not allocator-owned RAM.
	const u32 cartridgeSlot = domain == 1 ? 1u : 0u;
	Span<const u8> directory;
	if ((address & 3u) != 0u || !std::has_single_bit(count)
		|| count > CART_ROM_SIZE / sizeof(u32)
		|| !m_memory.bindRomByteView(address, count * sizeof(u32), cartridgeSlot, directory)) {
		throw BMSX_RUNTIME_ERROR("BLua32 String bucket table is invalid.");
	}
	const u32 table = static_cast<u32>(domain + 1);
	writeMetadata(ROM_TABLES + 8 * table, romStringId(address, cartridgeSlot));
	writeMetadata(ROM_TABLES + 8 * table + 4, count);
	if (table != 0 && metadata(FIRST_CART) == 0) writeMetadata(FIRST_CART, table);
}

Span<const u8> StringPool::bindRomStringHeader(u32 address, u32 cartridgeSlot) const {
	Span<const u8> header;
	if ((address & (BLUA32_STRING_RECORD_ALIGNMENT - 1u)) != 0u
		|| !m_memory.bindRomByteView(address, BLUA32_STRING_RECORD_HEADER_SIZE, cartridgeSlot, header)
		|| readLE32(header.data()) != (BLUA32_STRING_RECORD_KIND | BLUA32_STRING_RECORD_ROM_FLAG)) {
		throw BMSX_RUNTIME_ERROR("BLua32 ROM String header is invalid.");
	}
	return header;
}

std::string_view StringPool::bindRomStringBytes(u32 address, u32 cartridgeSlot, u32 length) const {
	if (length == 0u) return {};
	Span<const u8> record;
	if (length > CART_ROM_SIZE - BLUA32_STRING_RECORD_HEADER_SIZE
		|| !m_memory.bindRomByteView(address, BLUA32_STRING_RECORD_HEADER_SIZE + length, cartridgeSlot, record)) {
		throw BMSX_RUNTIME_ERROR("BLua32 ROM String is truncated.");
	}
	return {reinterpret_cast<const char*>(record.data() + BLUA32_STRING_RECORD_HEADER_SIZE), length};
}

u32 StringPool::lookupRamChain(u32 bucket, u32 hash, const ByteSpan& bytes) const {
	u32 record = m_memory.readRamRecordWord(bucket);
	if (record == 0u) return 0;
	u32 remaining = std::min(metadata(USED), MAX_RAM_RECORDS);
	while (record != 0u && remaining-- != 0u) {
		if (m_memory.readRamRecordWord(record + BLUA32_STRING_HASH_OFFSET) == hash
			&& (m_memory.readRamRecordWord(record + BLUA32_STRING_LENGTH_OFFSET) & (MAIN_RAM_SIZE - 1u)) == bytes.length) {
			if (bytes.equalBytes(readBytes(record, 0, bytes.length))) return record;
		}
		record = m_memory.readRamRecordWord(record + BLUA32_STRING_NEXT_OFFSET);
	}
	return 0;
}

u32 StringPool::lookupRam(u32 hash, const ByteSpan& bytes) const {
	const u32 control = metadata(CAPACITY), count = control & RAM_BUCKET_EXTENT_MASK;
	if (count == 0u) return 0u;
	const u32 index = hash & (count - 1u);
	if ((control & (RAM_BUCKET_REHASH | RAM_BUCKET_SHRINK)) != 0u) {
		const u32 ready = metadata(REHASH_READY);
		if ((control & RAM_BUCKET_REHASH) != 0u) {
			if (index < ready) {
				const u32 bucket = metadata(REHASH_BASE) + 4u * (hash & (2u * count - 1u));
				if (const u32 found = lookupRamChain(bucket, hash, bytes)) return found;
				if (index + 1u < ready) return 0u;
			}
		} else {
			const u32 half = count / 2u, ordinal = index - half;
			if (index >= half && ordinal <= ready) {
				const u32 base = metadata(BUCKETS);
				const u32 found = lookupRamChain(base + 4u * ordinal, hash, bytes);
				if (found != 0u || ordinal < ready) return found;
				return lookupRamChain(base + 4u * index, hash, bytes);
			}
		}
	}
	return lookupRamChain(metadata(BUCKETS) + 4u * index, hash, bytes);
}

u32 StringPool::lookupRom(u32 directory, u32 hash, const ByteSpan& bytes) const {
	const u32 table = ROM_TABLES + 8u * directory;
	const u32 count = metadata(table + 4u);
	if (count == 0u) return 0;
	u32 record = readWord(metadata(table), 4u * (hash & (count - 1u)));
	if (record == 0u) return 0;
	// The directory owner, not the backing of the directory or preceding
	// record, selects the socket for every absolute cartridge reference.
	const u32 cartridgeSlot = directory == 2u ? 1u : 0u;
	const auto available = m_memory.systemRomStorage().size() + romStorage(romStringId(CART_ROM_BASE, cartridgeSlot)).size();
	size_t remaining = available / BLUA32_STRING_RECORD_HEADER_SIZE;
	while (record != 0u) {
		if (remaining-- == 0u) throw BMSX_RUNTIME_ERROR("BLua32 ROM String chain is invalid.");
		const auto header = bindRomStringHeader(record, cartridgeSlot);
		const u32 length = readLE32(header.data() + BLUA32_STRING_LENGTH_OFFSET);
		if (readLE32(header.data() + BLUA32_STRING_HASH_OFFSET) == hash && length == bytes.length
			&& bytes.equalBytes({bindRomStringBytes(record, cartridgeSlot, length), {}, length})) return romStringId(record, cartridgeSlot);
		record = readLE32(header.data() + BLUA32_STRING_NEXT_OFFSET);
	}
	return 0;
}

u32 StringPool::lookup(u32 hash, const ByteSpan& bytes) const {
	if (const u32 match = lookupRam(hash, bytes)) return match;
	if (const u32 match = lookupRom(0u, hash, bytes)) return match;
	const u32 first = metadata(FIRST_CART);
	if (first == 0) return 0;
	if (const u32 match = lookupRom(first, hash, bytes)) return match;
	return lookupRom(3u - first, hash, bytes);
}

StringId StringPool::resolveImageRecord(ExecutionDomainId domain, u32 address) {
	const u32 cartridgeSlot = domain == 1 ? 1u : 0u;
	const auto header = bindRomStringHeader(address, cartridgeSlot);
	const u32 hash = readLE32(header.data() + BLUA32_STRING_HASH_OFFSET);
	const auto bytes = bindRomStringBytes(address, cartridgeSlot, readLE32(header.data() + BLUA32_STRING_LENGTH_OFFSET));
	if (const u32 match = lookup(hash, {bytes, {}, bytes.size()})) return retain(match);
	throw BMSX_RUNTIME_ERROR("BLua32 ROM String is missing from its bucket.");
}

std::optional<StringId> StringPool::find(std::string_view value) const {
	const u32 id = lookup(fnv1a32(value), {value, {}, value.size()});
	return id == 0 ? std::nullopt : std::optional<StringId>(id);
}

size_t StringPool::rehashStep(u32 oldCount, u32 nextBase, size_t allowance) {
	const u32 oldBase = metadata(BUCKETS), count = 2u * oldCount;
	u32 ready = metadata(REHASH_READY);
	size_t work = 0;
	// Only the last prepared pair can still have records in its old bucket.
	while (work < allowance) {
		if (ready != 0u) {
			const u32 head = oldBase + 4u * (ready - 1u);
			if (const u32 record = m_memory.readRamRecordWord(head)) {
				const u32 link = record + BLUA32_STRING_NEXT_OFFSET;
				const u32 hash = m_memory.readRamRecordWord(record + BLUA32_STRING_HASH_OFFSET);
				const u32 bucket = nextBase + 4u * (hash & (count - 1u));
				m_memory.writeRamRecordWord(head, m_memory.readRamRecordWord(link));
				m_memory.writeRamRecordWord(link, m_memory.readRamRecordWord(bucket));
				m_memory.writeRamRecordWord(bucket, record);
				++work;
				continue;
			}
		}
		if (ready == oldCount) {
			writeMetadata(BUCKETS, nextBase);
			writeMetadata(CAPACITY, count);
			m_memory.writeRamRecordPair(m_metadata + REHASH_BASE, 0u, 0u);
			m_heap.replaceRecord(oldBase, 0u, 0u);
			return work;
		}
		m_memory.writeRamRecordWord(nextBase + 4u * ready, 0u);
		m_memory.writeRamRecordWord(nextBase + 4u * (ready + oldCount), 0u);
		++ready;
		++work;
	}
	writeMetadata(REHASH_READY, ready);
	return work;
}

size_t StringPool::shrinkStep(u32 oldCount, size_t allowance) {
	const u32 base = metadata(BUCKETS), half = oldCount / 2u;
	const u32 start = metadata(REHASH_READY);
	u32 ready = start;
	size_t work = 0;
	while (ready < half && work < allowance) {
		const u32 upper = base + 4u * (half + ready);
		if (const u32 record = m_memory.readRamRecordWord(upper)) {
			const u32 lower = base + 4u * ready;
			const u32 link = record + BLUA32_STRING_NEXT_OFFSET;
			m_memory.writeRamRecordWord(upper, m_memory.readRamRecordWord(link));
			m_memory.writeRamRecordWord(link, m_memory.readRamRecordWord(lower));
			m_memory.writeRamRecordWord(lower, record);
		} else ++ready;
		++work;
	}
	if (ready == half && work < allowance) {
		m_arena.shrinkBacking(base, 4u * half);
		writeMetadata(CAPACITY, half);
		writeMetadata(REHASH_READY, 0u);
		writeMetadata(SWEEP, 0u);
		return work + 1u;
	}
	if (ready != start) writeMetadata(REHASH_READY, ready);
	return work;
}

StringId StringPool::intern(std::string_view value) {
	return intern({value, {}, value.size()}, fnv1a32(value), 0u);
}

StringId StringPool::internSlice(StringId id, size_t offset, size_t count) {
	const auto bytes = readBytes(id, offset, count);
	u32 hash = fnv1a32(bytes.wrapped, fnv1a32(bytes.first));
	for (size_t i = bytes.backedLength(); i < count; ++i) hash *= FNV1A32_PRIME;
	return intern(bytes, hash, id);
}

StringId StringPool::intern(const ByteSpan& bytes, u32 hash, StringId source) {
	if (const u32 id = lookup(hash, bytes)) return retain(id);
	Value root = valueNil();
	if (source != 0u) {
		// Retain the borrow in the current sweep as well as a new collection.
		mark(source);
		root = valueString(source);
	}
	const u32 control = metadata(CAPACITY), count = control & RAM_BUCKET_EXTENT_MASK;
	if (count == 0u) {
		const u32 base = m_heap.reserveBacking(4u * INITIAL_BUCKETS, 0u, root);
		const u32 offset = base & (MAIN_RAM_SIZE - 1u);
		std::memset(m_memory.ramData() + offset, 0, 4u * INITIAL_BUCKETS);
		m_memory.invalidateRamWrite(offset, 4u * INITIAL_BUCKETS);
		m_memory.writeRamRecordPair(m_metadata + BUCKETS, base, INITIAL_BUCKETS);
	} else if (!sweeping()) {
		if ((control & RAM_BUCKET_REHASH) != 0u) {
			rehashStep(count, metadata(REHASH_BASE), INTERN_REHASH_WORK);
		} else if (metadata(USED) >= count) {
			// The directory is optional; only the String record may trigger
			// emergency collection, which can change the current directory.
			if (const u32 nextBase = m_arena.allocate(8u * count, true)) {
				writeMetadata(REHASH_BASE, nextBase);
				writeMetadata(CAPACITY, count | RAM_BUCKET_REHASH);
				rehashStep(count, nextBase, INTERN_REHASH_WORK);
			}
		}
	}
	// Keep an oversized request in the allocation admission path: the
	// full-bank request cannot fit, but still clocks the final collection.
	const u32 size = static_cast<u32>(std::min(bytes.length, size_t(MAIN_RAM_SIZE)));
	const u32 id = m_heap.allocateRecord(BLUA32_STRING_RECORD_HEADER_SIZE + size, false, 0, 0, root);
	const u32 currentControl = metadata(CAPACITY), current = currentControl & RAM_BUCKET_EXTENT_MASK;
	u32 index = hash & (current - 1u);
	u32 base = metadata(BUCKETS);
	if ((currentControl & (RAM_BUCKET_REHASH | RAM_BUCKET_SHRINK)) != 0u) {
		const u32 ready = metadata(REHASH_READY);
		if ((currentControl & RAM_BUCKET_REHASH) != 0u) {
			if (index < ready) {
				base = metadata(REHASH_BASE);
				index = hash & (2u * current - 1u);
			}
		} else {
			const u32 half = current / 2u;
			// Prepend to the destination of the current chain, not the
			// chain that the collector is draining.
			if (index >= half && index - half <= ready) index -= half;
		}
	}
	const u32 bucket = base + 4u * index;
	m_memory.writeRamRecordWord(id, BLUA32_STRING_RECORD_KIND | ((metadata(EPOCH) & STRING_GC_EPOCH_MASK) << 8));
	m_memory.writeRamRecordWord(id + BLUA32_STRING_HASH_OFFSET, hash);
	m_memory.writeRamRecordWord(id + BLUA32_STRING_LENGTH_OFFSET, size);
	m_memory.writeRamRecordWord(id + BLUA32_STRING_NEXT_OFFSET, m_memory.readRamRecordWord(bucket));
	if (size != 0) {
		const u32 offset = (id + BLUA32_STRING_RECORD_HEADER_SIZE) & (MAIN_RAM_SIZE - 1u);
		u8* const target = m_memory.ramData() + offset;
		if (!bytes.first.empty()) std::memcpy(target, bytes.first.data(), bytes.first.size());
		if (!bytes.wrapped.empty()) std::memcpy(target + bytes.first.size(), bytes.wrapped.data(), bytes.wrapped.size());
		const size_t backed = bytes.backedLength();
		if (backed < size) std::memset(target + backed, 0, size - backed);
		m_memory.invalidateRamWrite(offset, size);
	}
	m_memory.writeRamRecordWord(bucket, id);
	writeMetadata(USED, metadata(USED) + 1u);
	return retain(id);
}

bool StringPool::mark(StringId id) {
	if (!isRamStringId(id)) return false;
	const u32 markByte = id + 1u;
	const u8 epoch = static_cast<u8>(metadata(EPOCH) & STRING_GC_EPOCH_MASK);
	if ((m_memory.readRamRecordByte(markByte) & STRING_GC_EPOCH_MASK) == epoch) return false;
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

void StringPool::beginSweep() {
	const u32 ready = metadata(REHASH_READY);
	writeMetadata(SWEEP, std::max(1u, ready));
	m_memory.writeRamRecordPair(m_metadata + SWEEP_LINK, 0u, 0u);
}
bool StringPool::sweeping() const { return metadata(SWEEP) != 0; }

size_t StringPool::sweepStep(size_t allowance) {
	const u32 cursor = metadata(SWEEP), control = metadata(CAPACITY), count = control & RAM_BUCKET_EXTENT_MASK;
	if (cursor == SWEEP_SHRINK) return shrinkStep(count, allowance);
	const u32 nextBase = (control & RAM_BUCKET_REHASH) != 0u ? metadata(REHASH_BASE) : 0u;
	size_t work = 0;
	if (cursor != SWEEP_REHASH) {
		const u32 base = metadata(BUCKETS), epoch = metadata(EPOCH) & STRING_GC_EPOCH_MASK;
		const u32 ready = metadata(REHASH_READY), lowEnd = count + ready, end = lowEnd + ready;
		u32 index = cursor - 1u, used = metadata(USED);
		u32 link = metadata(SWEEP_LINK), remaining = metadata(SWEEP_LEFT);
		// Freeze rehash until the remaining old buckets and the two prepared
		// prefixes have been swept. Inserts still select their owning bucket.
		while (index < end && allowance != 0u) {
			const u32 bucket = index < count ? base + 4u * index : index < lowEnd
				? nextBase + 4u * (index - count) : nextBase + 4u * (index - ready);
			if (link == 0u) {
				link = bucket;
				++work;
				--allowance;
			}
			// A new intern can prepend before a survivor link, never after it.
			if (link == bucket) remaining = std::min(used, MAX_RAM_RECORDS);
			u32 record = m_memory.readRamRecordWord(link);
			while (record != 0u && remaining != 0u && allowance != 0u
				&& m_memory.readRamRecordByte(record) == BLUA32_STRING_RECORD_KIND) {
				const u32 next = m_memory.readRamRecordWord(record + BLUA32_STRING_NEXT_OFFSET);
				--remaining;
				--allowance;
				++work;
				if ((m_memory.readRamRecordByte(record + 1u) & STRING_GC_EPOCH_MASK) != epoch) {
					m_memory.writeRamRecordWord(link, next);
					// A repeated link cannot clock a freed String, including a whole page run.
					m_memory.writeRamRecordByte(record, 0u);
					m_heap.releaseRecord(record, BLUA32_STRING_RECORD_HEADER_SIZE + byteLength(record));
					--used;
				} else link = record + BLUA32_STRING_NEXT_OFFSET;
				record = next;
			}
			if (record != 0u && remaining != 0u && allowance == 0u) break;
			if (record != 0u) m_memory.writeRamRecordWord(link, 0u);
			link = remaining = 0u;
			++index;
		}
		writeMetadata(USED, used);
		m_memory.writeRamRecordPair(m_metadata + SWEEP_LINK, link, remaining);
		if (index < end) {
			writeMetadata(SWEEP, index + 1u);
			return work;
		}
	}
	// A collection also retires the old directory; in particular an emergency
	// admission can recover it without waiting for another distinct intern.
	if (nextBase != 0u) {
		if (allowance != 0u) work += rehashStep(count, nextBase, allowance);
		if (metadata(REHASH_BASE) != 0u) {
			writeMetadata(SWEEP, SWEEP_REHASH);
			return work;
		}
	} else if (count >= MIN_SHRINK_BUCKETS && metadata(USED) <= count / 4u) {
		writeMetadata(CAPACITY, count | RAM_BUCKET_SHRINK);
		writeMetadata(SWEEP, SWEEP_SHRINK);
		return work + shrinkStep(count, allowance);
	}
	writeMetadata(SWEEP, 0u);
	return work;
}

} // namespace bmsx
