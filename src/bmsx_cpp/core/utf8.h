#pragma once

#include "core/primitives.h"

#include <string>
#include <string_view>

namespace bmsx {

inline size_t nextUtf8Index(std::string_view text, size_t index) {
	const u8 c0 = static_cast<u8>(text[index]);
	if (c0 < 0x80u) {
		return index + 1u;
	}
	if ((c0 & 0xE0u) == 0xC0u) {
		return index + 2u;
	}
	if ((c0 & 0xF0u) == 0xE0u) {
		return index + 3u;
	}
	return index + 4u;
}

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

inline void appendUtf8Codepoint(std::string& out, u32 codepoint) {
	if (codepoint <= 0x7Fu) {
		out.push_back(static_cast<char>(codepoint));
		return;
	}
	if (codepoint <= 0x7FFu) {
		out.push_back(static_cast<char>(0xC0u | ((codepoint >> 6u) & 0x1Fu)));
		out.push_back(static_cast<char>(0x80u | (codepoint & 0x3Fu)));
		return;
	}
	if (codepoint <= 0xFFFFu) {
		out.push_back(static_cast<char>(0xE0u | ((codepoint >> 12u) & 0x0Fu)));
		out.push_back(static_cast<char>(0x80u | ((codepoint >> 6u) & 0x3Fu)));
		out.push_back(static_cast<char>(0x80u | (codepoint & 0x3Fu)));
		return;
	}
	out.push_back(static_cast<char>(0xF0u | ((codepoint >> 18u) & 0x07u)));
	out.push_back(static_cast<char>(0x80u | ((codepoint >> 12u) & 0x3Fu)));
	out.push_back(static_cast<char>(0x80u | ((codepoint >> 6u) & 0x3Fu)));
	out.push_back(static_cast<char>(0x80u | (codepoint & 0x3Fu)));
}

} // namespace bmsx
