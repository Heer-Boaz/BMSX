#include "machine/cpu/string_pool.h"

#include "common/endian.h"
#include "common/hash_fnv.h"
#include "machine/cpu/heap_allocator.h"
#include "machine/cpu/lua_heap.h"
#include "machine/cpu/value.h"
#include "machine/memory/memory.h"
#include "spec/blua32/image_format.h"

#include <algorithm>
#include <bit>
#include <cstring>

namespace bmsx {
namespace {
constexpr u32 SWEEP = 0x10;
constexpr u32 SWEEP_LINK = 0x30, SWEEP_LEFT = 0x34;
constexpr u32 SWEEP_REHASH = 0x80000000u;
constexpr u32 SWEEP_SHRINK = 0xc0000000u;
constexpr u32 INITIAL_BUCKETS = 16;
constexpr u32 MIN_SHRINK_BUCKETS = 2u * HEAP_PAGE_SIZE / sizeof(u32);
constexpr size_t INTERN_REHASH_WORK = 64;
}

void StringPool::writeMetadata(u32 field, u32 word) { m_memory.writeRamRecordWord(m_metadata + field, word); }

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

StringId StringPool::resolveImageRecord(ExecutionDomainId domain, u32 address) {
	const u32 cartridgeSlot = domain == 1 ? 1u : 0u;
	const auto header = bindRomStringHeader(address, cartridgeSlot);
	const u32 hash = readLE32(header.data() + BLUA32_STRING_HASH_OFFSET);
	const auto bytes = bindRomStringBytes(address, cartridgeSlot, readLE32(header.data() + BLUA32_STRING_LENGTH_OFFSET));
	if (const u32 match = lookup(hash, {bytes, {}, bytes.size()})) return retain(match);
	throw BMSX_RUNTIME_ERROR("BLua32 ROM String is missing from its bucket.");
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
	return intern(value, fnv1a32(value));
}

StringId StringPool::intern(std::string_view value, u32 hash) {
	if (const auto match = lookup(hash, {value, {}, value.size()})) return retain(match);
	return insert({value, {}}, hash, 0u);
}

StringId StringPool::insert(const ByteSpan& bytes, u32 hash, StringId source) {
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
	// An unrepresentable length requests the full bank and fails fixed admission.
	const u32 size = static_cast<u32>(std::min(bytes.size(), size_t(MAIN_RAM_SIZE)));
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

void StringPool::markReachable(StringId id) {
	if (mark(id)) m_memory.writeRamRecordWord(m_markWorkOffset, m_memory.readRamRecordWord(m_markWorkOffset) + 1u);
}

void StringPool::markLocalRoots() { for (StringId id : m_localRoots) markReachable(id); }

size_t StringPool::takeMarkWork() {
	const u32 work = m_memory.readRamRecordWord(m_markWorkOffset);
	if (work != 0u) m_memory.writeRamRecordWord(m_markWorkOffset, 0u);
	return work;
}

void StringPool::resumeMarkWork(u32 work) {
	if (work != 0u || m_memory.readRamRecordWord(m_markWorkOffset) != 0u) m_memory.writeRamRecordWord(m_markWorkOffset, work);
}

void StringPool::beginSweep() {
	const u32 ready = metadata(REHASH_READY);
	writeMetadata(SWEEP, std::max(1u, ready));
	m_memory.writeRamRecordPair(m_metadata + SWEEP_LINK, 0u, 0u);
}
bool StringPool::sweeping() const { return metadata(SWEEP) != 0; }

u32 StringPool::estimateSweepWork() const {
	const u32 control = metadata(CAPACITY);
	const u32 count = control & RAM_BUCKET_EXTENT_MASK;
	const u32 records = metadata(USED);
	// Include a possible second visit during a pending directory migration.
	if ((control & RAM_BUCKET_REHASH) != 0u) return 3u * count + 2u * records;
	return count >= MIN_SHRINK_BUCKETS ? count + count / 2u + 2u * records + 1u : count + records;
}

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
