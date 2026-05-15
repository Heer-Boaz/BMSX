#pragma once

#include "render/shared/hardware/lighting.h"
#include "common/primitives.h"
#include <optional>

namespace bmsx {

struct LightingFrameState {
	std::optional<AmbientLight> ambient;
	std::array<DirectionalLight, RENDER_MAX_DIRECTIONAL_LIGHTS> directional{};
	std::array<PointLight, RENDER_MAX_POINT_LIGHTS> point{};
	i32 dirCount = 0;
	i32 pointCount = 0;
	bool dirty = true;
};

class LightingSystem {
public:
	LightingFrameState update();
	const LightingFrameState& frameState() const { return m_frameState; }

private:
	std::optional<AmbientLight> m_lastAmbient;
	LightingFrameState m_frameState;
};

} // namespace bmsx
