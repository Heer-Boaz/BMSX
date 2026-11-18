#include "machine/cpu/value_storage.h"

#include <array>
#include <cstdio>
#include <cstdlib>
#include <new>
#include <string_view>

namespace {
size_t allocations = 0, requestedBytes = 0, deallocations = 0;
void require(bool condition, const char* message) {
	if (!condition) { std::fprintf(stderr, "%s\n", message); std::abort(); }
}
}

void* operator new[](size_t bytes) {
	void* result = std::malloc(bytes);
	if (!result) throw std::bad_alloc();
	++allocations; requestedBytes += bytes;
	return result;
}
void operator delete[](void* pointer) noexcept { ++deallocations; std::free(pointer); }
void operator delete[](void* pointer, size_t) noexcept { ::operator delete[](pointer); }

int main(int argc, char** argv) {
	using bmsx::ValueStorage;
	static_assert(bmsx::VALUE_STORAGE_SLOT_BYTES == 5);
	for (size_t count : {0u, 1u, 2u, 3u, 8u, 127u, 1024u}) {
		const size_t before = requestedBytes;
		ValueStorage storage(count);
		require(storage.capacity() == count && storage.byteLength() == count * 5, "five bytes per dense slot");
		require(requestedBytes - before == count * 5, "one allocation requests the exact plane size");
		if (count != 0) {
			require(reinterpret_cast<uintptr_t>(storage.words()) % alignof(uint32_t) == 0, "word plane is aligned");
			require(storage.tags() == reinterpret_cast<uint8_t*>(storage.words()) + count * 4, "tag plane follows all words");
		}
		for (size_t i = 0; i < count; ++i) require(storage.words()[i] == 0 && storage.tags()[i] == 0, "new storage is zeroed");
		const size_t allocated = allocations;
		storage.resize(count);
		require(allocations == allocated, "same capacity does not allocate");
	}
	{
		ValueStorage storage(11);
		const std::array<uint32_t, 11> words{0u, 0xffffffffu, 0x80000000u, 0x7fc00001u,
			0xffc00000u, 0x7f800000u, 0xff800000u, 1u, 0x007fffffu, 0x3f800000u, 0x4b800001u};
		for (size_t i = 0; i < words.size(); ++i) { storage.words()[i] = words[i]; storage.tags()[i] = static_cast<uint8_t>(i * 29); }
		storage.resize(19);
		for (size_t i = 0; i < words.size(); ++i) require(storage.words()[i] == words[i] && storage.tags()[i] == static_cast<uint8_t>(i * 29), "growth preserves raw words and tags");
		for (size_t i = words.size(); i < 19; ++i) require(storage.words()[i] == 0 && storage.tags()[i] == 0, "growth initializes new slots");
		storage.resize(3); storage.resize(13);
		for (size_t i = 0; i < 3; ++i) require(storage.words()[i] == words[i], "shrinking retains the prefix");
		for (size_t i = 3; i < 13; ++i) require(storage.words()[i] == 0 && storage.tags()[i] == 0, "regrowth does not resurrect truncated slots");
		ValueStorage source(13);
		for (size_t i = 0; i < 13; ++i) { source.words()[i] = 0x7fc00000u + static_cast<uint32_t>(i); source.tags()[i] = 0xff; }
		const size_t allocated = allocations;
		auto* const backing = storage.words();
		for (int i = 0; i < 10000; ++i) {
			storage.copyFrom(source, 0, 0, 13); storage.copyWithin(2, 0, 11);
			storage.copyWithin(0, 2, 11); storage.clear(11, 2);
		}
		require(allocations == allocated && storage.words() == backing, "hot slot operations retain backing without allocation");
		for (size_t i = 0; i < 11; ++i) require(storage.words()[i] == source.words()[i] && storage.tags()[i] == 0xff, "overlap preserves raw NaN bits and tags");
		storage.resize(0); storage.clear(0, 0); storage.copyWithin(0, 0, 0); storage.copyFrom(source, 0, 0, 0);
		require(storage.byteLength() == 0 && storage.words() == nullptr && storage.tags() == nullptr, "empty storage owns no allocation");
	}
	{
		ValueStorage storage(17), source(32);
		std::array<uint32_t, 32> expectedWords{};
		std::array<uint8_t, 32> expectedTags{};
		for (size_t i = 0; i < 32; ++i) { source.words()[i] = 0x7f800001u + static_cast<uint32_t>(i); source.tags()[i] = static_cast<uint8_t>(i * 37); }
		uint32_t seed = 0x12345678u;
		for (int iteration = 0; iteration < 4096; ++iteration) {
			seed = seed * 1664525u + 1013904223u;
			const size_t count = (seed >> 24) % 6;
			const size_t first = (seed >> 8) % (storage.capacity() - count + 1);
			const size_t destination = (seed >> 16) % (storage.capacity() - count + 1);
			switch (seed & 3u) {
				case 0: {
					auto words = expectedWords; auto tags = expectedTags;
					storage.copyWithin(destination, first, count);
					for (size_t i = 0; i < count; ++i) { expectedWords[destination+i] = words[first+i]; expectedTags[destination+i] = tags[first+i]; }
					break;
				}
				case 1:
					storage.copyFrom(source, destination, first, count);
					for (size_t i = 0; i < count; ++i) { expectedWords[destination+i] = source.words()[first+i]; expectedTags[destination+i] = source.tags()[first+i]; }
					break;
				case 2:
					storage.clear(first, count);
					for (size_t i = 0; i < count; ++i) { expectedWords[first+i] = 0; expectedTags[first+i] = 0; }
					break;
				case 3: {
					const size_t next = 6 + ((seed >> 24) % 27);
					for (size_t i = std::min(next, storage.capacity()); i < 32; ++i) { expectedWords[i] = 0; expectedTags[i] = 0; }
					storage.resize(next); break;
				}
			}
			for (size_t i = 0; i < storage.capacity(); ++i) require(storage.words()[i] == expectedWords[i] && storage.tags()[i] == expectedTags[i], "trace agrees with independent slot-pair model");
		}
		if (argc == 2 && std::string_view(argv[1]) == "--trace") {
			std::printf("[");
			for (size_t i = 0; i < storage.capacity(); ++i) std::printf("%s[%u,%u]", i ? "," : "", storage.words()[i], storage.tags()[i]);
			std::printf("]\n");
		}
	}
	require(allocations == deallocations, "all backing allocations are released");
	return 0;
}
