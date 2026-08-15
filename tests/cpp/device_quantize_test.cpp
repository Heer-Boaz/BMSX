#include "render/post/device_quantize/lut.h"
#include "spec/bmsx/model.h"
#if BMSX_ENABLE_GLES2
#include "render/backend/gles2/backend.h"
#include "render/post/device_quantize/gles2/pipeline.h"
#endif

#include <array>
#include <stdexcept>

namespace {

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

template<size_t Size>
bmsx::u32 fnv1a32(const std::array<bmsx::u8, Size>& bytes) {
	bmsx::u32 hash = 0x811c9dc5u;
	for (const bmsx::u8 byte : bytes) hash = (hash ^ byte) * 0x01000193u;
	return hash;
}

} // namespace

int main() {
	constexpr std::array<bmsx::u8, 16> expectedBayer{{
		0u, 8u, 2u, 10u,
		12u, 4u, 14u, 6u,
		3u, 11u, 1u, 9u,
		15u, 7u, 13u, 5u,
	}};
	require(bmsx::DEVICE_QUANTIZE_BAYER_4X4 == expectedBayer, "device quantize Bayer matrix drifted");
	require(fnv1a32(bmsx::DEVICE_QUANTIZE_LUTS[0].redBlue) == 0xd49c27aeu, "RGB565 red/blue quantize LUT drifted");
	require(fnv1a32(bmsx::DEVICE_QUANTIZE_LUTS[0].green) == 0xee1a990bu, "RGB565 green quantize LUT drifted");
	require(fnv1a32(bmsx::DEVICE_QUANTIZE_LUTS[0].texture) == 0x4c180e75u, "RGB565 texture quantize LUT drifted");
	require(fnv1a32(bmsx::DEVICE_QUANTIZE_LUTS[1].redBlue) == 0x6fa13cc9u, "RGB343 red/blue quantize LUT drifted");
	require(fnv1a32(bmsx::DEVICE_QUANTIZE_LUTS[1].green) == 0x63162341u, "RGB343 green quantize LUT drifted");
	require(fnv1a32(bmsx::DEVICE_QUANTIZE_LUTS[1].texture) == 0xa8287db5u, "RGB343 texture quantize LUT drifted");
#if BMSX_ENABLE_GLES2
	bmsx::OpenGLES2Backend backend(
		1,
		1,
		false,
		bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
	backend.onContextLost();
	bmsx::DeviceQuantizePipeline::GLES2::State pipeline;
	pipeline.lutTextures[0] = new bmsx::GLES2Texture{};
	pipeline.lutTextures[1] = new bmsx::GLES2Texture{};
	bmsx::DeviceQuantizePipeline::GLES2::releaseLostTextureHandles(backend, pipeline);
	require(pipeline.lutTextures[0] == nullptr && pipeline.lutTextures[1] == nullptr,
		"GLES2 context loss should release device quantize texture owners");
#endif
	return 0;
}
