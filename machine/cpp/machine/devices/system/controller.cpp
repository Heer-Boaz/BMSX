#include "machine/devices/system/controller.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/memory/memory.h"

namespace bmsx {

SystemController::SystemController(Memory& memory, CPU& cpu)
	: m_memory(memory)
	, m_cpu(cpu) {
	memory.mapIoWrite<&SystemController::writeControl>(IO_SYS_CONTROL, *this);
}

void SystemController::reset() {
	m_resetRequested = false;
	m_memory.writeIoValue(IO_SYS_CONTROL, valueNumber(0.0));
}

void SystemController::writeControl([[maybe_unused]] u32 address, Value value) {
	if ((toU32(value) & SYS_CONTROL_RESET) != 0u) {
		m_resetRequested = true;
		m_cpu.requestYield();
	}
	m_memory.writeIoValue(IO_SYS_CONTROL, valueNumber(0.0));
}

bool SystemController::takeResetRequest() {
	const bool requested = m_resetRequested;
	m_resetRequested = false;
	return requested;
}

SystemControllerState SystemController::captureState() const {
	return { m_resetRequested };
}

void SystemController::restoreState(const SystemControllerState& state) {
	m_resetRequested = state.resetRequested;
	m_memory.writeIoValue(IO_SYS_CONTROL, valueNumber(0.0));
}

} // namespace bmsx
