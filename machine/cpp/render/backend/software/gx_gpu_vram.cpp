#include "render/backend/software/gx_gpu_vram.h"

namespace bmsx {
namespace {

inline u32 ditheredByte(u32 byte, i32 offset) {
	const i32 value = static_cast<i32>(byte) + offset;
	if (value < 0) {
		return 0u;
	}
	if (value > 255) {
		return 255u;
	}
	return static_cast<u32>(value);
}

inline u32 blendChannel5(u32 src, u32 dst, u32 blendMode) {
	switch (blendMode) {
		case 0u:
			return (src + dst) >> 1u;
		case 1u: {
			const u32 sum = src + dst;
			return sum < 31u ? sum : 31u;
		}
		case 2u:
			return dst > src ? dst - src : 0u;
		default: {
			const u32 sum = dst + (src >> 2u);
			return sum < 31u ? sum : 31u;
		}
	}
}

} // namespace

std::array<u16, kGxGpuSoftwareVramWords> g_gxGpuSoftwareVram{};

void resetGxGpuSoftwareVram() {
	g_gxGpuSoftwareVram.fill(0u);
}

size_t gxGpuSoftwareVramIndex(i32 x, i32 y) {
	const u32 wrappedX = static_cast<u32>(x) & (GX_GPU_VRAM_WIDTH - 1u);
	const u32 wrappedY = static_cast<u32>(y) & (GX_GPU_VRAM_HEIGHT - 1u);
	return static_cast<size_t>(wrappedY) * static_cast<size_t>(GX_GPU_VRAM_WIDTH) + static_cast<size_t>(wrappedX);
}

u16 gxGpuSoftwareRgb888WordToRgb555(u32 word) {
	return static_cast<u16>(((word & 0xffu) >> 3u)
		| ((((word >> 8u) & 0xffu) >> 3u) << 5u)
		| ((((word >> 16u) & 0xffu) >> 3u) << 10u));
}

u8 gxGpuSoftwareRgb555ChannelTo8(u32 channel) {
	return static_cast<u8>((channel << 3u) | (channel >> 2u));
}

void gxGpuSoftwareWriteMaskedVramWord(size_t index, u32 word, u32 maskBitModeWord) {
	const u16 dstWord = g_gxGpuSoftwareVram[index];
	if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) && (dstWord & 0x8000u) != 0u) {
		return;
	}
	const u32 maskBit = gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 0x8000u : word & 0x8000u;
	g_gxGpuSoftwareVram[index] = static_cast<u16>((word & 0x7fffu) | maskBit);
}

void gxGpuSoftwareWriteRenderVramPixel5(i32 x, i32 y, u32 r5, u32 g5, u32 b5, bool blendEnabled, u32 blendMode, u32 maskBitModeWord, u32 outputMaskBit) {
	const size_t index = gxGpuSoftwareVramIndex(x, y);
	const u32 dstWord = g_gxGpuSoftwareVram[index];
	if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) && (dstWord & 0x8000u) != 0u) {
		return;
	}
	u32 blendedR5 = r5;
	u32 blendedG5 = g5;
	u32 blendedB5 = b5;
	if (blendEnabled) {
		blendedR5 = blendChannel5(blendedR5, dstWord & 0x1fu, blendMode);
		blendedG5 = blendChannel5(blendedG5, (dstWord >> 5u) & 0x1fu, blendMode);
		blendedB5 = blendChannel5(blendedB5, (dstWord >> 10u) & 0x1fu, blendMode);
	}
	const u32 maskBit = gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 0x8000u : outputMaskBit & 0x8000u;
	g_gxGpuSoftwareVram[index] = static_cast<u16>(blendedR5 | (blendedG5 << 5u) | (blendedB5 << 10u) | maskBit);
}

void gxGpuSoftwareWriteRenderVramPixel(i32 x, i32 y, u32 r8, u32 g8, u32 b8, bool ditherEnabled, bool blendEnabled, u32 blendMode, u32 maskBitModeWord) {
	u32 r = r8;
	u32 g = g8;
	u32 b = b8;
	if (ditherEnabled) {
		const i32 offset = gxGpuSoftwareDitherOffset(x, y);
		r = ditheredByte(r, offset);
		g = ditheredByte(g, offset);
		b = ditheredByte(b, offset);
	}
	gxGpuSoftwareWriteRenderVramPixel5(x, y, r >> 3u, g >> 3u, b >> 3u, blendEnabled, blendMode, maskBitModeWord, 0u);
}

i32 gxGpuSoftwareDitherOffset(i32 x, i32 y) {
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

bool gxGpuSoftwareInterlacedSkipsLine(i32 y, u32 interlacedRenderWord) {
	return (interlacedRenderWord & GX_GPU_INTERLACED_RENDER_ENABLE) != 0u
		&& (static_cast<u32>(y) & 1u) == ((interlacedRenderWord & GX_GPU_INTERLACED_RENDER_ACTIVE_LINE_LSB) >> 1u);
}

} // namespace bmsx
