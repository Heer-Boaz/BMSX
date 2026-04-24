#include "machine/runtime/cart_boot.h"

#include "core/engine.h"
#include "machine/bus/io.h"
#include "machine/runtime/runtime.h"

#include <stdexcept>

namespace bmsx {

void CartBootState::reset(Runtime& runtime) {
	m_prepared = false;
	m_pending = false;
	setReadyFlag(runtime, false);
}

void CartBootState::setReadyFlag(Runtime& runtime, bool value) {
	runtime.machine().memory().writeValue(IO_SYS_CART_BOOTREADY, valueNumber(value ? 1.0 : 0.0));
}

void CartBootState::prepareIfNeeded(Runtime& runtime) {
	if (!runtime.isEngineProgramActive()) {
		return;
	}
	if (!EngineCore::instance().hasLoadedCartProgram()) {
		return;
	}
	if (m_prepared) {
		return;
	}
	m_prepared = true;
	setReadyFlag(runtime, true);
}

void CartBootState::request(Runtime& runtime) {
	m_pending = true;
	setReadyFlag(runtime, false);
}

bool CartBootState::processProgramReloadRequest(Runtime& runtime) {
	if (!runtime.m_rebootRequested) {
		return false;
	}
	runtime.m_rebootRequested = false;
	runtime.frameScheduler.clearQueuedTime();
	if (!EngineCore::instance().rebootLoadedRom()) {
		EngineCore::instance().log(LogLevel::Error, "Runtime fault: reboot to bootrom failed.\n");
	}
	return true;
}

bool CartBootState::pollSystemBootRequest(Runtime& runtime) {
	if (!runtime.isEngineProgramActive()) {
		return false;
	}
	if (runtime.machine().memory().readIoU32(IO_SYS_BOOT_CART) == 0u) {
		return false;
	}
	runtime.machine().memory().writeValue(IO_SYS_BOOT_CART, valueNumber(0.0));
	runtime.frameScheduler.clearQueuedTime();
	request(runtime);
	return true;
}

bool CartBootState::processPending(Runtime& runtime) {
	prepareIfNeeded(runtime);
	if (pollSystemBootRequest(runtime)) {
		return true;
	}
	if (!m_pending) {
		return false;
	}
	if (runtime.frameLoop.frameActive) {
		runtime.frameLoop.resetFrameState(runtime);
	}
	if (runtime.m_pendingCall == Runtime::PendingCall::Entry) {
		runtime.m_pendingCall = Runtime::PendingCall::None;
		runtime.vblank.clearHaltUntilIrq(runtime);
	}
	runtime.frameScheduler.clearQueuedTime();
	m_pending = false;
	try {
		if (!EngineCore::instance().bootLoadedCart()) {
			setReadyFlag(runtime, false);
			EngineCore::instance().log(LogLevel::Error,
				"Runtime fault: deferred cart boot request failed while leaving system boot screen active.\n");
		}
	} catch (const std::exception& error) {
		setReadyFlag(runtime, false);
		EngineCore::instance().log(LogLevel::Error,
			"Runtime fault: deferred cart boot request failed while leaving system boot screen active: %s\n",
			error.what());
	}
	return true;
}

} // namespace bmsx
