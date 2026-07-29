#include "render/backend/software/gx_gpu_vram.h"

namespace bmsx {

void loadGxGpuSoftwareVramBytes(
	GxGpuSoftwareState& software,
	std::span<const u8> source) {
	for (size_t wordIndex = 0u; wordIndex < software.vram.size(); wordIndex += 1u) {
		const size_t byteIndex = wordIndex << 1u;
		software.vram[wordIndex] = static_cast<u16>(
			source[byteIndex] | (static_cast<u16>(source[byteIndex + 1u]) << 8u));
	}
}

} // namespace bmsx
