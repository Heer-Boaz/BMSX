#pragma once

#include "common/primitives.h"
#include "machine/devices/gx/vram_address.h"

#include <array>
#include <cstddef>

namespace bmsx {

constexpr size_t kGxGpuSoftwareVramWords = static_cast<size_t>(GX_GPU_VRAM_WIDTH) * static_cast<size_t>(GX_GPU_VRAM_HEIGHT);

extern std::array<u16, kGxGpuSoftwareVramWords> g_gxGpuSoftwareVram;

void loadGxGpuSoftwareVramBytes(const u8* source);

inline size_t gxGpuSoftwareVramIndex(i32 x, i32 y) {
	const u32 wrappedX = static_cast<u32>(x) & (GX_GPU_VRAM_WIDTH - 1u);
	const u32 wrappedY = static_cast<u32>(y) & (GX_GPU_VRAM_HEIGHT - 1u);
	return static_cast<size_t>(wrappedY) * static_cast<size_t>(GX_GPU_VRAM_WIDTH) + static_cast<size_t>(wrappedX);
}

inline u16 gxGpuSoftwareRgb888WordToRgb555(u32 word) {
	return static_cast<u16>(((word & 0xffu) >> 3u)
		| ((((word >> 8u) & 0xffu) >> 3u) << 5u)
		| ((((word >> 16u) & 0xffu) >> 3u) << 10u));
}

inline u8 gxGpuSoftwareRgb555ChannelTo8(u32 channel) {
	return static_cast<u8>((channel << 3u) | (channel >> 2u));
}

inline u32 gxGpuSoftwareTextureModulationPreDither(u32 texture5, u32 vertex8) {
	return (texture5 * vertex8) >> 4u;
}

inline u32 gxGpuSoftwareTextureModulationChannel5(u32 texture5, u32 vertex8, i32 ditherOffset) {
	const i32 dithered = static_cast<i32>(gxGpuSoftwareTextureModulationPreDither(texture5, vertex8)) + ditherOffset;
	if (dithered < 0) {
		return 0u;
	}
	const u32 channel5 = static_cast<u32>(dithered) >> 3u;
	return channel5 < 31u ? channel5 : 31u;
}

inline void gxGpuSoftwareWriteMaskedVramWord(size_t index, u32 word, bool checkMaskBit, bool setMaskBit) {
	const u16 dstWord = g_gxGpuSoftwareVram[index];
	if (checkMaskBit && (dstWord & 0x8000u) != 0u) {
		return;
	}
	const u32 maskBit = setMaskBit ? 0x8000u : word & 0x8000u;
	g_gxGpuSoftwareVram[index] = static_cast<u16>((word & 0x7fffu) | maskBit);
}

inline u32 gxGpuSoftwareBlendRgb555(u32 sourceWord, u32 destinationWord, u32 blendMode) {
	u32 source = sourceWord | 0x8000u;
	u32 destination = destinationWord;
	u32 color;
	switch (blendMode) {
		case 0u:
			destination |= 0x8000u;
			color = ((source + destination) - ((source ^ destination) & 0x0421u)) >> 1u;
			break;
		case 1u: {
			destination &= 0x7fffu;
			const u32 sum = source + destination;
			const u32 carry = (sum - ((source ^ destination) & 0x8421u)) & 0x8420u;
			color = (sum - carry) | (carry - (carry >> 5u));
			break;
		}
		case 2u: {
			destination |= 0x8000u;
			source &= 0x7fffu;
			const u32 difference = destination - source + 0x108420u;
			const u32 borrow = (difference - ((destination ^ source) & 0x108420u)) & 0x108420u;
			color = (difference - borrow) & (borrow - (borrow >> 5u));
			break;
		}
		default: {
			destination &= 0x7fffu;
			source = ((source >> 2u) & 0x1ce7u) | 0x8000u;
			const u32 sum = source + destination;
			const u32 carry = (sum - ((source ^ destination) & 0x8421u)) & 0x8420u;
			color = (sum - carry) | (carry - (carry >> 5u));
			break;
		}
	}
	return color & 0x7fffu;
}

inline void gxGpuSoftwareWriteRenderVramPixel5(i32 x, i32 y, u32 r5, u32 g5, u32 b5, bool blendEnabled, u32 blendMode, bool checkMaskBit, bool setMaskBit, u32 outputMaskBit) {
	const size_t index = gxGpuSoftwareVramIndex(x, y);
	const u32 dstWord = g_gxGpuSoftwareVram[index];
	if (checkMaskBit && (dstWord & 0x8000u) != 0u) {
		return;
	}
	u32 color = r5 | (g5 << 5u) | (b5 << 10u);
	if (blendEnabled) {
		color = gxGpuSoftwareBlendRgb555(color, dstWord, blendMode);
	}
	const u32 maskBit = setMaskBit ? 0x8000u : outputMaskBit & 0x8000u;
	g_gxGpuSoftwareVram[index] = static_cast<u16>(color | maskBit);
}

inline i32 gxGpuSoftwareDitherOffset(i32 x, i32 y) {
	switch (((y & 3) << 2) | (x & 3)) {
		case 0:
			return -4;
		case 1:
			return 0;
		case 2:
			return -3;
		case 3:
			return 1;
		case 4:
			return 2;
		case 5:
			return -2;
		case 6:
			return 3;
		case 7:
			return -1;
		case 8:
			return -3;
		case 9:
			return 1;
		case 10:
			return -4;
		case 11:
			return 0;
		case 12:
			return 3;
		case 13:
			return -1;
		case 14:
			return 2;
		default:
			return -2;
	}
}

inline void gxGpuSoftwareWriteRenderVramPixel(i32 x, i32 y, u32 r8, u32 g8, u32 b8, bool ditherEnabled, bool blendEnabled, u32 blendMode, bool checkMaskBit, bool setMaskBit) {
	u32 r = r8;
	u32 g = g8;
	u32 b = b8;
	if (ditherEnabled) {
		const i32 offset = gxGpuSoftwareDitherOffset(x, y);
		const i32 ditheredR = static_cast<i32>(r) + offset;
		const i32 ditheredG = static_cast<i32>(g) + offset;
		const i32 ditheredB = static_cast<i32>(b) + offset;
		r = ditheredR < 0 ? 0u : (ditheredR > 255 ? 255u : static_cast<u32>(ditheredR));
		g = ditheredG < 0 ? 0u : (ditheredG > 255 ? 255u : static_cast<u32>(ditheredG));
		b = ditheredB < 0 ? 0u : (ditheredB > 255 ? 255u : static_cast<u32>(ditheredB));
	}
	gxGpuSoftwareWriteRenderVramPixel5(x, y, r >> 3u, g >> 3u, b >> 3u, blendEnabled, blendMode, checkMaskBit, setMaskBit, 0u);
}

} // namespace bmsx
