#include "machine/runtime/cart_boot.h"

#include "core/rom_boot_manager.h"
#include "machine/bus/io.h"
#include "machine/runtime/runtime.h"

#include <stdexcept>

namespace bmsx {

CartBootState::CartBootState(Runtime& runtime, RomBootManager& bootManager)
	: m_runtime(runtime)
	, m_bootManager(bootManager) {
}

void CartBootState::reset() {
	m_prepared = false;
	m_pending = false;
	setReadyFlag(false);
}

// disable-next-line single_line_method_pattern -- cart boot readiness is owned by this state and projected into SYS MMIO.
void CartBootState::setReadyFlag(bool value) {
	m_runtime.machine().memory().writeValue(IO_SYS_CART_BOOTREADY, valueNumber(value ? 1.0 : 0.0));
}

void CartBootState::prepareIfNeeded() {
	Runtime& runtime = m_runtime;
	if (!runtime.isEngineProgramActive()) {
		return;
	}
	if (!m_bootManager.hasLoadedCartProgram()) {
		return;
	}
	if (m_prepared) {
		return;
	}
	m_prepared = true;
	setReadyFlag(true);
}

void CartBootState::request() {
	m_pending = true;
	setReadyFlag(false);
}

bool CartBootState::processProgramReloadRequest() {
	Runtime& runtime = m_runtime;
	if (!runtime.m_rebootRequested) {
		return false;
	}
	runtime.m_rebootRequested = false;
	runtime.frameScheduler.clearQueuedTime();
	if (!m_bootManager.rebootLoadedRom()) {
		throw std::runtime_error("Runtime fault: reboot to bootrom failed.");
	}
	return true;
}

bool CartBootState::pollSystemBootRequest() {
	Runtime& runtime = m_runtime;
	if (!runtime.isEngineProgramActive()) {
		return false;
	}
	if (runtime.machine().memory().readIoU32(IO_SYS_BOOT_CART) == 0u) {
		return false;
	}
	runtime.machine().memory().writeValue(IO_SYS_BOOT_CART, valueNumber(0.0));
	runtime.frameScheduler.clearQueuedTime();
	request();
	return true;
}

bool CartBootState::processPending() {
	Runtime& runtime = m_runtime;
	prepareIfNeeded();
	if (pollSystemBootRequest()) {
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
		if (!m_bootManager.bootLoadedCart()) {
			setReadyFlag(false);
			throw std::runtime_error("Runtime fault: deferred cart boot request failed while leaving system boot screen active.");
		}
	} catch (const std::exception& error) {
		setReadyFlag(false);
		throw std::runtime_error(std::string("Runtime fault: deferred cart boot request failed while leaving system boot screen active: ") + error.what());
	}
	return true;
}

} // namespace bmsx
