#pragma once

#include "render/shared/hardware/lighting.h"
#include "core/primitives.h"
#include <optional>

namespace bmsx {

struct LightingFrameState {
	std::optional<AmbientLight> ambient;
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
