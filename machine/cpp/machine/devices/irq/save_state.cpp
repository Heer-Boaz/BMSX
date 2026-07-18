#include "machine/devices/irq/controller.h"

namespace bmsx {

IrqControllerState IrqController::captureState() const {
	return IrqControllerState{
		m_mask,
		m_pendingFlags,
		m_userMask,
		m_userPendingFlags,
		m_supervisorContextActive,
	};
}

void IrqController::restoreState(const IrqControllerState& state) {
	m_mask = state.mask;
	m_pendingFlags = state.pendingFlags;
	m_userMask = state.userMask;
	m_userPendingFlags = state.userPendingFlags;
	m_supervisorContextActive = state.supervisorContextActive;
	postLoad();
}

} // namespace bmsx
