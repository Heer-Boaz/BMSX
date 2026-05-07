#pragma once

#include "common/primitives.h"

#include <string>
#include <string_view>

namespace bmsx {

constexpr u32 kInvalidUtf8Codepoint = static_cast<u32>('?');

inline u8 utf8ByteAt(const std::string& text, size_t index) {
	return static_cast<u8>(text[index]);
}

inline bool isUtf8Continuation(u8 value) {
	return (value & 0xC0u) == 0x80u;
}

inline void appendUtf8TailBytes(std::string& out, u32 codepoint, i32 count) {
	for (i32 shift = (count - 1) * 6; shift >= 0; shift -= 6) {
		out.push_back(static_cast<char>(0x80u | ((codepoint >> static_cast<u32>(shift)) & 0x3Fu)));
	}
}

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

inline size_t utf8ByteLength(std::string_view text) {
	return text.size();
}

inline int utf8CodepointCount(std::string_view text) {
	int count = 0;
	size_t index = 0;
	while (index < text.size()) {
		index = nextUtf8Index(text, index);
		count += 1;
	}
	return count;
}

inline u32 readUtf8Codepoint(const std::string& text, size_t& index) {
	const size_t size = text.size();
	const u8 c0 = utf8ByteAt(text, index);
	index += 1u;
	if (c0 < 0x80u) {
		return c0;
	}
	if ((c0 & 0xE0u) == 0xC0u) {
		if (index >= size) {
			return kInvalidUtf8Codepoint;
		}
		const u8 c1 = utf8ByteAt(text, index);
		index += 1u;
		if (!isUtf8Continuation(c1)) {
			return kInvalidUtf8Codepoint;
		}
		return ((c0 & 0x1Fu) << 6u) | (c1 & 0x3Fu);
	}
	if ((c0 & 0xF0u) == 0xE0u) {
		if (index + 1u >= size) {
			return kInvalidUtf8Codepoint;
		}
		const u8 c1 = utf8ByteAt(text, index);
		const u8 c2 = utf8ByteAt(text, index + 1u);
		index += 2u;
		if (!isUtf8Continuation(c1) || !isUtf8Continuation(c2)) {
			return kInvalidUtf8Codepoint;
		}
		return ((c0 & 0x0Fu) << 12u) | ((c1 & 0x3Fu) << 6u) | (c2 & 0x3Fu);
	}
	if (index + 2u >= size) {
		return kInvalidUtf8Codepoint;
	}
	const u8 c1 = utf8ByteAt(text, index);
	const u8 c2 = utf8ByteAt(text, index + 1u);
	const u8 c3 = utf8ByteAt(text, index + 2u);
	index += 3u;
	if (!isUtf8Continuation(c1) || !isUtf8Continuation(c2) || !isUtf8Continuation(c3)) {
		return kInvalidUtf8Codepoint;
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
		appendUtf8TailBytes(out, codepoint, 1);
		return;
	}
	if (codepoint <= 0xFFFFu) {
		out.push_back(static_cast<char>(0xE0u | ((codepoint >> 12u) & 0x0Fu)));
		appendUtf8TailBytes(out, codepoint, 2);
		return;
	}
	out.push_back(static_cast<char>(0xF0u | ((codepoint >> 18u) & 0x07u)));
	appendUtf8TailBytes(out, codepoint, 3);
}

} // namespace bmsx
