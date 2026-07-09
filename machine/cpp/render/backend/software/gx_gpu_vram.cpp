#include "render/backend/software/gx_gpu_vram.h"

namespace bmsx {

std::array<u16, kGxGpuSoftwareVramWords> g_gxGpuSoftwareVram{};


void loadGxGpuSoftwareVramBytes(const u8* source) {
	for (size_t wordIndex = 0u; wordIndex < kGxGpuSoftwareVramWords; wordIndex += 1u) {
		const size_t byteIndex = wordIndex << 1u;
		g_gxGpuSoftwareVram[wordIndex] = static_cast<u16>(source[byteIndex] | (static_cast<u16>(source[byteIndex + 1u]) << 8u));
	}
}

} // namespace bmsx
