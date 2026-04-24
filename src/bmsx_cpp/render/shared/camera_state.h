#pragma once

#include "core/primitives.h"
#include <array>
#include <optional>

namespace bmsx {

struct ResolvedCameraState {
	std::array<f32, 16> view{};
	std::array<f32, 16> proj{};
	std::array<f32, 16> viewProj{};
	std::array<f32, 16> skyboxView{};
	Vec3 camPos{};
};

std::optional<ResolvedCameraState> resolveCameraState();

} // namespace bmsx
