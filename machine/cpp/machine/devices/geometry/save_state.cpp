#include "machine/devices/geometry/controller.h"

#include "spec/bmsx/io.h"

#include <cstddef>

namespace bmsx {

GeometryControllerState GeometryController::captureState() const {
	GeometryControllerState state;
	state.phase = m_phase;
	for (size_t index = 0; index < GEOMETRY_CONTROLLER_REGISTER_COUNT; index += 1u) {
		state.registerWords[index] = m_memory.readIoU32(IO_GEO_REGISTER_ADDRS[index]);
	}
	state.activeJob = m_activeJob;
	state.workCarry = m_workCarry;
	state.availableWorkUnits = m_availableWorkUnits;
	state.supervisorQuiesceRequested = m_supervisorQuiesceRequested;
	return state;
}

void GeometryController::restoreState(const GeometryControllerState& state, int64_t nowCycles) {
	for (size_t index = 0; index < GEOMETRY_CONTROLLER_REGISTER_COUNT; index += 1u) {
		m_memory.writeIoU32(IO_GEO_REGISTER_ADDRS[index], state.registerWords[index]);
	}
	m_phase = state.phase;
	m_activeJob = state.activeJob;
	m_workCarry = state.workCarry;
	m_availableWorkUnits = state.availableWorkUnits;
	m_supervisorQuiesceRequested = state.supervisorQuiesceRequested;
	m_memory.writeIoU32(IO_GEO_CTRL, m_memory.readIoU32(IO_GEO_CTRL) & ~GEO_CTRL_ABORT);
	scheduleNextService(nowCycles);
}

} // namespace bmsx
