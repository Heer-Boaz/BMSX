#include "render/3d/camera.h"

namespace bmsx {
namespace {

constexpr f32 kPi = 3.14159265358979323846f;

f32 degToRad(f32 degrees) {
	return degrees * (kPi / 180.0f);
}

} // namespace

Render3D::Mat4 buildCameraProjection(const CameraProjectionConfig& config) {
	Render3D::Mat4 out{};
	switch (config.type) {
		case CameraProjectionType::Perspective:
			Render3D::mat4PerspectiveInto(out, degToRad(config.fovDegrees), config.aspect, config.nearPlane, config.farPlane);
			return out;
		case CameraProjectionType::Orthographic:
			Render3D::mat4OrthographicInto(out, -config.aspect, config.aspect, -1.0f, 1.0f, config.nearPlane, config.farPlane);
			return out;
		case CameraProjectionType::Fisheye:
			Render3D::mat4FisheyeInto(out, degToRad(config.fovDegrees), config.aspect, config.nearPlane, config.farPlane);
			return out;
		case CameraProjectionType::Panorama:
			Render3D::mat4PanoramaInto(out, degToRad(config.fovDegrees), config.aspect, config.nearPlane, config.farPlane);
			return out;
		case CameraProjectionType::InfinitePerspective:
			Render3D::mat4InfinitePerspectiveInto(out, degToRad(config.fovDegrees), config.aspect, config.nearPlane);
			return out;
		case CameraProjectionType::Oblique:
			Render3D::mat4ObliqueInto(out, -config.aspect, config.aspect, -1.0f, 1.0f, config.nearPlane, config.farPlane, 0.78539816339f, 0.78539816339f);
			return out;
		case CameraProjectionType::AsymmetricFrustum:
			Render3D::mat4AsymmetricFrustumInto(out, -config.aspect, config.aspect, -1.0f, 1.0f, config.nearPlane, config.farPlane);
			return out;
		case CameraProjectionType::Isometric:
			Render3D::mat4IsometricInto(out, 1.0f);
			return out;
		case CameraProjectionType::ViewFromBasis:
			Render3D::mat4SetIdentity(out);
			return out;
	}
	return out;
}

Render3D::Mat4 buildResetCameraProjection() {
	return buildCameraProjection(CameraProjectionConfig{
		CameraProjectionType::Perspective,
		RESET_CAMERA_FOV_DEGREES,
		RESET_CAMERA_ASPECT,
		RESET_CAMERA_NEAR,
		RESET_CAMERA_FAR,
	});
}

} // namespace bmsx
