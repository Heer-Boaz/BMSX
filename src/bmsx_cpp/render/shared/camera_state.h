#pragma once

#include "common/primitives.h"
#include "render/3d/math.h"

namespace bmsx {

struct ResolvedCameraState {
	const Render3D::Mat4& view;
	const Render3D::Mat4& proj;
	const Render3D::Mat4& viewProj;
	const Render3D::Mat4& skyboxView;
	const Vec3& camPos;
};

ResolvedCameraState resolveCameraState();

} // namespace bmsx
