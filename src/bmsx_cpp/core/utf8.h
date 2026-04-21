#pragma once

#include "core/primitives.h"

#include <string>

namespace bmsx {

inline u32 readUtf8Codepoint(const std::string& text, size_t& index) {
	const size_t size = text.size();
	const u8 c0 = static_cast<u8>(text[index]);
	index += 1u;
	if (c0 < 0x80u) {
		return c0;
	}
	if ((c0 & 0xE0u) == 0xC0u) {
		if (index >= size) {
			return static_cast<u32>('?');
		}
		const u8 c1 = static_cast<u8>(text[index]);
		index += 1u;
		if ((c1 & 0xC0u) != 0x80u) {
			return static_cast<u32>('?');
		}
		return ((c0 & 0x1Fu) << 6u) | (c1 & 0x3Fu);
	}
	if ((c0 & 0xF0u) == 0xE0u) {
		if (index + 1u >= size) {
			return static_cast<u32>('?');
		}
		const u8 c1 = static_cast<u8>(text[index]);
		const u8 c2 = static_cast<u8>(text[index + 1u]);
		index += 2u;
		if ((c1 & 0xC0u) != 0x80u || (c2 & 0xC0u) != 0x80u) {
			return static_cast<u32>('?');
		}
		return ((c0 & 0x0Fu) << 12u) | ((c1 & 0x3Fu) << 6u) | (c2 & 0x3Fu);
	}
	if (index + 2u >= size) {
		return static_cast<u32>('?');
	}
	const u8 c1 = static_cast<u8>(text[index]);
	const u8 c2 = static_cast<u8>(text[index + 1u]);
	const u8 c3 = static_cast<u8>(text[index + 2u]);
	index += 3u;
	if ((c1 & 0xC0u) != 0x80u || (c2 & 0xC0u) != 0x80u || (c3 & 0xC0u) != 0x80u) {
		return static_cast<u32>('?');
	}
	return ((c0 & 0x07u) << 18u) | ((c1 & 0x3Fu) << 12u) | ((c2 & 0x3Fu) << 6u) | (c3 & 0x3Fu);
}

} // namespace bmsx
