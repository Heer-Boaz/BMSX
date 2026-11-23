#include "machine/scheduler/device.h"

#include "common/scope_exit.h"
#include "machine/cpu/cpu.h"

#include <limits>

namespace bmsx {

DeviceScheduler::DeviceScheduler(CPU& cpu)
	: m_cpu(cpu) {
}

uint32_t DeviceScheduler::nextTimerGeneration(uint32_t value) {
	const uint32_t next = value + 1u;
	return next == 0u ? 1u : next;
}

void DeviceScheduler::setNowCycles(i64 nowCycles) {
	m_schedulerNowCycles = nowCycles;
}

void DeviceScheduler::reset() {
	clearTimerHeap();
	m_schedulerNowCycles = 0;
	m_schedulerSliceActive = false;
	m_activeSliceBaseCycle = 0;
	m_activeSliceBudgetCycles = 0;
	m_activeSliceTargetCycle = 0;
	m_deviceServiceTimerGeneration.fill(0);
}

i64 DeviceScheduler::currentNowCycles() const {
	if (!m_schedulerSliceActive) {
		return m_schedulerNowCycles;
	}
	return m_activeSliceBaseCycle + (m_activeSliceBudgetCycles - m_cpu.instructionBudgetRemaining);
}

RunResult DeviceScheduler::runCpuSlice(int targetDepth, int sliceBudget, u32 targetThread, CpuRunKind kind) {
	beginCpuSlice(sliceBudget);
	ScopeExit activeSlice([this]() { endCpuSlice(); });
#if defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	DiagnosticCpuSliceMeasurement measurement(diagnosticCpuTiming, sliceBudget, m_cpu.instructionBudgetRemaining);
#endif
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	// Same admission/consumption boundary as CpuTopologyDiagnostic::scheduler;
	// this bounded probe needs the cumulative count/sum, not its histograms.
	const DiagnosticExecutionProfile before = m_cpu.diagnosticExecutionProfile();
	const auto result = m_cpu.runUntilDepth(targetDepth, sliceBudget, targetThread, kind);
	const auto& after = m_cpu.diagnosticExecutionProfile();
	const i64 consumed = static_cast<i64>(sliceBudget) - m_cpu.instructionBudgetRemaining;
	const i64 native = after.nativeOriginCycles - before.nativeOriginCycles;
	++diagnosticCpuSliceCount;
	diagnosticCpuSliceConsumedCycles += consumed;
	diagnosticNativeOriginCycles += native;
	diagnosticInterpreterRuntimeCycles += consumed - native;
	diagnosticNativeOpcodes.newt += after.nativeOpcodes.newt - before.nativeOpcodes.newt;
	diagnosticNativeOpcodes.call += after.nativeOpcodes.call - before.nativeOpcodes.call;
	diagnosticNativeOpcodes.setfield += after.nativeOpcodes.setfield - before.nativeOpcodes.setfield;
	diagnosticNativeOpcodes.concat += after.nativeOpcodes.concat - before.nativeOpcodes.concat;
	diagnosticNativeOpcodes.concatn += after.nativeOpcodes.concatn - before.nativeOpcodes.concatn;
	diagnosticInterpreterOpcodes.newt += after.interpreterOpcodes.newt - before.interpreterOpcodes.newt;
	diagnosticInterpreterOpcodes.call += after.interpreterOpcodes.call - before.interpreterOpcodes.call;
	diagnosticInterpreterOpcodes.setfield += after.interpreterOpcodes.setfield - before.interpreterOpcodes.setfield;
	diagnosticInterpreterOpcodes.concat += after.interpreterOpcodes.concat - before.interpreterOpcodes.concat;
	diagnosticInterpreterOpcodes.concatn += after.interpreterOpcodes.concatn - before.interpreterOpcodes.concatn;
	return result;
#else
	return m_cpu.runUntilDepth(targetDepth, sliceBudget, targetThread, kind);
#endif
}

void DeviceScheduler::advanceTo(i64 nowCycles) {
	m_schedulerNowCycles = nowCycles;
}

i64 DeviceScheduler::nextDeadline() {
	discardStaleTopTimers();
	if (m_timerDeadlines.empty()) {
		return std::numeric_limits<i64>::max();
	}
	return m_timerDeadlines[0];
}

bool DeviceScheduler::hasDueTimer() {
	discardStaleTopTimers();
	return !m_timerDeadlines.empty() && m_timerDeadlines[0] <= m_schedulerNowCycles;
}

uint8_t DeviceScheduler::popDueTimer() {
	const uint8_t deviceKind = m_timerDeviceKinds[0];
	removeTopTimer();
	return deviceKind;
}

void DeviceScheduler::scheduleDeviceService(uint8_t deviceKind, i64 deadlineCycles) {
	const uint32_t generation = nextTimerGeneration(m_deviceServiceTimerGeneration[deviceKind]);
	m_deviceServiceTimerGeneration[deviceKind] = generation;
	pushTimer(deadlineCycles, deviceKind, generation);
	requestYieldForEarlierDeadline(deadlineCycles);
}

void DeviceScheduler::cancelDeviceService(uint8_t deviceKind) {
	uint32_t& generation = m_deviceServiceTimerGeneration[deviceKind];
	generation = nextTimerGeneration(generation);
}

void DeviceScheduler::clearTimerHeap() {
	m_timerDeadlines.clear();
	m_timerDeviceKinds.clear();
	m_timerGenerations.clear();
}

void DeviceScheduler::pushTimer(i64 deadline, uint8_t deviceKind, uint32_t generation) {
	size_t index = m_timerDeadlines.size();
	m_timerDeadlines.push_back(deadline);
	m_timerDeviceKinds.push_back(deviceKind);
	m_timerGenerations.push_back(generation);
	while (index > 0) {
		const size_t parent = (index - 1u) >> 1u;
		if (m_timerDeadlines[parent] < deadline ||
			(m_timerDeadlines[parent] == deadline && m_timerDeviceKinds[parent] <= deviceKind)) {
			break;
		}
		m_timerDeadlines[index] = m_timerDeadlines[parent];
		m_timerDeviceKinds[index] = m_timerDeviceKinds[parent];
		m_timerGenerations[index] = m_timerGenerations[parent];
		index = parent;
	}
	m_timerDeadlines[index] = deadline;
	m_timerDeviceKinds[index] = deviceKind;
	m_timerGenerations[index] = generation;
}

void DeviceScheduler::removeTopTimer() {
	const size_t lastIndex = m_timerDeadlines.size() - 1u;
	const i64 deadline = m_timerDeadlines[lastIndex];
	const uint8_t deviceKind = m_timerDeviceKinds[lastIndex];
	const uint32_t generation = m_timerGenerations[lastIndex];
	m_timerDeadlines.pop_back();
	m_timerDeviceKinds.pop_back();
	m_timerGenerations.pop_back();
	if (lastIndex == 0u) {
		return;
	}
	size_t index = 0u;
	while (index < (lastIndex >> 1u)) {
		size_t child = (index << 1u) + 1u;
		if (child + 1u < lastIndex && (m_timerDeadlines[child + 1u] < m_timerDeadlines[child] ||
			(m_timerDeadlines[child + 1u] == m_timerDeadlines[child] && m_timerDeviceKinds[child + 1u] < m_timerDeviceKinds[child]))) {
			child += 1u;
		}
		if (m_timerDeadlines[child] > deadline ||
			(m_timerDeadlines[child] == deadline && m_timerDeviceKinds[child] >= deviceKind)) {
			break;
		}
		m_timerDeadlines[index] = m_timerDeadlines[child];
		m_timerDeviceKinds[index] = m_timerDeviceKinds[child];
		m_timerGenerations[index] = m_timerGenerations[child];
		index = child;
	}
	m_timerDeadlines[index] = deadline;
	m_timerDeviceKinds[index] = deviceKind;
	m_timerGenerations[index] = generation;
}

void DeviceScheduler::discardStaleTopTimers() {
	while (!m_timerDeadlines.empty()) {
		if (m_timerGenerations[0] == m_deviceServiceTimerGeneration[m_timerDeviceKinds[0]]) {
			return;
		}
		removeTopTimer();
	}
}

void DeviceScheduler::requestYieldForEarlierDeadline(i64 deadlineCycles) {
	if (!m_schedulerSliceActive) {
		return;
	}
	if (deadlineCycles > m_activeSliceTargetCycle) {
		return;
	}
	m_cpu.requestYield();
}

} // namespace bmsx
