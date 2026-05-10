#pragma once

#include "machine/devices/vdp/xf.h"
#include "render/3d/math.h"

namespace bmsx {

struct VdpTransformSnapshot {
	Render3D::Mat4 view{};
	Render3D::Mat4 proj{};
	Render3D::Mat4 viewProj{};
	Render3D::Mat4 skyboxView{};
	Render3D::PlanePack frustumPlanes{};
	Vec3 eye{};
};

void resolveVdpTransformSnapshot(VdpTransformSnapshot& target,
								const std::array<u32, VDP_XF_MATRIX_WORDS>& viewMatrixWords,
								const std::array<u32, VDP_XF_MATRIX_WORDS>& projectionMatrixWords);

} // namespace bmsx
