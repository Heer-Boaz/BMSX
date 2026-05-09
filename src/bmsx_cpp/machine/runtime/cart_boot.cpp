#include "machine/runtime/cart_boot.h"

#include "machine/bus/io.h"
#include "machine/runtime/runtime.h"

#include <stdexcept>

namespace bmsx {

CartBootState::CartBootState(Runtime& runtime)
		: m_runtime(runtime) {
}

void CartBootState::reset() {
		m_pending = false;
}

void CartBootState::request() {
		m_pending = true;
}

bool CartBootState::pollSystemBootRequest() {
	Runtime& runtime = m_runtime;
	if (runtime.isCartProgramStarted()) {
		return false;
	}
	if (runtime.machine.memory.readIoU32(IO_SYS_BOOT_CART) == 0u) {
		return false;
	}
	runtime.machine.memory.writeValue(IO_SYS_BOOT_CART, valueNumber(0.0));
	runtime.frameScheduler.clearQueuedTime();
	request();
	return true;
}

bool CartBootState::processPending() {
	Runtime& runtime = m_runtime;
	pollSystemBootRequest();
	if (!m_pending) {
		return false;
	}
	if (runtime.frameLoop.frameActive) {
		runtime.frameLoop.resetFrameState(runtime);
	}
	if (runtime.m_pendingCall == Runtime::PendingCall::Entry) {
		runtime.m_pendingCall = Runtime::PendingCall::None;
		runtime.cpuExecution.clearHaltUntilIrq(runtime);
	}
	runtime.frameScheduler.clearQueuedTime();
	m_pending = false;
	try {
		runtime.startCartProgram();
	} catch (const std::exception& error) {
		throw std::runtime_error(std::string("Runtime fault: deferred cart boot request failed while leaving system boot screen active: ") + error.what());
	}
	return true;
}

} // namespace bmsx
