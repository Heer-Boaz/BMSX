#pragma once

#include "machine/devices/geometry/job.h"
#include "machine/devices/geometry/contracts.h"
#include "machine/memory/memory.h"

#include <cstdint>
#include <array>

namespace bmsx {

enum class GeometryXform2Phase : u32 { Record, Publish, Complete };

struct GeometryXform2Progress {
	u32 phase = 0u;
	u32 dstAddress = 0u, boundsAddress = 0u;
	u32 vertexCount = 0u;
	bool hasBounds = false;
	std::array<u32, GEO_XFORM2_MAX_VERTICES * 2u> vertices{};
	std::array<u32, 4> bounds{};
	MemoryWordCounters pendingMemory{};
	u32 pendingWorkUnits = 0u, pendingFault = 0u;
};

class GeometryXform2Unit {
public:
	explicit GeometryXform2Unit(Memory& memory);

	void reset() { m_progress = {}; }
	void beginJob() {
		m_progress.phase = static_cast<u32>(GeometryXform2Phase::Record);
		m_progress.pendingMemory = {};
		m_progress.pendingWorkUnits = 0u;
		m_progress.pendingFault = 0u;
	}
	const GeometryXform2Progress& progress() const { return m_progress; }
	GeometryXform2Progress captureState() const { return m_progress; }
	void restoreState(const GeometryXform2Progress& state) { m_progress = state; }
	void processStep(GeometryJobState& job);

private:
	Memory& m_memory;
	GeometryXform2Progress m_progress;
};

} // namespace bmsx
