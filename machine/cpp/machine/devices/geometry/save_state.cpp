#include "machine/devices/geometry/controller.h"

#include "spec/bmsx/io.h"

namespace bmsx {

GeometryControllerState GeometryController::captureState() const {
	GeometryControllerState state;
	state.phase = m_phase;
	state.registerWords = m_registerWords;
	state.activeJob = m_activeJob;
	state.workCarry = m_workCarry;
	state.availableWorkUnits = m_availableWorkUnits;
	state.supervisorQuiesceRequested = m_supervisorQuiesceRequested;
	return state;
}

void GeometryController::restoreState(const GeometryControllerState& state, int64_t nowCycles) {
	m_registerWords = state.registerWords;
	m_registerWords[(IO_GEO_CTRL - IO_GEO_BASE) / IO_WORD_SIZE] &= ~GEO_CTRL_ABORT;
	mirrorRegisters();
	m_phase = state.phase;
	m_activeJob = state.activeJob;
	m_workCarry = state.workCarry;
	m_availableWorkUnits = state.availableWorkUnits;
	m_supervisorQuiesceRequested = state.supervisorQuiesceRequested;
	scheduleNextService(nowCycles);
}

} // namespace bmsx
