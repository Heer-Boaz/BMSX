#pragma once

#include "common/primitives.h"
#include "render/backend/gx_gpu_render_rules.h"
#include "render/backend/software/gx_gpu_state.h"
#include "render/backend/software/gx_gpu_vram.h"
#include "spec/gx/vram.h"

#if defined(__ARM_NEON)
#include <arm_neon.h>
#include <bit>
#elif defined(__SSE2__)
#include <emmintrin.h>
#endif

namespace bmsx {

inline u32 gxGpuSoftwareTextureWindowCoord(i32 coord, u32 andMask, u32 orMask) {
	return (static_cast<u32>(coord) & andMask) | orMask;
}

template<u32 TextureMode>
inline u32 sampleGxGpuSoftwareTextureWord(
	const GxGpuSoftwareState& software,
	const u16* textureWords,
	const u16* clutWords,
	i32 u,
	i32 v,
	u32 pageX,
	u32 pageY,
	u32 textureWindowAndX,
	u32 textureWindowAndY,
	u32 textureWindowOrX,
	u32 textureWindowOrY,
	u32 clutBaseX,
	u32 clutBaseY) {
	const u32 windowedU = gxGpuSoftwareTextureWindowCoord(u, textureWindowAndX, textureWindowOrX);
	const u32 windowedV = gxGpuSoftwareTextureWindowCoord(v, textureWindowAndY, textureWindowOrY);
	if constexpr (TextureMode == GX_GPU_TEXTURE_MODE_PALETTE4) {
		const u32 textureWord = textureWords[gxGpuSoftwareVramIndex(software, static_cast<i32>(pageX + (windowedU / 4u)), static_cast<i32>(pageY + windowedV))];
		const u32 paletteIndex = (textureWord >> ((windowedU & 3u) << 2u)) & 0x0fu;
		return clutWords[gxGpuSoftwareVramIndex(software, static_cast<i32>(clutBaseX + paletteIndex), static_cast<i32>(clutBaseY))];
	}
	if constexpr (TextureMode == GX_GPU_TEXTURE_MODE_PALETTE8) {
		const u32 textureWord = textureWords[gxGpuSoftwareVramIndex(software, static_cast<i32>(pageX + (windowedU / 2u)), static_cast<i32>(pageY + windowedV))];
		const u32 paletteIndex = (textureWord >> ((windowedU & 1u) << 3u)) & 0xffu;
		return clutWords[gxGpuSoftwareVramIndex(software, static_cast<i32>(clutBaseX + paletteIndex), static_cast<i32>(clutBaseY))];
	}
	return textureWords[gxGpuSoftwareVramIndex(software, static_cast<i32>(pageX + windowedU), static_cast<i32>(pageY + windowedV))];
}

struct GxGpuSoftwareTextureSource {
	const u16* textureWords;
	const u16* clutWords;
	u32 pageX;
	u32 pageY;
	u32 textureWindowAndX;
	u32 textureWindowAndY;
	u32 textureWindowOrX;
	u32 textureWindowOrY;
	u32 clutBaseX;
	u32 clutBaseY;
};

#if defined(__ARM_NEON)
static_assert(std::endian::native == std::endian::little, "NEON texel fetches split VRAM words into little-endian bytes");

// The sixteen CLUT4 colors as low/high byte tables for vtbl.
struct GxGpuSoftwareClut4Lanes {
	uint8x8x2_t low;
	uint8x8x2_t high;
};

inline GxGpuSoftwareClut4Lanes loadGxGpuSoftwareClut4Lanes(const GxGpuSoftwareState& software, const GxGpuSoftwareTextureSource& source) {
	alignas(16) u8 low[16];
	alignas(16) u8 high[16];
	for (u32 index = 0u; index < 16u; index += 1u) {
		const u16 color = source.clutWords[gxGpuSoftwareVramIndex(software, static_cast<i32>(source.clutBaseX + index), static_cast<i32>(source.clutBaseY))];
		low[index] = static_cast<u8>(color);
		high[index] = static_cast<u8>(color >> 8u);
	}
	return {{{vld1_u8(low), vld1_u8(low + 8)}}, {{vld1_u8(high), vld1_u8(high + 8)}}};
}
#endif

// One textured rectangle's texel source; u steps by uStep (+-1) per pixel.
// Everything its rows share is decided here, once per primitive.
template<u32 TextureMode>
struct GxGpuSoftwareRectangleTexture {
	const GxGpuSoftwareState& software;
	GxGpuSoftwareTextureSource source;
	i32 uStep;
	const u16* clutRow;
	bool adjacentU;
#if defined(__ARM_NEON)
	GxGpuSoftwareClut4Lanes clut4;
#endif

	GxGpuSoftwareRectangleTexture(const GxGpuSoftwareState& software, const GxGpuSoftwareTextureSource& source, i32 uStep)
		: software(software), source(source), uStep(uStep),
		  clutRow(source.clutWords + gxGpuSoftwareVramIndex(software, 0, source.clutBaseY)),
		  adjacentU(uStep == 1 && source.textureWindowAndX == 0xffu && source.textureWindowOrX == 0u) {
#if defined(__ARM_NEON)
		if constexpr (TextureMode == GX_GPU_TEXTURE_MODE_PALETTE4)
			clut4 = loadGxGpuSoftwareClut4Lanes(software, source);
#endif
	}
};

// Texels along one rectangle row: v is fixed and u steps per pixel.
// operator() is the exact per-pixel fetch. On vector hosts, fetch8() returns the next
// eight texels at once when they are adjacent in one VRAM row (adjacentU and
// no U or VRAM X wrap) and otherwise falls back to eight exact fetches; both
// advance u identically.
template<u32 TextureMode>
struct GxGpuSoftwareRectangleTexels {
	const GxGpuSoftwareRectangleTexture<TextureMode>& texture;
	i32 u;
	const u16* row;

