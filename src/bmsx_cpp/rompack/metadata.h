#pragma once

#include "common/primitives.h"
#include <cstddef>
#include <string>
#include <vector>

namespace bmsx {

constexpr u32 ROM_METADATA_MAGIC = 0x44544d42; // 'BMTD' little-endian
constexpr u32 ROM_METADATA_VERSION = 1;
constexpr size_t ROM_METADATA_HEADER_SIZE = 12;

struct RomMetadataSection {
	std::vector<std::string> propNames;
	size_t payloadOffset = 0;
};

RomMetadataSection parseRomMetadataSection(const u8* data, size_t size);

} // namespace bmsx
