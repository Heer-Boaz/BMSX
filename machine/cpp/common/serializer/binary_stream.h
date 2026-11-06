#pragma once

#include "common/endian.h"

#include <bit>
#include <cassert>
#include <cstring>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace bmsx {

// Typed, little-endian storage streams. The consumer owns the field layout.
// Measuring visits spans in O(1); writing never allocates or stages their bytes.
class BinarySize {
public:
	size_t length = 0;
	void u8(bmsx::u8) { length += 1; }
	void u16(bmsx::u16) { length += 2; }
	void i16(bmsx::i16) { length += 2; }
	void u32(bmsx::u32) { length += 4; }
	void i32(bmsx::i32) { length += 4; }
	void u64(bmsx::u64) { length += 8; }
	void i64(bmsx::i64) { length += 8; }
	void f64(bmsx::f64) { length += 8; }
	void boolean(bool) { ++length; }
	void bytes(std::span<const bmsx::u8> value) { length += value.size(); }
	void u32s(std::span<const bmsx::u32> value) { length += value.size_bytes(); }
	void i32s(std::span<const bmsx::i32> value) { length += value.size_bytes(); }
	void string(std::string_view value) { length += 4 + value.size(); }
};

class BinaryWriter {
public:
	explicit BinaryWriter(std::span<bmsx::u8> output) : m_output(output) {}
	size_t length = 0;
	void u8(bmsx::u8 value) { *take(1) = value; }
	void u16(bmsx::u16 value) { writeLE16(take(2), value); }
	void i16(bmsx::i16 value) { writeLE16(take(2), value); }
	void u32(bmsx::u32 value) { writeLE32(take(4), value); }
	void i32(bmsx::i32 value) { writeLE32(take(4), value); }
	void u64(bmsx::u64 value) { writeLE64(take(8), value); }
	void i64(bmsx::i64 value) { writeLE64(take(8), value); }
	void f64(bmsx::f64 value) { writeF64LE(take(8), value); }
	void boolean(bool value) { u8(value ? 1 : 0); }
	void bytes(std::span<const bmsx::u8> value) {
		if (!value.empty()) std::memcpy(take(value.size()), value.data(), value.size());
	}
	void u32s(std::span<const bmsx::u32> value) { words(value); }
	void i32s(std::span<const bmsx::i32> value) { words(value); }
	void string(std::string_view value) {
		u32(static_cast<bmsx::u32>(value.size()));
		bytes({reinterpret_cast<const bmsx::u8*>(value.data()), value.size()});
	}
private:
	// The owning codec measures and admits its complete output before writing.
	bmsx::u8* take(size_t count) {
		assert(count <= m_output.size() - length);
		auto* output = m_output.data() + length;
		length += count;
		return output;
	}
	template<class T> void words(std::span<const T> value) {
		if constexpr (std::endian::native == std::endian::little) {
			bytes({reinterpret_cast<const bmsx::u8*>(value.data()), value.size_bytes()});
		} else {
			for (T word : value) u32(static_cast<bmsx::u32>(word));
		}
	}
	std::span<bmsx::u8> m_output;
};

class BinaryReader {
public:
	explicit BinaryReader(std::span<const bmsx::u8> input) : m_input(input) {}
	bmsx::u8 u8() { return *take(1).data(); }
	bmsx::u16 u16() { return readLE16(take(2).data()); }
	bmsx::i16 i16() { return static_cast<bmsx::i16>(readLE16(take(2).data())); }
	bmsx::u32 u32() { return readLE32(take(4).data()); }
	bmsx::i32 i32() { return static_cast<bmsx::i32>(readLE32(take(4).data())); }
	bmsx::u64 u64() { return readLE64(take(8).data()); }
	bmsx::i64 i64() { return static_cast<bmsx::i64>(readLE64(take(8).data())); }
	bmsx::f64 f64() { return readF64LE(take(8).data()); }
	bool boolean() { return u8() != 0; }
	std::vector<bmsx::u8> bytes(size_t count) {
		const auto input = take(count);
		return {input.begin(), input.end()};
	}
	void u32s(std::span<bmsx::u32> output) { words(output); }
	void i32s(std::span<bmsx::i32> output) { words(output); }
	std::vector<bmsx::u32> u32s(size_t count) { return wordVector<bmsx::u32>(count); }
	std::vector<bmsx::i32> i32s(size_t count) { return wordVector<bmsx::i32>(count); }
	std::string string() {
		const auto input = take(u32());
		return {reinterpret_cast<const char*>(input.data()), input.size()};
	}
	void finish() const {
		if (m_offset != m_input.size()) throw std::runtime_error("Trailing binary payload.");
	}
private:
	std::span<const bmsx::u8> take(size_t count, size_t width = 1) {
		if (count > (m_input.size() - m_offset) / width) throw std::runtime_error("Truncated binary payload.");
		const size_t bytes = count * width;
		const auto input = m_input.subspan(m_offset, bytes);
		m_offset += bytes;
		return input;
	}
	template<class T> void copyWords(std::span<const bmsx::u8> input, std::span<T> output) {
		if constexpr (std::endian::native == std::endian::little) {
			if (!input.empty()) std::memcpy(output.data(), input.data(), input.size());
		} else {
			for (size_t index = 0; index < output.size(); ++index)
				output[index] = static_cast<T>(readLE32(input.data() + index * 4));
		}
	}
	template<class T> void words(std::span<T> output) { copyWords(take(output.size(), sizeof(T)), output); }
	template<class T> std::vector<T> wordVector(size_t count) {
		const auto input = take(count, sizeof(T));
		std::vector<T> output(count);
		copyWords<T>(input, output);
		return output;
	}
	std::span<const bmsx::u8> m_input;
	size_t m_offset = 0;
};

} // namespace bmsx
