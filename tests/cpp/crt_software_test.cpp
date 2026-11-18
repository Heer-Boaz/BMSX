#include "common/hash.h"
#include "render/backend/backend.h"
#include "render/backend/pass/library.h"
#include "render/post/crt/noise.h"
#include "render/post/crt/software/crt_processor.h"
#include "spec/bmsx/model.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <vector>

using namespace bmsx;

static void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

static void testContrastKernel() {
	constexpr i32 sourceWidth = 13, sourceHeight = 11;
	SoftwareBackend backend(1, 1, PSX_MACHINE_SPEC.gxGpuVramBytes);
	std::vector<u8> bytes(sourceWidth * sourceHeight * 4);
	for (u32 i = 0; i < bytes.size(); ++i) bytes[i] = static_cast<u8>(fmix32(i) >> 24u);
	const auto source = backend.createTexture(bytes.data(), sourceWidth, sourceHeight, RGBA8_LINEAR_TEXTURE_PARAMS);
	CRTPipelineState state;
	state.colorTex = source;
	state.srcWidth = sourceWidth;
	state.srcHeight = sourceHeight;
	state.noisePhase = CRTPipeline::NOISE_PHASE_MASK;
	state.options.blurIntensity = 0;
	for (const auto size : {std::array<i32, 2>{13, 11}, {26, 33}, {19, 17}, {5, 7}}) {
		backend.resizePresentationTarget(size[0], size[1]);
		state.width = size[0];
		state.height = size[1];
		const size_t pixelCount = size[0] * size[1];
		for (u32 flags = 0; flags < 128u; ++flags) {
			if ((flags & (4u | 32u | 64u)) == 0u || (flags & 8u) != 0u) continue;
			state.options.applyNoise = (flags & 1u) != 0u;
			state.options.applyColorBleed = (flags & 2u) != 0u;
			state.options.applyScanlines = (flags & 4u) != 0u;
			state.options.applyGlow = (flags & 16u) != 0u;
			state.options.applyFringing = (flags & 32u) != 0u;
			state.options.applyAperture = (flags & 64u) != 0u;
			state.options.applyBlur = true;
			CRTPipeline::Software::renderCRT(backend, state);
			const std::vector<u32> nineTap(backend.framebuffer(), backend.framebuffer() + pixelCount);
			state.options.applyBlur = false;
			CRTPipeline::Software::renderCRT(backend, state);
			require(std::equal(nineTap.begin(), nineTap.end(), backend.framebuffer()),
				"four-tap contrast preserves the nine-tap output when blur contributes zero");
		}
	}
	backend.destroyTexture(source);
}

static void testNoise() {
	constexpr i32 width = 13, height = 11;
	SoftwareBackend backend(width, height, PSX_MACHINE_SPEC.gxGpuVramBytes);
	backend.resizePresentationTarget(width, height);
	std::vector<u8> bytes(width * height * 4, 128u);
	const auto source = backend.createTexture(bytes.data(), width, height, RGBA8_LINEAR_TEXTURE_PARAMS);
	CRTPipelineState state;
	state.width = state.srcWidth = width;
	state.height = state.srcHeight = height;
	state.colorTex = source;
	state.options.applyNoise = true;
	state.options.applyColorBleed = state.options.applyGlow = state.options.applyBlur = false;
	state.options.applyScanlines = state.options.applyFringing = state.options.applyAperture = false;
	const auto noise = CRTPipeline::noiseTextureBytes();
	for (const u32 phase : {0u, 49152u, CRTPipeline::NOISE_PHASE_MASK}) {
		state.noisePhase = phase;
		CRTPipeline::Software::renderCRT(backend, state);
		for (u32 y = 0; y < height; ++y) for (u32 x = 0; x < width; ++x) {
			const u32 noiseX = (x + (phase & (CRTPipeline::NOISE_WIDTH - 1u))) & (CRTPipeline::NOISE_WIDTH - 1u);
			const u32 noiseY = (y + phase / CRTPipeline::NOISE_WIDTH) & (CRTPipeline::NOISE_HEIGHT - 1u);
			const u32 offset = (noiseY * CRTPipeline::NOISE_WIDTH + noiseX) * 4u;
			const f32 grain = (static_cast<f32>(noise[offset]) / 255.0f - 0.5f) * 0.65f
				+ (static_cast<f32>(noise[offset + 1u]) / 255.0f - 0.5f) * 0.35f;
			constexpr f32 center = 128.0f / 255.0f;
			const f32 amp = state.options.noiseIntensity * (0.2f + 0.8f * (1.0f - center));
			const i32 expected = static_cast<i32>(center * (1.0f + grain * amp) * 255.0f + 0.5f);
			const u32 pixel = backend.framebuffer()[y * width + x];
			for (const u32 shift : {0u, 8u, 16u})
				require(std::abs(static_cast<i32>((pixel >> shift) & 255u) - expected) <= 1,
					"software noise consumes the shared pixel/line table at the selected phase");
		}
	}
	backend.destroyTexture(source);
}

int main() {
	testContrastKernel();
	testNoise();
	std::cout << "CRT-SOFTWARE:PASS\n";
}
