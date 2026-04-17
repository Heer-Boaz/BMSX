#include "machine/runtime/runtime_vblank.h"

#include "core/engine_core.h"
#include "machine/bus/io.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/runtime_cpu_executor.h"
#include "machine/runtime/runtime_timing_config.h"
#include <algorithm>
#include <limits>
#include <stdexcept>
#include <string>

namespace bmsx {
namespace {
inline std::runtime_error runtimeFault(const std::string& message) {
	return BMSX_RUNTIME_ERROR("Runtime fault: " + message);
}
}

void RuntimeVblankState::configureCycleBudget(Runtime& runtime) {
	if (m_vblankCycles <= 0) {
		return;
	}
	if (m_vblankCycles > runtime.timing.cycleBudgetPerFrame) {
		throw runtimeFault("vblank_cycles must be less than or equal to cycles_per_frame.");
	}
	m_vblankStartCycle = runtime.timing.cycleBudgetPerFrame - m_vblankCycles;
	reset(runtime);
}

void RuntimeVblankState::setVblankCycles(Runtime& runtime, int cycles) {
	if (cycles <= 0) {
		throw runtimeFault("vblank_cycles must be greater than 0.");
	}
	if (cycles > runtime.timing.cycleBudgetPerFrame) {
		throw runtimeFault("vblank_cycles must be less than or equal to cycles_per_frame.");
	}
	m_vblankCycles = cycles;
	m_vblankStartCycle = runtime.timing.cycleBudgetPerFrame - m_vblankCycles;
	reset(runtime);
}

int RuntimeVblankState::getCyclesIntoFrame(const Runtime& runtime) const {
	return static_cast<int>(runtime.m_machine.scheduler().nowCycles() - m_frameStartCycle);
}

void RuntimeVblankState::resetScheduler(Runtime& runtime) {
	runtime.m_machine.scheduler().reset();
	m_frameStartCycle = 0;
}

void RuntimeVblankState::reset(Runtime& runtime) {
	resetScheduler(runtime);
	m_vblankActive = false;
	m_vblankSequence = 0;
	m_lastCompletedVblankSequence = 0;
	runtime.m_machine.inputController().restoreSampleArmed(false);
	runtime.m_machine.irqController().postLoad();
	resetHaltIrqWait();
	runtime.m_machine.vdp().resetStatus();
	if (m_vblankStartCycle == 0) {
		setVblankStatus(runtime, true);
	}
	scheduleCurrentFrameTimers(runtime);
	refreshDeviceTimings(runtime, runtime.m_machine.scheduler().nowCycles());
}

RuntimeVblankSnapshot RuntimeVblankState::capture(const Runtime& runtime) const {
	RuntimeVblankSnapshot state;
	state.cyclesIntoFrame = getCyclesIntoFrame(runtime);
	return state;
}

void RuntimeVblankState::restore(Runtime& runtime, const RuntimeVblankSnapshot& state) {
	clearHaltUntilIrq(runtime);
	runtime.machineScheduler.reset();
	runtime.frameLoop.reset();
	runtime.screen.reset();
	resetScheduler(runtime);
	runtime.m_machine.scheduler().setNowCycles(state.cyclesIntoFrame);
	m_frameStartCycle = 0;
	m_vblankSequence = 0;
	m_lastCompletedVblankSequence = 0;
	m_activeTickCompleted = false;
	runtime.m_machine.irqController().postLoad();
	const bool active = (m_vblankStartCycle == 0) || (getCyclesIntoFrame(runtime) >= m_vblankStartCycle);
	setVblankStatus(runtime, active);
	scheduleCurrentFrameTimers(runtime);
	refreshDeviceTimings(runtime, runtime.m_machine.scheduler().nowCycles());
}

void RuntimeVblankState::beginTick() {
	m_activeTickCompleted = false;
}

void RuntimeVblankState::abandonTick() {
	m_activeTickCompleted = false;
}

void RuntimeVblankState::handleBeginTimer(Runtime& runtime) {
	if (!m_vblankActive) {
		enterVblank(runtime);
	}
}

void RuntimeVblankState::handleEndTimer(Runtime& runtime) {
	if (m_vblankActive) {
		leaveVblank(runtime);
	}
	m_frameStartCycle = runtime.m_machine.scheduler().nowCycles();
	scheduleCurrentFrameTimers(runtime);
	if (m_vblankStartCycle == 0) {
		enterVblank(runtime);
	}
}

void RuntimeVblankState::clearHaltUntilIrq(Runtime& runtime) {
	runtime.m_machine.cpu().clearHaltUntilIrq();
	resetHaltIrqWait();
	m_clearBackQueuesAfterIrqWake = false;
}

bool RuntimeVblankState::consumeBackQueueClearAfterIrqWake() {
	if (!m_clearBackQueuesAfterIrqWake) {
		return false;
	}
	m_clearBackQueuesAfterIrqWake = false;
	return true;
}

bool RuntimeVblankState::runHaltedUntilIrq(Runtime& runtime, FrameState& frameState) {
	runDueRuntimeTimers(runtime);
	if (!runtime.m_machine.cpu().isHaltedUntilIrq()) {
		resetHaltIrqWait();
		return false;
	}
	if (tryCompleteTickOnPendingVblankIrq(runtime, frameState)) {
		return true;
	}
	if (!m_haltIrqWaitArmed) {
		const uint32_t pendingFlags = runtime.m_machine.irqController().pendingFlags();
		if (pendingFlags != 0u) {
			runtime.m_machine.cpu().clearHaltUntilIrq();
			return m_activeTickCompleted;
		}
		m_haltIrqSignalSequence = runtime.m_machine.irqController().signalSequence();
		m_haltIrqWaitArmed = true;
	}
	while (true) {
		if (runtime.m_machine.irqController().signalSequence() != m_haltIrqSignalSequence) {
			runtime.m_machine.cpu().clearHaltUntilIrq();
			resetHaltIrqWait();
			return m_activeTickCompleted;
		}
		if (frameState.cycleBudgetRemaining > 0) {
			const i64 cyclesToTarget = runtime.m_machine.scheduler().nextDeadline() - runtime.m_machine.scheduler().nowCycles();
			if (cyclesToTarget <= 0) {
				runDueRuntimeTimers(runtime);
				continue;
			}
			const int idleCycles = static_cast<int>(std::min<i64>(frameState.cycleBudgetRemaining, cyclesToTarget));
			frameState.cycleBudgetRemaining -= idleCycles;
			advanceRuntimeTime(runtime, idleCycles);
			if (tryCompleteTickOnPendingVblankIrq(runtime, frameState)) {
				return true;
			}
			continue;
		}
		return true;
	}
}

void RuntimeVblankState::scheduleCurrentFrameTimers(Runtime& runtime) {
	runtime.m_machine.scheduler().scheduleVblankEnd(m_frameStartCycle + runtime.timing.cycleBudgetPerFrame);
	if (m_vblankStartCycle > 0 && getCyclesIntoFrame(runtime) < m_vblankStartCycle) {
		runtime.m_machine.scheduler().scheduleVblankBegin(m_frameStartCycle + m_vblankStartCycle);
	}
}

void RuntimeVblankState::setVblankStatus(Runtime& runtime, bool active) {
	m_vblankActive = active;
	runtime.m_machine.vdp().setVblankStatus(active);
}

void RuntimeVblankState::enterVblank(Runtime& runtime) {
	m_vblankSequence += 1;
	commitFrameOnVblankEdge(runtime);
	runtime.m_machine.inputController().onVblankEdge();
	setVblankStatus(runtime, true);
	runtime.m_machine.irqController().raise(IRQ_VBLANK);
	if (runtime.frameLoop.frameActive && isFrameBoundaryHalt(runtime)) {
		completeTickIfPending(runtime, runtime.frameLoop.frameState, m_vblankSequence);
		m_clearBackQueuesAfterIrqWake = true;
	}
}

void RuntimeVblankState::leaveVblank(Runtime& runtime) {
	setVblankStatus(runtime, false);
}

void RuntimeVblankState::resetHaltIrqWait() {
	m_haltIrqWaitArmed = false;
	m_haltIrqSignalSequence = 0;
}

bool RuntimeVblankState::tryCompleteTickOnPendingVblankIrq(Runtime& runtime, FrameState& frameState) {
	if (!isFrameBoundaryHalt(runtime)) {
		return false;
	}
	if (m_vblankSequence == 0) {
		return false;
	}
	const uint32_t pendingFlags = runtime.m_machine.irqController().pendingFlags();
	if ((pendingFlags & IRQ_VBLANK) == 0u) {
		return false;
	}
	if (m_lastCompletedVblankSequence == m_vblankSequence) {
		return false;
	}
	completeTickIfPending(runtime, frameState, m_vblankSequence);
	m_clearBackQueuesAfterIrqWake = true;
	runtime.m_machine.cpu().clearHaltUntilIrq();
	resetHaltIrqWait();
	return true;
}

bool RuntimeVblankState::isFrameBoundaryHalt(Runtime& runtime) const {
	return runtime.m_machine.cpu().getFrameDepth() == 1
		&& runtime.m_pendingCall == Runtime::PendingCall::Entry
		&& runtime.m_machine.cpu().isHaltedUntilIrq();
}

void RuntimeVblankState::commitFrameOnVblankEdge(Runtime& runtime) {
	runtime.m_machine.vdp().syncRegisters();
	runtime.m_machine.vdp().presentReadyFrameOnVblankEdge();
	runtime.m_machine.vdp().commitViewSnapshot(*EngineCore::instance().view());
}

void RuntimeVblankState::completeTickIfPending(Runtime& runtime, FrameState& frameState, uint64_t vblankSequence) {
	if (m_lastCompletedVblankSequence == vblankSequence) {
		return;
	}
	m_activeTickCompleted = true;
	runtime.machineScheduler.enqueueTickCompletion(runtime, frameState);
	m_lastCompletedVblankSequence = vblankSequence;
}

} // namespace bmsx
