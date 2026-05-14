#include "machine/devices/irq/controller.h"

namespace bmsx {

IrqControllerState IrqController::captureState() const {
	return IrqControllerState{m_pendingFlags};
}

void IrqController::restoreState(const IrqControllerState& state) {
	m_pendingFlags = state.pendingFlags;
	postLoad();
}

} // namespace bmsx
