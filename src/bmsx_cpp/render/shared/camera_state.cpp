#include "render/shared/camera_state.h"

#include "render/shared/hardware/camera.h"

namespace bmsx {

ResolvedCameraState resolveCameraState() {
	const HardwareCameraState& camera = resolveActiveHardwareCamera();
	return ResolvedCameraState{
		camera.view,
		camera.proj,
		camera.viewProj,
		camera.skyboxView,
		camera.eye,
	};
}

} // namespace bmsx
