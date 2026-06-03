#include "rompack/host_system_atlas.h"

#include <array>
#include <limits>
#include <stdexcept>
#include <string>

namespace bmsx {
namespace {

std::array<int, 256> buildBase64DecodeTable() {
	std::array<int, 256> table{};
	table.fill(-1);
	for (int value = 0; value < 26; ++value) {
		table[static_cast<size_t>('A' + value)] = value;
		table[static_cast<size_t>('a' + value)] = value + 26;
	}
	for (int value = 0; value < 10; ++value) {
		table[static_cast<size_t>('0' + value)] = value + 52;
	}
	table[static_cast<size_t>('+')] = 62;
	table[static_cast<size_t>('/')] = 63;
	return table;
}

std::vector<u8> decodeBase64(std::string_view input) {
	static const std::array<int, 256> decodeTable = buildBase64DecodeTable();
	std::vector<u8> out;
	out.reserve((input.size() * 3u) / 4u);
	int value = 0;
	int bits = -8;
	for (char raw : input) {
		const unsigned char ch = static_cast<unsigned char>(raw);
		if (ch == '=') {
			break;
		}
		const int decoded = decodeTable[ch];
		if (decoded < 0) {
			throw BMSX_RUNTIME_ERROR("[HostSystemAtlas] Invalid base64 byte in generated atlas.");
		}
		value = (value << 6) | decoded;
		bits += 6;
		if (bits >= 0) {
			out.push_back(static_cast<u8>((value >> bits) & 0xff));
			bits -= 8;
		}
	}
	return out;
}

std::uint32_t hostSystemAtlasByteSize() {
	const std::uint64_t bytes = static_cast<std::uint64_t>(hostSystemAtlasWidth())
		* static_cast<std::uint64_t>(hostSystemAtlasHeight())
		* 4u;
	if (bytes > std::numeric_limits<std::uint32_t>::max()) {
		throw BMSX_RUNTIME_ERROR("[HostSystemAtlas] Generated atlas is too large for a host texture.");
	}
	return static_cast<std::uint32_t>(bytes);
}

const std::vector<u8>& decodedHostSystemAtlasPixels() {
	static const std::vector<u8> pixels = [] {
		std::vector<u8> decoded = decodeBase64(generatedHostSystemAtlasRgbaBase64());
		const size_t expectedSize = static_cast<size_t>(hostSystemAtlasByteSize());
		if (decoded.size() != expectedSize) {
			throw BMSX_RUNTIME_ERROR("[HostSystemAtlas] Generated atlas pixel data has the wrong size.");
		}
		return decoded;
	}();
	return pixels;
}

} // namespace

std::uint32_t hostSystemAtlasWidth() {
	const std::int32_t width = generatedHostSystemAtlasWidth();
	if (width <= 0) {
		throw BMSX_RUNTIME_ERROR("[HostSystemAtlas] Generated atlas width is invalid.");
	}
	return static_cast<std::uint32_t>(width);
}

std::uint32_t hostSystemAtlasHeight() {
	const std::int32_t height = generatedHostSystemAtlasHeight();
	if (height <= 0) {
		throw BMSX_RUNTIME_ERROR("[HostSystemAtlas] Generated atlas height is invalid.");
	}
	return static_cast<std::uint32_t>(height);
}

const std::vector<u8>& hostSystemAtlasPixels() {
	return decodedHostSystemAtlasPixels();
}

const HostSystemAtlasGeneratedImage& hostSystemAtlasImage(std::string_view id) {
	const HostSystemAtlasGeneratedImage* images = generatedHostSystemAtlasImages();
	const size_t count = generatedHostSystemAtlasImageCount();
	for (size_t index = 0; index < count; ++index) {
		if (images[index].id == id) {
			return images[index];
		}
	}
	throw BMSX_RUNTIME_ERROR("[HostSystemAtlas] Image '" + std::string(id) + "' is not in the host system atlas.");
}

} // namespace bmsx
