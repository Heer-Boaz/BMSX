#include "machine/devices/vdp/xf.h"

#include "machine/devices/vdp/fixed_point.h"

namespace bmsx {
namespace {

constexpr f32 kResetAspect = 256.0f / 212.0f;
constexpr f32 kResetNear = 0.1f;
constexpr f32 kResetFar = 50.0f;
constexpr f32 kResetFocalY = static_cast<f32>(0x0001bb68u) / 65536.0f;

void setIdentityWords(std::array<u32, VDP_XF_MATRIX_WORDS>& out) {
	out = {};
	out[0] = 0x00010000u;
	out[5] = 0x00010000u;
	out[10] = 0x00010000u;
	out[15] = 0x00010000u;
}

void setResetProjectionWords(std::array<u32, VDP_XF_MATRIX_WORDS>& out) {
	const f32 depth = (kResetFar + kResetNear) / (kResetNear - kResetFar);
	const f32 depthOffset = (2.0f * kResetFar * kResetNear) / (kResetNear - kResetFar);
	out = {};
	out[0] = encodeSignedQ16_16(kResetFocalY / kResetAspect);
	out[5] = encodeSignedQ16_16(kResetFocalY);
	out[10] = encodeSignedQ16_16(depth);
	out[11] = encodeSignedQ16_16(-1.0f);
	out[14] = encodeSignedQ16_16(depthOffset);
}

} // namespace

VdpXfUnit::VdpXfUnit() {
	reset();
}

void VdpXfUnit::reset() {
	setIdentityWords(viewMatrixWords);
	setResetProjectionWords(projectionMatrixWords);
}

VdpXfState VdpXfUnit::captureState() const {
	return VdpXfState{viewMatrixWords, projectionMatrixWords};
}

void VdpXfUnit::restoreState(const VdpXfState& state) {
	viewMatrixWords = state.viewMatrixWords;
	projectionMatrixWords = state.projectionMatrixWords;
}

} // namespace bmsx
