#pragma once

#include "machine/devices/geometry/projection.h"
#include "machine/devices/geometry/state.h"
#include "machine/memory/memory.h"

#include <cstdint>

namespace bmsx {

class GeometrySat2Unit {
public:
	explicit GeometrySat2Unit(Memory& memory);

	uint32_t validateSubmission(const GeometryJobState& job) const;
	uint32_t processRecord(GeometryJobState& job);

private:
	void projectVertexSpanInto(uint32_t base, uint32_t count, double ax, double ay, GeometryProjectionSpan& out) const;
	void writeResult(uint32_t addr, uint32_t hit, int32_t nx, int32_t ny, int32_t depth, uint32_t meta);

	GeometryProjectionSpan m_projectionA;
	GeometryProjectionSpan m_projectionB;
	Memory& m_memory;
};

} // namespace bmsx
