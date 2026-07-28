#pragma once

#include "common/primitives.h"

#include <cstddef>

namespace bmsx {

constexpr u32 GX_GPU_VRAM_WIDTH = 1024u;
constexpr u32 GX_GPU_VRAM_HEIGHT = 1024u;
constexpr u32 GX_GPU_VRAM_Y_ADDRESS_PERIOD = 1024u;
constexpr u32 GX_GPU_VRAM_Y_ADDRESS_EXTENSION_BIT = 0x200u;
constexpr size_t GX_GPU_VRAM_WORD_COUNT = static_cast<size_t>(GX_GPU_VRAM_WIDTH) * static_cast<size_t>(GX_GPU_VRAM_HEIGHT);
constexpr size_t GX_GPU_VRAM_BYTE_COUNT = GX_GPU_VRAM_WORD_COUNT * 2u;

inline u32 gxGpuVramYAddressMask(u32 vramYAddressExtensionWord) {
	return vramYAddressExtensionWord != 0u ? GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1u : GX_GPU_VRAM_Y_ADDRESS_EXTENSION_BIT - 1u;
}

inline u32 gxGpuVramYAddress(u32 y, u32 vramYAddressExtensionWord) {
	return y & gxGpuVramYAddressMask(vramYAddressExtensionWord);
}

} // namespace bmsx
