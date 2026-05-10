#include "render/vdp/transform.h"

#include "machine/devices/vdp/fixed_point.h"

namespace bmsx {

void resolveVdpTransformSnapshot(VdpTransformSnapshot& target,
								const std::array<u32, VDP_XF_MATRIX_WORDS>& viewMatrixWords,
								const std::array<u32, VDP_XF_MATRIX_WORDS>& projectionMatrixWords) {
	for (size_t index = 0; index < VDP_XF_MATRIX_WORDS; ++index) {
		target.view[index] = decodeSignedQ16_16(viewMatrixWords[index]);
		target.proj[index] = decodeSignedQ16_16(projectionMatrixWords[index]);
	}
	Render3D::mat4MulInto(target.viewProj, target.proj, target.view);
	Render3D::mat4SkyboxFromViewInto(target.skyboxView, target.view);
	Render3D::extractFrustumPlanesInto(target.frustumPlanes, target.viewProj);
	Render3D::mat4AffineViewEyeInto(target.eye, target.view, target.skyboxView);
}

} // namespace bmsx
