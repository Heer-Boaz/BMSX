#include "render/shared/camera_state.h"
#include "render/shared/hardware/camera.h"

namespace bmsx {

std::optional<ResolvedCameraState> resolveCameraState() {
	const HardwareCameraState* camera = resolveActiveHardwareCamera();
	if (!camera) {
		return std::nullopt;
	}
	return ResolvedCameraState{
		camera->view,
		camera->proj,
		camera->viewProj,
		camera->skyboxView,
		camera->eye,
	};
}

} // namespace bmsx
