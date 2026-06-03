#include "machine/scheduler/device.h"

#include "machine/cpu/cpu.h"

#include <limits>
#include <stdexcept>
#include <string>

namespace bmsx {
namespace {
constexpr uint8_t TIMER_EVENT_KIND_SHIFT = 8;
}

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
	m_vblankEnterTimerGeneration = 0;
	m_vblankEndTimerGeneration = 0;
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
	if (m_timerCount == 0u) {
		return std::numeric_limits<i64>::max();
	}
	return m_timerDeadlines[0];
}

bool DeviceScheduler::hasDueTimer() {
	discardStaleTopTimers();
	return m_timerCount > 0u && m_timerDeadlines[0] <= m_schedulerNowCycles;
}

uint16_t DeviceScheduler::popDueTimer() {
	const uint8_t kind = m_timerKinds[0];
	const uint8_t payload = m_timerPayloads[0];
	removeTopTimer();
	return static_cast<uint16_t>((static_cast<uint16_t>(kind) << TIMER_EVENT_KIND_SHIFT) | payload);
}

void DeviceScheduler::scheduleVblankTimer(uint8_t timerKind, i64 deadlineCycles) {
	uint32_t generation;
	if (timerKind == TimerKindVblankBegin) {
		generation = nextTimerGeneration(m_vblankEnterTimerGeneration);
		m_vblankEnterTimerGeneration = generation;
	} else {
		generation = nextTimerGeneration(m_vblankEndTimerGeneration);
		m_vblankEndTimerGeneration = generation;
	}
	pushTimer(deadlineCycles, timerKind, 0u, generation);
	requestYieldForEarlierDeadline(deadlineCycles);
}

void DeviceScheduler::scheduleDeviceService(uint8_t deviceKind, i64 deadlineCycles) {
	const uint32_t generation = nextTimerGeneration(m_deviceServiceTimerGeneration[deviceKind]);
	m_deviceServiceTimerGeneration[deviceKind] = generation;
	pushTimer(deadlineCycles, TimerKindDeviceService, deviceKind, generation);
	requestYieldForEarlierDeadline(deadlineCycles);
}

void DeviceScheduler::cancelDeviceService(uint8_t deviceKind) {
	uint32_t& generation = m_deviceServiceTimerGeneration[deviceKind];
	generation = nextTimerGeneration(generation);
}

void DeviceScheduler::clearTimerHeap() {
	m_timerCount = 0;
	m_timerDeadlines.clear();
	m_timerKinds.clear();
	m_timerPayloads.clear();
	m_timerGenerations.clear();
}

void DeviceScheduler::pushTimer(i64 deadline, uint8_t kind, uint8_t payload, uint32_t generation) {
	size_t index = m_timerCount;
	m_timerCount += 1;
	m_timerDeadlines.push_back(deadline);
	m_timerKinds.push_back(kind);
	m_timerPayloads.push_back(payload);
	m_timerGenerations.push_back(generation);
	while (index > 0) {
		const size_t parent = (index - 1u) >> 1u;
		if (m_timerDeadlines[parent] <= deadline) {
			break;
		}
		m_timerDeadlines[index] = m_timerDeadlines[parent];
		m_timerKinds[index] = m_timerKinds[parent];
		m_timerPayloads[index] = m_timerPayloads[parent];
		m_timerGenerations[index] = m_timerGenerations[parent];
		index = parent;
	}
	m_timerDeadlines[index] = deadline;
	m_timerKinds[index] = kind;
	m_timerPayloads[index] = payload;
	m_timerGenerations[index] = generation;
}

void DeviceScheduler::removeTopTimer() {
	if (m_timerCount == 0u) {
		return;
	}
	const size_t lastIndex = m_timerCount - 1u;
	const i64 deadline = m_timerDeadlines[lastIndex];
	const uint8_t kind = m_timerKinds[lastIndex];
	const uint8_t payload = m_timerPayloads[lastIndex];
	const uint32_t generation = m_timerGenerations[lastIndex];
	m_timerCount = lastIndex;
	m_timerDeadlines.pop_back();
	m_timerKinds.pop_back();
	m_timerPayloads.pop_back();
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
		m_timerKinds[index] = m_timerKinds[child];
		m_timerPayloads[index] = m_timerPayloads[child];
		m_timerGenerations[index] = m_timerGenerations[child];
		index = child;
	}
	m_timerDeadlines[index] = deadline;
	m_timerKinds[index] = kind;
	m_timerPayloads[index] = payload;
	m_timerGenerations[index] = generation;
}

bool DeviceScheduler::isTimerCurrent(uint8_t kind, uint8_t payload, uint32_t generation) const {
	switch (kind) {
		case TimerKindVblankBegin:
			return generation == m_vblankEnterTimerGeneration;
		case TimerKindVblankEnd:
			return generation == m_vblankEndTimerGeneration;
		case TimerKindDeviceService:
			return generation == m_deviceServiceTimerGeneration[payload];
		default:
			throw std::runtime_error("Runtime fault: unknown timer kind " + std::to_string(kind) + ".");
	}
}

void DeviceScheduler::discardStaleTopTimers() {
	while (m_timerCount > 0u) {
		if (isTimerCurrent(m_timerKinds[0], m_timerPayloads[0], m_timerGenerations[0])) {
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
