#pragma once

#include <cstddef>
#include <string>
#include <string_view>

#include "common/primitives.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {

using StringId = u32;
inline constexpr bool isRamStringId(StringId address) { return address >= RAM_BASE && address < CART_ROM_BASE; }
class Memory;

// A String payload is the record's machine address. Cartridge ROM payloads
// carry their socket in bit 31, independently of the current bus selection.
class StringPool {
public:
	explicit StringPool(Memory& memory) : m_memory(memory) {}
	int byteLength(StringId id) const;
	u32 byteAt(StringId id, size_t index) const;
	void appendBytes(std::string& target, StringId id) const;
	void appendBytes(std::string& target, StringId id, size_t offset, size_t count) const;
	std::string toString(StringId id) const;
	int compareBytes(StringId left, StringId right, size_t offset, size_t count) const;

protected:
	struct ByteSpan {
		std::string_view first;
		std::string_view wrapped;
		size_t size() const { return first.size() + wrapped.size(); }
	};
	u32 readWord(u32 base, u32 displacement = 0) const;
	ByteSpan readBytes(StringId id, size_t offset, size_t count) const;
	Memory& m_memory;

private:
	Span<const u8> romStorage(u32 address) const;
};

} // namespace bmsx
