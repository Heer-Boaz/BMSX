#pragma once

#include "common/primitives.h"

#include <cstddef>

namespace bmsx {

constexpr u32 GX_GPU_VRAM_X_ADDRESS_PERIOD = 1024u;
constexpr u32 GX_GPU_VRAM_Y_ADDRESS_PERIOD = 1024u;
constexpr u32 GX_GPU_VRAM_Y_ADDRESS_EXTENSION_BIT = 0x200u;
constexpr u32 GX_GPU_VRAM_ADDRESS_ROW_BYTE_COUNT = GX_GPU_VRAM_X_ADDRESS_PERIOD * 2u;
constexpr size_t GX_GPU_VRAM_ADDRESS_WORD_COUNT =
	static_cast<size_t>(GX_GPU_VRAM_X_ADDRESS_PERIOD) * static_cast<size_t>(GX_GPU_VRAM_Y_ADDRESS_PERIOD);

inline u32 gxGpuVramYAddressMask(u32 vramYAddressExtensionWord) {
	return vramYAddressExtensionWord != 0u ? GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1u : GX_GPU_VRAM_Y_ADDRESS_EXTENSION_BIT - 1u;
}

inline u32 gxGpuVramYAddress(u32 y, u32 vramYAddressExtensionWord) {
	return y & gxGpuVramYAddressMask(vramYAddressExtensionWord);
}

} // namespace bmsx
