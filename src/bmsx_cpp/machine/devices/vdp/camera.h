#pragma once

#include "core/primitives.h"
#include <array>

namespace bmsx {

struct VdpCameraSnapshot {
	std::array<f32, 16> view{};
	std::array<f32, 16> proj{};
	std::array<f32, 16> viewProj{};
	std::array<f32, 16> skyboxView{};
	Vec3 eye{};
};

struct VdpCameraState {
	std::array<f32, 16> view{};
	std::array<f32, 16> proj{};
	Vec3 eye{};
};

class VdpCameraUnit {
public:
	VdpCameraUnit();
	void reset();
	void writeCameraBank0(const std::array<f32, 16>& view, const std::array<f32, 16>& proj, f32 eyeX, f32 eyeY, f32 eyeZ);
	void latchFrame(VdpCameraSnapshot& target) const;
	VdpCameraState captureState() const;

private:
	VdpCameraSnapshot m_live{};
};

} // namespace bmsx
