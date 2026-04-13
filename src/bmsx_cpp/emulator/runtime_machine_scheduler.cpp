#include "runtime_machine_scheduler.h"
#include "runtime.h"
#include "../utils/clamp.h"
#include <cmath>
#include <stdexcept>

namespace bmsx {
namespace {
constexpr int MAX_QUEUED_FRAMES = 5;

inline std::runtime_error runtimeFault(const std::string& message) {
	return std::runtime_error(std::string("Runtime fault: ") + message);
}
}

void RuntimeMachineSchedulerState::queueHostCycles(const Runtime& runtime, f64 deltaMs) {
	const f64 totalCycles = m_queuedCycleRemainder + (deltaMs * static_cast<f64>(runtime.m_cpuHz) / 1000.0);
	const i64 wholeCycles = static_cast<i64>(std::floor(totalCycles));
	m_queuedCycleRemainder = totalCycles - static_cast<f64>(wholeCycles);
	m_queuedCycleBudget = clamp(m_queuedCycleBudget + wholeCycles, static_cast<i64>(0), static_cast<i64>(runtime.m_cycleBudgetPerFrame) * static_cast<i64>(MAX_QUEUED_FRAMES));
}

bool RuntimeMachineSchedulerState::canRunScheduledUpdate(const Runtime& runtime) const {
	if (!runtime.m_luaInitialized || !runtime.m_tickEnabled || runtime.m_runtimeFailed) {
		return false;
	}
	if (runtime.m_frameActive && runtime.m_frameState.cycleBudgetRemaining > 0) {
		return true;
	}
	return m_queuedCycleBudget >= runtime.m_cycleBudgetPerFrame;
}

bool RuntimeMachineSchedulerState::consumeQueuedFrame(const Runtime& runtime) {
	if (m_queuedCycleBudget < runtime.m_cycleBudgetPerFrame) {
		return false;
	}
	m_queuedCycleBudget -= runtime.m_cycleBudgetPerFrame;
	return true;
}

void RuntimeMachineSchedulerState::clearQueuedTime() {
	m_queuedCycleBudget = 0;
	m_queuedCycleRemainder = 0.0;
}

void RuntimeMachineSchedulerState::clearTickCompletionQueue(Runtime& runtime) {
	m_tickCompletionReadIndex = 0;
	m_tickCompletionWriteIndex = 0;
	m_tickCompletionCount = 0;
	runtime.m_lastTickConsumedSequence = runtime.m_lastTickSequence;
}

void RuntimeMachineSchedulerState::reset(Runtime& runtime) {
	clearQueuedTime();
	clearTickCompletionQueue(runtime);
}

void RuntimeMachineSchedulerState::enqueueTickCompletion(Runtime& runtime, FrameState& frameState) {
	if (m_tickCompletionCount >= TICK_COMPLETION_QUEUE_CAPACITY) {
		throw runtimeFault("tick completion queue overflow.");
	}
	TickCompletion& slot = m_tickCompletionQueue[m_tickCompletionWriteIndex];
	const i64 sequence = runtime.m_lastTickSequence + 1;
	slot.sequence = sequence;
	slot.remaining = frameState.cycleBudgetRemaining;
	slot.visualCommitted = runtime.m_vdp.lastFrameCommitted();
	slot.vdpFrameCost = runtime.m_vdp.lastFrameCost();
	slot.vdpFrameHeld = runtime.m_vdp.lastFrameHeld();
	m_tickCompletionWriteIndex = (m_tickCompletionWriteIndex + 1) % TICK_COMPLETION_QUEUE_CAPACITY;
	m_tickCompletionCount += 1;
	runtime.m_lastTickBudgetGranted = frameState.cycleBudgetGranted;
	runtime.m_lastTickCpuBudgetGranted = frameState.cycleBudgetGranted;
	runtime.m_lastTickCpuUsedCycles = frameState.activeCpuUsedCycles;
	runtime.m_lastTickBudgetRemaining = frameState.cycleBudgetRemaining;
	runtime.m_lastTickVisualFrameCommitted = slot.visualCommitted;
	runtime.m_lastTickVdpFrameCost = slot.vdpFrameCost;
	runtime.m_lastTickVdpFrameHeld = slot.vdpFrameHeld;
	runtime.m_lastTickCompleted = true;
	runtime.m_lastTickSequence = sequence;
}

bool RuntimeMachineSchedulerState::consumeTickCompletion(Runtime& runtime, TickCompletion& outCompletion) {
	if (m_tickCompletionCount == 0u) {
		return false;
	}
	outCompletion = m_tickCompletionQueue[m_tickCompletionReadIndex];
	m_tickCompletionReadIndex = (m_tickCompletionReadIndex + 1) % TICK_COMPLETION_QUEUE_CAPACITY;
	m_tickCompletionCount -= 1u;
	runtime.m_lastTickConsumedSequence = outCompletion.sequence;
	return true;
}

bool RuntimeMachineSchedulerState::refillFrameBudget(Runtime& runtime, FrameState& frameState) {
	if (!consumeQueuedFrame(runtime)) {
		return false;
	}
	frameState.cycleBudgetRemaining += runtime.m_cycleBudgetPerFrame;
	frameState.cycleBudgetGranted += runtime.m_cycleBudgetPerFrame;
	return true;
}

bool RuntimeMachineSchedulerState::startScheduledFrame(Runtime& runtime) {
	if (!consumeQueuedFrame(runtime)) {
		return false;
	}
	runtime.beginFrameState();
	return true;
}

void RuntimeMachineSchedulerState::run(Runtime& runtime, f64 hostDeltaMs) {
	queueHostCycles(runtime, hostDeltaMs);
	while (canRunScheduledUpdate(runtime)) {
		const bool progressed = runtime.tickUpdate();
		if (runtime.hasActiveTick() && !progressed) {
			break;
		}
	}
}

} // namespace bmsx
