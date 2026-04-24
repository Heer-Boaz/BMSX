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

} // namespace

LightingFrameState LightingSystem::update() {
	const bool hardwareDirty = consumeHardwareLightingDirty();
	const std::optional<AmbientLight> ambient = resolveHardwareAmbientLight();
	const i32 dirCount = static_cast<i32>(getHardwareDirectionalLights().size());
	const i32 pointCount = static_cast<i32>(getHardwarePointLights().size());
	const bool dirty = hardwareDirty
		|| m_frameState.dirCount != dirCount
		|| m_frameState.pointCount != pointCount
		|| !ambientLightsEqual(m_lastAmbient, ambient);
	m_lastAmbient = ambient;
	if (dirty) {
		m_frameState = {
			ambient,
			dirCount,
			pointCount,
			true,
		};
	} else {
		m_frameState.dirty = false;
	}
	return m_frameState;
}

} // namespace bmsx
