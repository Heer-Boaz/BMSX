#pragma once

#include "machine/devices/geometry/job.h"
#include "machine/memory/memory.h"

#include <cstdint>

namespace bmsx {

class GeometryXform2Unit {
public:
	explicit GeometryXform2Unit(Memory& memory);

	uint32_t validateSubmission(const GeometryJobState& job) const;
	uint32_t processRecord(GeometryJobState& job);

private:
	Memory& m_memory;
};

} // namespace bmsx
