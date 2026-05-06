#include "render/shared/hardware/camera.h"

#include "render/3d/camera.h"
#include "render/3d/math.h"

namespace bmsx {
namespace {

const Render3D::Mat4 kResetCameraProjection = buildResetCameraProjection();

HardwareCameraState s_hardwareCamera = {
	Render3D::kIdentityMat4,
	kResetCameraProjection,
	kResetCameraProjection,
	Render3D::kIdentityMat4,
	{},
};

} // namespace

void setHardwareCamera(const std::array<f32, 16>& view,
						const std::array<f32, 16>& proj,
						f32 eyeX,
						f32 eyeY,
						f32 eyeZ) {
	s_hardwareCamera.view = view;
	s_hardwareCamera.proj = proj;
	Render3D::mat4MulInto(s_hardwareCamera.viewProj, proj, view);
	Render3D::mat4SkyboxFromViewInto(s_hardwareCamera.skyboxView, view);
	s_hardwareCamera.eye = { eyeX, eyeY, eyeZ };
}

void resetHardwareCameraBank0() {
	s_hardwareCamera.view = Render3D::kIdentityMat4;
	s_hardwareCamera.proj = kResetCameraProjection;
	s_hardwareCamera.viewProj = kResetCameraProjection;
	s_hardwareCamera.skyboxView = Render3D::kIdentityMat4;
	s_hardwareCamera.eye = {};
}

const HardwareCameraState& resolveActiveHardwareCamera() {
	return s_hardwareCamera;
}

} // namespace bmsx
