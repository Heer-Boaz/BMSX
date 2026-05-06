#include "rompack/metadata.h"

#include "common/endian.h"
#include <string>

namespace bmsx {
namespace {

u32 readMetadataVarUint(const u8* data, size_t size, size_t& pos) {
	u32 value = 0;
	u32 shift = 0;
	int count = 0;
	while (true) {
		if (pos >= size) {
			throw BMSX_RUNTIME_ERROR("ROM metadata varuint truncated.");
		}
		const u8 byte = data[pos++];
		value |= static_cast<u32>(byte & 0x7f) << shift;
		if ((byte & 0x80) == 0) {
			return value;
		}
		shift += 7;
		if (++count > 4) {
			throw BMSX_RUNTIME_ERROR("ROM metadata varuint overflow.");
		}
	}
}

} // namespace

RomMetadataSection parseRomMetadataSection(const u8* data, size_t size) {
	if (size < ROM_METADATA_HEADER_SIZE) {
		throw BMSX_RUNTIME_ERROR("ROM metadata section too small.");
	}
	if (readLE32(data + 0) != ROM_METADATA_MAGIC) {
		throw BMSX_RUNTIME_ERROR("Invalid ROM metadata magic.");
	}
	if (readLE32(data + 4) != ROM_METADATA_VERSION) {
		throw BMSX_RUNTIME_ERROR("Unsupported ROM metadata version.");
	}
	const u32 propCount = readLE32(data + 8);
	size_t pos = ROM_METADATA_HEADER_SIZE;
	RomMetadataSection section;
	section.propNames.reserve(propCount);
	for (u32 i = 0; i < propCount; ++i) {
		const u32 length = readMetadataVarUint(data, size, pos);
		if (pos + length > size) {
			throw BMSX_RUNTIME_ERROR("ROM metadata property string truncated.");
		}
		section.propNames.emplace_back(reinterpret_cast<const char*>(data + pos), length);
		pos += length;
	}
	section.payloadOffset = pos;
	return section;
}

} // namespace bmsx