	GxGpuSoftwareRectangleTexels(const GxGpuSoftwareRectangleTexture<TextureMode>& texture, i32 u, i32 v)
		: texture(texture), u(u) {
		const auto& source = texture.source;
		row = source.textureWords + gxGpuSoftwareVramIndex(texture.software, 0,
			static_cast<i32>(source.pageY + gxGpuSoftwareTextureWindowCoord(v, source.textureWindowAndY, source.textureWindowOrY)));
	}

	u32 operator()() {
		const auto& source = texture.source;
		const u32 coord = gxGpuSoftwareTextureWindowCoord(u, source.textureWindowAndX, source.textureWindowOrX);
		u += texture.uStep;
		constexpr u32 xMask = GX_GPU_VRAM_X_ADDRESS_PERIOD - 1u;
		if constexpr (TextureMode == GX_GPU_TEXTURE_MODE_PALETTE4) {
			const u32 packed = row[(source.pageX + (coord >> 2)) & xMask];
			return texture.clutRow[(source.clutBaseX + ((packed >> ((coord & 3) * 4)) & 15u)) & xMask];
		} else if constexpr (TextureMode == GX_GPU_TEXTURE_MODE_PALETTE8) {
			const u32 packed = row[(source.pageX + (coord >> 1)) & xMask];
			return texture.clutRow[(source.clutBaseX + ((packed >> ((coord & 1) * 8)) & 255u)) & xMask];
		} else return row[(source.pageX + coord) & xMask];
	}

#if defined(__ARM_NEON)
	uint16x8_t fetch8() {
		if constexpr (TextureMode != GX_GPU_TEXTURE_MODE_PALETTE8) {
			const u32 windowedU = static_cast<u32>(u) & 0xffu;
			if (texture.adjacentU && windowedU <= 248u) {
				if constexpr (TextureMode == GX_GPU_TEXTURE_MODE_PALETTE4) {
					const u32 word = texture.source.pageX + (windowedU >> 2u);
					if (word + 3u < GX_GPU_VRAM_X_ADDRESS_PERIOD) {
						// Four words hold sixteen nibbles, low nibble first.
						const uint8x8_t bytes = vreinterpret_u8_u16(vld1_u16(row + word));
						const uint8x8x2_t nibbles = vzip_u8(vand_u8(bytes, vdup_n_u8(0x0fu)), vshr_n_u8(bytes, 4));
						uint8x8_t indices;
						switch (windowedU & 3u) {
							case 0u: indices = nibbles.val[0]; break;
							case 1u: indices = vext_u8(nibbles.val[0], nibbles.val[1], 1); break;
							case 2u: indices = vext_u8(nibbles.val[0], nibbles.val[1], 2); break;
							default: indices = vext_u8(nibbles.val[0], nibbles.val[1], 3); break;
						}
						u += 8;
						// Interleaving the low and high bytes forms the eight 16-bit colors.
						const GxGpuSoftwareClut4Lanes& clut4 = texture.clut4;
						const uint8x8x2_t colors = vzip_u8(vtbl2_u8(clut4.low, indices), vtbl2_u8(clut4.high, indices));
						return vreinterpretq_u16_u8(vcombine_u8(colors.val[0], colors.val[1]));
					}
				} else {
					const u32 x = texture.source.pageX + windowedU;
					if (x + 7u < GX_GPU_VRAM_X_ADDRESS_PERIOD) {
						u += 8;
						return vld1q_u16(row + x);
					}
				}
			}
		}
		alignas(16) u16 samples[8];
		for (u32 lane = 0u; lane < 8u; lane += 1u) {
			samples[lane] = static_cast<u16>((*this)());
		}
		return vld1q_u16(samples);
	}
#elif defined(__SSE2__)
	__m128i fetch8() {
		constexpr u32 xMask = GX_GPU_VRAM_X_ADDRESS_PERIOD - 1u;
		const auto& source = texture.source;
		const u32 coord = static_cast<u32>(u) & 255u;
		if (texture.adjacentU && coord <= 248u) {
			if constexpr (TextureMode == GX_GPU_TEXTURE_MODE_PALETTE4) {
				// Eight indices span two or three GX words. Fetch exactly those
				// words, with independent X wrapping, before gathering the CLUT.
				const u32 x = source.pageX + (coord >> 2);
				u32 packed = row[x & xMask] | (static_cast<u32>(row[(x + 1u) & xMask]) << 16);
				const u32 shift = (coord & 3u) * 4u;
				if (shift) packed = (packed >> shift) | (static_cast<u32>(row[(x + 2u) & xMask]) << (32u - shift));
				const u16* palette = texture.clutRow + source.clutBaseX; // CLUT X is 16-word aligned.
				u += 8;
				return _mm_setr_epi16(palette[packed & 15], palette[(packed >> 4) & 15],
					palette[(packed >> 8) & 15], palette[(packed >> 12) & 15],
					palette[(packed >> 16) & 15], palette[(packed >> 20) & 15],
					palette[(packed >> 24) & 15], palette[packed >> 28]);
			} else if constexpr (TextureMode == GX_GPU_TEXTURE_MODE_DIRECT16) {
				const u32 x = (source.pageX + coord) & xMask;
				if (x + 7u <= xMask) {
					u += 8;
					return _mm_loadu_si128(reinterpret_cast<const __m128i*>(row + x));
				}
			}
		}
		alignas(16) u16 gathered[8];
		for (u16& sample : gathered) sample = static_cast<u16>((*this)());
		return _mm_load_si128(reinterpret_cast<const __m128i*>(gathered));
	}
#endif
};

} // namespace bmsx
