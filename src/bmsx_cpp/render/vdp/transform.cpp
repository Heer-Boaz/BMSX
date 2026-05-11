#include "render/vdp/transform.h"

#include "machine/devices/vdp/fixed_point.h"

namespace bmsx {

void resolveVdpTransformSnapshot(VdpTransformSnapshot& target,
									const std::array<u32, VDP_XF_MATRIX_REGISTER_WORDS>& matrixWords,
									u32 viewMatrixIndex,
									u32 projectionMatrixIndex) {
	const size_t viewBase = static_cast<size_t>(viewMatrixIndex * VDP_XF_MATRIX_WORDS);
	const size_t projectionBase = static_cast<size_t>(projectionMatrixIndex * VDP_XF_MATRIX_WORDS);
	for (size_t index = 0; index < VDP_XF_MATRIX_WORDS; ++index) {
		target.view[index] = decodeSignedQ16_16(matrixWords[viewBase + index]);
		target.proj[index] = decodeSignedQ16_16(matrixWords[projectionBase + index]);
	}
	Render3D::mat4MulInto(target.viewProj, target.proj, target.view);
	Render3D::mat4SkyboxFromViewInto(target.skyboxView, target.view);
	Render3D::extractFrustumPlanesInto(target.frustumPlanes, target.viewProj);
	Render3D::mat4AffineViewEyeInto(target.eye, target.view, target.skyboxView);
}

} // namespace bmsx
