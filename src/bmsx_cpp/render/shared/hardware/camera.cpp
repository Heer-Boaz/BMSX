#include "render/shared/hardware/camera.h"

namespace bmsx {
namespace {

std::array<f32, 16> makeIdentity() {
	return {
		1.0f, 0.0f, 0.0f, 0.0f,
		0.0f, 1.0f, 0.0f, 0.0f,
		0.0f, 0.0f, 1.0f, 0.0f,
		0.0f, 0.0f, 0.0f, 1.0f,
	};
}

void mulInto(std::array<f32, 16>& out, const std::array<f32, 16>& a, const std::array<f32, 16>& b) {
	const f32 b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
	const f32 b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7];
	const f32 b8 = b[8], b9 = b[9], b10 = b[10], b11 = b[11];
	const f32 b12 = b[12], b13 = b[13], b14 = b[14], b15 = b[15];
	for (int i = 0; i < 4; ++i) {
		const f32 ai0 = a[static_cast<size_t>(i)];
		const f32 ai1 = a[static_cast<size_t>(i + 4)];
		const f32 ai2 = a[static_cast<size_t>(i + 8)];
		const f32 ai3 = a[static_cast<size_t>(i + 12)];
		out[static_cast<size_t>(i)] = ai0 * b0 + ai1 * b1 + ai2 * b2 + ai3 * b3;
		out[static_cast<size_t>(i + 4)] = ai0 * b4 + ai1 * b5 + ai2 * b6 + ai3 * b7;
		out[static_cast<size_t>(i + 8)] = ai0 * b8 + ai1 * b9 + ai2 * b10 + ai3 * b11;
		out[static_cast<size_t>(i + 12)] = ai0 * b12 + ai1 * b13 + ai2 * b14 + ai3 * b15;
	}
}

void skyboxFromViewInto(std::array<f32, 16>& out, const std::array<f32, 16>& view) {
	out[0] = view[0]; out[1] = view[4]; out[2] = view[8]; out[3] = 0.0f;
	out[4] = view[1]; out[5] = view[5]; out[6] = view[9]; out[7] = 0.0f;
	out[8] = view[2]; out[9] = view[6]; out[10] = view[10]; out[11] = 0.0f;
	out[12] = 0.0f; out[13] = 0.0f; out[14] = 0.0f; out[15] = 1.0f;
}

HardwareCameraState s_hardwareCamera = {
	makeIdentity(),
	makeIdentity(),
	makeIdentity(),
	makeIdentity(),
	{},
	false,
};

} // namespace

void setHardwareCamera(const std::array<f32, 16>& view,
						const std::array<f32, 16>& proj,
						f32 eyeX,
						f32 eyeY,
						f32 eyeZ) {
	s_hardwareCamera.view = view;
	s_hardwareCamera.proj = proj;
	mulInto(s_hardwareCamera.viewProj, proj, view);
	skyboxFromViewInto(s_hardwareCamera.skyboxView, view);
	s_hardwareCamera.eye = { eyeX, eyeY, eyeZ };
	s_hardwareCamera.active = true;
}

void clearHardwareCamera() {
	s_hardwareCamera.active = false;
}

const HardwareCameraState* resolveActiveHardwareCamera() {
	if (!s_hardwareCamera.active) {
		return nullptr;
	}
	return &s_hardwareCamera;
}

} // namespace bmsx
