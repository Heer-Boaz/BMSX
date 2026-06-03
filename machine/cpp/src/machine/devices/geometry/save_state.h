#pragma once

#include "machine/devices/geometry/contracts.h"
#include "machine/devices/geometry/job.h"

#include <array>
#include <cstdint>
#include <optional>

namespace bmsx {

struct GeometryControllerState {
	GeometryControllerPhase phase = GeometryControllerPhase::Idle;
	std::array<uint32_t, GEOMETRY_CONTROLLER_REGISTER_COUNT> registerWords{};
	std::optional<GeometryJobState> activeJob;
	int64_t workCarry = 0;
	uint32_t availableWorkUnits = 0;
};

} // namespace bmsx
