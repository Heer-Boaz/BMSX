#include "machine/cpu/string_pool.h"

#include "common/bytes_equal.h"
#include "common/endian.h"
#include "common/hash_fnv.h"
#include "machine/cpu/heap_allocator.h"
#include "machine/memory/memory.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/memory_map.h"

#include <algorithm>
#include <cstring>

namespace bmsx {
namespace {
constexpr u32 romOffset(u32 address) {
	return address < RAM_BASE ? address
		: (address & BLUA32_STRING_ROM_ADDRESS_MASK) - CART_ROM_BASE;
}
}

StringPool::StringPool(LuaHeap& heap, Memory& memory, HeapAllocator& arena)
	: m_heap(heap), m_memory(memory), m_arena(arena), m_metadata(arena.managementOffset() + HEAP_STRING_METADATA_OFFSET),
	m_markWorkOffset(arena.managementOffset() + HEAP_STRING_MARK_WORK_OFFSET) {}

u32 StringPool::metadata(u32 field) const { return m_memory.readRamRecordWord(m_metadata + field); }

Span<const u8> StringPool::romStorage(u32 address) const {
	if (address < RAM_BASE) return m_memory.systemRomStorage();
	return *m_memory.cartridgeController().romStorage(address >> BLUA32_STRING_ROM_SOCKET_SHIFT);
}

u32 StringPool::readWord(u32 base, u32 displacement) const {
	if (isRamStringId(base)) return m_memory.readRamRecordWord(base + displacement);
	const auto rom = romStorage(base);
	return readLE32(rom.data() + romOffset(base) + displacement);
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
	return rom[offset];
}

StringPool::ByteSpan StringPool::readBytes(StringId id, size_t start, size_t length) const {
	if (isRamStringId(id)) {
		const size_t offset = (id + BLUA32_STRING_RECORD_HEADER_SIZE + start) & (MAIN_RAM_SIZE - 1u);
		const auto* ram = reinterpret_cast<const char*>(m_memory.ramData());
		const size_t first = std::min(length, size_t(MAIN_RAM_SIZE - offset));
		return {{ram + offset, first}, {ram, length - first}};
	}
	const auto rom = romStorage(id);
	const size_t offset = romOffset(id) + BLUA32_STRING_RECORD_HEADER_SIZE + start;
	return {{reinterpret_cast<const char*>(rom.data() + offset), length}, {}};
}

bool StringPool::ByteSpan::consumeEqual(std::string_view prefix) {
	const size_t n = std::min(first.size(), prefix.size());
	if (n) {
		if (!bytesEqual(first.data(), prefix.data(), n)) return false;
		first.remove_prefix(n);
		prefix.remove_prefix(n);
	}
	if (!prefix.empty()) {
		if (!bytesEqual(wrapped.data(), prefix.data(), prefix.size())) return false;
		wrapped.remove_prefix(prefix.size());
	}
	return true;
}

bool StringPool::InternKey::matches(ByteSpan candidate) const {
	if (!candidate.consumeEqual(head)) return false;
	for (const auto part : tail) if (!candidate.consumeEqual(part)) return false;
	return true;
}

void StringPool::appendBytes(std::string& target, StringId id) const {
	appendBytes(target, id, 0, byteLength(id));
}

void StringPool::appendBytes(std::string& target, StringId id, size_t offset, size_t count) const {
	const auto bytes = readBytes(id, offset, count);
	target.append(bytes.first);
	target.append(bytes.wrapped);
}

std::string StringPool::toString(StringId id) const {
	std::string text;
	appendBytes(text, id);
	return text;
}

int StringPool::compareBytes(StringId left, StringId right, size_t offset, size_t count) const {
	if (left == right) return 0;
	auto a = readBytes(left, offset, count), b = readBytes(right, offset, count);
	while (count != 0) {
		const size_t n = std::min(a.first.size(), b.first.size());
		const int order = std::memcmp(a.first.data(), b.first.data(), n);
		if (order != 0) return order;
		count -= n;
		a.first.remove_prefix(n);
		b.first.remove_prefix(n);
		if (a.first.empty()) a.first = a.wrapped;
		if (b.first.empty()) b.first = b.wrapped;
	}
	return 0;
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

u32 StringPool::lookupRamChain(u32 bucket, u32 hash, const InternKey& bytes) const {
	u32 record = m_memory.readRamRecordWord(bucket);
	if (record == 0u) return 0;
	u32 remaining = std::min(metadata(USED), MAX_RAM_RECORDS);
	while (record != 0u && remaining-- != 0u) {
		if (m_memory.readRamRecordWord(record + BLUA32_STRING_HASH_OFFSET) == hash
			&& (m_memory.readRamRecordWord(record + BLUA32_STRING_LENGTH_OFFSET) & (MAIN_RAM_SIZE - 1u)) == bytes.length) {
			if (bytes.matches(readBytes(record, 0, bytes.length))) return record;
		}
		record = m_memory.readRamRecordWord(record + BLUA32_STRING_NEXT_OFFSET);
	}
	return 0;
}

u32 StringPool::lookupRam(u32 hash, const InternKey& bytes) const {
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

u32 StringPool::lookupRom(u32 directory, u32 hash, const InternKey& bytes) const {
	const u32 table = ROM_TABLES + 8u * directory;
	const u32 count = metadata(table + 4u);
	if (count == 0u) return 0;
	u32 record = readWord(metadata(table), 4u * (hash & (count - 1u)));
	if (record == 0u) return 0;
	// The directory owner, not the backing of the directory or preceding
	// record, selects the socket for every absolute cartridge reference.
	const u32 cartridgeSlot = directory == 2u ? 1u : 0u;
	const auto* cart = m_memory.cartridgeController().romStorage(cartridgeSlot);
	const size_t available = m_memory.systemRomStorage().size() + (cart ? cart->size() : 0u);
	size_t remaining = available / BLUA32_STRING_RECORD_HEADER_SIZE;
	while (record != 0u) {
		if (remaining-- == 0u) throw BMSX_RUNTIME_ERROR("BLua32 ROM String chain is invalid.");
		const auto header = bindRomStringHeader(record, cartridgeSlot);
		const u32 length = readLE32(header.data() + BLUA32_STRING_LENGTH_OFFSET);
		if (readLE32(header.data() + BLUA32_STRING_HASH_OFFSET) == hash && length == bytes.length
			&& bytes.matches({bindRomStringBytes(record, cartridgeSlot, length), {}})) return romStringId(record, cartridgeSlot);
		record = readLE32(header.data() + BLUA32_STRING_NEXT_OFFSET);
	}
	return 0;
}

u32 StringPool::lookup(u32 hash, const InternKey& bytes) const {
	if (const u32 match = lookupRam(hash, bytes)) return match;
	if (const u32 match = lookupRom(0u, hash, bytes)) return match;
	const u32 first = metadata(FIRST_CART);
	if (first == 0) return 0;
	if (const u32 match = lookupRom(first, hash, bytes)) return match;
	return lookupRom(3u - first, hash, bytes);
}

std::optional<StringId> StringPool::find(std::string_view value) const {
	const u32 id = lookup(fnv1a32(value), {value, {}, value.size()});
	return id == 0 ? std::nullopt : std::optional<StringId>(id);
}

} // namespace bmsx
