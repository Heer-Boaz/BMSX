#include "common/serializer/binencoder.h"
#include <algorithm>
#include <array>
#include <cstdlib>
#include <new>
#include <stdexcept>

namespace {
size_t largeAllocations = 0;
void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}
}

// Observe payload-sized allocations, not incidental schema bookkeeping.
void* operator new(std::size_t size) {
	if (size >= 1024 * 1024) ++largeAllocations;
	if (void* memory = std::malloc(size)) return memory;
	throw std::bad_alloc();
}
void operator delete(void* memory) noexcept { std::free(memory); }
void operator delete(void* memory, std::size_t) noexcept { std::free(memory); }

int main() {
	using namespace bmsx;
	const std::array<std::string, 2> properties{"bytes", "text"};
	std::array<u8, 5> bytes{0, 1, 127, 128, 255};
	BinObject fields;
	fields["bytes"] = BinBinaryView(bytes);
	fields["text"] = "unicode \xc3\xab";
	const BinValue value(std::move(fields));
	require(value["bytes"].asBinaryView().data() == bytes.data(), "binary input is borrowed, not cloned");
	bytes[1] = 42;
	const auto expected = encodeBinaryWithPropTable(value, properties);
	const auto decoded = decodeBinaryWithPropTable(expected, properties);
	require(std::ranges::equal(decoded["bytes"].asBinary(), bytes), "decoder owns the current borrowed bytes");
	bytes[1] = 43;
	require(decoded["bytes"].asBinary()[1] == 42, "decoded bytes do not alias the input");
	bytes[1] = 42;
	std::vector<u8> destination(expected.size() + 2, 0xa5);
	const auto occupied = encodeBinaryWithPropTable(value, properties,
		std::span<u8>(destination).subspan(1, expected.size()));
	require(occupied == expected.size(), "direct encoder reports its exact extent");
	require(std::equal(expected.begin(), expected.end(), destination.begin() + 1), "direct and owned encoders are byte identical");
	require(destination.front() == 0xa5 && destination.back() == 0xa5, "direct encoder respects destination boundaries");
	std::fill(destination.begin(), destination.end(), 0xa5);
	bool rejected = false;
	try {
		encodeBinaryWithPropTable(value, properties, std::span<u8>(destination).subspan(1, expected.size() - 1));
	} catch (const std::length_error&) {
		rejected = true;
	}
	require(rejected, "undersized external buffers are rejected");
	require(destination[expected.size()] == 0xa5 && destination.back() == 0xa5, "rejection never writes beyond the provided span");
	const BinValue empty{BinBinaryView{}};
	const auto emptyBytes = encodeBinaryWithPropTable(empty, {});
	require(decodeBinaryWithPropTable(emptyBytes, {}).asBinary().empty(), "empty borrowed payloads round-trip");
	std::vector<u8> pixels(2 * 1024 * 1024, 0x5a);
	const BinValue vram{BinBinaryView(pixels)};
	std::vector<u8> output(pixels.size() + 16);
	const size_t before = largeAllocations;
	const size_t written = encodeBinaryWithPropTable(vram, {}, std::span<u8>(output));
	require(largeAllocations == before, "direct binary encoding never allocates an intermediate payload-sized buffer");
	require(written > pixels.size(), "binary framing is included in the occupied extent");
}
