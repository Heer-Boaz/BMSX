#include "render/lighting/system.h"

#include "render/gameview.h"

namespace bmsx {

LightingFrameState LightingSystem::update(const GameView& view) {
	const auto& ambient = view.vdpAmbientLightColorIntensity;
	if (ambient[3] != 0.0f) {
		m_frameState.ambient = AmbientLight{
			{ambient[0], ambient[1], ambient[2]},
			ambient[3],
		};
	} else {
		m_frameState.ambient.reset();
	}

	m_frameState.dirCount = view.vdpDirectionalLightCount;
	for (i32 index = 0; index < view.vdpDirectionalLightCount; ++index) {
		const size_t base = static_cast<size_t>(index) * 3u;
		DirectionalLight& light = m_frameState.directional[static_cast<size_t>(index)];
		light.orientation = {
			view.vdpDirectionalLightDirections[base],
			view.vdpDirectionalLightDirections[base + 1u],
			view.vdpDirectionalLightDirections[base + 2u],
		};
		light.color = {
			view.vdpDirectionalLightColors[base],
			view.vdpDirectionalLightColors[base + 1u],
			view.vdpDirectionalLightColors[base + 2u],
		};
		light.intensity = view.vdpDirectionalLightIntensities[static_cast<size_t>(index)];
	}

	m_frameState.pointCount = view.vdpPointLightCount;
	for (i32 index = 0; index < view.vdpPointLightCount; ++index) {
		const size_t vecBase = static_cast<size_t>(index) * 3u;
		const size_t paramBase = static_cast<size_t>(index) * 2u;
		PointLight& light = m_frameState.point[static_cast<size_t>(index)];
		light.pos = {
			view.vdpPointLightPositions[vecBase],
			view.vdpPointLightPositions[vecBase + 1u],
			view.vdpPointLightPositions[vecBase + 2u],
		};
		light.range = view.vdpPointLightParams[paramBase];
		light.color = {
			view.vdpPointLightColors[vecBase],
			view.vdpPointLightColors[vecBase + 1u],
			view.vdpPointLightColors[vecBase + 2u],
		};
		light.intensity = view.vdpPointLightParams[paramBase + 1u];
	}

	m_frameState.dirty = true;
	return m_frameState;
}

} // namespace bmsx
