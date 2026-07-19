#pragma once

#include "machine/devices/gx/vram_address.h"

namespace bmsx {

constexpr u32 GX_GPU_PSMCT32 = 0u;
constexpr u32 GX_GPU_PSMCT24 = 1u;
constexpr u32 GX_GPU_PSMCT16 = 2u;
constexpr u32 GX_GPU_PSMCT16S = 10u;
constexpr u32 GX_GPU_PSGPU24 = 18u;
constexpr u32 GX_GPU_PSMGX16 = 31u;

namespace detail {
constexpr u32 GX_GPU_VRAM_WORD_MASK = static_cast<u32>(GX_GPU_VRAM_WORD_COUNT - 1u);
constexpr u32 GX_GPU_VRAM_BYTE_MASK = static_cast<u32>(GX_GPU_VRAM_BYTE_COUNT - 1u);
} // namespace detail

inline u32 gxGpuLocalMemoryAddress32(u32 baseWord, u32 pagesPerRow, u32 x, u32 y) {
	const u32 page = (y >> 5u) * pagesPerRow + (x >> 6u);
	const u32 pageX = x & 63u;
	const u32 pageY = y & 31u;
	const u32 blockX = pageX >> 3u;
	const u32 blockY = pageY >> 3u;
	const u32 block = (blockX & 1u)
		| ((blockY & 1u) << 1u)
		| ((blockX & 2u) << 1u)
		| ((blockY & 2u) << 2u)
		| ((blockX & 4u) << 2u);
	const u32 column = (pageX & 1u)
		| ((pageY & 1u) << 1u)
		| ((pageX & 6u) << 1u)
		| ((pageY & 6u) << 3u);
	return (baseWord + (page << 12u) + (block << 7u) + (column << 1u)) & detail::GX_GPU_VRAM_WORD_MASK;
}

namespace detail {
inline u32 localMemoryColumn16(u32 pageX, u32 pageY) {
	return ((pageX & 1u) << 1u)
		| ((pageX & 2u) << 2u)
		| ((pageX & 4u) << 2u)
		| ((pageX & 8u) >> 3u)
		| ((pageY & 1u) << 2u)
		| ((pageY & 2u) << 4u)
		| ((pageY & 4u) << 4u);
}
} // namespace detail

inline u32 gxGpuLocalMemoryAddress16(u32 baseWord, u32 pagesPerRow, u32 x, u32 y) {
	const u32 page = (y >> 6u) * pagesPerRow + (x >> 6u);
	const u32 pageX = x & 63u;
	const u32 pageY = y & 63u;
	const u32 blockX = pageX >> 4u;
	const u32 blockY = pageY >> 3u;
	const u32 block = ((blockX & 1u) << 1u)
		| (blockY & 1u)
		| ((blockX & 2u) << 2u)
		| ((blockY & 2u) << 1u)
		| ((blockY & 4u) << 2u);
	return (baseWord + (page << 12u) + (block << 7u) + detail::localMemoryColumn16(pageX, pageY))
		& detail::GX_GPU_VRAM_WORD_MASK;
}

inline u32 gxGpuLocalMemoryAddress16S(u32 baseWord, u32 pagesPerRow, u32 x, u32 y) {
	const u32 page = (y >> 6u) * pagesPerRow + (x >> 6u);
	const u32 pageX = x & 63u;
	const u32 pageY = y & 63u;
	const u32 blockX = pageX >> 4u;
	const u32 blockY = pageY >> 3u;
	const u32 block = (blockY & 1u)
		| ((blockX & 1u) << 1u)
		| (blockY & 4u)
		| ((blockY & 2u) << 2u)
		| ((blockX & 2u) << 3u);
	return (baseWord + (page << 12u) + (block << 7u) + detail::localMemoryColumn16(pageX, pageY))
		& detail::GX_GPU_VRAM_WORD_MASK;
}

inline u32 gxGpuLocalMemoryAddressGx16(u32 baseWord, u32 framebufferWidth, u32 x, u32 y) {
	return (baseWord + y * framebufferWidth + x) & detail::GX_GPU_VRAM_WORD_MASK;
}

inline u32 gxGpuLocalMemoryByteAddressGpu24(u32 baseWord, u32 pagesPerRow, u32 pixelX, u32 y, u32 channel) {
	const u32 logicalByte = pixelX * 3u + channel;
	const u32 wordAddress = gxGpuLocalMemoryAddress16(baseWord, pagesPerRow, logicalByte >> 1u, y);
	return ((wordAddress << 1u) | (logicalByte & 1u)) & detail::GX_GPU_VRAM_BYTE_MASK;
}

} // namespace bmsx
