#include "machine/devices/vdp/camera.h"

namespace bmsx {
namespace {

constexpr f32 kResetCameraAspect = 256.0f / 212.0f;
constexpr f32 kResetCameraFocalY = 1.73205080757f;
constexpr f32 kResetCameraNear = 0.1f;
constexpr f32 kResetCameraFar = 50.0f;
constexpr f32 kResetCameraDepth = (kResetCameraFar + kResetCameraNear) / (kResetCameraNear - kResetCameraFar);
constexpr f32 kResetCameraDepthOffset = (2.0f * kResetCameraFar * kResetCameraNear) / (kResetCameraNear - kResetCameraFar);

void setIdentity(std::array<f32, 16>& out) {
	out = {
		1.0f, 0.0f, 0.0f, 0.0f,
		0.0f, 1.0f, 0.0f, 0.0f,
		0.0f, 0.0f, 1.0f, 0.0f,
		0.0f, 0.0f, 0.0f, 1.0f,
	};
}

void setResetProjection(std::array<f32, 16>& out) {
	out = {
		kResetCameraFocalY / kResetCameraAspect, 0.0f, 0.0f, 0.0f,
		0.0f, kResetCameraFocalY, 0.0f, 0.0f,
		0.0f, 0.0f, kResetCameraDepth, -1.0f,
		0.0f, 0.0f, kResetCameraDepthOffset, 0.0f,
	};
}

void multiplyMat4Into(std::array<f32, 16>& out, const std::array<f32, 16>& a, const std::array<f32, 16>& b) {
	const f32 b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
	const f32 b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7];
	const f32 b8 = b[8], b9 = b[9], b10 = b[10], b11 = b[11];
	const f32 b12 = b[12], b13 = b[13], b14 = b[14], b15 = b[15];
	for (size_t i = 0; i < 4; ++i) {
		const f32 ai0 = a[i], ai1 = a[i + 4], ai2 = a[i + 8], ai3 = a[i + 12];
		out[i] = ai0 * b0 + ai1 * b1 + ai2 * b2 + ai3 * b3;
		out[i + 4] = ai0 * b4 + ai1 * b5 + ai2 * b6 + ai3 * b7;
		out[i + 8] = ai0 * b8 + ai1 * b9 + ai2 * b10 + ai3 * b11;
		out[i + 12] = ai0 * b12 + ai1 * b13 + ai2 * b14 + ai3 * b15;
	}
}

void skyboxFromViewInto(std::array<f32, 16>& out, const std::array<f32, 16>& view) {
	out[0] = view[0]; out[1] = view[4]; out[2] = view[8]; out[3] = 0.0f;
	out[4] = view[1]; out[5] = view[5]; out[6] = view[9]; out[7] = 0.0f;
	out[8] = view[2]; out[9] = view[6]; out[10] = view[10]; out[11] = 0.0f;
	out[12] = 0.0f; out[13] = 0.0f; out[14] = 0.0f; out[15] = 1.0f;
}

} // namespace

VdpCameraUnit::VdpCameraUnit() {
	reset();
}

void VdpCameraUnit::reset() {
	setIdentity(m_live.view);
	setResetProjection(m_live.proj);
	m_live.viewProj = m_live.proj;
	setIdentity(m_live.skyboxView);
	m_live.eye = {};
}

void VdpCameraUnit::writeCameraBank0(const std::array<f32, 16>& view, const std::array<f32, 16>& proj, f32 eyeX, f32 eyeY, f32 eyeZ) {
	m_live.view = view;
	m_live.proj = proj;
	multiplyMat4Into(m_live.viewProj, m_live.proj, m_live.view);
	skyboxFromViewInto(m_live.skyboxView, m_live.view);
	m_live.eye = { eyeX, eyeY, eyeZ };
}

void VdpCameraUnit::latchFrame(VdpCameraSnapshot& target) const {
	target = m_live;
}

VdpCameraState VdpCameraUnit::captureState() const {
	return {
		m_live.view,
		m_live.proj,
		m_live.eye,
	};
}

} // namespace bmsx
