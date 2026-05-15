#include "render/lighting/system.h"

namespace bmsx {
namespace {

bool ambientLightsEqual(const std::optional<AmbientLight>& left, const std::optional<AmbientLight>& right) {
	if (left.has_value() != right.has_value()) {
		return false;
	}
	if (!left.has_value()) {
		return true;
	}
	return left->intensity == right->intensity
		&& left->color[0] == right->color[0]
		&& left->color[1] == right->color[1]
		&& left->color[2] == right->color[2];
}

template<typename Light, size_t Limit>
void writeLightFrameState(std::array<Light, Limit>& target, i32& targetCount, const std::vector<Light>& lights, i32 count) {
	targetCount = count;
	for (i32 index = 0; index < count; ++index) {
		target[static_cast<size_t>(index)] = lights[static_cast<size_t>(index)];
	}
}

} // namespace

LightingFrameState LightingSystem::update() {
	const bool hardwareDirty = consumeHardwareLightingDirty();
	const std::optional<AmbientLight> ambient = resolveHardwareAmbientLight();
	const std::vector<DirectionalLight>& directionalLights = getHardwareDirectionalLights();
	const std::vector<PointLight>& pointLights = getHardwarePointLights();
	const size_t directionalLightCount = directionalLights.size();
	const size_t pointLightCount = pointLights.size();
	const i32 dirCount = directionalLightCount < RENDER_MAX_DIRECTIONAL_LIGHTS
		? static_cast<i32>(directionalLightCount)
		: static_cast<i32>(RENDER_MAX_DIRECTIONAL_LIGHTS);
	const i32 pointCount = pointLightCount < RENDER_MAX_POINT_LIGHTS
		? static_cast<i32>(pointLightCount)
		: static_cast<i32>(RENDER_MAX_POINT_LIGHTS);
	const bool dirty = hardwareDirty
		|| m_frameState.dirCount != dirCount
		|| m_frameState.pointCount != pointCount
		|| !ambientLightsEqual(m_lastAmbient, ambient);
	m_lastAmbient = ambient;
	if (dirty) {
		m_frameState.ambient = ambient;
		writeLightFrameState(m_frameState.directional, m_frameState.dirCount, directionalLights, dirCount);
		writeLightFrameState(m_frameState.point, m_frameState.pointCount, pointLights, pointCount);
	}
	m_frameState.dirty = dirty;
	return m_frameState;
}

} // namespace bmsx
