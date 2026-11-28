#include "machine/cpu/string_pool.h"

#include "common/endian.h"
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

} // namespace bmsx
