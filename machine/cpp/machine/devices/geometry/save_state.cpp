#include "machine/devices/geometry/controller.h"

#include "spec/bmsx/io.h"

#include <algorithm>

namespace bmsx {

GeometryControllerState GeometryController::captureState() const {
	GeometryControllerState state;
	state.phase = m_phase;
	state.registerWords = m_registerWords;
	state.activeJob = m_activeJob;
	state.xform = m_xform2.captureState();
	state.sat = m_sat2.captureState();
	state.overlap = m_overlap2d.captureState();
	state.workCarry = m_workCarry;
	state.pendingCycles = m_phase == GeometryControllerPhase::Busy
		? std::max<i64>(0, m_serviceDeadline - m_scheduler.currentNowCycles()) : 0;
	state.supervisorQuiesceRequested = m_supervisorQuiesceRequested;
	return state;
}

void GeometryController::restoreState(const GeometryControllerState& state, int64_t nowCycles) {
	m_registerWords = state.registerWords;
	m_registerWords[(IO_GEO_CTRL - IO_GEO_BASE) / IO_WORD_SIZE] &= ~GEO_CTRL_ABORT;
	mirrorRegisters();
	m_phase = state.phase;
	m_activeJob = state.activeJob;
	m_xform2.restoreState(state.xform);
	m_sat2.restoreState(state.sat);
	m_overlap2d.restoreState(state.overlap);
	m_workCarry = state.workCarry;
	m_supervisorQuiesceRequested = state.supervisorQuiesceRequested;
	if (m_phase == GeometryControllerPhase::Busy) scheduleInterval(nowCycles + state.pendingCycles);
	else m_scheduler.cancelDeviceService(DEVICE_SERVICE_GEO);
}

} // namespace bmsx
