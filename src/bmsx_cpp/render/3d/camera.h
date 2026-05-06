#pragma once

#include "render/3d/math.h"

namespace bmsx {

enum class CameraProjectionType {
	Perspective,
	Orthographic,
	Fisheye,
	Panorama,
	Oblique,
	AsymmetricFrustum,
	Isometric,
	InfinitePerspective,
	ViewFromBasis,
};

struct CameraProjectionConfig {
	CameraProjectionType type = CameraProjectionType::Perspective;
	f32 fovDegrees = 60.0f;
	f32 aspect = 1.0f;
	f32 nearPlane = 0.1f;
	f32 farPlane = 1000.0f;
};

constexpr f32 RESET_CAMERA_ASPECT = 256.0f / 212.0f;
constexpr f32 RESET_CAMERA_FOV_DEGREES = 60.0f;
constexpr f32 RESET_CAMERA_NEAR = 0.1f;
constexpr f32 RESET_CAMERA_FAR = 50.0f;

Render3D::Mat4 buildCameraProjection(const CameraProjectionConfig& config);
Render3D::Mat4 buildResetCameraProjection();

} // namespace bmsx
