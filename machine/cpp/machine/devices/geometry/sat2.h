#pragma once

#include "machine/devices/geometry/contracts.h"
#include "machine/devices/geometry/job.h"
#include "machine/memory/memory.h"

#include <array>

namespace bmsx {

enum class GeometrySat2Phase : u32 { Record, LoadA, LoadB, Compute, Publish, Complete };

struct GeometrySat2Progress {
	u32 phase = 0u;
	u32 vertexAddressA = 0u, vertexAddressB = 0u;
	u32 countA = 0u, countB = 0u, resultAddress = 0u;
	std::array<u32, GEO_SAT2_MAX_POLY_VERTICES * 2u> verticesA{};
	std::array<u32, GEO_SAT2_MAX_POLY_VERTICES * 2u> verticesB{};
	std::array<u32, 5> result{};
	MemoryWordCounters pendingMemory{};
	u32 pendingWorkUnits = 0u, pendingFault = 0u;
};

class GeometrySat2Unit {
public:
	explicit GeometrySat2Unit(Memory& memory);
	void reset();
	void beginJob() { m_progress.phase = static_cast<u32>(GeometrySat2Phase::Record); m_progress.pendingMemory = {}; m_progress.pendingWorkUnits = 0; m_progress.pendingFault = 0; }
	const GeometrySat2Progress& progress() const { return m_progress; }
	GeometrySat2Progress captureState() const { return m_progress; }
	void restoreState(const GeometrySat2Progress& state) { m_progress = state; }
	void processStep(GeometryJobState& job);

private:
	Memory& m_memory;
	GeometrySat2Progress m_progress;
};

} // namespace bmsx
