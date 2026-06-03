#pragma once

#include "common/primitives.h"
#include "render/3d/light.h"
#include <optional>

namespace bmsx {

class GameView;

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
	LightingFrameState update(const GameView& view);
	const LightingFrameState& frameState() const { return m_frameState; }

private:
	LightingFrameState m_frameState;
};

} // namespace bmsx
