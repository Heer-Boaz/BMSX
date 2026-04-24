#pragma once

#include "render/shared/submissions.h"
#include <array>
#include <optional>
#include <string>
#include <vector>

namespace bmsx {

struct RuntimeRenderCameraState {
	std::array<f32, 16> view{};
	std::array<f32, 16> proj{};
	std::array<f32, 3> eye{};
};

struct RuntimeAmbientLightState {
	std::string id;
	std::array<f32, 3> color = {0.0f, 0.0f, 0.0f};
	f32 intensity = 0.0f;
};

struct RuntimeDirectionalLightState {
	std::string id;
	std::array<f32, 3> color = {0.0f, 0.0f, 0.0f};
	f32 intensity = 0.0f;
	std::array<f32, 3> orientation = {0.0f, 0.0f, 1.0f};
};

struct RuntimePointLightState {
	std::string id;
	std::array<f32, 3> color = {0.0f, 0.0f, 0.0f};
	f32 intensity = 0.0f;
	std::array<f32, 3> pos = {0.0f, 0.0f, 0.0f};
	f32 range = 0.0f;
};

struct RuntimeRenderState {
	std::optional<RuntimeRenderCameraState> camera;
	std::vector<RuntimeAmbientLightState> ambientLights;
	std::vector<RuntimeDirectionalLightState> directionalLights;
	std::vector<RuntimePointLightState> pointLights;
	SpriteParallaxRig spriteParallaxRig{};
};

RuntimeRenderState captureRuntimeRenderState();
void applyRuntimeRenderState(const RuntimeRenderState& state);
void beginRuntimeRenderFrame();
void clearRuntimeRenderBackQueues();
void resetRuntimeRenderState();

} // namespace bmsx
