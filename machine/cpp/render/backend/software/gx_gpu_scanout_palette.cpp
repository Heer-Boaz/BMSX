#include "render/backend/software/gx_gpu_scanout_palette.h"

#include "render/backend/software/gx_gpu_vram.h"

namespace bmsx {

const std::array<u32, 0x10000u> GX_GPU_SOFTWARE_RGB555_RGBA = [] {
	std::array<u32, 0x10000u> colors{};
	for (u32 word = 0u; word < colors.size(); word += 1u) {
		colors[word] = static_cast<u32>(gxGpuSoftwareRgb555ChannelTo8(word & 0x1fu))
			| (static_cast<u32>(gxGpuSoftwareRgb555ChannelTo8((word >> 5u) & 0x1fu)) << 8u)
			| (static_cast<u32>(gxGpuSoftwareRgb555ChannelTo8((word >> 10u) & 0x1fu)) << 16u)
			| ((word & 0x8000u) << 16u);
	}
	return colors;
}();

} // namespace bmsx
