#pragma once

#include "machine/devices/geometry/contracts.h"
#include "machine/devices/geometry/job.h"
#include "machine/devices/geometry/overlap2d.h"

#include <array>
#include <cstdint>
#include <optional>

namespace bmsx {

struct GeometryControllerState {
	GeometryControllerPhase phase = GeometryControllerPhase::Idle;
	std::array<uint32_t, GEOMETRY_CONTROLLER_REGISTER_COUNT> registerWords{};
	std::optional<GeometryJobState> activeJob;
	GeometryOverlap2dProgress overlap;
	int64_t workCarry = 0;
	uint32_t availableWorkUnits = 0;
	int64_t pendingCycles = 0;
	bool supervisorQuiesceRequested = false;
};

} // namespace bmsx
