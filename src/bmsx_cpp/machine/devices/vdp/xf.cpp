#include "machine/devices/vdp/xf.h"

#include "machine/devices/vdp/fixed_point.h"
#include "machine/devices/vdp/matrix_words.h"

namespace bmsx {
namespace {

constexpr f32 kResetAspect = 256.0f / 212.0f;
constexpr f32 kResetNear = 0.1f;
constexpr f32 kResetFar = 50.0f;
constexpr f32 kResetFocalY = static_cast<f32>(0x0001bb68u) / 65536.0f;

void setResetProjectionWordsAt(std::array<u32, VDP_XF_MATRIX_REGISTER_WORDS>& out, size_t base) {
	const f32 depth = (kResetFar + kResetNear) / (kResetNear - kResetFar);
	const f32 depthOffset = (2.0f * kResetFar * kResetNear) / (kResetNear - kResetFar);
	for (size_t index = 0; index < VDP_XF_MATRIX_WORDS; ++index) {
		out[base + index] = 0u;
	}
	out[base] = encodeSignedQ16_16(kResetFocalY / kResetAspect);
	out[base + 5u] = encodeSignedQ16_16(kResetFocalY);
	out[base + 10u] = encodeSignedQ16_16(depth);
	out[base + 11u] = encodeSignedQ16_16(-1.0f);
	out[base + 14u] = encodeSignedQ16_16(depthOffset);
}

} // namespace

VdpXfUnit::VdpXfUnit() {
	reset();
}

void VdpXfUnit::reset() {
	for (u32 matrixIndex = 0u; matrixIndex < VDP_XF_MATRIX_COUNT; ++matrixIndex) {
		setIdentityMatrixWordsAt(matrixWords, static_cast<size_t>(matrixIndex * VDP_XF_MATRIX_WORDS));
	}
	setResetProjectionWordsAt(matrixWords, static_cast<size_t>(VDP_XF_PROJECTION_MATRIX_RESET_INDEX * VDP_XF_MATRIX_WORDS));
	viewMatrixIndex = VDP_XF_VIEW_MATRIX_RESET_INDEX;
	projectionMatrixIndex = VDP_XF_PROJECTION_MATRIX_RESET_INDEX;
}

bool VdpXfUnit::writeRegister(u32 registerIndex, u32 word) {
	if (registerIndex < VDP_XF_MATRIX_REGISTER_WORDS) {
		matrixWords[static_cast<size_t>(registerIndex)] = word;
		return true;
	}
	if (registerIndex == VDP_XF_VIEW_MATRIX_INDEX_REGISTER) {
		if (word >= VDP_XF_MATRIX_COUNT) {
			return false;
		}
		viewMatrixIndex = word;
		return true;
	}
	if (registerIndex == VDP_XF_PROJECTION_MATRIX_INDEX_REGISTER) {
		if (word >= VDP_XF_MATRIX_COUNT) {
			return false;
		}
		projectionMatrixIndex = word;
		return true;
	}
	return false;
}

VdpXfState VdpXfUnit::captureState() const {
	return VdpXfState{matrixWords, viewMatrixIndex, projectionMatrixIndex};
}

void VdpXfUnit::restoreState(const VdpXfState& state) {
	matrixWords = state.matrixWords;
	viewMatrixIndex = state.viewMatrixIndex;
	projectionMatrixIndex = state.projectionMatrixIndex;
}

} // namespace bmsx
