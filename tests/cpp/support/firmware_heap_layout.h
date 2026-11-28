#pragma once

#include "spec/blua32/execution_domain.h"

namespace bmsx::test {

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
