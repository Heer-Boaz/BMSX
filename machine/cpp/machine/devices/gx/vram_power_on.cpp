#include "machine/devices/gx/vram_power_on.h"

#include "machine/common/hash.h"
#include "machine/devices/gx/gpu_command_buffer.h"

namespace bmsx {
namespace {

constexpr size_t GX_GPU_VRAM_POWER_ON_BLOCK_BYTES = 32u;
constexpr u32 GX_GPU_VRAM_POWER_ON_BLOCK_WORDS = static_cast<u32>(GX_GPU_VRAM_POWER_ON_BLOCK_BYTES >> 2u);
// Fixed seeds make the hardware power-on state reproducible across mirrored runtimes and test runs.
constexpr u32 GX_GPU_VRAM_POWER_ON_BIAS_SEED = 0x14040c15u;
constexpr u32 GX_GPU_VRAM_POWER_ON_BOOT_SEED = 0x20000000u;
// One MiB activates the 64 KiB macro octave: 15 * 127 maximum bias at 12%, 28%, and 48%.
constexpr i32 GX_GPU_VRAM_POWER_ON_FORCE_THRESHOLD_0 = 228;
constexpr i32 GX_GPU_VRAM_POWER_ON_FORCE_THRESHOLD_1 = 533;
constexpr i32 GX_GPU_VRAM_POWER_ON_FORCE_THRESHOLD_2 = 914;

} // namespace

void initializeGxGpuVramPowerOn(u8* vramBytes) {
	u32 pageHash = 0u;
	u32 rowHash = 0u;
	u32 macroHash = 0u;
	u32 preferredWord = 0u;
	constexpr u32 blockCount = static_cast<u32>(GX_GPU_VRAM_BYTE_COUNT / GX_GPU_VRAM_POWER_ON_BLOCK_BYTES);
	for (u32 blockIndex = 0u; blockIndex < blockCount; blockIndex += 1u) {
		if ((blockIndex & 0x7ffu) == 0u) {
			const u32 macroIndex = blockIndex >> 11u;
			macroHash = fmix32(GX_GPU_VRAM_POWER_ON_BIAS_SEED ^ (macroIndex * 0x165667b1u) ^ 0xd3a2646cu);
			preferredWord = scramble32(macroHash);
		}
		if ((blockIndex & 0x7fu) == 0u) {
			const u32 pageIndex = blockIndex >> 7u;
			pageHash = fmix32(GX_GPU_VRAM_POWER_ON_BIAS_SEED ^ (pageIndex * 0xc2b2ae35u) ^ 0xa5a5a5a5u);
		}
		if ((blockIndex & 0x07u) == 0u) {
			const u32 rowIndex = blockIndex >> 3u;
			rowHash = fmix32(GX_GPU_VRAM_POWER_ON_BIAS_SEED ^ (rowIndex * 0x85ebca6bu) ^ 0x1b873593u);
		}
		const u32 blockHash = fmix32(GX_GPU_VRAM_POWER_ON_BIAS_SEED ^ (blockIndex * 0x9e3779b9u) ^ 0x85ebca77u);

		const i32 bias = signed8FromHash(pageHash) * 4
			+ signed8FromHash(rowHash) * 2
			+ signed8FromHash(blockHash)
			+ signed8FromHash(macroHash) * 8;
		const i32 absoluteBias = bias < 0 ? -bias : bias;
		const i32 forceLevel = absoluteBias < GX_GPU_VRAM_POWER_ON_FORCE_THRESHOLD_0 ? 0
			: absoluteBias < GX_GPU_VRAM_POWER_ON_FORCE_THRESHOLD_1 ? 1
				: absoluteBias < GX_GPU_VRAM_POWER_ON_FORCE_THRESHOLD_2 ? 2 : 3;
		const i32 jitterLevel = 3 - forceLevel;

		u32 patternState = (blockHash ^ rowHash ^ 0xdeadbeefu) | 1u;
		patternState = xorshift32(patternState);
		const u32 forcePattern1 = scramble32(patternState);
		patternState = xorshift32(patternState);
		const u32 forcePattern2 = scramble32(patternState);
		patternState = xorshift32(xorshift32(patternState));
		const u32 weakPattern1 = scramble32(patternState);
		patternState = xorshift32(patternState);
		const u32 weakPattern2 = scramble32(patternState);
		patternState = xorshift32(patternState);
		const u32 weakPattern3 = scramble32(patternState);
		patternState = xorshift32(patternState);
		const u32 weakPattern4 = scramble32(patternState);

		u32 forceMask = 0u;
		switch (forceLevel) {
			case 1: forceMask = forcePattern1 & forcePattern2; break;
			case 2: forceMask = forcePattern1; break;
			case 3: forceMask = forcePattern1 | forcePattern2; break;
		}

		u32 weakMask = weakPattern1 & weakPattern2 & weakPattern3;
		if (jitterLevel <= 2) weakMask &= weakPattern4;
		if (jitterLevel <= 1) weakMask &= weakMask >> 1u;
		if (jitterLevel == 0) weakMask = 0u;
		weakMask &= ~forceMask;

		u32 baseState = (blockHash ^ 0xa1b2c3d4u) | 1u;
		u32 bootState = fmix32(GX_GPU_VRAM_POWER_ON_BOOT_SEED ^ (blockIndex * 0x7f4a7c15u) ^ 0x31415926u) | 1u;
		const size_t blockByteOffset = static_cast<size_t>(blockIndex) << 5u;
		for (u32 wordIndex = 0u; wordIndex < GX_GPU_VRAM_POWER_ON_BLOCK_WORDS; wordIndex += 1u) {
			baseState = xorshift32(baseState);
			bootState = xorshift32(bootState);
			const u32 baseWord = scramble32(baseState);
			const u32 bootWord = scramble32(bootState);
			const u32 word = ((baseWord & ~forceMask) | (preferredWord & forceMask)) ^ (bootWord & weakMask);
			const size_t byteOffset = blockByteOffset + (static_cast<size_t>(wordIndex) << 2u);
			vramBytes[byteOffset] = static_cast<u8>(word & 0xffu);
			vramBytes[byteOffset + 1u] = static_cast<u8>((word >> 8u) & 0xffu);
			vramBytes[byteOffset + 2u] = static_cast<u8>((word >> 16u) & 0xffu);
			vramBytes[byteOffset + 3u] = static_cast<u8>(word >> 24u);
		}
	}
}

} // namespace bmsx
