#pragma once

#include "common/primitives.h"

#include <cstddef>

namespace bmsx {

constexpr u32 GX_GPU_VRAM_WIDTH = 1024u;
constexpr u32 GX_GPU_VRAM_HEIGHT = 512u;
constexpr u32 GX_GPU_VRAM_Y_ADDRESS_PERIOD = 1024u;
constexpr u32 GX_GPU_VRAM_Y_BANK_BIT = GX_GPU_VRAM_HEIGHT;
constexpr size_t GX_GPU_VRAM_WORD_COUNT = static_cast<size_t>(GX_GPU_VRAM_WIDTH) * static_cast<size_t>(GX_GPU_VRAM_HEIGHT);
constexpr size_t GX_GPU_VRAM_BYTE_COUNT = GX_GPU_VRAM_WORD_COUNT * 2u;
constexpr u32 GX_GPU_VRAM_OPEN_BUS_WORD = 0u;

inline u32 gxGpuVramYAddressMask(u32 vramYAddressExtensionWord) {
	return vramYAddressExtensionWord != 0u ? GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1u : GX_GPU_VRAM_HEIGHT - 1u;
}

inline u32 gxGpuVramYAddress(u32 y, u32 vramYAddressExtensionWord) {
	return y & gxGpuVramYAddressMask(vramYAddressExtensionWord);
}

inline bool gxGpuVramYBankInstalled(u32 y) {
	return (y & GX_GPU_VRAM_Y_BANK_BIT) == 0u;
}

inline bool gxGpuVramYSpanOverlapsInstalledBank(u32 y, u32 height, u32 vramYAddressExtensionWord) {
	if (height == 0u) return false;
	if (vramYAddressExtensionWord == 0u) return true;
	const u32 logicalY = y & (GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1u);
	return logicalY < GX_GPU_VRAM_HEIGHT || height > GX_GPU_VRAM_Y_ADDRESS_PERIOD - logicalY;
}

} // namespace bmsx
