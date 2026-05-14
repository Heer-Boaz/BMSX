#pragma once

#include "machine/devices/geometry/contracts.h"

#include <array>
#include <cstdint>
#include <optional>

namespace bmsx {

struct GeometryJobState {
	uint32_t cmd = 0;
	uint32_t src0 = 0;
	uint32_t src1 = 0;
	uint32_t src2 = 0;
	uint32_t dst0 = 0;
	uint32_t dst1 = 0;
	uint32_t count = 0;
	uint32_t param0 = 0;
	uint32_t param1 = 0;
	uint32_t stride0 = 0;
	uint32_t stride1 = 0;
	uint32_t stride2 = 0;
	uint32_t processed = 0;
	uint32_t resultCount = 0;
	uint32_t exactPairCount = 0;
	uint32_t broadphasePairCount = 0;
};

struct GeometryControllerState {
	GeometryControllerPhase phase = GeometryControllerPhase::Idle;
	std::array<uint32_t, GEOMETRY_CONTROLLER_REGISTER_COUNT> registerWords{};
	std::optional<GeometryJobState> activeJob;
	int64_t workCarry = 0;
	uint32_t availableWorkUnits = 0;
};

} // namespace bmsx
