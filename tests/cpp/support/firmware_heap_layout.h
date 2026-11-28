#pragma once

#include "spec/blua32/execution_domain.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx::test {

// Stock firmware collector record layout, used by the native test oracle.
inline constexpr u32 GC_COLOR_OFFSET = 1;
inline constexpr u8 GC_COLOR_MASK = 0x03;
inline constexpr u32 GC_RECORD_SHIFT = 3;
inline constexpr u32 GC_RECORD_ALIGNMENT = 1u << GC_RECORD_SHIFT;
inline constexpr u32 GC_RECORD_MASK = MAIN_RAM_SIZE - GC_RECORD_ALIGNMENT;
// The record address names the aligned payload; the preceding word links
// this object into the collector's inventory. This prefix is not guest charge.
inline constexpr u32 GC_OBJECT_PREFIX = GC_RECORD_ALIGNMENT;
inline constexpr u32 GC_OBJECT_LINK_BEFORE = sizeof(u32);
inline constexpr u32 GC_RECORD_LINK = 4;
// A four-MiB RAM bank has 19 index bits at eight-byte record alignment.
inline constexpr u32 GC_GRAY_INDEX_BITS = 19;
inline constexpr u32 GC_GRAY_INDEX_MASK = (1u << GC_GRAY_INDEX_BITS) - 1;
inline constexpr u32 CLOSURE_CANONICAL = 4;

// Firmware's storage owner is separate from the machine operand directory.
inline constexpr u32 FIRMWARE_IMAGE_STORAGE_OFFSET = 0x250u;
inline constexpr u32 FIRMWARE_IMAGE_STORAGE_SIZE = 12u;
inline constexpr u32 FIRMWARE_IMAGE_STORAGE_BASE_OFFSET = 0u;
inline constexpr u32 FIRMWARE_IMAGE_STORAGE_BYTES_OFFSET = 4u;
inline constexpr u32 FIRMWARE_IMAGE_STORAGE_RAM_STRING_END_OFFSET = 8u;

constexpr u32 firmwareImageStorageOffset(u32 management, ExecutionDomainId domain) {
	return management + FIRMWARE_IMAGE_STORAGE_OFFSET + FIRMWARE_IMAGE_STORAGE_SIZE * static_cast<u32>(domain + 1);
}

} // namespace bmsx::test
