#include "machine/devices/vdp/camera.h"
#include "machine/devices/vdp/fixed_point.h"

#include <cstddef>
#include <cmath>

namespace bmsx {
namespace {

constexpr f32 kResetCameraAspect = 256.0f / 212.0f;
constexpr f32 kResetCameraNear = 0.1f;
constexpr f32 kResetCameraFar = 50.0f;
constexpr f32 kResetCameraDepth = (kResetCameraFar + kResetCameraNear) / (kResetCameraNear - kResetCameraFar);
constexpr f32 kResetCameraDepthOffset = (2.0f * kResetCameraFar * kResetCameraNear) / (kResetCameraNear - kResetCameraFar);

void setProjectionFromFocalY(std::array<f32, 16>& out, f32 focalY) {
	out = {
		focalY / kResetCameraAspect, 0.0f, 0.0f, 0.0f,
		0.0f, focalY, 0.0f, 0.0f,
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

void extractFrustumPlanesInto(std::array<f32, 24>& out, const std::array<f32, 16>& viewProjection) {
	const auto& m = viewProjection;
	out[0] = m[3] + m[0]; out[1] = m[7] + m[4]; out[2] = m[11] + m[8]; out[3] = m[15] + m[12];
	out[4] = m[3] - m[0]; out[5] = m[7] - m[4]; out[6] = m[11] - m[8]; out[7] = m[15] - m[12];
	out[8] = m[3] + m[1]; out[9] = m[7] + m[5]; out[10] = m[11] + m[9]; out[11] = m[15] + m[13];
	out[12] = m[3] - m[1]; out[13] = m[7] - m[5]; out[14] = m[11] - m[9]; out[15] = m[15] - m[13];
	out[16] = m[3] + m[2]; out[17] = m[7] + m[6]; out[18] = m[11] + m[10]; out[19] = m[15] + m[14];
	out[20] = m[3] - m[2]; out[21] = m[7] - m[6]; out[22] = m[11] - m[10]; out[23] = m[15] - m[14];
	for (size_t index = 0u; index < 6u; ++index) {
		const size_t base = index * 4u;
		const f32 length = std::sqrt(out[base] * out[base] + out[base + 1u] * out[base + 1u] + out[base + 2u] * out[base + 2u]);
		const f32 divisor = length == 0.0f ? 1.0f : length;
		out[base] /= divisor;
		out[base + 1u] /= divisor;
		out[base + 2u] /= divisor;
		out[base + 3u] /= divisor;
	}
}

void setViewFromPoseInto(std::array<f32, 16>& out, f32 eyeX, f32 eyeY, f32 eyeZ, u32 yawWord, u32 pitchWord, u32 rollWord) {
	const f32 yaw = decodeTurn16(yawWord);
	const f32 pitch = decodeTurn16(pitchWord);
	const f32 roll = decodeTurn16(rollWord);
	const f32 cy = std::cos(yaw);
	const f32 sy = -std::sin(yaw);
	const f32 cp = std::cos(pitch);
	const f32 sp = std::sin(pitch);
	const f32 cr = std::cos(roll);
	const f32 sr = std::sin(roll);
	const f32 r00 = cy * cr + sy * sp * sr;
	const f32 r01 = sr * cp;
	const f32 r02 = -sy * cr + cy * sp * sr;
	const f32 r10 = -cy * sr + sy * sp * cr;
	const f32 r11 = cr * cp;
	const f32 r12 = sr * sy + cy * sp * cr;
	const f32 r20 = sy * cp;
	const f32 r21 = -sp;
	const f32 r22 = cy * cp;
	out[0] = r00; out[4] = r01; out[8] = r02; out[12] = -(r00 * eyeX + r01 * eyeY + r02 * eyeZ);
	out[1] = r10; out[5] = r11; out[9] = r12; out[13] = -(r10 * eyeX + r11 * eyeY + r12 * eyeZ);
	out[2] = r20; out[6] = r21; out[10] = r22; out[14] = -(r20 * eyeX + r21 * eyeY + r22 * eyeZ);
	out[3] = 0.0f; out[7] = 0.0f; out[11] = 0.0f; out[15] = 1.0f;
}

void rebuildFromPose(VdpCameraSnapshot& live, const VdpCameraState& pose) {
	const f32 eyeX = decodeSignedQ16_16(pose.eyeXWord);
	const f32 eyeY = decodeSignedQ16_16(pose.eyeYWord);
	const f32 eyeZ = decodeSignedQ16_16(pose.eyeZWord);
	setViewFromPoseInto(live.view, eyeX, eyeY, eyeZ, pose.yawWord, pose.pitchWord, pose.rollWord);
	setProjectionFromFocalY(live.proj, decodeUnsignedQ16_16(pose.focalYWord));
	multiplyMat4Into(live.viewProj, live.proj, live.view);
	skyboxFromViewInto(live.skyboxView, live.view);
	extractFrustumPlanesInto(live.frustumPlanes, live.viewProj);
	live.eye = { eyeX, eyeY, eyeZ };
}

} // namespace

VdpCameraUnit::VdpCameraUnit() {
	reset();
}

void VdpCameraUnit::reset() {
	pose = VdpCameraState{};
	rebuildFromPose(snapshot, pose);
}

void VdpCameraUnit::writePosePacket(u32 eyeXWord, u32 eyeYWord, u32 eyeZWord, u32 yawWord, u32 pitchWord, u32 rollWord, u32 focalYWord) {
	pose.eyeXWord = eyeXWord;
	pose.eyeYWord = eyeYWord;
	pose.eyeZWord = eyeZWord;
	pose.yawWord = yawWord;
	pose.pitchWord = pitchWord;
	pose.rollWord = rollWord;
	pose.focalYWord = focalYWord;
	rebuildFromPose(snapshot, pose);
}

void VdpCameraUnit::restoreState(const VdpCameraState& state) {
	pose = state;
	rebuildFromPose(snapshot, pose);
}

} // namespace bmsx
