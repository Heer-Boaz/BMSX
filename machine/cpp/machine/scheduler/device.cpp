#include "machine/scheduler/device.h"

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

void DeviceScheduler::beginCpuSlice(int sliceBudget) {
	m_schedulerSliceActive = true;
	m_activeSliceBaseCycle = m_schedulerNowCycles;
	m_activeSliceBudgetCycles = sliceBudget;
	m_activeSliceTargetCycle = m_schedulerNowCycles + sliceBudget;
}

void DeviceScheduler::endCpuSlice() {
	m_schedulerSliceActive = false;
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
		if (m_timerDeadlines[parent] <= deadline) {
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
		if (child + 1u < lastIndex && m_timerDeadlines[child + 1u] < m_timerDeadlines[child]) {
			child += 1u;
		}
		if (m_timerDeadlines[child] >= deadline) {
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
