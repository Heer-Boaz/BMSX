#include "common/serializer/binary_stream.h"

#include <algorithm>
#include <array>
#include <bit>
#include <stdexcept>

namespace {
void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

template<class Sink> void writeFixture(Sink& sink) {
	sink.boolean(true); sink.boolean(false);
	sink.u8(0xfe); sink.u16(0x1234); sink.i16(-2);
	sink.u32(0x89abcdef); sink.i32(-3);
	sink.u64((bmsx::u64{1} << 40) + 9); sink.i64(-((bmsx::i64{1} << 40) + 9));
	sink.f64(-0.0);
	sink.string(std::string_view("\xc3\xb6\xf0\x9f\x98\x80\0", 7));
}

void readFixture(bmsx::BinaryReader& reader) {
	require(reader.boolean() && !reader.boolean(), "boolean bytes round-trip");
	require(reader.u8() == 0xfe && reader.u16() == 0x1234 && reader.i16() == -2, "small integer widths round-trip");
	require(reader.u32() == 0x89abcdef && reader.i32() == -3, "register word bits round-trip");
	require(reader.u64() == (bmsx::u64{1} << 40) + 9 && reader.i64() == -((bmsx::i64{1} << 40) + 9), "wide cycle counts round-trip");
	require(std::bit_cast<bmsx::u64>(reader.f64()) == 0x8000000000000000, "floating negative zero is preserved");
	require(reader.string() == std::string("\xc3\xb6\xf0\x9f\x98\x80\0", 7), "UTF-8 and embedded NUL round-trip");
	reader.finish();
}
}

int main() {
	using namespace bmsx;
	// Shared with the TS stream regression: exact widths, little endian, no tags.
	const std::array<u8, 50> expected{
		1, 0, 0xfe, 0x34, 0x12, 0xfe, 0xff, 0xef, 0xcd, 0xab, 0x89, 0xfd, 0xff, 0xff, 0xff,
		9, 0, 0, 0, 0, 1, 0, 0, 0xf7, 0xff, 0xff, 0xff, 0xff, 0xfe, 0xff, 0xff,
		0, 0, 0, 0, 0, 0, 0, 0x80, 7, 0, 0, 0, 0xc3, 0xb6, 0xf0, 0x9f, 0x98, 0x80, 0,
	};
	BinarySize size;
	writeFixture(size);
	require(size.length == expected.size(), "measure exactly predicts the encoded extent");
	std::array<u8, 52> output;
	output.fill(0xa5);
	BinaryWriter writer(std::span<u8>(output).subspan(1, expected.size()));
	writeFixture(writer);
	require(std::equal(expected.begin(), expected.end(), output.begin() + 1), "storage has the declared primitive layout");
	require(output.front() == 0xa5 && output.back() == 0xa5, "writes remain within their admitted output");
	BinaryReader reader(expected);
	readFixture(reader);
	for (size_t length = 0; length < expected.size(); ++length) {
		bool rejected = false;
		try { BinaryReader truncated(std::span<const u8>(expected).first(length)); readFixture(truncated); }
		catch (const std::runtime_error&) { rejected = true; }
		require(rejected, "every truncated field is rejected at the byte boundary");
	}
	const std::array<u32, 3> words{0, 0x12345678, 0xffffffff};
	std::array<u8, 12> bytes;
	BinaryWriter wordWriter(bytes);
	wordWriter.u32s(words);
	BinaryReader wordReader(bytes);
	const auto decoded = wordReader.u32s(words.size());
	require(std::ranges::equal(decoded, words), "bulk word I/O preserves all bits");
}
