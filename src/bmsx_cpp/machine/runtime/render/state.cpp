#include "machine/runtime/render/state.h"

#include "render/shared/hardware/camera.h"
#include "render/shared/hardware/lighting.h"
#include "render/shared/queues.h"
#include <algorithm>
#include <unordered_map>
#include <utility>

namespace bmsx {
namespace {

template<typename Map, typename T, typename BuildFn>
std::vector<T> captureSortedLightEntries(const Map& map, BuildFn&& build) {
	std::vector<std::pair<std::string, const typename Map::mapped_type*>> entries;
	entries.reserve(map.size());
	for (const auto& entry : map) {
		entries.emplace_back(entry.first, &entry.second);
	}
	std::sort(entries.begin(), entries.end(), [](const auto& left, const auto& right) {
		return left.first < right.first;
	});
	std::vector<T> out;
	out.reserve(entries.size());
	for (const auto& entry : entries) {
		out.push_back(build(entry.first, *entry.second));
	}
	return out;
}

} // namespace

RuntimeRenderState captureRuntimeRenderState() {
	RuntimeRenderState state;
	if (const HardwareCameraState* camera = resolveActiveHardwareCamera()) {
		state.camera = RuntimeRenderCameraState{
			camera->view,
			camera->proj,
			{ camera->eye.x, camera->eye.y, camera->eye.z },
		};
	}
	state.ambientLights = captureSortedLightEntries<std::unordered_map<std::string, AmbientLight>, RuntimeAmbientLightState>(
		getHardwareAmbientLights(),
		[](const std::string& id, const AmbientLight& light) {
			return RuntimeAmbientLightState{
				id,
				light.color,
				light.intensity,
			};
		});
	state.directionalLights = captureSortedLightEntries<std::unordered_map<std::string, DirectionalLight>, RuntimeDirectionalLightState>(
		getHardwareDirectionalLights(),
		[](const std::string& id, const DirectionalLight& light) {
			return RuntimeDirectionalLightState{
				id,
				light.color,
				light.intensity,
				light.orientation,
			};
		});
	state.pointLights = captureSortedLightEntries<std::unordered_map<std::string, PointLight>, RuntimePointLightState>(
		getHardwarePointLights(),
		[](const std::string& id, const PointLight& light) {
			return RuntimePointLightState{
				id,
				light.color,
				light.intensity,
				{ light.pos.x, light.pos.y, light.pos.z },
				light.range,
			};
		});
	state.spriteParallaxRig = RenderQueues::spriteParallaxRig;
	return state;
}

void applyRuntimeRenderState(const RuntimeRenderState& state) {
	if (state.camera.has_value()) {
		const RuntimeRenderCameraState& camera = *state.camera;
		setHardwareCamera(camera.view, camera.proj, camera.eye[0], camera.eye[1], camera.eye[2]);
	} else {
		clearHardwareCamera();
	}
	clearHardwareLighting();
	for (const RuntimeAmbientLightState& light : state.ambientLights) {
		putHardwareAmbientLight(light.id, AmbientLight{
			light.color,
			light.intensity,
		});
	}
	for (const RuntimeDirectionalLightState& light : state.directionalLights) {
		putHardwareDirectionalLight(light.id, DirectionalLight{
			light.color,
			light.intensity,
			light.orientation,
		});
	}
	for (const RuntimePointLightState& light : state.pointLights) {
		putHardwarePointLight(light.id, PointLight{
			light.color,
			light.intensity,
			Vec3{ light.pos[0], light.pos[1], light.pos[2] },
			light.range,
		});
	}
	RenderQueues::setSpriteParallaxRig(
		state.spriteParallaxRig.vy,
		state.spriteParallaxRig.scale,
		state.spriteParallaxRig.impact,
		state.spriteParallaxRig.impact_t,
		state.spriteParallaxRig.bias_px,
		state.spriteParallaxRig.parallax_strength,
		state.spriteParallaxRig.scale_strength,
		state.spriteParallaxRig.flip_strength,
		state.spriteParallaxRig.flip_window);
}

void beginRuntimeRenderFrame() {
	clearHardwareLighting();
}

void clearRuntimeRenderBackQueues() {
	RenderQueues::clearBackQueues();
}

void resetRuntimeRenderState() {
	clearHardwareCamera();
	clearHardwareLighting();
	RenderQueues::setSpriteParallaxRig(0.0f, 1.0f, 0.0f, 0.0f, 0.0f, 1.0f, 1.0f, 0.0f, 0.6f);
}

} // namespace bmsx
