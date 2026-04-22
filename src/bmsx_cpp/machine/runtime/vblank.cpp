#include "machine/runtime/vblank.h"

#include "core/engine.h"
#include "machine/bus/io.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/cpu_executor.h"
#include "machine/runtime/timing/config.h"
#include "machine/scheduler/device.h"
#include <algorithm>
#include <limits>
#include <stdexcept>

namespace bmsx {

void VblankState::configureCycleBudget(Runtime& runtime) {
	if (m_vblankCycles <= 0) {
		return;
	}
	const int cycleBudgetPerFrame = runtime.timing.cycleBudgetPerFrame;
	if (m_vblankCycles > cycleBudgetPerFrame) {
		throw BMSX_RUNTIME_ERROR("Runtime fault: vblank_cycles must be less than or equal to cycles_per_frame.");
	}
	m_vblankStartCycle = cycleBudgetPerFrame - m_vblankCycles;
	reset(runtime);
}

void VblankState::setVblankCycles(Runtime& runtime, int cycles) {
	if (cycles <= 0) {
		throw BMSX_RUNTIME_ERROR("Runtime fault: vblank_cycles must be greater than 0.");
	}
	const int cycleBudgetPerFrame = runtime.timing.cycleBudgetPerFrame;
	if (cycles > cycleBudgetPerFrame) {
		throw BMSX_RUNTIME_ERROR("Runtime fault: vblank_cycles must be less than or equal to cycles_per_frame.");
	}
	m_vblankCycles = cycles;
	m_vblankStartCycle = cycleBudgetPerFrame - m_vblankCycles;
	reset(runtime);
}

int VblankState::getCyclesIntoFrame(const Runtime& runtime) const {
	return static_cast<int>(runtime.m_machine.scheduler().nowCycles() - m_frameStartCycle);
}

void VblankState::resetScheduler(Runtime& runtime) {
	runtime.m_machine.scheduler().reset();
	m_frameStartCycle = 0;
}

void VblankState::reset(Runtime& runtime) {
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

RuntimeVblankSnapshot VblankState::capture(const Runtime& runtime) const {
	RuntimeVblankSnapshot state;
	state.cyclesIntoFrame = getCyclesIntoFrame(runtime);
	return state;
}

void VblankState::restore(Runtime& runtime, const RuntimeVblankSnapshot& state) {
	clearHaltUntilIrq(runtime);
	runtime.frameScheduler.reset();
	runtime.frameLoop.reset();
	runtime.screen.reset();
	resetScheduler(runtime);
	runtime.m_machine.scheduler().setNowCycles(state.cyclesIntoFrame);
	m_frameStartCycle = 0;
	m_vblankSequence = 0;
	m_lastCompletedVblankSequence = 0;
	m_activeTickCompleted = false;
	runtime.m_machine.irqController().postLoad();
	setVblankStatus(runtime, m_vblankStartCycle == 0 || getCyclesIntoFrame(runtime) >= m_vblankStartCycle);
	scheduleCurrentFrameTimers(runtime);
	refreshDeviceTimings(runtime, runtime.m_machine.scheduler().nowCycles());
}

void VblankState::beginTick() {
	m_activeTickCompleted = false;
}

void VblankState::abandonTick() {
	m_activeTickCompleted = false;
}

void VblankState::handleBeginTimer(Runtime& runtime) {
	if (!m_vblankActive) {
		enterVblank(runtime);
	}
}

void VblankState::handleEndTimer(Runtime& runtime) {
	if (m_vblankActive) {
		setVblankStatus(runtime, false);
	}
	m_frameStartCycle = runtime.m_machine.scheduler().nowCycles();
	scheduleCurrentFrameTimers(runtime);
	if (m_vblankStartCycle == 0) {
		enterVblank(runtime);
	}
}

void VblankState::clearHaltUntilIrq(Runtime& runtime) {
	runtime.m_machine.cpu().clearHaltUntilIrq();
	resetHaltIrqWait();
	m_clearBackQueuesAfterIrqWake = false;
}

bool VblankState::consumeBackQueueClearAfterIrqWake() {
	if (!m_clearBackQueuesAfterIrqWake) {
		return false;
	}
	m_clearBackQueuesAfterIrqWake = false;
	return true;
}

bool VblankState::runHaltedUntilIrq(Runtime& runtime, FrameState& frameState) {
	auto& cpu = runtime.m_machine.cpu();
	auto& irqController = runtime.m_machine.irqController();
	auto& scheduler = runtime.m_machine.scheduler();
	int& cycleBudgetRemaining = frameState.cycleBudgetRemaining;
	runDueRuntimeTimers(runtime);
	if (!cpu.isHaltedUntilIrq()) {
		resetHaltIrqWait();
		return false;
	}
	if (tryCompleteTickOnPendingVblankIrq(runtime, frameState)) {
		return true;
	}
	while (true) {
		const uint32_t signalSequence = irqController.signalSequence();
		if (!m_haltIrqWaitArmed) {
			if (irqController.pendingFlags() != 0u) {
				cpu.clearHaltUntilIrq();
				return m_activeTickCompleted;
			}
			m_haltIrqSignalSequence = signalSequence;
			m_haltIrqWaitArmed = true;
		} else if (signalSequence != m_haltIrqSignalSequence) {
			cpu.clearHaltUntilIrq();
			resetHaltIrqWait();
			return m_activeTickCompleted;
		}
		if (cycleBudgetRemaining > 0) {
			const i64 cyclesToTarget = scheduler.nextDeadline() - scheduler.nowCycles();
			if (cyclesToTarget <= 0) {
				runDueRuntimeTimers(runtime);
				continue;
			}
			const int idleCycles = static_cast<int>(std::min<i64>(cycleBudgetRemaining, cyclesToTarget));
			cycleBudgetRemaining -= idleCycles;
			advanceRuntimeTime(runtime, idleCycles);
			if (tryCompleteTickOnPendingVblankIrq(runtime, frameState)) {
				return true;
			}
			continue;
		}
		return true;
	}
}

void VblankState::scheduleCurrentFrameTimers(Runtime& runtime) {
	auto& scheduler = runtime.m_machine.scheduler();
	scheduler.scheduleVblankTimer(TimerKindVblankEnd, m_frameStartCycle + runtime.timing.cycleBudgetPerFrame);
	if (m_vblankStartCycle > 0 && getCyclesIntoFrame(runtime) < m_vblankStartCycle) {
		scheduler.scheduleVblankTimer(TimerKindVblankBegin, m_frameStartCycle + m_vblankStartCycle);
	}
}

void VblankState::setVblankStatus(Runtime& runtime, bool active) {
	m_vblankActive = active;
	runtime.m_machine.vdp().setVblankStatus(active);
}

void VblankState::enterVblank(Runtime& runtime) {
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

void VblankState::resetHaltIrqWait() {
	m_haltIrqWaitArmed = false;
	m_haltIrqSignalSequence = 0;
}

bool VblankState::tryCompleteTickOnPendingVblankIrq(Runtime& runtime, FrameState& frameState) {
	if (!isFrameBoundaryHalt(runtime)) {
		return false;
	}
	if (m_vblankSequence == 0) {
		return false;
	}
	if ((runtime.m_machine.irqController().pendingFlags() & IRQ_VBLANK) == 0u) {
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

bool VblankState::isFrameBoundaryHalt(Runtime& runtime) const {
	return runtime.m_machine.cpu().getFrameDepth() == 1
		&& runtime.m_pendingCall == Runtime::PendingCall::Entry
		&& runtime.m_machine.cpu().isHaltedUntilIrq();
}

void VblankState::commitFrameOnVblankEdge(Runtime& runtime) {
	runtime.m_machine.vdp().syncRegisters();
	runtime.m_machine.vdp().presentReadyFrameOnVblankEdge();
	runtime.m_machine.vdp().commitViewSnapshot(*EngineCore::instance().view());
}

void VblankState::completeTickIfPending(Runtime& runtime, FrameState& frameState, uint64_t vblankSequence) {
	if (m_lastCompletedVblankSequence == vblankSequence) {
		return;
	}
	m_activeTickCompleted = true;
	runtime.frameScheduler.enqueueTickCompletion(runtime, frameState);
	m_lastCompletedVblankSequence = vblankSequence;
}

} // namespace bmsx
