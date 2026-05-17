#include "machine/runtime/vblank.h"

#include "machine/bus/io.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/timing/config.h"
#include "machine/scheduler/device.h"

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
	return static_cast<int>(runtime.machine.scheduler.nowCycles() - m_frameStartCycle);
}

void VblankState::resetScheduler(Runtime& runtime) {
	runtime.machine.scheduler.reset();
	m_frameStartCycle = 0;
}

void VblankState::reset(Runtime& runtime) {
	resetScheduler(runtime);
	m_vblankActive = false;
	m_vblankSequence = 0;
	m_lastCompletedVblankSequence = 0;
	runtime.machine.inputController.cancelSampleArm();
	runtime.machine.irqController.postLoad();
	runtime.machine.vdp.resetStatus();
	if (m_vblankStartCycle == 0) {
		publishVblankTiming(runtime, true);
	}
	scheduleCurrentFrameTimers(runtime);
	refreshDeviceTimings(runtime, runtime.machine.scheduler.nowCycles());
}

RuntimeVblankSnapshot VblankState::capture(const Runtime& runtime) const {
	RuntimeVblankSnapshot state;
	state.cyclesIntoFrame = getCyclesIntoFrame(runtime);
	return state;
}

void VblankState::restore(Runtime& runtime, const RuntimeVblankSnapshot& state) {
	runtime.frameScheduler.reset();
	runtime.frameLoop.reset();
	runtime.screen.reset();
	resetScheduler(runtime);
	runtime.machine.scheduler.setNowCycles(state.cyclesIntoFrame);
	m_frameStartCycle = 0;
	m_vblankSequence = 0;
	m_lastCompletedVblankSequence = 0;
	m_activeTickCompleted = false;
	runtime.machine.irqController.postLoad();
	publishVblankTiming(runtime, m_vblankStartCycle == 0 || getCyclesIntoFrame(runtime) >= m_vblankStartCycle);
	scheduleCurrentFrameTimers(runtime);
	refreshDeviceTimings(runtime, runtime.machine.scheduler.nowCycles());
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
	m_frameStartCycle = runtime.machine.scheduler.nowCycles();
	if (m_vblankStartCycle == 0) {
		scheduleCurrentFrameTimers(runtime);
		enterVblank(runtime);
		return;
	}
	if (m_vblankActive) {
		publishVblankTiming(runtime, false);
	}
	scheduleCurrentFrameTimers(runtime);
}

void VblankState::scheduleCurrentFrameTimers(Runtime& runtime) {
	auto& scheduler = runtime.machine.scheduler;
	scheduler.scheduleVblankTimer(TimerKindVblankEnd, m_frameStartCycle + runtime.timing.cycleBudgetPerFrame);
	if (m_vblankStartCycle > 0 && getCyclesIntoFrame(runtime) < m_vblankStartCycle) {
		scheduler.scheduleVblankTimer(TimerKindVblankBegin, m_frameStartCycle + m_vblankStartCycle);
	}
}

void VblankState::publishVblankTiming(Runtime& runtime, bool active) {
	m_vblankActive = active;
	runtime.machine.vdp.setScanoutTiming(active, getCyclesIntoFrame(runtime), runtime.timing.cycleBudgetPerFrame, m_vblankStartCycle);
}

void VblankState::enterVblank(Runtime& runtime) {
	m_vblankSequence += 1;
	runtime.screen.executeReadyVdpFrameBuffer(runtime);
	runtime.machine.vdp.presentReadyFrameOnVblankEdge();
	runtime.machine.inputController.onVblankEdge(runtime.frameLoop.currentTimeSeconds * 1000.0, static_cast<u32>(runtime.machine.scheduler.nowCycles()));
	publishVblankTiming(runtime, true);
	runtime.machine.irqController.raise(IRQ_VBLANK);
	if (runtime.frameLoop.frameActive) {
		completeTickIfPending(runtime, runtime.frameLoop.frameState, m_vblankSequence);
	}
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
