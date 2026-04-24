#pragma once

#include "core/primitives.h"
#include <array>

namespace bmsx {

struct HardwareCameraState {
	std::array<f32, 16> view{};
	std::array<f32, 16> proj{};
	std::array<f32, 16> viewProj{};
	std::array<f32, 16> skyboxView{};
	Vec3 eye{};
	bool active = false;
};

void setHardwareCamera(const std::array<f32, 16>& view,
						const std::array<f32, 16>& proj,
						f32 eyeX,
						f32 eyeY,
						f32 eyeZ);
void clearHardwareCamera();
const HardwareCameraState* resolveActiveHardwareCamera();

} // namespace bmsx
