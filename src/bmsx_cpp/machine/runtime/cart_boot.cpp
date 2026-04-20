#include "machine/runtime/cart_boot.h"

#include "core/engine.h"
#include "machine/bus/io.h"
#include "machine/runtime/runtime.h"

#include <stdexcept>

namespace bmsx {

void CartBootState::reset(Runtime& runtime) {
	m_prepared = false;
	m_pending = false;
	runtime.machine().memory().writeValue(IO_SYS_CART_BOOTREADY, valueNumber(0.0));
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
	runtime.machine().memory().writeValue(IO_SYS_CART_BOOTREADY, valueNumber(1.0));
}

void CartBootState::request(Runtime& runtime) {
	m_pending = true;
	runtime.machine().memory().writeValue(IO_SYS_CART_BOOTREADY, valueNumber(0.0));
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
	if (!m_pending) {
		return false;
	}
	const bool hasActiveEntry = runtime.hasEntryContinuation();
	if (runtime.frameLoop.frameActive || hasActiveEntry) {
		runtime.frameLoop.resetFrameState(runtime);
	}
	if (hasActiveEntry) {
		runtime.m_pendingCall = Runtime::PendingCall::None;
		runtime.vblank.clearHaltUntilIrq(runtime);
	}
	runtime.frameScheduler.clearQueuedTime();
	m_pending = false;
	try {
		if (!EngineCore::instance().bootLoadedCart()) {
			runtime.machine().memory().writeValue(IO_SYS_CART_BOOTREADY, valueNumber(0.0));
			EngineCore::instance().log(LogLevel::Error,
				"Runtime fault: deferred cart boot request failed while leaving system boot screen active.\n");
			return true;
		}
	} catch (const std::exception& error) {
		runtime.machine().memory().writeValue(IO_SYS_CART_BOOTREADY, valueNumber(0.0));
		EngineCore::instance().log(LogLevel::Error,
			"Runtime fault: deferred cart boot request failed while leaving system boot screen active: %s\n",
			error.what());
	}
	return true;
}

} // namespace bmsx
